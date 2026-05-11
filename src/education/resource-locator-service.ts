import type { CourseItemRecord, CourseResourceRecord, EducationSnapshot } from "../schemas/education.ts";
import type { ProjectState, ResourceLocatorMatch } from "../schemas/models.ts";
import { EducationRepo } from "../storage/education-repo.ts";
import {
  ProjectResourceService,
  detectNeed,
  itemText,
  resourceBelongsToProject,
  resourceText,
  resourceTypeBias,
  scoreTokenOverlap,
  tokenizeMessage,
} from "./project-resource-service.ts";
import { ReplayKnowledgeService } from "./replay-knowledge-service.ts";
import { ResourceIndexer, type ResourceIndexSegment } from "./resource-indexer.ts";
import { expandRelatedCourseIds } from "./course-relations.ts";

export interface LocatorResult {
  matches: ResourceLocatorMatch[];
  summaryLines: string[];
  readSet: string[];
}

const compactText = (value: string, maxLength: number = 160): string => {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
};

const resourceMatchBias = (resource: CourseResourceRecord, message: string): number => {
  let score = 0;
  if (/(教材|pdf|讲义|哪页)/i.test(message) && resource.resourceType === "pdf") score += 16;
  if (/(课件|ppt|slide|slides|哪页)/i.test(message) && (resource.resourceType === "ppt" || resource.resourceType === "pptx")) {
    score += 28;
  }
  if (/(怎么讲|回放|字幕|视频|lecture|replay|哪一段)/i.test(message)) {
    if (resource.resourceType === "subtitle") score += 18;
    if (resource.resourceType === "video") score += 10;
  }
  return score;
};

const itemIntentBias = (item: CourseItemRecord | null, message: string): number => {
  if (!item) return 0;
  if (/(作业|assignment|homework)/i.test(message) && item.type === "assignment") return 18;
  if (/(通知|notice)/i.test(message) && item.type === "notice") return 14;
  if (/(怎么讲|回放|lecture|replay)/i.test(message)) {
    if (item.type === "replay") return 16;
    if (item.type === "class") return 10;
  }
  return 0;
};

const segmentBias = (segment: ResourceIndexSegment, message: string): number => {
  if (segment.kind === "timestamp" && /(怎么讲|老师|回放|视频|字幕|哪一段)/i.test(message)) return 12;
  if (segment.kind === "page" && /(哪页|课件|教材|pdf|ppt|slide|slides)/i.test(message)) return 12;
  return 0;
};

const renderSummaryLine = (match: ResourceLocatorMatch): string => {
  if (match.locator.kind === "timestamp") {
    const startMin = Math.floor(match.locator.startSec / 60);
    const startSec = Math.floor(match.locator.startSec % 60)
      .toString()
      .padStart(2, "0");
    const endMin = Math.floor(match.locator.endSec / 60);
    const endSec = Math.floor(match.locator.endSec % 60)
      .toString()
      .padStart(2, "0");
    return `Relevant lecture locator: ${match.title} around ${startMin}:${startSec}-${endMin}:${endSec} mentions ${match.snippet}.`;
  }
  return `Relevant document locator: ${match.title} page ${match.locator.page} covers ${match.snippet}.`;
};

export class ResourceLocatorService {
  private readonly educationRepo: EducationRepo;
  private readonly projectResourceService: ProjectResourceService;
  private readonly resourceIndexer: ResourceIndexer;
  private readonly replayKnowledgeService: ReplayKnowledgeService;

  constructor(educationRepo: EducationRepo) {
    this.educationRepo = educationRepo;
    this.projectResourceService = new ProjectResourceService(educationRepo);
    this.resourceIndexer = new ResourceIndexer(educationRepo);
    this.replayKnowledgeService = new ReplayKnowledgeService(educationRepo);
  }

  async locate(project: ProjectState, message: string): Promise<LocatorResult> {
    const snapshot = await this.educationRepo.readSnapshot();
    return this.locateFromSnapshot(project, snapshot, message);
  }

  async locateFromSnapshot(project: ProjectState, snapshot: EducationSnapshot, message: string): Promise<LocatorResult> {
    const baseContext = this.projectResourceService.buildContextFromSnapshot(project, snapshot, message);
    const itemMap = new Map(snapshot.courseItems.map((item) => [item.id, item]));
    const resourceMap = new Map(snapshot.courseResources.map((resource) => [resource.id, resource]));
    const need = detectNeed(message);
    const tokens = tokenizeMessage(message);
    const expandedCourseIds = expandRelatedCourseIds(snapshot, project.scope.courseIds);
    const relevantItemIds = new Set(baseContext.relevantItems.map((item) => item.id));
    const candidateResources = new Map<string, CourseResourceRecord>();

    for (const resource of baseContext.relevantResources) {
      candidateResources.set(resource.id, resource);
    }
    for (const resource of snapshot.courseResources) {
      if (!resourceBelongsToProject(project, resource, expandedCourseIds)) continue;
      if (project.resources.pinnedResourceIds.includes(resource.id)) {
        candidateResources.set(resource.id, resource);
      }
      if (resource.linkedItemId && relevantItemIds.has(resource.linkedItemId)) {
        candidateResources.set(resource.id, resource);
      }
    }

    const matches: ResourceLocatorMatch[] = [];
    const readSet = new Set(baseContext.readSet);

    for (const resource of candidateResources.values()) {
      const linkedItem = resource.linkedItemId ? itemMap.get(resource.linkedItemId) ?? null : null;
      if (
        need.homework &&
        (resource.resourceType === "subtitle" || resource.resourceType === "video") &&
        linkedItem?.type !== "assignment" &&
        linkedItem?.type !== "notice"
      ) {
        continue;
      }

      const index = await this.resourceIndexer.ensureIndexed(resource);
      if (!index?.segments.length) continue;

      readSet.add(`workspace/state/education/index/resources/${resource.id}.json`);
      const baseScore =
        resourceTypeBias(resource, need) +
        resourceMatchBias(resource, message) +
        scoreTokenOverlap(resourceText(resource), tokens) +
        (project.resources.pinnedResourceIds.includes(resource.id) ? 10 : 0) +
        (project.resources.preferredTypes.includes(resource.resourceType) ? 5 : 0) +
        itemIntentBias(linkedItem, message) +
        (linkedItem ? scoreTokenOverlap(itemText(linkedItem), tokens) : 0);

      for (const segment of index.segments) {
        const segmentScore =
          baseScore +
          scoreTokenOverlap(segment.text.toLowerCase(), tokens) +
          scoreTokenOverlap(segment.keywords.join(" "), tokens) +
          segmentBias(segment, message) +
          (linkedItem && relevantItemIds.has(linkedItem.id) ? 8 : 0);

        if (segmentScore <= 0) continue;

        matches.push({
          resourceId: resource.id,
          resourceType: resource.resourceType,
          title: resource.title,
          courseId: resource.courseId,
          linkedItemId: resource.linkedItemId,
          locator:
            segment.kind === "timestamp"
              ? { kind: "timestamp", startSec: segment.startSec, endSec: segment.endSec }
              : { kind: "page", page: segment.page },
          snippet: compactText(segment.text),
          score: segmentScore,
          localPath: resource.localPath,
          url: resource.url,
        });
      }
    }

    const replayKnowledgeResult = need.homework
      ? { matches: [], summaryLines: [], readSet: [] }
      : await this.replayKnowledgeService.searchFromSnapshot(project, snapshot, message);
    for (const match of replayKnowledgeResult.matches) {
      const subtitleResource = resourceMap.get(match.subtitleResourceId);
      if (subtitleResource && resourceBelongsToProject(project, subtitleResource, expandedCourseIds)) {
        matches.push({
          resourceId: subtitleResource.id,
          resourceType: subtitleResource.resourceType,
          title: subtitleResource.title,
          courseId: subtitleResource.courseId,
          linkedItemId: subtitleResource.linkedItemId,
          locator: { kind: "timestamp", startSec: match.startSec, endSec: match.endSec },
          snippet: compactText(match.text),
          score: match.score + 6,
          localPath: subtitleResource.localPath,
          url: subtitleResource.url,
        });
      }

      if (match.pptResourceId && match.pptPage) {
        const pptResource = resourceMap.get(match.pptResourceId);
        if (pptResource && resourceBelongsToProject(project, pptResource, expandedCourseIds)) {
          matches.push({
            resourceId: pptResource.id,
            resourceType: pptResource.resourceType,
            title: pptResource.title,
            courseId: pptResource.courseId,
            linkedItemId: pptResource.linkedItemId,
            locator: { kind: "page", page: match.pptPage },
            snippet: compactText(match.text),
            score: match.score + (/(ppt|slide|slides|课件|哪页)/i.test(message) ? 18 : 4),
            localPath: pptResource.localPath,
            url: pptResource.url,
          });
        }
      }
    }

    matches.sort((left, right) => right.score - left.score || left.title.localeCompare(right.title));
    const deduped: ResourceLocatorMatch[] = [];
    const seen = new Set<string>();
    for (const match of matches) {
      const locatorKey =
        match.locator.kind === "timestamp"
          ? `${match.resourceId}:timestamp:${match.locator.startSec}:${match.locator.endSec}`
          : `${match.resourceId}:page:${match.locator.page}`;
      if (seen.has(locatorKey)) continue;
      seen.add(locatorKey);
      deduped.push(match);
      if (deduped.length >= 5) break;
    }

    return {
      matches: deduped,
      summaryLines: deduped.slice(0, 3).map(renderSummaryLine).concat(replayKnowledgeResult.summaryLines).slice(0, 3),
      readSet: Array.from(new Set([...readSet, ...replayKnowledgeResult.readSet])),
    };
  }
}
