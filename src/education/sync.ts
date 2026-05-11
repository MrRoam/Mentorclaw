import { EducationRepo } from "../storage/education-repo.ts";
import type { CourseItemType, EducationSnapshot } from "../schemas/education.ts";
import { syncBuaaByxt, type BuaaByxtSyncResult } from "./providers/buaa/byxt.ts";
import { syncBuaaMsa, type BuaaMsaSyncResult } from "./providers/buaa/msa.ts";

export type EducationSyncResult = BuaaByxtSyncResult | BuaaMsaSyncResult;

const requireConnection = async (repo: EducationRepo, connectionId: string) => {
  const connections = await repo.readConnections();
  const matched = connections.find((connection) => connection.id === connectionId);
  if (!matched) {
    throw new Error(`Connection ${connectionId} was not found in the runtime education store.`);
  }
  return matched;
};

const readSnapshot = async (repo: EducationRepo): Promise<EducationSnapshot> => repo.readSnapshot();

const resolveMsaCourseIds = async (repo: EducationRepo, connectionId: string, courseId?: string | null): Promise<string[]> => {
  if (courseId?.trim()) return [courseId.trim()];
  const connection = await requireConnection(repo, connectionId);
  const metadataCourseIds = Array.isArray(connection.metadata?.courseIds)
    ? connection.metadata.courseIds.filter((value): value is string => typeof value === "string" && value.trim())
    : [];
  if (metadataCourseIds.length) return metadataCourseIds;

  const snapshot = await readSnapshot(repo);
  const mapped = Array.from(
    new Set(
      snapshot.courses.flatMap((course) => {
        const direct =
          course.sourceType === "buaa-msa" && typeof course.sourceCourseId === "string" && course.sourceCourseId.trim()
            ? [course.sourceCourseId.trim()]
            : [];
        const aliases =
          course.metadata && typeof course.metadata === "object" && !Array.isArray(course.metadata)
            ? (() => {
                const sourceAliases = (course.metadata as Record<string, unknown>).sourceAliases;
                if (!sourceAliases || typeof sourceAliases !== "object" || Array.isArray(sourceAliases)) return [];
                const alias = (sourceAliases as Record<string, unknown>)["buaa-msa"];
                return typeof alias === "string" && alias.trim() ? [alias.trim()] : [];
              })()
            : [];
        return [...direct, ...aliases];
      }),
    ),
  );
  if (mapped.length) return mapped;
  throw new Error("MSA sync needs course ids either in the connection metadata or as an explicit courseId.");
};

export const syncCourses = async (repo: EducationRepo, connectionId: string): Promise<EducationSyncResult> => {
  const connection = await requireConnection(repo, connectionId);
  if (connection.sourceType === "buaa-byxt") {
    return syncBuaaByxt(repo, {
      auth: connection.auth as Parameters<typeof syncBuaaByxt>[1]["auth"],
      termCode: typeof connection.metadata?.termCode === "string" ? connection.metadata.termCode : null,
    });
  }
  if (connection.sourceType === "buaa-msa") {
    return syncBuaaMsa(repo, {
      auth: connection.auth as Parameters<typeof syncBuaaMsa>[1]["auth"],
      term: typeof connection.metadata?.term === "string" ? connection.metadata.term : null,
      courseIds: await resolveMsaCourseIds(repo, connectionId),
    });
  }
  throw new Error(`Connection source ${connection.sourceType} is not supported yet.`);
};

export const syncCourseItems = async (
  repo: EducationRepo,
  connectionId: string,
  itemTypes: CourseItemType[] = ["class", "exam", "assignment", "notice", "replay"],
): Promise<EducationSyncResult> => {
  const connection = await requireConnection(repo, connectionId);
  if (connection.sourceType === "buaa-byxt") {
    if (!itemTypes.includes("class")) {
      throw new Error("BYXT only provides timetable class items in the current implementation.");
    }
    return syncCourses(repo, connectionId);
  }
  if (connection.sourceType === "buaa-msa") {
    if (!itemTypes.includes("replay")) {
      throw new Error("MSA currently syncs replay items and replay-linked resources.");
    }
    return syncCourses(repo, connectionId);
  }
  throw new Error(`Connection source ${connection.sourceType} is not supported yet.`);
};

export const syncCourseResources = async (
  repo: EducationRepo,
  connectionId: string,
  courseId?: string | null,
  _replayItemId?: string | null,
): Promise<EducationSyncResult> => {
  const connection = await requireConnection(repo, connectionId);
  if (connection.sourceType !== "buaa-msa") {
    throw new Error(`Connection source ${connection.sourceType} does not expose course resources right now.`);
  }
  return syncBuaaMsa(repo, {
    auth: connection.auth as Parameters<typeof syncBuaaMsa>[1]["auth"],
    term: typeof connection.metadata?.term === "string" ? connection.metadata.term : null,
    courseIds: await resolveMsaCourseIds(repo, connectionId, courseId),
  });
};
