import type { CourseRecord, EducationSnapshot } from "../schemas/education.ts";

const textValue = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const sourceAliases = (course: CourseRecord): Record<string, string> => {
  const raw = course.metadata?.sourceAliases;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const aliases: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const text = textValue(value);
    if (text) aliases[key] = text;
  }
  return aliases;
};

const sourceIdFor = (course: CourseRecord, sourceType: string): string => {
  if (course.sourceType === sourceType) return textValue(course.sourceCourseId);
  return sourceAliases(course)[sourceType] || "";
};

const normalizeCourseText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\uFF08[^\uFF09]*\uFF09/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, "");

export const linkedCourseIds = (left: CourseRecord, right: CourseRecord): boolean => {
  if (left.id === right.id) return true;

  const leftMsa = sourceIdFor(left, "buaa-msa");
  const rightMsa = sourceIdFor(right, "buaa-msa");
  if (leftMsa && rightMsa && leftMsa === rightMsa) return true;

  const leftByxt = sourceIdFor(left, "buaa-byxt");
  const rightByxt = sourceIdFor(right, "buaa-byxt");
  if (leftByxt && rightByxt && leftByxt === rightByxt) return true;

  if (textValue(left.metadata?.byxtCourseId) === right.id) return true;
  if (textValue(right.metadata?.byxtCourseId) === left.id) return true;

  const sameKnownSource =
    left.sourceType === right.sourceType &&
    Boolean(left.sourceCourseId) &&
    left.sourceCourseId === right.sourceCourseId;
  if (sameKnownSource) return true;

  return (
    left.term === right.term &&
    normalizeCourseText(left.title) === normalizeCourseText(right.title) &&
    normalizeCourseText(left.teacher) === normalizeCourseText(right.teacher)
  );
};

export const expandRelatedCourseIds = (snapshot: EducationSnapshot, courseIds: Iterable<string>): Set<string> => {
  const expanded = new Set(Array.from(courseIds).filter(Boolean));
  let changed = true;
  while (changed) {
    changed = false;
    for (const course of snapshot.courses) {
      if (expanded.has(course.id)) continue;
      const linked = snapshot.courses.some((candidate) => expanded.has(candidate.id) && linkedCourseIds(candidate, course));
      if (linked) {
        expanded.add(course.id);
        changed = true;
      }
    }
  }
  return expanded;
};

export const resolveMsaCourseIdForCourse = (snapshot: EducationSnapshot, course: CourseRecord): string => {
  const direct = sourceIdFor(course, "buaa-msa") || textValue(course.metadata?.msaCourseId);
  if (direct) return direct;

  const relatedMsaCourse = snapshot.courses.find(
    (candidate) => linkedCourseIds(course, candidate) && candidate.sourceType === "buaa-msa" && textValue(candidate.sourceCourseId),
  );
  return relatedMsaCourse?.sourceCourseId?.trim() || "";
};
