import type {
  ConnectionRecord,
  CourseItemRecord,
  CourseItemType,
  CourseRecord,
  CourseResourceRecord,
  CourseResourceType,
  EducationSnapshot,
  SchedulePreferences,
} from "../schemas/education.ts";
import { ReplayKnowledgeService } from "./replay-knowledge-service.ts";
import { ResourceIndexer } from "./resource-indexer.ts";
import { EducationRepo } from "../storage/education-repo.ts";

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "item";

const stableCourseKey = (input: {
  term: string;
  sourceType: string;
  sourceCourseId?: string | null;
  stableKeyHint?: string | null;
  title: string;
  teacher?: string | null;
}): string => {
  if (input.sourceCourseId?.trim()) {
    return `${slugify(input.term)}:${slugify(input.sourceType)}:${slugify(input.sourceCourseId)}`;
  }
  return `${slugify(input.term)}:${slugify(input.title)}:${slugify(input.teacher || "unknown-teacher")}`;
};

const generatedCourseId = (stableKey: string): string => `course-${stableKey}`;

const generatedItemId = (courseId: string, input: {
  sourceType: string;
  sourceItemId?: string | null;
  type: CourseItemType;
  title: string;
  startAt?: string | null;
  dueAt?: string | null;
}): string => {
  if (input.sourceItemId?.trim()) return `item-${slugify(input.sourceType)}-${slugify(input.sourceItemId)}`;
  return `item-${slugify(courseId)}-${input.type}-${slugify(input.title)}-${slugify(input.startAt || input.dueAt || "unscheduled")}`;
};

const generatedResourceId = (courseId: string, input: {
  sourceType: string;
  sourceResourceId?: string | null;
  resourceType: CourseResourceType;
  title: string;
  url: string;
}): string => {
  if (input.sourceResourceId?.trim()) return `resource-${slugify(input.sourceType)}-${slugify(input.sourceResourceId)}`;
  return `resource-${slugify(courseId)}-${input.resourceType}-${slugify(input.title)}-${slugify(input.url)}`;
};

const readMetadataRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};

const readStableKeyHints = (metadata: Record<string, unknown> | null | undefined): string[] => {
  const arrayValue = metadata?.stableKeyHints;
  if (Array.isArray(arrayValue)) {
    return arrayValue
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean);
  }
  if (typeof metadata?.stableKeyHint === "string" && metadata.stableKeyHint.trim()) {
    return [metadata.stableKeyHint.trim()];
  }
  return [];
};

const mergeStableKeyHints = (
  existingMetadata: Record<string, unknown> | null | undefined,
  incomingHint: string | null,
): string[] => {
  const hints = new Set(readStableKeyHints(existingMetadata));
  if (incomingHint?.trim()) {
    hints.add(incomingHint.trim());
  }
  return Array.from(hints);
};

const mergeSourceAliases = (
  existingMetadata: Record<string, unknown> | null | undefined,
  sourceType: string,
  sourceCourseId: string | null,
): Record<string, string> => {
  const existingAliases = readMetadataRecord(existingMetadata?.sourceAliases);
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(existingAliases)) {
    if (typeof value === "string" && value.trim()) {
      next[key] = value.trim();
    }
  }
  if (sourceCourseId?.trim()) {
    next[sourceType] = sourceCourseId.trim();
  }
  return next;
};

export interface ImportedConnection {
  sourceType: string;
  accountLabel: string;
  status?: ConnectionRecord["status"];
  auth?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  lastSyncedAt?: string | null;
  lastError?: string | null;
}

export interface ImportedCourseItem {
  sourceItemId?: string | null;
  type: CourseItemType;
  title: string;
  teacher?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  dueAt?: string | null;
  location?: string | null;
  body?: string;
  metaJson?: Record<string, unknown>;
  lastSyncedAt?: string | null;
}

export interface ImportedCourseResource {
  sourceResourceId?: string | null;
  linkedItemSourceId?: string | null;
  parentSourceResourceId?: string | null;
  resourceType: CourseResourceType;
  title: string;
  url: string;
  localPath?: string | null;
  metaJson?: Record<string, unknown>;
}

export interface ImportedCourse {
  stableKeyHint?: string | null;
  sourceCourseId?: string | null;
  title: string;
  teacher?: string | null;
  term: string;
  displayColor?: string | null;
  status?: CourseRecord["status"];
  metadata?: Record<string, unknown>;
  items?: ImportedCourseItem[];
  resources?: ImportedCourseResource[];
}

export interface EducationImportDocument {
  sourceType: string;
  importedAt?: string | null;
  connection?: ImportedConnection | null;
  schedulePreferences?: Partial<SchedulePreferences>;
  courses: ImportedCourse[];
}

export interface EducationImportResult {
  sourceType: string;
  importedCourses: number;
  importedItems: number;
  importedResources: number;
  schedulePreferences: SchedulePreferences;
}

const upsertConnection = (connections: ConnectionRecord[], sourceType: string, connection?: ImportedConnection | null): ConnectionRecord[] => {
  if (!connection) return connections;
  const id = `connection-${slugify(sourceType)}-${slugify(connection.accountLabel)}`;
  const next: ConnectionRecord = {
    id,
    sourceType,
    accountLabel: connection.accountLabel,
    status: connection.status ?? "connected",
    auth: connection.auth ?? {},
    metadata: connection.metadata ?? {},
    lastSyncedAt: connection.lastSyncedAt ?? null,
    lastError: connection.lastError ?? null,
  };

  const existingIndex = connections.findIndex((item) => item.id === id);
  if (existingIndex < 0) return [...connections, next];
  const merged = [...connections];
  merged[existingIndex] = { ...merged[existingIndex], ...next };
  return merged;
};

const upsertCourse = (courses: CourseRecord[], sourceType: string, input: ImportedCourse): CourseRecord => {
  const requestedStableKey = stableCourseKey({
    term: input.term,
    sourceType,
    sourceCourseId: input.sourceCourseId,
    stableKeyHint: input.stableKeyHint,
    title: input.title,
    teacher: input.teacher,
  });
  const requestedHint = input.stableKeyHint?.trim() || null;
  const linkedCourseId =
    typeof input.metadata?.byxtCourseId === "string" && input.metadata.byxtCourseId.trim()
      ? input.metadata.byxtCourseId.trim()
      : "";
  const linkedMatch = linkedCourseId ? courses.find((course) => course.id === linkedCourseId) : null;
  const exactMatch = courses.find((course) => course.stableKey === requestedStableKey);
  const hintedMatch =
    exactMatch ||
    !requestedHint
      ? null
      : courses.find(
          (course) =>
            course.term === input.term &&
            readStableKeyHints(course.metadata).includes(requestedHint),
        );
  const existing = linkedMatch ?? exactMatch ?? hintedMatch ?? null;
  const stableKey = existing?.stableKey ?? requestedStableKey;
  const id = existing?.id ?? generatedCourseId(stableKey);
  const stableKeyHints = mergeStableKeyHints(existing?.metadata, requestedHint);
  const sourceAliases = mergeSourceAliases(existing?.metadata, sourceType, input.sourceCourseId ?? null);
  const keepExistingIdentity = Boolean(existing && existing.sourceType !== sourceType);
  const next: CourseRecord = {
    id,
    stableKey,
    title: keepExistingIdentity ? existing!.title : input.title,
    teacher: keepExistingIdentity ? existing!.teacher : input.teacher || "",
    term: keepExistingIdentity ? existing!.term : input.term,
    sourceType: existing?.sourceType ?? sourceType,
    sourceCourseId:
      existing?.sourceType === sourceType
        ? input.sourceCourseId ?? existing?.sourceCourseId ?? null
        : existing?.sourceCourseId ?? input.sourceCourseId ?? null,
    status: input.status ?? existing?.status ?? "active",
    displayColor: input.displayColor ?? existing?.displayColor ?? null,
    metadata: {
      ...readMetadataRecord(existing?.metadata),
      ...(input.metadata ?? {}),
      stableKeyHints,
      sourceAliases,
    },
  };

  const existingIndex = courses.findIndex((course) => course.id === id);
  if (existingIndex < 0) {
    courses.push(next);
  } else {
    courses[existingIndex] = next;
  }
  return next;
};

const upsertCourseItems = (
  items: CourseItemRecord[],
  sourceType: string,
  course: CourseRecord,
  importedItems: ImportedCourseItem[],
): Map<string, string> => {
  const itemIdsBySourceId = new Map<string, string>();
  for (const imported of importedItems) {
    const id = generatedItemId(course.id, {
      sourceType,
      sourceItemId: imported.sourceItemId,
      type: imported.type,
      title: imported.title,
      startAt: imported.startAt,
      dueAt: imported.dueAt,
    });
    const existingIndex = items.findIndex((item) => item.id === id);
    const existing = existingIndex >= 0 ? items[existingIndex] : null;
    const next: CourseItemRecord = {
      id,
      courseId: course.id,
      type: imported.type,
      sourceItemId: imported.sourceItemId ?? null,
      title: imported.title,
      teacher: imported.teacher ?? course.teacher ?? null,
      startAt: imported.startAt ?? null,
      endAt: imported.endAt ?? null,
      dueAt: imported.dueAt ?? null,
      location: imported.location ?? null,
      body: imported.body ?? "",
      metaJson: {
        ...(existing?.metaJson ?? {}),
        ...(imported.metaJson ?? {}),
      },
      isHidden: existing?.isHidden ?? false,
      manualTitle: existing?.manualTitle ?? null,
      manualLocation: existing?.manualLocation ?? null,
      manualStartAt: existing?.manualStartAt ?? null,
      manualEndAt: existing?.manualEndAt ?? null,
      manualNote: existing?.manualNote ?? null,
      lastSyncedAt: imported.lastSyncedAt ?? existing?.lastSyncedAt ?? null,
    };
    if (existingIndex < 0) {
      items.push(next);
    } else {
      items[existingIndex] = next;
    }
    if (imported.sourceItemId?.trim()) itemIdsBySourceId.set(imported.sourceItemId, id);
  }
  return itemIdsBySourceId;
};

const upsertCourseResources = (
  resources: CourseResourceRecord[],
  sourceType: string,
  course: CourseRecord,
  importedResources: ImportedCourseResource[],
  itemIdsBySourceId: Map<string, string>,
): void => {
  const resourceIdsBySourceId = new Map<string, string>();
  for (const imported of importedResources) {
    const id = generatedResourceId(course.id, {
      sourceType,
      sourceResourceId: imported.sourceResourceId,
      resourceType: imported.resourceType,
      title: imported.title,
      url: imported.url,
    });
    const existingIndex = resources.findIndex((resource) => resource.id === id);
    const existing = existingIndex >= 0 ? resources[existingIndex] : null;
    const linkedItemId = imported.linkedItemSourceId ? itemIdsBySourceId.get(imported.linkedItemSourceId) ?? null : existing?.linkedItemId ?? null;
    const parentId = imported.parentSourceResourceId ? resourceIdsBySourceId.get(imported.parentSourceResourceId) ?? null : existing?.parentId ?? null;
    const next: CourseResourceRecord = {
      id,
      courseId: course.id,
      linkedItemId,
      parentId,
      resourceType: imported.resourceType,
      title: imported.title,
      url: imported.url,
      localPath: imported.localPath ?? existing?.localPath ?? null,
      metaJson: {
        ...(existing?.metaJson ?? {}),
        ...(imported.metaJson ?? {}),
      },
    };

    if (existingIndex < 0) {
      resources.push(next);
    } else {
      resources[existingIndex] = next;
    }
    if (imported.sourceResourceId?.trim()) resourceIdsBySourceId.set(imported.sourceResourceId, id);
  }
};

export const importEducationDocument = async (
  repo: EducationRepo,
  document: EducationImportDocument,
): Promise<EducationImportResult> => {
  await repo.ensureScaffold();
  const snapshot: EducationSnapshot = await repo.readSnapshot();

  snapshot.connections = upsertConnection(snapshot.connections, document.sourceType, document.connection);

  let importedItems = 0;
  let importedResources = 0;
  const importedCourseIds = new Set<string>();
  for (const importedCourse of document.courses) {
    const course = upsertCourse(snapshot.courses, document.sourceType, importedCourse);
    importedCourseIds.add(course.id);
    const itemIdsBySourceId = upsertCourseItems(snapshot.courseItems, document.sourceType, course, importedCourse.items ?? []);
    upsertCourseResources(snapshot.courseResources, document.sourceType, course, importedCourse.resources ?? [], itemIdsBySourceId);
    importedItems += importedCourse.items?.length ?? 0;
    importedResources += importedCourse.resources?.length ?? 0;
  }

  await Promise.all([
    repo.writeConnections(snapshot.connections),
    repo.writeCourses(snapshot.courses),
    repo.writeCourseItems(snapshot.courseItems),
    repo.writeCourseResources(snapshot.courseResources),
  ]);

  const indexer = new ResourceIndexer(repo);
  const resourcesToIndex = snapshot.courseResources.filter(
    (resource) => importedCourseIds.has(resource.courseId) && Boolean(resource.localPath),
  );
  await Promise.all(resourcesToIndex.map((resource) => indexer.ensureIndexed(resource)));

  const replayKnowledgeService = new ReplayKnowledgeService(repo);
  const replayItemsToIndex = snapshot.courseItems.filter(
    (item) => importedCourseIds.has(item.courseId) && item.type === "replay",
  );
  await Promise.all(replayItemsToIndex.map((item) => replayKnowledgeService.ensureIndexedReplay(item, snapshot)));

  const schedulePreferences = document.schedulePreferences
    ? await repo.updateSchedulePreferences(document.schedulePreferences)
    : await repo.readSchedulePreferences();

  return {
    sourceType: document.sourceType,
    importedCourses: document.courses.length,
    importedItems,
    importedResources,
    schedulePreferences,
  };
};
