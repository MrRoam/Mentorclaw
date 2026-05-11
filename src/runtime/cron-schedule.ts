import type { CourseItemRecord } from "../schemas/education.ts";
import type { CronDefinition, CronScheduleRule } from "../schemas/models.ts";

export interface DueCronTrigger {
  cron: CronDefinition;
  courseItem: CourseItemRecord | null;
  scheduledFor: string;
  stateKey: string;
}

const DEFAULT_TIMEZONE = "Asia/Shanghai";
const RUN_WINDOW_MS = 36 * 60 * 60 * 1000;

const normalizeText = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, " ");

const normalizeHourMinute = (hour: number, minute: number): string => {
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error("Schedule time must be a valid 24-hour clock time.");
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

const parseTimeOfDay = (description: string): string | null => {
  const normalized = normalizeText(description);
  const colonMatch = normalized.match(/\b([01]?\d|2[0-3])[:：]([0-5]\d)\b/);
  if (colonMatch) return normalizeHourMinute(Number(colonMatch[1]), Number(colonMatch[2]));

  const chineseMatch = description.match(/(?:晚上|晚间|夜里|当天晚上|当晚)?\s*([0-2]?\d)\s*[点時时](?:\s*([0-5]?\d)\s*分?)?/);
  if (chineseMatch) {
    let hour = Number(chineseMatch[1]);
    const minute = chineseMatch[2] ? Number(chineseMatch[2]) : 0;
    if (/(晚上|晚间|夜里|当天晚上|当晚)/.test(description) && hour >= 1 && hour <= 11) hour += 12;
    return normalizeHourMinute(hour, minute);
  }

  const englishMatch = normalized.match(/\b(?:at\s*)?([0-2]?\d)(?::([0-5]\d))?\s*(am|pm)\b/);
  if (englishMatch) {
    let hour = Number(englishMatch[1]);
    const minute = englishMatch[2] ? Number(englishMatch[2]) : 0;
    if (englishMatch[3] === "pm" && hour < 12) hour += 12;
    if (englishMatch[3] === "am" && hour === 12) hour = 0;
    return normalizeHourMinute(hour, minute);
  }

  return null;
};

export const parseCronScheduleDescription = (description: string, timezone = DEFAULT_TIMEZONE): CronScheduleRule => {
  const text = normalizeText(description);
  if (!text || text === "manual") return { kind: "manual" };

  const timeOfDay = parseTimeOfDay(description);
  if (!timeOfDay) {
    throw new Error("Schedule description must include an exact trigger time, for example: 晚上9点 or 21:00.");
  }

  const mentionsClass =
    /课|课程|上课|class|lecture/.test(description) || /\b(after|following) (each|every) (class|lecture)\b/.test(text);
  const mentionsSameDay = /当天|当晚|same night|same day|after each|after every/.test(text);
  if (!mentionsClass || !mentionsSameDay) {
    return {
      kind: "daily_time",
      timeOfDay,
      timezone,
    };
  }

  return {
    kind: "after_course_class",
    timeOfDay,
    timezone,
    offsetDays: 0,
    source: "course_schedule",
  };
};

const localParts = (date: Date, timezone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
};

const timezoneOffsetMs = (date: Date, timezone: string): number => {
  const parts = localParts(date, timezone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - date.getTime();
};

const zonedLocalTimeToUtc = (year: number, month: number, day: number, timeOfDay: string, timezone: string): Date => {
  const [hourRaw, minuteRaw] = timeOfDay.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let index = 0; index < 2; index += 1) {
    utcMs = Date.UTC(year, month - 1, day, hour, minute, 0) - timezoneOffsetMs(new Date(utcMs), timezone);
  }
  return new Date(utcMs);
};

const classEndTime = (item: CourseItemRecord): Date | null => {
  const raw = item.manualEndAt || item.endAt || item.manualStartAt || item.startAt;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
};

const maybePushDailyTrigger = (
  due: DueCronTrigger[],
  cron: CronDefinition,
  runState: Record<string, string>,
  now: Date,
): void => {
  if (cron.scheduleRule?.kind !== "daily_time") return;
  const timezone = cron.scheduleRule.timezone || DEFAULT_TIMEZONE;
  const timeOfDay = cron.scheduleRule.timeOfDay || "21:00";
  const parts = localParts(now, timezone);
  const scheduledFor = zonedLocalTimeToUtc(parts.year, parts.month, parts.day, timeOfDay, timezone);
  const scheduledMs = scheduledFor.getTime();
  const nowMs = now.getTime();
  const createdAt = cron.updatedAt ? new Date(cron.updatedAt).getTime() : 0;
  if (scheduledMs > nowMs || scheduledMs <= createdAt) return;
  if (nowMs - scheduledMs > RUN_WINDOW_MS) return;
  const stateKey = `${cron.cronId}:daily:${scheduledFor.toISOString()}`;
  if (runState[stateKey]) return;
  due.push({ cron, courseItem: null, scheduledFor: scheduledFor.toISOString(), stateKey });
};

export const dueCronTriggers = (
  crons: CronDefinition[],
  courseItems: CourseItemRecord[],
  runState: Record<string, string>,
  now: Date = new Date(),
): DueCronTrigger[] => {
  const due: DueCronTrigger[] = [];
  const nowMs = now.getTime();

  for (const cron of crons) {
    if (cron.enabled === false) continue;
    if (cron.scheduleRule?.kind === "daily_time") {
      maybePushDailyTrigger(due, cron, runState, now);
      continue;
    }
    if (cron.scheduleRule?.kind !== "after_course_class") continue;

    const rule = cron.scheduleRule;
    const timezone = rule.timezone || DEFAULT_TIMEZONE;
    const timeOfDay = rule.timeOfDay || "21:00";
    const createdAt = cron.updatedAt ? new Date(cron.updatedAt).getTime() : 0;
    const courseIds = new Set(cron.courseIds || []);
    if (!courseIds.size) continue;

    for (const item of courseItems) {
      if (item.type !== "class" || !courseIds.has(item.courseId) || item.isHidden) continue;
      const endedAt = classEndTime(item);
      if (!endedAt || endedAt.getTime() > nowMs) continue;
      const parts = localParts(endedAt, timezone);
      const scheduledFor = zonedLocalTimeToUtc(parts.year, parts.month, parts.day + (rule.offsetDays || 0), timeOfDay, timezone);
      const scheduledMs = scheduledFor.getTime();
      if (scheduledMs > nowMs || scheduledMs <= createdAt) continue;
      if (nowMs - scheduledMs > RUN_WINDOW_MS) continue;
      const stateKey = `${cron.cronId}:${item.id}:${scheduledFor.toISOString()}`;
      if (runState[stateKey]) continue;
      due.push({ cron, courseItem: item, scheduledFor: scheduledFor.toISOString(), stateKey });
    }
  }

  return due;
};
