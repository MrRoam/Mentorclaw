export type ConnectionStatus = "connected" | "disconnected" | "invalid" | "error";
export type CourseStatus = "active" | "archived" | "hidden";
export type CourseItemType = "class" | "exam" | "assignment" | "notice" | "replay" | "manual";
export type CourseResourceType = "folder" | "ppt" | "pptx" | "pdf" | "video" | "subtitle" | "notes" | "link";
export type ScheduleViewMode = "month" | "week";

export interface ConnectionRecord {
  id: string;
  sourceType: string;
  accountLabel: string;
  status: ConnectionStatus;
  auth: Record<string, unknown>;
  metadata: Record<string, unknown>;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface CourseRecord {
  id: string;
  stableKey: string;
  title: string;
  teacher: string;
  term: string;
  sourceType: string;
  sourceCourseId: string | null;
  status: CourseStatus;
  displayColor: string | null;
  metadata: Record<string, unknown>;
}

export interface CourseItemRecord {
  id: string;
  courseId: string;
  type: CourseItemType;
  sourceItemId: string | null;
  title: string;
  teacher: string | null;
  startAt: string | null;
  endAt: string | null;
  dueAt: string | null;
  location: string | null;
  body: string;
  metaJson: Record<string, unknown>;
  isHidden: boolean;
  manualTitle: string | null;
  manualLocation: string | null;
  manualStartAt: string | null;
  manualEndAt: string | null;
  manualNote: string | null;
  lastSyncedAt: string | null;
}

export interface CourseResourceRecord {
  id: string;
  courseId: string;
  linkedItemId: string | null;
  parentId: string | null;
  resourceType: CourseResourceType;
  title: string;
  url: string;
  localPath: string | null;
  metaJson: Record<string, unknown>;
}

export interface SchedulePreferences {
  showTimetableInSchedule: boolean;
  scheduleDefaultView: ScheduleViewMode;
}

export interface EducationSnapshot {
  connections: ConnectionRecord[];
  courses: CourseRecord[];
  courseItems: CourseItemRecord[];
  courseResources: CourseResourceRecord[];
  schedulePreferences: SchedulePreferences;
}

export const defaultSchedulePreferences = (): SchedulePreferences => ({
  showTimetableInSchedule: true,
  scheduleDefaultView: "week",
});
