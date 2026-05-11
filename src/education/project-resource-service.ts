import type {
  CourseItemRecord,
  CourseRecord,
  CourseResourceRecord,
  EducationSnapshot,
} from "../schemas/education.ts";
import type { ProjectState } from "../schemas/models.ts";
import { EducationRepo } from "../storage/education-repo.ts";
import { expandRelatedCourseIds } from "./course-relations.ts";

export interface ProjectCourseContext {
  courses: CourseRecord[];
  relevantItems: CourseItemRecord[];
  relevantResources: CourseResourceRecord[];
  summaryLines: string[];
  readSet: string[];
}

export interface ProjectQueryNeed {
  homework: boolean;
  lecture: boolean;
  exam: boolean;
  resource: boolean;
}

const COMMON_QUERY_TOKENS = new Set(["怎么", "老师", "这个", "那个", "什么", "帮我", "一下"]);

export const normalize = (value: string): string => value.toLowerCase();

const tokenizeEnglish = (message: string): string[] =>
  Array.from(new Set((message.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []).filter(Boolean)));

const tokenizeChinese = (message: string): string[] => {
  const segments = message.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  const tokens = new Set<string>();
  for (const segment of segments) {
    tokens.add(segment);
    const max = Math.min(segment.length, 4);
    for (let size = 2; size <= max; size += 1) {
      for (let index = 0; index <= segment.length - size; index += 1) {
        tokens.add(segment.slice(index, index + size));
      }
    }
  }
  return Array.from(tokens);
};

export const tokenizeMessage = (message: string): string[] =>
  Array.from(new Set([...tokenizeEnglish(message), ...tokenizeChinese(message)])).filter(
    (token) => !COMMON_QUERY_TOKENS.has(token),
  );

const stringifyRecord = (value: Record<string, unknown>): string => JSON.stringify(value).toLowerCase();

export const itemText = (item: CourseItemRecord): string =>
  normalize(
    [
      item.manualTitle ?? item.title,
      item.body,
      item.teacher ?? "",
      item.manualLocation ?? item.location ?? "",
      stringifyRecord(item.metaJson),
      item.manualNote ?? "",
    ].join(" "),
  );

export const resourceText = (resource: CourseResourceRecord): string =>
  normalize([resource.title, resource.url, resource.localPath ?? "", stringifyRecord(resource.metaJson)].join(" "));

export const scoreTokenOverlap = (haystack: string, tokens: string[]): number =>
  tokens.reduce((score, token) => score + (token && haystack.includes(normalize(token)) ? token.length : 0), 0);

export const detectNeed = (message: string): ProjectQueryNeed => ({
  homework: /(作业|assignment|homework|ddl|截止|due)/i.test(message),
  lecture: /(怎么讲|讲了什么|老师.*讲|第\s*[0-9一二三四五六七八九十]+\s*讲|回放|replay|课堂|课上)/i.test(message),
  exam: /(考试|exam|quiz|测验|期中|期末)/i.test(message),
  resource: /(课件|ppt|pdf|讲义|字幕|notes|资料|resource|教材|slide|slides)/i.test(message),
});

const itemTypeBias = (item: CourseItemRecord, need: ProjectQueryNeed): number => {
  let score = 0;
  if (need.homework) {
    if (item.type === "assignment") score += 14;
    if (item.type === "notice") score += 6;
  }
  if (need.lecture) {
    if (item.type === "replay") score += 14;
    if (item.type === "class") score += 10;
  }
  if (need.exam && item.type === "exam") score += 14;
  if (!need.homework && !need.lecture && !need.exam) {
    if (item.type === "class" || item.type === "assignment" || item.type === "replay") score += 3;
  }
  return score;
};

export const resourceTypeBias = (resource: CourseResourceRecord, need: ProjectQueryNeed): number => {
  let score = 0;
  if (need.lecture) {
    if (resource.resourceType === "subtitle") score += 12;
    if (resource.resourceType === "ppt" || resource.resourceType === "pptx") score += 10;
    if (resource.resourceType === "video" || resource.resourceType === "notes") score += 8;
  }
  if (need.resource) {
    if (resource.resourceType === "pdf" || resource.resourceType === "ppt" || resource.resourceType === "pptx") score += 8;
    if (resource.resourceType === "notes" || resource.resourceType === "link") score += 6;
  }
  if (need.homework && resource.resourceType === "notes") score += 4;
  return score;
};

const formatWhen = (item: CourseItemRecord): string => item.startAt ?? item.dueAt ?? "unscheduled";

export const resourceBelongsToProject = (
  project: ProjectState,
  resource: CourseResourceRecord,
  expandedCourseIds?: Set<string>,
): boolean => {
  const projectId = typeof resource.metaJson.projectId === "string" ? resource.metaJson.projectId : null;
  if (projectId) {
    return projectId === project.projectId;
  }
  return (expandedCourseIds ?? new Set(project.scope.courseIds)).has(resource.courseId);
};

export class ProjectResourceService {
  private readonly educationRepo: EducationRepo;

  constructor(educationRepo: EducationRepo) {
    this.educationRepo = educationRepo;
  }

  async buildContext(project: ProjectState, message: string): Promise<ProjectCourseContext> {
    const courseIds = project.scope.courseIds.filter(Boolean);
    const hasProjectUploads = project.resources.pinnedResourceIds.length > 0;
    if (!courseIds.length && !hasProjectUploads) {
      return {
        courses: [],
        relevantItems: [],
        relevantResources: [],
        summaryLines: [],
        readSet: [],
      };
    }

    const snapshot = await this.educationRepo.readSnapshot();
    return this.buildContextFromSnapshot(project, snapshot, message);
  }

  buildContextFromSnapshot(project: ProjectState, snapshot: EducationSnapshot, message: string): ProjectCourseContext {
    const courseIds = expandRelatedCourseIds(snapshot, project.scope.courseIds.filter(Boolean));
    const courses = snapshot.courses.filter((course) => courseIds.has(course.id));
    if (!courses.length && !project.resources.pinnedResourceIds.length) {
      return {
        courses: [],
        relevantItems: [],
        relevantResources: [],
        summaryLines: [`Project is course-bound, but no imported course record matched: ${project.scope.courseIds.join(", ")}.`],
        readSet: [
          "workspace/state/education/courses.json",
          "workspace/state/education/course-items.json",
          "workspace/state/education/course-resources.json",
        ],
      };
    }

    const need = detectNeed(message);
    const tokens = tokenizeMessage(message);
    const items = snapshot.courseItems.filter((item) => courseIds.has(item.courseId) && !item.isHidden);
    const scoredItems = items
      .map((item) => ({
        item,
        score: itemTypeBias(item, need) + scoreTokenOverlap(itemText(item), tokens),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || formatWhen(right.item).localeCompare(formatWhen(left.item)));

    const relevantItems = scoredItems.slice(0, 3).map((entry) => entry.item);
    const itemIds = new Set(relevantItems.map((item) => item.id));
    const scoredResources = snapshot.courseResources
      .filter((resource) => resourceBelongsToProject(project, resource, courseIds))
      .map((resource) => {
        let score = resourceTypeBias(resource, need) + scoreTokenOverlap(resourceText(resource), tokens);
        if (resource.linkedItemId && itemIds.has(resource.linkedItemId)) score += 12;
        if (project.resources.pinnedResourceIds.includes(resource.id)) score += 10;
        if (project.resources.preferredTypes.includes(resource.resourceType)) score += 4;
        return { resource, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.resource.title.localeCompare(right.resource.title));

    const relevantResources = scoredResources.slice(0, 4).map((entry) => entry.resource);
    const summaryLines: string[] = [];

    if (courses.length) {
      summaryLines.push(
        `Bound courses: ${courses.map((course) => `${course.title} (${course.teacher || "teacher unknown"})`).join("; ")}.`,
      );
    }

    if (relevantItems.length) {
      summaryLines.push(
        `Relevant course items: ${relevantItems
          .map((item) => `[${item.type}] ${item.manualTitle ?? item.title} @ ${formatWhen(item)}`)
          .join(" ; ")}.`,
      );
    }

    if (relevantResources.length) {
      summaryLines.push(
        `Relevant course resources: ${relevantResources
          .map((resource) => `[${resource.resourceType}] ${resource.title}`)
          .join(" ; ")}.`,
      );
    }

    return {
      courses,
      relevantItems,
      relevantResources,
      summaryLines,
      readSet: [
        "workspace/state/education/courses.json",
        "workspace/state/education/course-items.json",
        "workspace/state/education/course-resources.json",
      ],
    };
  }
}
