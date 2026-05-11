import type {
  CourseItemRecord,
  CourseItemType,
  CourseRecord,
  CourseResourceRecord,
  EducationSnapshot,
} from "../schemas/education.ts";
import { EducationRepo } from "../storage/education-repo.ts";

export interface ScheduleEventView {
  id: string;
  courseId: string;
  type: CourseItemType;
  title: string;
  teacher: string | null;
  location: string | null;
  startAt: string | null;
  endAt: string | null;
  dueAt: string | null;
  isHidden: boolean;
  source: "course-item";
}

const resolvedTitle = (item: CourseItemRecord): string => item.manualTitle ?? item.title;
const resolvedLocation = (item: CourseItemRecord): string | null => item.manualLocation ?? item.location;
const resolvedStartAt = (item: CourseItemRecord): string | null => item.manualStartAt ?? item.startAt;
const resolvedEndAt = (item: CourseItemRecord): string | null => item.manualEndAt ?? item.endAt;

export const listCourses = (snapshot: EducationSnapshot, term?: string | null): CourseRecord[] =>
  snapshot.courses.filter((course) => !term || course.term === term);

export const listCourseItems = (
  snapshot: EducationSnapshot,
  courseId: string,
  type?: CourseItemType | null,
): CourseItemRecord[] =>
  snapshot.courseItems.filter((item) => item.courseId === courseId && (!type || item.type === type));

export const listCourseResources = (
  snapshot: EducationSnapshot,
  courseId: string,
  linkedItemId?: string | null,
): CourseResourceRecord[] =>
  snapshot.courseResources.filter(
    (resource) => resource.courseId === courseId && (!linkedItemId || resource.linkedItemId === linkedItemId),
  );

export const listScheduleEvents = (
  snapshot: EducationSnapshot,
  rangeStart: string,
  rangeEnd: string,
  includeTimetable: boolean,
): ScheduleEventView[] => {
  const startMs = new Date(rangeStart).getTime();
  const endMs = new Date(rangeEnd).getTime();
  return snapshot.courseItems
    .filter((item) => {
      if (item.isHidden) return false;
      if (!includeTimetable && item.type === "class") return false;
      const startAt = resolvedStartAt(item);
      const dueAt = item.dueAt;
      const eventMs = new Date(startAt ?? dueAt ?? 0).getTime();
      return Number.isFinite(eventMs) && eventMs >= startMs && eventMs <= endMs;
    })
    .map((item) => ({
      id: item.id,
      courseId: item.courseId,
      type: item.type,
      title: resolvedTitle(item),
      teacher: item.teacher,
      location: resolvedLocation(item),
      startAt: resolvedStartAt(item),
      endAt: resolvedEndAt(item),
      dueAt: item.dueAt,
      isHidden: item.isHidden,
      source: "course-item" as const,
    }))
    .sort((left, right) => {
      const leftMs = new Date(left.startAt ?? left.dueAt ?? 0).getTime();
      const rightMs = new Date(right.startAt ?? right.dueAt ?? 0).getTime();
      return leftMs - rightMs;
    });
};

export interface CourseItemOverridePatch {
  isHidden?: boolean;
  manualTitle?: string | null;
  manualLocation?: string | null;
  manualStartAt?: string | null;
  manualEndAt?: string | null;
  manualNote?: string | null;
}

export const updateCourseItemOverrides = async (
  repo: EducationRepo,
  itemId: string,
  patch: CourseItemOverridePatch,
): Promise<CourseItemRecord> => {
  const items = await repo.readCourseItems();
  const index = items.findIndex((item) => item.id === itemId);
  if (index < 0) {
    throw new Error(`Course item ${itemId} was not found.`);
  }
  const next: CourseItemRecord = {
    ...items[index],
    ...(patch.isHidden == null ? {} : { isHidden: patch.isHidden }),
    ...(patch.manualTitle === undefined ? {} : { manualTitle: patch.manualTitle }),
    ...(patch.manualLocation === undefined ? {} : { manualLocation: patch.manualLocation }),
    ...(patch.manualStartAt === undefined ? {} : { manualStartAt: patch.manualStartAt }),
    ...(patch.manualEndAt === undefined ? {} : { manualEndAt: patch.manualEndAt }),
    ...(patch.manualNote === undefined ? {} : { manualNote: patch.manualNote }),
  };
  items[index] = next;
  await repo.writeCourseItems(items);
  return next;
};
