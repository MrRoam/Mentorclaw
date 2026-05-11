import { readFile, writeFile } from "node:fs/promises";
import type { CourseItemRecord, CourseResourceRecord, EducationSnapshot } from "../schemas/education.ts";
import type { ProjectState } from "../schemas/models.ts";
import { EducationRepo } from "../storage/education-repo.ts";
import { resourceBelongsToProject, scoreTokenOverlap, tokenizeMessage } from "./project-resource-service.ts";
import { ResourceIndexer, type TimestampIndexSegment } from "./resource-indexer.ts";
import { expandRelatedCourseIds } from "./course-relations.ts";

export interface ReplaySlideTiming {
  page: number;
  timeSec: number;
  timeText: string | null;
}

export interface ReplayKnowledgeSegment {
  startSec: number;
  endSec: number;
  text: string;
  keywords: string[];
  subtitleResourceId: string;
  pptResourceId: string | null;
  pptPage: number | null;
  pptTimeSec: number | null;
}

export interface ReplayKnowledgeIndexRecord {
  replayItemId: string;
  courseId: string;
  replayTitle: string;
  subtitleResourceId: string;
  pptResourceId: string | null;
  slideTimeline: ReplaySlideTiming[];
  sourceFingerprint: string;
  updatedAt: string;
  segments: ReplayKnowledgeSegment[];
}

export interface ReplayKnowledgeMatch {
  replayItemId: string;
  courseId: string;
  replayTitle: string;
  startSec: number;
  endSec: number;
  text: string;
  keywords: string[];
  subtitleResourceId: string;
  pptResourceId: string | null;
  pptPage: number | null;
  pptTimeSec: number | null;
  score: number;
}

export interface ReplayKnowledgeSearchResult {
  matches: ReplayKnowledgeMatch[];
  summaryLines: string[];
  readSet: string[];
}

const normalizeSlideTimeline = (resource: CourseResourceRecord): ReplaySlideTiming[] => {
  const raw = resource.metaJson.slideTimeline;
  if (!Array.isArray(raw)) {
    const imageUrls = Array.isArray(resource.metaJson.imageUrls)
      ? resource.metaJson.imageUrls.map((entry) => String(entry ?? "").trim()).filter(Boolean)
      : [];
    return imageUrls
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
      .filter((entry): entry is ReplaySlideTiming => Boolean(entry))
      .sort((left, right) => left.timeSec - right.timeSec || left.page - right.page);
  }
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const page = Number(record.page);
      const timeSec = Number(record.timeSec);
      return Number.isFinite(page) && page > 0 && Number.isFinite(timeSec) && timeSec >= 0
        ? {
            page,
            timeSec,
            timeText: typeof record.timeText === "string" && record.timeText.trim() ? record.timeText.trim() : null,
          }
        : null;
    })
    .filter((entry): entry is ReplaySlideTiming => Boolean(entry))
    .sort((left, right) => left.timeSec - right.timeSec || left.page - right.page);
};

const findActiveSlide = (
  segment: TimestampIndexSegment,
  slideTimeline: ReplaySlideTiming[],
): { page: number | null; timeSec: number | null } => {
  if (!slideTimeline.length) {
    return { page: null, timeSec: null };
  }

  let active = slideTimeline[0];
  for (const slide of slideTimeline) {
    if (slide.timeSec <= segment.startSec) {
      active = slide;
      continue;
    }
    break;
  }

  return {
    page: active.page,
    timeSec: active.timeSec,
  };
};

const buildSourceFingerprint = (
  replay: CourseItemRecord,
  subtitleIndexFingerprint: string,
  slideTimeline: ReplaySlideTiming[],
  pptResourceId: string | null,
): string =>
  JSON.stringify({
    replayId: replay.id,
    replayUpdatedAt: replay.lastSyncedAt ?? null,
    subtitleIndexFingerprint,
    pptResourceId,
    slideTimeline,
  });

const compactSnippet = (value: string, maxLength: number = 140): string => {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
};

const renderSummaryLine = (match: ReplayKnowledgeMatch): string => {
  const startMin = Math.floor(match.startSec / 60);
  const startSec = Math.floor(match.startSec % 60)
    .toString()
    .padStart(2, "0");
  const endMin = Math.floor(match.endSec / 60);
  const endSec = Math.floor(match.endSec % 60)
    .toString()
    .padStart(2, "0");
  const slideText = match.pptPage ? `; aligned slide ${match.pptPage}` : "";
  return `${match.replayTitle} ${startMin}:${startSec}-${endMin}:${endSec}${slideText}: ${compactSnippet(match.text)}.`;
};

export class ReplayKnowledgeService {
  private readonly educationRepo: EducationRepo;
  private readonly resourceIndexer: ResourceIndexer;

  constructor(educationRepo: EducationRepo) {
    this.educationRepo = educationRepo;
    this.resourceIndexer = new ResourceIndexer(educationRepo);
  }

  async readReplayIndex(replayItemId: string): Promise<ReplayKnowledgeIndexRecord | null> {
    try {
      const raw = await readFile(this.educationRepo.replayKnowledgeIndexPath(replayItemId), "utf8");
      return JSON.parse(raw) as ReplayKnowledgeIndexRecord;
    } catch {
      return null;
    }
  }

  async ensureIndexedReplay(
    replay: CourseItemRecord,
    snapshot?: EducationSnapshot,
  ): Promise<ReplayKnowledgeIndexRecord | null> {
    if (replay.type !== "replay") {
      return null;
    }

    const resolvedSnapshot = snapshot ?? (await this.educationRepo.readSnapshot());
    const linkedResources = resolvedSnapshot.courseResources.filter((resource) => resource.linkedItemId === replay.id);
    const subtitleResource = linkedResources.find((resource) => resource.resourceType === "subtitle");
    if (!subtitleResource) {
      return null;
    }

    const subtitleIndex = await this.resourceIndexer.ensureIndexed(subtitleResource);
    const subtitleSegments = subtitleIndex?.segments.filter(
      (segment): segment is TimestampIndexSegment => segment.kind === "timestamp",
    );
    if (!subtitleIndex || !subtitleSegments.length) {
      return null;
    }

    const pptResource =
      linkedResources.find((resource) => resource.resourceType === "ppt" && normalizeSlideTimeline(resource).length > 0) ??
      null;
    const slideTimeline = pptResource ? normalizeSlideTimeline(pptResource) : [];
    const sourceFingerprint = buildSourceFingerprint(replay, subtitleIndex.sourceFingerprint, slideTimeline, pptResource?.id ?? null);
    const existing = await this.readReplayIndex(replay.id);
    if (existing?.sourceFingerprint === sourceFingerprint) {
      return existing;
    }

    const segments: ReplayKnowledgeSegment[] = subtitleSegments.map((segment) => {
      const activeSlide = findActiveSlide(segment, slideTimeline);
      return {
        startSec: segment.startSec,
        endSec: segment.endSec,
        text: segment.text,
        keywords: segment.keywords,
        subtitleResourceId: subtitleResource.id,
        pptResourceId: pptResource?.id ?? null,
        pptPage: activeSlide.page,
        pptTimeSec: activeSlide.timeSec,
      };
    });

    const record: ReplayKnowledgeIndexRecord = {
      replayItemId: replay.id,
      courseId: replay.courseId,
      replayTitle: replay.manualTitle ?? replay.title,
      subtitleResourceId: subtitleResource.id,
      pptResourceId: pptResource?.id ?? null,
      slideTimeline,
      sourceFingerprint,
      updatedAt: new Date().toISOString(),
      segments,
    };

    await writeFile(
      this.educationRepo.replayKnowledgeIndexPath(replay.id),
      `${JSON.stringify(record, null, 2)}\n`,
      "utf8",
    );
    return record;
  }

  async search(project: ProjectState, message: string): Promise<ReplayKnowledgeSearchResult> {
    const snapshot = await this.educationRepo.readSnapshot();
    return this.searchFromSnapshot(project, snapshot, message);
  }

  async searchFromSnapshot(
    project: ProjectState,
    snapshot: EducationSnapshot,
    message: string,
  ): Promise<ReplayKnowledgeSearchResult> {
    const tokens = tokenizeMessage(message);
    const matches: ReplayKnowledgeMatch[] = [];
    const readSet = new Set<string>();
    const expandedCourseIds = expandRelatedCourseIds(snapshot, project.scope.courseIds);
    const replayItems = snapshot.courseItems.filter(
      (item) => item.type === "replay" && expandedCourseIds.has(item.courseId),
    );
    const replayMap = new Map(replayItems.map((item) => [item.id, item]));

    for (const replay of replayItems) {
      const record = await this.ensureIndexedReplay(replay, snapshot);
      if (!record) continue;
      readSet.add(`workspace/state/education/index/replays/${replay.id}.json`);
      for (const segment of record.segments) {
        const score =
          scoreTokenOverlap(segment.text.toLowerCase(), tokens) +
          scoreTokenOverlap(segment.keywords.join(" "), tokens) +
          scoreTokenOverlap(record.replayTitle.toLowerCase(), tokens);
        if (score <= 0) continue;
        matches.push({
          replayItemId: replay.id,
          courseId: record.courseId,
          replayTitle: record.replayTitle,
          startSec: segment.startSec,
          endSec: segment.endSec,
          text: segment.text,
          keywords: segment.keywords,
          subtitleResourceId: segment.subtitleResourceId,
          pptResourceId: segment.pptResourceId,
          pptPage: segment.pptPage,
          pptTimeSec: segment.pptTimeSec,
          score,
        });
      }
    }

    matches.sort((left, right) => right.score - left.score || left.startSec - right.startSec);
    const deduped: ReplayKnowledgeMatch[] = [];
    const seen = new Set<string>();
    for (const match of matches) {
      const replay = replayMap.get(match.replayItemId);
      if (!replay) continue;
      const subtitleResource = snapshot.courseResources.find((resource) => resource.id === match.subtitleResourceId);
      if (!subtitleResource || !resourceBelongsToProject(project, subtitleResource, expandedCourseIds)) continue;
      const key = `${match.replayItemId}:${match.startSec}:${match.endSec}:${match.pptPage ?? "none"}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(match);
      if (deduped.length >= 5) break;
    }

    return {
      matches: deduped,
      summaryLines: deduped.slice(0, 3).map(renderSummaryLine),
      readSet: Array.from(readSet),
    };
  }
}
