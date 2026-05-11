import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ConnectionRecord,
  CourseItemRecord,
  CourseRecord,
  CourseResourceRecord,
  EducationSnapshot,
  SchedulePreferences,
} from "../schemas/education.ts";
import { defaultSchedulePreferences } from "../schemas/education.ts";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const normalizeSchedulePreferences = (value: Partial<SchedulePreferences> | null | undefined): SchedulePreferences => ({
  showTimetableInSchedule: value?.showTimetableInSchedule ?? defaultSchedulePreferences().showTimetableInSchedule,
  scheduleDefaultView: value?.scheduleDefaultView === "month" ? "month" : "week",
});

export class EducationRepo {
  readonly runtimeRoot: string;
  readonly workspaceRoot: string;
  readonly educationDir: string;
  readonly assetsDir: string;
  readonly uploadsDir: string;
  readonly indexDir: string;
  readonly resourceIndexDir: string;
  readonly replayKnowledgeIndexDir: string;
  readonly files: {
    connections: string;
    courses: string;
    courseItems: string;
    courseResources: string;
    schedulePreferences: string;
  };

  constructor(runtimeRoot: string) {
    this.runtimeRoot = runtimeRoot;
    this.workspaceRoot = path.join(runtimeRoot, "workspace");
    this.educationDir = path.join(this.workspaceRoot, "state", "education");
    this.assetsDir = path.join(this.educationDir, "assets");
    this.uploadsDir = path.join(this.assetsDir, "uploads");
    this.indexDir = path.join(this.educationDir, "index");
    this.resourceIndexDir = path.join(this.indexDir, "resources");
    this.replayKnowledgeIndexDir = path.join(this.indexDir, "replays");
    this.files = {
      connections: path.join(this.educationDir, "connections.json"),
      courses: path.join(this.educationDir, "courses.json"),
      courseItems: path.join(this.educationDir, "course-items.json"),
      courseResources: path.join(this.educationDir, "course-resources.json"),
      schedulePreferences: path.join(this.educationDir, "schedule-preferences.json"),
    };
  }

  async ensureScaffold(): Promise<void> {
    await Promise.all([
      mkdir(this.educationDir, { recursive: true }),
      mkdir(this.assetsDir, { recursive: true }),
      mkdir(this.uploadsDir, { recursive: true }),
      mkdir(this.indexDir, { recursive: true }),
      mkdir(this.resourceIndexDir, { recursive: true }),
      mkdir(this.replayKnowledgeIndexDir, { recursive: true }),
    ]);
    await Promise.all([
      this.writeIfMissing(this.files.connections, [] satisfies ConnectionRecord[]),
      this.writeIfMissing(this.files.courses, [] satisfies CourseRecord[]),
      this.writeIfMissing(this.files.courseItems, [] satisfies CourseItemRecord[]),
      this.writeIfMissing(this.files.courseResources, [] satisfies CourseResourceRecord[]),
      this.writeIfMissing(this.files.schedulePreferences, defaultSchedulePreferences()),
    ]);
  }

  async readSnapshot(): Promise<EducationSnapshot> {
    const [connections, courses, courseItems, courseResources, schedulePreferences] = await Promise.all([
      this.readConnections(),
      this.readCourses(),
      this.readCourseItems(),
      this.readCourseResources(),
      this.readSchedulePreferences(),
    ]);
    return { connections, courses, courseItems, courseResources, schedulePreferences };
  }

  async readConnections(): Promise<ConnectionRecord[]> {
    return this.readJson(this.files.connections, []);
  }

  async writeConnections(records: ConnectionRecord[]): Promise<void> {
    await this.writeJson(this.files.connections, records);
  }

  async readCourses(): Promise<CourseRecord[]> {
    return this.readJson(this.files.courses, []);
  }

  async writeCourses(records: CourseRecord[]): Promise<void> {
    await this.writeJson(this.files.courses, records);
  }

  async readCourseItems(): Promise<CourseItemRecord[]> {
    return this.readJson(this.files.courseItems, []);
  }

  async writeCourseItems(records: CourseItemRecord[]): Promise<void> {
    await this.writeJson(this.files.courseItems, records);
  }

  async readCourseResources(): Promise<CourseResourceRecord[]> {
    return this.readJson(this.files.courseResources, []);
  }

  async writeCourseResources(records: CourseResourceRecord[]): Promise<void> {
    await this.writeJson(this.files.courseResources, records);
  }

  async readSchedulePreferences(): Promise<SchedulePreferences> {
    const raw = await this.readJson<Partial<SchedulePreferences>>(this.files.schedulePreferences, defaultSchedulePreferences());
    return normalizeSchedulePreferences(raw);
  }

  async writeSchedulePreferences(preferences: SchedulePreferences): Promise<void> {
    await this.writeJson(this.files.schedulePreferences, normalizeSchedulePreferences(preferences));
  }

  async updateSchedulePreferences(patch: Partial<SchedulePreferences>): Promise<SchedulePreferences> {
    const next = normalizeSchedulePreferences({
      ...(await this.readSchedulePreferences()),
      ...patch,
    });
    await this.writeSchedulePreferences(next);
    return next;
  }

  resourceIndexPath(resourceId: string): string {
    return path.join(this.resourceIndexDir, `${resourceId}.json`);
  }

  replayKnowledgeIndexPath(replayItemId: string): string {
    return path.join(this.replayKnowledgeIndexDir, `${replayItemId}.json`);
  }

  projectUploadDir(projectId: string): string {
    return path.join(this.uploadsDir, projectId);
  }

  private async readJson<T>(filePath: string, fallback: T): Promise<T> {
    try {
      const raw = await readFile(filePath, "utf8");
      if (!raw.trim()) return clone(fallback);
      return JSON.parse(raw) as T;
    } catch {
      return clone(fallback);
    }
  }

  private async writeJson(filePath: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }

  private async writeIfMissing(filePath: string, value: unknown): Promise<void> {
    try {
      await readFile(filePath, "utf8");
    } catch {
      await this.writeJson(filePath, value);
    }
  }
}
