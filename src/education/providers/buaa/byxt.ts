import { importEducationDocument, type EducationImportResult, type ImportedCourse } from "../../importer.ts";
import { EducationRepo } from "../../../storage/education-repo.ts";
import { nowIso } from "../../../utils/time.ts";
import {
  BuaaSessionClient,
  addDays,
  combineShanghaiDateTime,
  decodeJson,
  ensureOk,
  loginBuaaSsoWithPassword,
  normalizeDateOnly,
  normalizeCourseHint,
  normalizeTeacherLabel,
  resolveBuaaBaseUrls,
  type BuaaBaseUrls,
  type FetchLike,
} from "./shared.ts";

interface ByxtTerm {
  itemCode: string;
  itemName: string;
  selected?: boolean;
}

interface ByxtWeek {
  startDate: string;
  endDate: string;
  serialNumber: number;
  name: string;
}

interface ByxtCourseClass {
  courseCode: string;
  courseName: string;
  courseSerialNo?: string | null;
  credit?: string | null;
  beginTime?: string | null;
  endTime?: string | null;
  beginSection?: number | null;
  endSection?: number | null;
  placeName?: string | null;
  weeksAndTeachers?: string | null;
  teachingTarget?: string | null;
  color?: string | null;
  dayOfWeek?: number | null;
}

interface ByxtTermsEnvelope {
  datas: ByxtTerm[];
  code: string;
  msg?: string | null;
}

interface ByxtWeeksEnvelope {
  datas: ByxtWeek[];
  code: string;
  msg?: string | null;
}

interface ByxtWeeklyScheduleEnvelope {
  datas: {
    arrangedList: ByxtCourseClass[];
    code: string;
    name: string;
  };
  code: string;
  msg?: string | null;
}

interface UcStatusEnvelope {
  code: number;
  data?: {
    name?: string | null;
    schoolid?: string | null;
  } | null;
}

export interface BuaaByxtAuth {
  username?: string | null;
  password?: string | null;
  cookie?: string | null;
  accountLabel?: string | null;
  displayName?: string | null;
}

export interface BuaaByxtSyncOptions {
  auth: BuaaByxtAuth;
  termCode?: string | null;
  baseUrls?: Partial<BuaaBaseUrls> | null;
  fetchImpl?: FetchLike;
}

export interface BuaaByxtSyncResult extends EducationImportResult {
  termCode: string;
  termName: string;
  importedWeeks: number;
}

const scheduleHeaders = (baseUrls: BuaaBaseUrls): HeadersInit => ({
  accept: "application/json, text/javascript, */*; q=0.01",
  "x-requested-with": "XMLHttpRequest",
  referer: `${baseUrls.byxtBase}/jwapp/sys/homeapp/index.html`,
});

const selectTerm = (terms: ByxtTerm[], preferredTermCode?: string | null): ByxtTerm => {
  if (!terms.length) {
    throw new Error("BYXT did not return any term information.");
  }

  if (preferredTermCode?.trim()) {
    const matched = terms.find((term) => term.itemCode === preferredTermCode);
    if (!matched) {
      throw new Error(`BYXT term ${preferredTermCode} was not found.`);
    }
    return matched;
  }

  return terms.find((term) => term.selected) ?? terms[0];
};

const stableCourseSourceId = (item: ByxtCourseClass): string | null => {
  const bits = [item.courseCode?.trim(), item.courseSerialNo?.trim()].filter(Boolean);
  return bits.length ? bits.join(":") : null;
};

const stableClassSourceId = (termCode: string, weekSerial: number, item: ByxtCourseClass): string => {
  const parts = [
    termCode,
    `week-${weekSerial}`,
    item.courseCode || item.courseName,
    item.courseSerialNo || "",
    String(item.dayOfWeek ?? ""),
    item.beginTime || "",
    item.endTime || "",
    item.placeName || "",
  ];
  return parts.join(":");
};

const buildUcStatusUrl = (baseUrls: BuaaBaseUrls): string => `${baseUrls.ucBase}/api/uc/status`;
const buildUcActivateUrl = (baseUrls: BuaaBaseUrls): string =>
  `${baseUrls.ucBase}/api/login?target=${encodeURIComponent(`${baseUrls.ucBase}/#/user/login`)}`;
const buildByxtCurrentUserUrl = (baseUrls: BuaaBaseUrls): string =>
  `${baseUrls.byxtBase}/jwapp/sys/homeapp/api/home/currentUser.do`;
const buildTermsUrl = (baseUrls: BuaaBaseUrls): string =>
  `${baseUrls.byxtBase}/jwapp/sys/homeapp/api/home/student/schoolCalendars.do`;
const buildWeeksUrl = (baseUrls: BuaaBaseUrls, termCode: string): string =>
  `${baseUrls.byxtBase}/jwapp/sys/homeapp/api/home/getTermWeeks.do?termCode=${encodeURIComponent(termCode)}`;
const buildWeekScheduleUrl = (baseUrls: BuaaBaseUrls): string =>
  `${baseUrls.byxtBase}/jwapp/sys/homeapp/api/home/student/getMyScheduleDetail.do`;

const isSsoLoginPage = (bodyText: string, finalUrl: string): boolean =>
  finalUrl.includes("sso.buaa.edu.cn/login") ||
  (/name=["']execution["']/i.test(bodyText) && /CAS Login|缁熶竴韬唤璁よ瘉/i.test(bodyText));

const isJsonLike = (bodyText: string): boolean => {
  const trimmed = bodyText.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
};

const isByxtSessionReady = (bodyText: string, finalUrl: string, status: number): boolean => {
  if (status === 401) return false;
  if (isSsoLoginPage(bodyText, finalUrl)) return false;
  return isJsonLike(bodyText);
};

const ensureByxtResponseUsable = (
  result: Awaited<ReturnType<BuaaSessionClient["get"]>>,
  label: string,
): void => {
  if (isSsoLoginPage(result.bodyText, result.finalUrl) || result.response.status === 401) {
    throw new Error("BUAA SSO login succeeded, but BYXT did not accept the session.");
  }
  ensureOk(result, label);
};

const establishByxtSession = async (
  client: BuaaSessionClient,
  baseUrls: BuaaBaseUrls,
): Promise<void> => {
  const currentUser = await client.get(buildByxtCurrentUserUrl(baseUrls), {
    headers: {
      accept: "application/json, text/javascript, */*; q=0.01",
      "x-requested-with": "XMLHttpRequest",
      referer: `${baseUrls.ucBase}/#/user/login`,
    },
  });
  if (!isByxtSessionReady(currentUser.bodyText, currentUser.finalUrl, currentUser.response.status)) {
    throw new Error("BUAA SSO login succeeded, but BYXT session initialization did not complete.");
  }
};

const loginWithPassword = async (
  client: BuaaSessionClient,
  auth: BuaaByxtAuth,
  baseUrls: BuaaBaseUrls,
): Promise<{ accountLabel: string; displayName: string }> => {
  if (!auth.username?.trim() || !auth.password?.trim()) {
    throw new Error("BYXT login requires username and password.");
  }

  const byxtServiceLoginUrl = `${baseUrls.ssoBase}/login?service=${encodeURIComponent(buildByxtCurrentUserUrl(baseUrls))}`;
  await loginBuaaSsoWithPassword(client, auth, baseUrls, "BUAA SSO", byxtServiceLoginUrl);

  const activate = await client.get(buildUcActivateUrl(baseUrls));
  ensureOk(activate, "BUAA UC activate");

  const status = await client.get(buildUcStatusUrl(baseUrls), {
    headers: {
      accept: "application/json, text/javascript, */*; q=0.01",
      "x-requested-with": "XMLHttpRequest",
    },
  });
  ensureOk(status, "BUAA UC status");
  const payload = decodeJson<UcStatusEnvelope>(status.bodyText, "BUAA UC status");
  if (payload.code !== 0 || !payload.data?.schoolid?.trim()) {
    throw new Error("BUAA UC login succeeded but the user session is not ready for BYXT.");
  }

  return {
    accountLabel: payload.data.schoolid.trim(),
    displayName: payload.data.name?.trim() || "",
  };
};

const requestByxtApi = async (
  client: BuaaSessionClient,
  baseUrls: BuaaBaseUrls,
  label: string,
  request: () => Promise<Awaited<ReturnType<BuaaSessionClient["get"]>>>,
): Promise<Awaited<ReturnType<BuaaSessionClient["get"]>>> => {
  let result = await request();
  if (isSsoLoginPage(result.bodyText, result.finalUrl) || result.response.status === 401) {
    await establishByxtSession(client, baseUrls);
    result = await request();
  }
  ensureByxtResponseUsable(result, label);
  return result;
};

const groupCourses = (termName: string, termCode: string, weeks: ByxtWeek[], weeklySchedules: ByxtCourseClass[][]): ImportedCourse[] => {
  const courses = new Map<string, ImportedCourse>();

  weeks.forEach((week, weekIndex) => {
    const normalizedWeekStart = normalizeDateOnly(week.startDate);
    const normalizedWeekEnd = normalizeDateOnly(week.endDate);
    for (const item of weeklySchedules[weekIndex] ?? []) {
      const teacher = normalizeTeacherLabel(item.weeksAndTeachers);
      const sourceCourseId = stableCourseSourceId(item);
      const courseKey = sourceCourseId || `${item.courseName}:${teacher || "unknown-teacher"}`;
      const startDate =
        item.dayOfWeek && normalizedWeekStart
          ? addDays(normalizedWeekStart, Math.max(item.dayOfWeek - 1, 0))
          : normalizedWeekStart;
      const startAt = combineShanghaiDateTime(startDate, item.beginTime);
      const endAt = combineShanghaiDateTime(startDate, item.endTime);

      let course = courses.get(courseKey);
      if (!course) {
        course = {
          stableKeyHint: normalizeCourseHint(item.courseName, teacher),
          sourceCourseId,
          title: item.courseName,
          teacher,
          term: termName || termCode,
          displayColor: item.color ?? null,
          metadata: {
            source: "buaa-byxt",
          },
          items: [],
        };
        courses.set(courseKey, course);
      }

      course.items?.push({
        sourceItemId: stableClassSourceId(termCode, week.serialNumber, item),
        type: "class",
        title: item.courseName,
        teacher,
        startAt,
        endAt,
        location: item.placeName ?? null,
        metaJson: {
          termCode,
          weekSerial: week.serialNumber,
          weekName: week.name,
          weekStartDate: normalizedWeekStart,
          weekEndDate: normalizedWeekEnd,
          dayOfWeek: item.dayOfWeek ?? null,
          beginSection: item.beginSection ?? null,
          endSection: item.endSection ?? null,
          courseCode: item.courseCode,
          courseSerialNo: item.courseSerialNo ?? null,
          credit: item.credit ?? null,
          teachingTarget: item.teachingTarget ?? null,
          weeksAndTeachers: teacher ? `${week.name} ${teacher}` : item.weeksAndTeachers ?? null,
        },
        lastSyncedAt: nowIso(),
      });
    }
  });

  return Array.from(courses.values());
};

export const syncBuaaByxt = async (
  repo: EducationRepo,
  options: BuaaByxtSyncOptions,
): Promise<BuaaByxtSyncResult> => {
  const baseUrls = resolveBuaaBaseUrls(options.baseUrls);
  const client = new BuaaSessionClient({
    cookie: options.auth.cookie ?? null,
    fetchImpl: options.fetchImpl,
  });

  const account = options.auth.cookie?.trim()
    ? {
        accountLabel: options.auth.accountLabel?.trim() || options.auth.username?.trim() || "buaa-user",
        displayName: options.auth.displayName?.trim() || "",
      }
    : await loginWithPassword(client, options.auth, baseUrls);

  await establishByxtSession(client, baseUrls);

  const termsResult = await requestByxtApi(client, baseUrls, "BYXT term list", () =>
    client.get(buildTermsUrl(baseUrls), { headers: scheduleHeaders(baseUrls) }),
  );
  const termsEnvelope = decodeJson<ByxtTermsEnvelope>(termsResult.bodyText, "BYXT term list");
  if (termsEnvelope.code !== "0") {
    throw new Error(`BYXT term list failed: ${termsEnvelope.msg || "unknown error"}`);
  }
  const term = selectTerm(termsEnvelope.datas, options.termCode);

  const weeksResult = await requestByxtApi(client, baseUrls, "BYXT week list", () =>
    client.get(buildWeeksUrl(baseUrls, term.itemCode), { headers: scheduleHeaders(baseUrls) }),
  );
  const weeksEnvelope = decodeJson<ByxtWeeksEnvelope>(weeksResult.bodyText, "BYXT week list");
  if (weeksEnvelope.code !== "0") {
    throw new Error(`BYXT week list failed: ${weeksEnvelope.msg || "unknown error"}`);
  }

  const weeklySchedules: ByxtCourseClass[][] = [];
  for (const week of weeksEnvelope.datas) {
    const scheduleResult = await requestByxtApi(client, baseUrls, `BYXT weekly schedule for week ${week.serialNumber}`, () =>
      client.postForm(
        buildWeekScheduleUrl(baseUrls),
        {
          termCode: term.itemCode,
          type: "week",
          week: String(week.serialNumber),
        },
        { headers: scheduleHeaders(baseUrls) },
      ),
    );
    const envelope = decodeJson<ByxtWeeklyScheduleEnvelope>(
      scheduleResult.bodyText,
      `BYXT weekly schedule for week ${week.serialNumber}`,
    );
    if (envelope.code !== "0") {
      throw new Error(`BYXT weekly schedule failed for week ${week.serialNumber}: ${envelope.msg || "unknown error"}`);
    }
    weeklySchedules.push(envelope.datas.arrangedList ?? []);
  }

  const courses = groupCourses(term.itemName, term.itemCode, weeksEnvelope.datas, weeklySchedules);
  const importedAt = nowIso();
  const result = await importEducationDocument(repo, {
    sourceType: "buaa-byxt",
    importedAt,
    connection: {
      sourceType: "buaa-byxt",
      accountLabel: account.accountLabel,
      status: "connected",
      auth: {
        mode: "cookie",
        cookie: client.cookieHeader(),
        username: options.auth.username ?? null,
        password: options.auth.password ?? null,
        displayName: account.displayName || null,
      },
      metadata: {
        termCode: term.itemCode,
        termName: term.itemName,
        weekCount: weeksEnvelope.datas.length,
        displayName: account.displayName || null,
        studentName: account.displayName || null,
      },
      lastSyncedAt: importedAt,
      lastError: null,
    },
    courses,
  });

  return {
    ...result,
    termCode: term.itemCode,
    termName: term.itemName,
    importedWeeks: weeksEnvelope.datas.length,
  };
};
