import { importEducationDocument, type EducationImportResult, type ImportedCourse, type ImportedCourseResource } from "../../importer.ts";
import type { CourseRecord } from "../../../schemas/education.ts";
import { EducationRepo } from "../../../storage/education-repo.ts";
import { nowIso } from "../../../utils/time.ts";
import {
  BuaaSessionClient,
  buildPptPrintHtml,
  createSignedMsaVideoUrl,
  decodeJson,
  extractJwtAccountFromCookieString,
  extractJwtTokenFromCookieString,
  inferCurrentAcademicTerm,
  loginBuaaSsoWithPassword,
  normalizeCourseHint,
  normalizeDateTime,
  resolveBuaaBaseUrls,
  sanitizeFileSegment,
  writeRuntimeAsset,
  type BuaaBaseUrls,
  type FetchLike,
} from "./shared.ts";

type JsonRecord = Record<string, unknown>;

export interface BuaaMsaAuth {
  username?: string | null;
  password?: string | null;
  token?: string | null;
  account?: string | null;
  cookie?: string | null;
  accountLabel?: string | null;
  displayName?: string | null;
}

export interface BuaaMsaSyncOptions {
  auth: BuaaMsaAuth;
  courseIds: string[];
  term?: string | null;
  baseUrls?: Partial<BuaaBaseUrls> | null;
  fetchImpl?: FetchLike;
}

export interface BuaaMsaSyncResult extends EducationImportResult {
  syncedCourseIds: string[];
  replayCount: number;
}

export interface BuaaMsaDiscoveryOptions {
  auth: BuaaMsaAuth;
  term?: string | null;
  baseUrls?: Partial<BuaaBaseUrls> | null;
  fetchImpl?: FetchLike;
}

export interface BuaaMsaDiscoveryResult extends EducationImportResult {
  discoveredCourseIds: string[];
  matchedCourseIds: string[];
  unmatchedCount: number;
}

interface MsaUserInfoEnvelope {
  params?: {
    id?: string | number | null;
    tenant_id?: string | number | null;
    phone?: string | number | null;
    name?: string | null;
    realname?: string | null;
    real_name?: string | null;
    user_name?: string | null;
    student_name?: string | null;
  } | null;
}

const COURSE_READY_STATUS = "6";

const normalizeText = (value: unknown): string => String(value ?? "").trim();

const normalizeTitleForMatch = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[（）]/g, (char) => (char === "（" ? "(" : ")"))
    .replace(/\s+/g, "");

const normalizeTeacherForMatch = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[【\[].*?[】\]]/g, " ")
    .replace(/[（(].*?[）)]/g, " ")
    .replace(/[主讲理论实验实践]/g, " ")
    .replace(/[、,，;；|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const hasObjectShape = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const findNestedString = (value: unknown, keys: string[], depth: number = 0): string | null => {
  if (!value || depth > 5) return null;
  if (hasObjectShape(value)) {
    for (const key of keys) {
      const candidate = value[key];
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
    for (const child of Object.values(value)) {
      const nested = findNestedString(child, keys, depth + 1);
      if (nested) return nested;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findNestedString(item, keys, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
};

const flattenCourseSessions = (courseData: unknown): JsonRecord[] => {
  const sessions: JsonRecord[] = [];
  const visit = (value: unknown): void => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!hasObjectShape(value)) return;
    const hasIdentity = "id" in value || "sub_id" in value || "subId" in value;
    const hasReplayShape =
      "sub_title" in value ||
      "title" in value ||
      "lecturer_name" in value ||
      "status" in value ||
      "sub_status" in value;
    if (hasIdentity && hasReplayShape) {
      sessions.push(value);
      return;
    }
    Object.values(value).forEach(visit);
  };

  const root = hasObjectShape(courseData) && hasObjectShape(courseData.data) ? courseData.data : courseData;
  const subList = hasObjectShape(root) ? root.sub_list ?? root.subList ?? root : root;
  visit(subList);
  return sessions;
};

const inferStreamLabel = (rawUrl: string): string => {
  if (rawUrl.includes("ppt")) return "slides-video";
  if (rawUrl.includes("tea")) return "teacher-video";
  return "video";
};

const pickReplayStartAt = (session: JsonRecord, subInfo: JsonRecord | null): string | null =>
  normalizeDateTime(
    session.live_start_time ??
      session.start_time ??
      session.begin_time ??
      session.beginTime ??
      session.record_time ??
      session.created_at ??
      subInfo?.live_start_time ??
      subInfo?.start_time,
  );

const pickReplayEndAt = (session: JsonRecord, subInfo: JsonRecord | null): string | null =>
  normalizeDateTime(
    session.live_end_time ??
      session.end_time ??
      session.endTime ??
      subInfo?.live_end_time ??
      subInfo?.end_time,
  );

const matchExistingCourseTerm = (existingCourses: CourseRecord[], title: string, teacher: string): string | null => {
  const normalizedTitle = title.trim().toLowerCase();
  const normalizedTeacher = teacher.trim().toLowerCase();
  const exact = existingCourses.find(
    (course) =>
      course.title.trim().toLowerCase() === normalizedTitle &&
      course.teacher.trim().toLowerCase() === normalizedTeacher,
  );
  if (exact) return exact.term;
  const loose = existingCourses.find((course) => course.title.trim().toLowerCase() === normalizedTitle);
  return loose?.term ?? null;
};

const findExistingTimetableCourse = (
  existingCourses: CourseRecord[],
  title: string,
  teacher: string,
): CourseRecord | null => {
  const normalizedTitle = normalizeTitleForMatch(title);
  const normalizedTeacher = normalizeTeacherForMatch(teacher);
  const timetableCourses = existingCourses.filter((course) => course.sourceType === "buaa-byxt");

  const exact = timetableCourses.find((course) => {
    const courseTitle = normalizeTitleForMatch(course.title);
    const courseTeacher = normalizeTeacherForMatch(course.teacher);
    if (courseTitle !== normalizedTitle) return false;
    if (!normalizedTeacher) return true;
    if (!courseTeacher) return true;
    return courseTeacher.includes(normalizedTeacher) || normalizedTeacher.includes(courseTeacher);
  });
  if (exact) return exact;

  return timetableCourses.find((course) => normalizeTitleForMatch(course.title) === normalizedTitle) ?? null;
};

const makeAuthorizedHeaders = (token: string, extra?: HeadersInit): HeadersInit => ({
  authorization: `Bearer ${token}`,
  ...(extra ?? {}),
});

interface MsaAuthSession {
  token: string;
  account: string;
  cookie: string;
  accountLabel: string;
}

const ensureCourseIds = (courseIds: string[]): string[] => {
  const cleaned = courseIds.map((value) => value.trim()).filter(Boolean);
  if (!cleaned.length) {
    throw new Error("MSA sync requires at least one course id.");
  }
  return Array.from(new Set(cleaned));
};

const readConnectionCourseIds = (metadata: unknown): string[] => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const raw = (metadata as Record<string, unknown>).courseIds;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
};

const extractCourseIdFromCatalogNode = (value: JsonRecord): string => {
  const direct = normalizeText(value.course_id ?? value.courseId ?? value.courseid);
  if (direct) return direct;
  if ("sub_id" in value || "subId" in value || "resource_guid" in value) return "";
  const courseishTitle = Boolean(findNestedString(value, ["course_title", "course_name", "courseName", "kcmc", "title", "name"]));
  return courseishTitle ? normalizeText(value.id) : "";
};

const extractMsaCatalogCourseIds = (payload: JsonRecord): string[] => {
  const ids = new Set<string>();
  const visit = (value: unknown, depth: number = 0): void => {
    if (!value || depth > 6) return;
    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, depth + 1));
      return;
    }
    if (!hasObjectShape(value)) return;
    const courseId = extractCourseIdFromCatalogNode(value);
    if (courseId) ids.add(courseId);
    Object.values(value).forEach((entry) => visit(entry, depth + 1));
  };

  visit(hasObjectShape(payload.data) ? payload.data : payload);
  return Array.from(ids);
};

const buildMsaCatalogUrls = (baseUrls: BuaaBaseUrls): string[] => [
  `${baseUrls.yjapiBase}/courseapi/v2/course-live/search-live-course-list?need_time_quantum=1&unique_course=1&with_sub_duration=1&with_sub_data=1`,
  `${baseUrls.yjapiBase}/courseapi/v2/course-live/get-my-course-month`,
  `${baseUrls.yjapiBase}/courseapi/v2/course-live/get-my-course-day`,
];

const fetchMsaCatalogCourseIds = async (
  client: BuaaSessionClient,
  baseUrls: BuaaBaseUrls,
  token: string,
): Promise<string[]> => {
  const discovered = new Set<string>();
  for (const url of buildMsaCatalogUrls(baseUrls)) {
    const result = await client.get(url, {
      headers: makeAuthorizedHeaders(token),
    });
    if (!result.response.ok) continue;
    const payload = decodeJson<JsonRecord>(result.bodyText, `MSA catalog ${url}`);
    if (getMsaPayloadError(payload)) continue;
    for (const courseId of extractMsaCatalogCourseIds(payload)) {
      discovered.add(courseId);
    }
  }
  return Array.from(discovered);
};

interface MsaCourseDetail {
  courseId: string;
  detailData: JsonRecord;
  title: string;
  teacher: string;
  sessions: JsonRecord[];
}

const fetchMsaCourseDetail = async (
  client: BuaaSessionClient,
  baseUrls: BuaaBaseUrls,
  token: string,
  account: string,
  courseId: string,
): Promise<MsaCourseDetail> => {
  const detailUrl =
    `${baseUrls.yjapiBase}/courseapi/v3/multi-search/get-course-detail?course_id=${encodeURIComponent(courseId)}` +
    (account ? `&student=${encodeURIComponent(account)}` : "");
  const detailResult = await client.get(detailUrl, {
    headers: makeAuthorizedHeaders(token),
  });
  if (!detailResult.response.ok) {
    throw new Error(`MSA course ${courseId} failed with HTTP ${detailResult.response.status}.`);
  }

  const detailEnvelope = decodeJson<JsonRecord>(detailResult.bodyText, `MSA course ${courseId}`);
  ensureMsaPayloadOk(detailEnvelope, `MSA course ${courseId}`);
  const detailData = hasObjectShape(detailEnvelope.data) ? detailEnvelope.data : detailEnvelope;
  const title =
    findNestedString(detailData, ["course_title", "course_name", "courseName", "kcmc", "title"]) ||
    `MSA Course ${courseId}`;
  const teacher =
    findNestedString(detailData, ["lecturer_name", "teacher_name", "teacherName", "teacher", "skjs"]) || "";
  return {
    courseId,
    detailData,
    title,
    teacher,
    sessions: flattenCourseSessions(detailData),
  };
};

export const discoverBuaaMsaCourseMappings = async (
  repo: EducationRepo,
  options: BuaaMsaDiscoveryOptions,
): Promise<BuaaMsaDiscoveryResult> => {
  const baseUrls = resolveBuaaBaseUrls(options.baseUrls);
  const client = new BuaaSessionClient({
    cookie: options.auth.cookie ?? null,
    fetchImpl: options.fetchImpl,
  });
  const authSession = await resolveMsaAuthSession(client, options.auth, baseUrls);
  const { token, account } = authSession;
  const existingCourses = await repo.readCourses();
  const existingConnections = await repo.readConnections();
  const discoveredCourseIds = await fetchMsaCatalogCourseIds(client, baseUrls, token);
  const importedCourses: ImportedCourse[] = [];
  const matchedCourseIds = new Set<string>();

  for (const courseId of discoveredCourseIds) {
    const detail = await fetchMsaCourseDetail(client, baseUrls, token, account, courseId);
    const matchedCourse = findExistingTimetableCourse(existingCourses, detail.title, detail.teacher);
    if (!matchedCourse) continue;
    const term =
      options.term?.trim() ||
      matchedCourse.term ||
      matchExistingCourseTerm(existingCourses, detail.title, detail.teacher) ||
      inferCurrentAcademicTerm();
    importedCourses.push({
      stableKeyHint: normalizeCourseHint(detail.title, detail.teacher),
      sourceCourseId: courseId,
      title: detail.title,
      teacher: detail.teacher,
      term,
      metadata: {
        source: "buaa-msa",
        msaCourseId: courseId,
        byxtCourseId: matchedCourse.id,
        discoverySource: "msa-course-catalog",
      },
      items: [],
      resources: [],
    });
    matchedCourseIds.add(matchedCourse.id);
  }

  const importedAt = nowIso();
  const connectionCourseIds = Array.from(
    new Set(
      existingConnections
        .filter((connection) => connection.sourceType === "buaa-msa")
        .flatMap((connection) => readConnectionCourseIds(connection.metadata))
        .concat(discoveredCourseIds),
    ),
  );

  const result = await importEducationDocument(repo, {
    sourceType: "buaa-msa",
    importedAt,
    connection: {
      sourceType: "buaa-msa",
      accountLabel: authSession.accountLabel,
      status: "connected",
      auth: {
        mode: "bearer",
        token,
        account: account || null,
        cookie: authSession.cookie || null,
        username: options.auth.username ?? null,
        password: options.auth.password ?? null,
        displayName: options.auth.displayName?.trim() || null,
      },
      metadata: {
        courseIds: connectionCourseIds,
        displayName: options.auth.displayName?.trim() || null,
        studentName: options.auth.displayName?.trim() || null,
        discoveryEnabled: true,
      },
      lastSyncedAt: importedAt,
      lastError: null,
    },
    courses: importedCourses,
  });

  return {
    ...result,
    discoveredCourseIds,
    matchedCourseIds: Array.from(matchedCourseIds),
    unmatchedCount: Math.max(0, discoveredCourseIds.length - matchedCourseIds.size),
  };
};

const parsePptImageUrls = (payload: JsonRecord): string[] =>
  Array.isArray(payload.list)
    ? payload.list
        .map((item) => {
          if (!hasObjectShape(item) || typeof item.content !== "string") return "";
          try {
            const parsed = JSON.parse(item.content) as { pptimgurl?: string };
            return parsed.pptimgurl?.trim() ?? "";
          } catch {
            return "";
          }
        })
        .filter(Boolean)
    : [];

const buildSlideTimelineFromImageUrls = (
  imageUrls: string[],
): Array<{ page: number; timeSec: number; timeText: string }> =>
  imageUrls
    .map((imageUrl, index) => {
      const fileName = imageUrl.split("?")[0]?.split("/").pop()?.trim() ?? "";
      const match = fileName.match(/^(\d+)\.(?:jpg|jpeg|png|webp)$/i);
      if (!match) return null;
      const milliseconds = Number(match[1]);
      if (!Number.isFinite(milliseconds) || milliseconds < 0) return null;
      const timeSec = milliseconds / 1000;
      return {
        page: index + 1,
        timeSec,
        timeText: `${Math.floor(timeSec / 60)}:${Math.floor(timeSec % 60)
          .toString()
          .padStart(2, "0")}`,
      };
    })
    .filter((entry): entry is { page: number; timeSec: number; timeText: string } => Boolean(entry));

const collectSubtitleRawLines = (subtitleData: unknown): Record<string, unknown>[] =>
  Array.isArray(subtitleData)
    ? subtitleData.reduce<Record<string, unknown>[]>((all, chapter) => {
        if (hasObjectShape(chapter) && Array.isArray(chapter.all_content)) {
          return [...all, ...chapter.all_content.filter(hasObjectShape)];
        }
        return all;
      }, [])
    : [];

const formatClock = (seconds: number): string => {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const h = Math.floor(safe / 3600)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((safe % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(safe % 60)
    .toString()
    .padStart(2, "0");
  return `${h}:${m}:${s}`;
};

const formatSrtTime = (seconds: number): string => {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const totalMilliseconds = Math.floor(safe * 1000);
  const hours = Math.floor(totalMilliseconds / 3600000)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((totalMilliseconds % 3600000) / 60000)
    .toString()
    .padStart(2, "0");
  const secs = Math.floor((totalMilliseconds % 60000) / 1000)
    .toString()
    .padStart(2, "0");
  const milliseconds = Math.floor(totalMilliseconds % 1000)
    .toString()
    .padStart(3, "0");
  return `${hours}:${minutes}:${secs},${milliseconds}`;
};

const mergeSubtitleLines = (lines: Record<string, unknown>[]): Record<string, unknown>[] => {
  if (!lines.length) return [];
  const merged: Record<string, unknown>[] = [];
  let current = { ...lines[0] };
  for (let index = 1; index < lines.length; index += 1) {
    const next = lines[index];
    const gap = Number(next.BeginSec ?? 0) - Number(current.EndSec ?? current.BeginSec ?? 0);
    const currentText = String(current.Text ?? "");
    if (gap < 1 && currentText.length < 20) {
      current.Text = `${currentText}${currentText ? "，" : ""}${String(next.Text ?? "")}`;
      current.EndSec = next.EndSec;
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);
  return merged;
};

const writeReplaySubtitleAssets = async (
  repo: EducationRepo,
  input: {
    courseId: string;
    replaySourceId: string;
    replayTitle: string;
    rawLines: Record<string, unknown>[];
  },
): Promise<ImportedCourseResource[]> => {
  const srtContent = input.rawLines
    .map((line, index) => {
      const begin = Number(line.BeginSec ?? 0);
      const end = Number(line.EndSec ?? begin + 2);
      const text = String(line.Text ?? "").trim();
      if (!text) return "";
      return `${index + 1}\n${formatSrtTime(begin)} --> ${formatSrtTime(end)}\n${text}\n`;
    })
    .filter(Boolean)
    .join("\n");

  const notesContent = mergeSubtitleLines(input.rawLines)
    .map((line) => {
      const begin = Number(line.BeginSec ?? 0);
      const text = String(line.Text ?? "").trim();
      if (!text) return "";
      return `[${formatClock(begin)}] ${text}`;
    })
    .filter(Boolean)
    .join("\n");

  const resources: ImportedCourseResource[] = [];
  const fileCourse = sanitizeFileSegment(input.courseId, "course");
  const fileReplay = sanitizeFileSegment(input.replaySourceId, "replay");

  if (srtContent) {
    const srtFile = await writeRuntimeAsset(repo, ["buaa-msa", fileCourse, fileReplay, "subtitle.srt"], `${srtContent}\n`);
    resources.push({
      sourceResourceId: `livingroom-srt:${input.courseId}:${input.replaySourceId}`,
      linkedItemSourceId: input.replaySourceId,
      resourceType: "subtitle",
      title: `${input.replayTitle} Subtitle`,
      url: "local://subtitle.srt",
      localPath: srtFile.relativePath,
      metaJson: {
        format: "srt",
        lineCount: input.rawLines.length,
        source: "search-trans-result",
      },
    });
  }

  if (notesContent) {
    const notesFile = await writeRuntimeAsset(repo, ["buaa-msa", fileCourse, fileReplay, "notes.txt"], `${notesContent}\n`);
    resources.push({
      sourceResourceId: `livingroom-notes:${input.courseId}:${input.replaySourceId}`,
      linkedItemSourceId: input.replaySourceId,
      resourceType: "notes",
      title: `${input.replayTitle} Notes`,
      url: "local://notes.txt",
      localPath: notesFile.relativePath,
      metaJson: {
        format: "txt",
        source: "search-trans-result",
      },
    });
  }

  return resources;
};

const getMsaPayloadError = (payload: JsonRecord): string | null => {
  if (payload.success === false) {
    const result = hasObjectShape(payload.result) ? payload.result : null;
    return (
      findNestedString(result, ["message", "errMsg", "msg"]) ||
      findNestedString(payload, ["message", "errMsg", "msg"]) ||
      "unknown error"
    );
  }

  if (typeof payload.code === "number" && ![0, 200, 10000].includes(payload.code)) {
    return findNestedString(payload, ["message", "errMsg", "msg"]) || "unknown error";
  }

  return null;
};

const ensureMsaPayloadOk = (payload: JsonRecord, label: string): void => {
  const error = getMsaPayloadError(payload);
  if (error) {
    throw new Error(`${label} failed: ${error}`);
  }
};

const buildMsaForwardUrl = (baseUrls: BuaaBaseUrls): string => `${baseUrls.classroomBase}/courseCenter`;
const BUAA_MSA_TENANT_CODE = "21";

const buildMsaAuthLoginUrl = (baseUrls: BuaaBaseUrls): string =>
  `${baseUrls.yjapiBase}/casapi/index.php?r=auth/login&auType=cmc&tenant_code=${BUAA_MSA_TENANT_CODE}&forward=${encodeURIComponent(buildMsaForwardUrl(baseUrls))}`;

const prepareMsaSsoLoginUrl = async (client: BuaaSessionClient, baseUrls: BuaaBaseUrls): Promise<string> => {
  const result = await client.get(buildMsaAuthLoginUrl(baseUrls), {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (result.response.status >= 500) {
    throw new Error(`MSA pre-login failed with HTTP ${result.response.status}.`);
  }
  if (extractJwtTokenFromCookieString(client.cookieHeader())) {
    return "";
  }
  if (result.finalUrl.startsWith(`${baseUrls.ssoBase}/login`)) {
    return result.finalUrl;
  }
  return `${baseUrls.ssoBase}/login?service=${encodeURIComponent(buildMsaAuthLoginUrl(baseUrls))}`;
};

const activateMsaSession = async (client: BuaaSessionClient, baseUrls: BuaaBaseUrls): Promise<void> => {
  const targets = [
    buildMsaForwardUrl(baseUrls),
    buildMsaAuthLoginUrl(baseUrls),
    `${baseUrls.ssoBase}/login?service=${encodeURIComponent(buildMsaAuthLoginUrl(baseUrls))}`,
  ];

  for (const target of targets) {
    const result = await client.get(target, {
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (extractJwtTokenFromCookieString(client.cookieHeader())) {
      return;
    }
    if (result.response.status >= 500) {
      throw new Error(`MSA session activation failed with HTTP ${result.response.status}.`);
    }
  }
};

const resolveMsaAuthSession = async (
  client: BuaaSessionClient,
  auth: BuaaMsaAuth,
  baseUrls: BuaaBaseUrls,
): Promise<MsaAuthSession> => {
  let token = auth.token?.trim() || extractJwtTokenFromCookieString(client.cookieHeader());
  if (!token && auth.username?.trim() && auth.password?.trim()) {
    const loginUrl = await prepareMsaSsoLoginUrl(client, baseUrls);
    if (loginUrl) {
      await loginBuaaSsoWithPassword(client, auth, baseUrls, "BUAA MSA", loginUrl);
      await activateMsaSession(client, baseUrls);
    }
    token = extractJwtTokenFromCookieString(client.cookieHeader());
  } else if (!token && auth.cookie?.trim()) {
    await activateMsaSession(client, baseUrls);
    token = extractJwtTokenFromCookieString(client.cookieHeader());
  }

  if (!token) {
    throw new Error("MSA sync requires username/password, a Bearer token, or a cookie that can activate an MSA session.");
  }

  const account = auth.account?.trim() || extractJwtAccountFromCookieString(client.cookieHeader()) || auth.username?.trim() || "";
  const cookie = client.cookieHeader();
  return {
    token,
    account,
    cookie,
    accountLabel: auth.accountLabel?.trim() || account || "buaa-msa",
  };
};

const searchTransResultUrls = (baseUrls: BuaaBaseUrls, input: {
  courseId: string;
  subId: string;
  resourceGuid?: string | null;
}): string[] => {
  const makeUrl = (includeResourceGuid: boolean): string => {
    const params = new URLSearchParams({
      course_id: input.courseId,
      sub_id: input.subId,
    });
    if (includeResourceGuid && input.resourceGuid?.trim()) {
      params.set("resource_guid", input.resourceGuid.trim());
    }
    return `${baseUrls.classroomBase}/pptnote/v1/schedule/search-trans-result?${params.toString()}`;
  };
  return input.resourceGuid?.trim() ? [makeUrl(true), makeUrl(false)] : [makeUrl(false)];
};

const fetchMsaSubtitleData = async (
  client: BuaaSessionClient,
  baseUrls: BuaaBaseUrls,
  token: string,
  input: {
    courseId: string;
    subId: string;
    resourceGuid?: string | null;
  },
): Promise<unknown[] | null> => {
  for (const url of searchTransResultUrls(baseUrls, input)) {
    const result = await client.get(url, {
      headers: makeAuthorizedHeaders(token),
    });
    if (!result.response.ok) continue;
    const payload = decodeJson<JsonRecord>(result.bodyText, `MSA subtitle ${input.courseId}/${input.subId}`);
    if (getMsaPayloadError(payload)) continue;
    if (Array.isArray(payload.list) && payload.list.length) return payload.list;
  }
  return null;
};

export const syncBuaaMsa = async (
  repo: EducationRepo,
  options: BuaaMsaSyncOptions,
): Promise<BuaaMsaSyncResult> => {
  const courseIds = ensureCourseIds(options.courseIds);
  const baseUrls = resolveBuaaBaseUrls(options.baseUrls);
  const client = new BuaaSessionClient({
    cookie: options.auth.cookie ?? null,
    fetchImpl: options.fetchImpl,
  });
  const authSession = await resolveMsaAuthSession(client, options.auth, baseUrls);
  const { token, account } = authSession;
  const existingCourses = await repo.readCourses();
  const importedCourses: ImportedCourse[] = [];
  let replayCount = 0;

  const userInfoResult = await client.get(`${baseUrls.classroomBase}/userapi/v1/infosimple`, {
    headers: makeAuthorizedHeaders(token),
  });
  if (!userInfoResult.response.ok) {
    throw new Error(`MSA user info failed with HTTP ${userInfoResult.response.status}.`);
  }
  const userInfoEnvelope = decodeJson<JsonRecord>(userInfoResult.bodyText, "MSA user info");
  ensureMsaPayloadOk(userInfoEnvelope, "MSA user info");
  const userInfo = (decodeJson<MsaUserInfoEnvelope>(userInfoResult.bodyText, "MSA user info").params ?? {});
  const displayName =
    options.auth.displayName?.trim() ||
    findNestedString(userInfo, ["realname", "real_name", "student_name", "name", "user_name"]) ||
    "";

  for (const courseId of courseIds) {
    const detail = await fetchMsaCourseDetail(client, baseUrls, token, account, courseId);
    const { detailData, title, teacher, sessions } = detail;
    const matchedCourse = findExistingTimetableCourse(existingCourses, title, teacher);
    if (!matchedCourse) {
      continue;
    }
    const term = options.term?.trim() || matchedCourse.term || matchExistingCourseTerm(existingCourses, title, teacher) || inferCurrentAcademicTerm();

    const course: ImportedCourse = {
      stableKeyHint: normalizeCourseHint(title, teacher),
      sourceCourseId: courseId,
      title,
      teacher,
      term,
      metadata: {
        source: "buaa-msa",
        msaCourseId: courseId,
        byxtCourseId: matchedCourse.id,
      },
      items: [],
      resources: [],
    };

    for (const [index, session] of sessions.entries()) {
      const subId = normalizeText(session.id ?? session.sub_id ?? session.subId);
      if (!subId) continue;
      const sessionStatus = normalizeText(session.sub_status ?? session.status);
      const subInfoResult = await client.get(
        `${baseUrls.classroomBase}/courseapi/v3/portal-home-setting/get-sub-info?course_id=${encodeURIComponent(courseId)}&sub_id=${encodeURIComponent(subId)}`,
        {
          headers: makeAuthorizedHeaders(token),
        },
      );

      const subInfoEnvelope = subInfoResult.response.ok
        ? decodeJson<JsonRecord>(subInfoResult.bodyText, `MSA sub-info ${courseId}/${subId}`)
        : {};
      const subInfoError = hasObjectShape(subInfoEnvelope) ? getMsaPayloadError(subInfoEnvelope) : null;
      const subInfo = !subInfoError && hasObjectShape(subInfoEnvelope.data) ? subInfoEnvelope.data : null;
      const replayTitle =
        normalizeText(subInfo?.sub_title) ||
        normalizeText(session.sub_title ?? session.title) ||
        `Replay ${index + 1}`;
      const replaySourceId = `msa-replay:${courseId}:${subId}`;
      replayCount += 1;

      course.items?.push({
        sourceItemId: replaySourceId,
        type: "replay",
        title: replayTitle,
        teacher: normalizeText(subInfo?.lecturer_name ?? session.lecturer_name) || teacher,
        startAt: pickReplayStartAt(session, subInfo),
        endAt: pickReplayEndAt(session, subInfo),
        body: `${baseUrls.classroomBase}/coursedetail?course_id=${encodeURIComponent(courseId)}`,
        metaJson: {
          courseId,
          subId,
          status: sessionStatus || null,
          available: sessionStatus === COURSE_READY_STATUS,
          session,
          subInfo: subInfo ?? null,
        },
        lastSyncedAt: nowIso(),
      });

      if (sessionStatus !== COURSE_READY_STATUS || !subInfo) {
        continue;
      }

      const videoList = hasObjectShape(subInfo.video_list) ? Object.values(subInfo.video_list) : [];
      for (const [streamIndex, rawVideo] of videoList.entries()) {
        if (!hasObjectShape(rawVideo) || typeof rawVideo.preview_url !== "string" || !rawVideo.preview_url.trim()) continue;
        const signedUrl = createSignedMsaVideoUrl(rawVideo.preview_url, userInfo);
        course.resources?.push({
          sourceResourceId: `msa-video:${courseId}:${subId}:${streamIndex}`,
          linkedItemSourceId: replaySourceId,
          resourceType: "video",
          title: `${replayTitle} ${inferStreamLabel(rawVideo.preview_url)}`,
          url: signedUrl,
          metaJson: {
            streamIndex,
            previewUrl: rawVideo.preview_url,
            label: inferStreamLabel(rawVideo.preview_url),
          },
        });
      }

      const resourceGuid = normalizeText(subInfo.resource_guid);
      const subtitleData = await fetchMsaSubtitleData(client, baseUrls, token, {
        courseId,
        subId,
        resourceGuid,
      });
      const subtitleLines = collectSubtitleRawLines(subtitleData);
      if (subtitleLines.length) {
        course.resources?.push(
          ...(await writeReplaySubtitleAssets(repo, {
            courseId,
            replaySourceId,
            replayTitle,
            rawLines: subtitleLines,
          })),
        );
      }

      if (resourceGuid) {
        const pptResult = await client.get(
          `${baseUrls.classroomBase}/pptnote/v1/schedule/search-ppt?course_id=${encodeURIComponent(courseId)}&sub_id=${encodeURIComponent(subId)}&resource_guid=${encodeURIComponent(resourceGuid)}`,
          {
            headers: makeAuthorizedHeaders(token),
          },
        );
        if (pptResult.response.ok) {
          const pptPayload = decodeJson<JsonRecord>(pptResult.bodyText, `MSA PPT ${courseId}/${subId}`);
          if (getMsaPayloadError(pptPayload)) {
            continue;
          }
          const imageUrls = parsePptImageUrls(pptPayload);
          if (imageUrls.length) {
            const slideTimeline = buildSlideTimelineFromImageUrls(imageUrls);
            const fileSegmentCourse = sanitizeFileSegment(courseId, "course");
            const fileSegmentReplay = sanitizeFileSegment(subId, "replay");
            const html = buildPptPrintHtml({
              title: `${title} - ${replayTitle}`,
              generatedAt: new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }),
              slides: imageUrls.map((imageUrl, slideIndex) => ({
                imageUrl,
                index: slideIndex + 1,
              })),
            });
            const assetFile = await writeRuntimeAsset(
              repo,
              ["buaa-msa", fileSegmentCourse, fileSegmentReplay, "slides.html"],
              html,
            );
            course.resources?.push({
              sourceResourceId: `msa-ppt:${courseId}:${subId}`,
              linkedItemSourceId: replaySourceId,
              resourceType: "ppt",
              title: `${replayTitle} Slides`,
              url: imageUrls[0],
              localPath: assetFile.relativePath,
              metaJson: {
                resourceGuid,
                imageUrls,
                slideTimeline,
                exportMode: "print-html",
              },
            });
          }
        }
      }
    }

    importedCourses.push(course);
  }

  const importedAt = nowIso();
  const result = await importEducationDocument(repo, {
    sourceType: "buaa-msa",
    importedAt,
    connection: {
      sourceType: "buaa-msa",
      accountLabel: authSession.accountLabel,
      status: "connected",
      auth: {
        mode: "bearer",
        token,
        account: account || null,
        cookie: authSession.cookie || null,
        username: options.auth.username ?? null,
        password: options.auth.password ?? null,
        displayName: displayName || null,
      },
      metadata: {
        courseIds,
        displayName: displayName || null,
        studentName: displayName || null,
      },
      lastSyncedAt: importedAt,
      lastError: null,
    },
    courses: importedCourses,
  });

  return {
    ...result,
    syncedCourseIds: courseIds,
    replayCount,
  };
};

export const importBuaaLivingroomCapture = async (
  repo: EducationRepo,
  input: {
    courseId: string;
    replaySourceId: string;
    replayTitle: string;
    courseTitle?: string | null;
    teacher?: string | null;
    term?: string | null;
    subtitleData?: unknown[];
    pptData?: unknown[];
  },
): Promise<EducationImportResult> => {
  const existingCourses = await repo.readCourses();
  const title = input.courseTitle?.trim() || existingCourses.find((course) => course.sourceCourseId === input.courseId)?.title || "MSA Course";
  const teacher = input.teacher?.trim() || existingCourses.find((course) => course.sourceCourseId === input.courseId)?.teacher || "";
  const term = input.term?.trim() || matchExistingCourseTerm(existingCourses, title, teacher) || inferCurrentAcademicTerm();

  const rawLines = (input.subtitleData ?? []).reduce<Record<string, unknown>[]>((all, chapter) => {
    if (hasObjectShape(chapter) && Array.isArray(chapter.all_content)) {
      return [...all, ...chapter.all_content.filter(hasObjectShape)];
    }
    return all;
  }, []);

  const formatClock = (seconds: number): string => {
    const h = Math.floor(seconds / 3600)
      .toString()
      .padStart(2, "0");
    const m = Math.floor((seconds % 3600) / 60)
      .toString()
      .padStart(2, "0");
    const s = Math.floor(seconds % 60)
      .toString()
      .padStart(2, "0");
    return `${h}:${m}:${s}`;
  };

  const mergeNotes = (lines: Record<string, unknown>[]): Record<string, unknown>[] => {
    if (!lines.length) return [];
    const merged: Record<string, unknown>[] = [];
    let current = { ...lines[0] };
    for (let index = 1; index < lines.length; index += 1) {
      const next = lines[index];
      const gap = Number(next.BeginSec ?? 0) - Number(current.EndSec ?? current.BeginSec ?? 0);
      const currentText = String(current.Text ?? "");
      if (gap < 1 && currentText.length < 20) {
        current.Text = `${currentText}${currentText ? "，" : ""}${String(next.Text ?? "")}`;
        current.EndSec = next.EndSec;
      } else {
        merged.push(current);
        current = { ...next };
      }
    }
    merged.push(current);
    return merged;
  };

  const srtContent = rawLines
    .map((line, index) => {
      const begin = Number(line.BeginSec ?? 0);
      const end = Number(line.EndSec ?? begin + 2);
      const text = String(line.Text ?? "").trim();
      if (!text) return "";
      const formatSrt = (seconds: number): string => `${formatClock(seconds).replace(/\./g, ",")},000`;
      return `${index + 1}\n${formatSrt(begin)} --> ${formatSrt(end)}\n${text}\n`;
    })
    .filter(Boolean)
    .join("\n");

  const notesContent = mergeNotes(rawLines)
    .map((line) => {
      const begin = Number(line.BeginSec ?? 0);
      const text = String(line.Text ?? "").trim();
      if (!text) return "";
      return `[${formatClock(begin)}] ${text}`;
    })
    .filter(Boolean)
    .join("\n");

  const resources: ImportedCourseResource[] = [];
  const fileCourse = sanitizeFileSegment(input.courseId, "course");
  const fileReplay = sanitizeFileSegment(input.replaySourceId, "replay");

  if (srtContent) {
    const srtFile = await writeRuntimeAsset(repo, ["buaa-msa", fileCourse, fileReplay, "subtitle.srt"], `${srtContent}\n`);
    resources.push({
      sourceResourceId: `livingroom-srt:${input.courseId}:${input.replaySourceId}`,
      linkedItemSourceId: input.replaySourceId,
      resourceType: "subtitle",
      title: `${input.replayTitle} Subtitle`,
      url: "local://subtitle.srt",
      localPath: srtFile.relativePath,
      metaJson: {
        format: "srt",
        lineCount: rawLines.length,
      },
    });
  }

  if (notesContent) {
    const notesFile = await writeRuntimeAsset(repo, ["buaa-msa", fileCourse, fileReplay, "notes.txt"], `${notesContent}\n`);
    resources.push({
      sourceResourceId: `livingroom-notes:${input.courseId}:${input.replaySourceId}`,
      linkedItemSourceId: input.replaySourceId,
      resourceType: "notes",
      title: `${input.replayTitle} Notes`,
      url: "local://notes.txt",
      localPath: notesFile.relativePath,
      metaJson: {
        format: "txt",
      },
    });
  }

  const slides = Array.isArray(input.pptData)
    ? input.pptData
        .map((item, index) => {
          if (!hasObjectShape(item) || typeof item.content !== "string") return null;
          try {
            const parsed = JSON.parse(item.content) as { pptimgurl?: string };
            if (!parsed.pptimgurl?.trim()) return null;
            const timeSec = Number(item.created_sec ?? item.BeginSec ?? 0);
            return {
              imageUrl: parsed.pptimgurl.trim(),
              index: index + 1,
              timeSec: Number.isFinite(timeSec) && timeSec >= 0 ? timeSec : 0,
              timeText: formatClock(Number.isFinite(timeSec) && timeSec >= 0 ? timeSec : 0),
            };
          } catch {
            return null;
          }
        })
        .filter((item): item is { imageUrl: string; index: number; timeSec: number; timeText: string } => Boolean(item))
    : [];

  if (slides.length) {
    const html = buildPptPrintHtml({
      title: `${title} - ${input.replayTitle}`,
      generatedAt: new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }),
      slides,
    });
    const pptFile = await writeRuntimeAsset(repo, ["buaa-msa", fileCourse, fileReplay, "livingroom-slides.html"], html);
    resources.push({
      sourceResourceId: `livingroom-ppt:${input.courseId}:${input.replaySourceId}`,
      linkedItemSourceId: input.replaySourceId,
      resourceType: "ppt",
      title: `${input.replayTitle} Slides`,
      url: slides[0].imageUrl,
      localPath: pptFile.relativePath,
        metaJson: {
          imageUrls: slides.map((slide) => slide.imageUrl),
          slideTimeline: slides.map((slide) => ({
            page: slide.index,
            timeSec: slide.timeSec,
            timeText: slide.timeText,
          })),
          exportMode: "print-html",
        },
    });
  }

  return importEducationDocument(repo, {
    sourceType: "buaa-msa",
    importedAt: nowIso(),
    courses: [
      {
        stableKeyHint: normalizeCourseHint(title, teacher),
        sourceCourseId: input.courseId,
        title,
        teacher,
        term,
        items: [
          {
            sourceItemId: input.replaySourceId,
            type: "replay",
            title: input.replayTitle,
            teacher,
            lastSyncedAt: nowIso(),
          },
        ],
        resources,
      },
    ],
  });
};
