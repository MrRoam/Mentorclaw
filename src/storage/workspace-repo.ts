import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  CronCreationInput,
  CronDefinition,
  CronRunRecord,
  CronScheduleRule,
  GlobalMemory,
  LearnerState,
  LearnerSummary,
  LearningEvent,
  Milestone,
  PlanCreationInput,
  PlanState,
  ProjectCreationInput,
  ProjectState,
  ResourceRef,
  RuntimePaths,
  RuntimeValidationResult,
  TaskItem,
  ThreadCreationInput,
  ThreadState,
} from "../schemas/models.ts";
import { parseCronScheduleDescription } from "../runtime/cron-schedule.ts";
import { makeMilestoneId, makePlanId, makeTaskId, makeThreadId } from "../utils/id.ts";
import { parseStructured, stringifyStructured } from "../utils/simple-yaml.ts";
import { daysFrom, nowIso } from "../utils/time.ts";

const DEFAULT_MEMORY = `# Durable Learner Memory

- 这里保存跨 project 稳定有效的用户画像、长期偏好和长期约束。
- 这里不保存某门课的一次性执行状态。
`;

const parseFrontmatter = (value: string): { attrs: Record<string, unknown>; body: string } => {
  const lines = value.split(/\r?\n/);
  if (lines[0] !== "---") {
    return { attrs: {}, body: value.trim() };
  }

  const closingIndex = lines.slice(1).findIndex((line) => line === "---");
  if (closingIndex < 0) {
    return { attrs: {}, body: value.trim() };
  }

  const attrsBlock = lines.slice(1, closingIndex + 1).join("\n");
  const body = lines.slice(closingIndex + 2).join("\n").trim();
  return { attrs: (parseStructured(attrsBlock) as Record<string, unknown>) ?? {}, body };
};

const renderFrontmatter = (attrs: Record<string, unknown>, body: string): string =>
  `---\n${JSON.stringify(attrs, null, 2)}\n---\n\n${body.trim()}\n`;

const sectionContent = (body: string, heading: string): string[] => {
  const matcher = new RegExp(`^## ${heading}\\s*$`, "m");
  const start = body.search(matcher);
  if (start < 0) return [];
  const after = body.slice(start).split(/\r?\n/).slice(1);
  const block: string[] = [];
  for (const line of after) {
    if (line.startsWith("## ")) break;
    const trimmed = line.replace(/^- /, "").trim();
    if (trimmed) block.push(trimmed);
  }
  return block;
};

const renderSection = (heading: string, lines: string[]): string =>
  `## ${heading}\n${lines.length ? `\n- ${lines.join("\n- ")}` : ""}`.trim();

const toResourceMarkdown = (resources: ResourceRef[]): string =>
  resources.length
    ? resources
        .map((resource) => `- [${resource.title}](${resource.uri}) | kind=${resource.kind} | trust=${resource.trustScore}`)
        .join("\n")
    : "- No bound resources yet.";

const parseResourceMarkdown = (markdown: string): ResourceRef[] =>
  markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ["))
    .map((line, index) => {
      const match = line.match(/^- \[(.+?)\]\((.+?)\)\s+\|\s+kind=(.+?)\s+\|\s+trust=(.+)$/);
      if (!match) return null;
      const [, title, uri, kind, trust] = match;
      return {
        id: `resource-${index + 1}`,
        title,
        uri,
        kind: kind as ResourceRef["kind"],
        sourceType: "manual",
        binding: "project",
        trustScore: Number(trust),
        relevanceScore: 0.5,
        rights: "unknown",
      } satisfies ResourceRef;
    })
    .filter((item): item is ResourceRef => item !== null);

const extractList = <T>(value: unknown): T[] => {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object" && Array.isArray((value as { items?: unknown[] }).items)) {
    return (value as { items: T[] }).items;
  }
  return [];
};

const defaultLearnerState = (): LearnerState => ({
  version: 1,
  updated_at: null,
  language: "zh-CN",
  timezone: "Asia/Shanghai",
  active_plan_count: 0,
  active_plan_ids: [],
  current_focus: null,
  risk_flags: [],
  capability_signals: [],
});

const buildSeedTasks = (goals: string[], now: string): TaskItem[] =>
  goals.map((goal, index) => ({
    id: makeTaskId(goal, index),
    title: goal,
    description: `Make measurable progress on "${goal}".`,
    status: "todo",
    priority: index === 0 ? "high" : "medium",
    dueAt: daysFrom(now, index + 1),
    acceptanceCriteria: [`Produce evidence for: ${goal}`],
    dependencies: index === 0 ? [] : [makeTaskId(goals[index - 1] ?? goal, index - 1)],
    evidenceRequired: index === 0 ? ["reproduction"] : ["application"],
    tags: ["auto-generated"],
  }));

const buildMilestones = (goals: string[], now: string): Milestone[] =>
  goals.slice(0, Math.max(1, Math.min(3, goals.length))).map((goal, index) => ({
    id: makeMilestoneId(goal, index),
    title: goal,
    dueAt: daysFrom(now, (index + 1) * 3),
    successCriteria: [`Evidence collected for ${goal}`],
    status: index === 0 ? "active" : "pending",
  }));

const toLegacyPlanState = (project: ProjectState): PlanState => ({
  planId: project.projectId,
  title: project.title,
  status: project.status === "archived" ? "completed" : project.status,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
  timebox: "",
  curriculumRefs: [],
  targetOutcome: project.goal.targetOutcome,
  constraints: project.goal.constraints,
  successDefinition: project.goal.successDefinition,
  goals: project.execution.tasks.map((task) => task.title),
  currentPhase: project.execution.mode,
  focusTopics: [],
  masterySnapshot: [],
  nextCheckpoint: project.execution.milestones[0]?.dueAt ?? null,
  tasks: project.execution.tasks,
  milestones: project.execution.milestones,
  misconceptions: project.memory.misconceptions,
  resources: project.resources.notes.map((note, index) => ({
    id: `project-note-${index + 1}`,
    title: note,
    kind: "other",
    sourceType: "project-note",
    uri: `project-note://${project.projectId}/${index + 1}`,
    binding: "project",
    bindingId: project.projectId,
    trustScore: 0.7,
    relevanceScore: 0.7,
    rights: "unknown",
  })),
  summary: project.summary,
  rubricRefs: [],
  threadIds: [],
});

const toProjectState = (plan: PlanState): ProjectState => ({
  projectId: plan.planId,
  title: plan.title,
  status: plan.status === "dropped" ? "archived" : plan.status,
  createdAt: plan.createdAt,
  updatedAt: plan.updatedAt,
  scope: {
    type: "general",
    courseIds: [],
  },
  goal: {
    summary: plan.summary || plan.title,
    targetOutcome: plan.targetOutcome,
    constraints: plan.constraints,
    successDefinition: plan.successDefinition,
  },
  execution: {
    mode: (plan.currentPhase as ProjectState["execution"]["mode"]) ?? "planning",
    nextAction: plan.tasks.find((task) => task.status !== "done")?.title ?? null,
    tasks: plan.tasks,
    milestones: plan.milestones,
  },
  memory: {
    misconceptions: plan.misconceptions,
    durableNotes: [],
  },
  resources: {
    pinnedResourceIds: plan.resources.map((resource) => resource.id),
    preferredTypes: Array.from(new Set(plan.resources.map((resource) => resource.kind))),
    notes: plan.resources.map((resource) => resource.title),
  },
  summary: plan.summary,
});

const mergeProjectStateFromPlan = (plan: PlanState, existing?: ProjectState | null): ProjectState => {
  const base = existing ?? toProjectState(plan);
  const resourceTitles = plan.resources.map((resource) => resource.title).filter(Boolean);
  const resourceKinds = plan.resources.map((resource) => resource.kind).filter(Boolean);
  const resourceIds = plan.resources.map((resource) => resource.id).filter(Boolean);

  return normalizeProject(
    {
      ...base,
      projectId: plan.planId,
      title: plan.title,
      status: plan.status === "dropped" ? "archived" : plan.status,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      goal: {
        ...base.goal,
        summary: plan.summary || base.goal.summary || plan.title,
        targetOutcome: plan.targetOutcome,
        constraints: plan.constraints,
        successDefinition: plan.successDefinition,
      },
      execution: {
        ...base.execution,
        mode: (plan.currentPhase as ProjectState["execution"]["mode"]) ?? base.execution.mode ?? "planning",
        nextAction: plan.tasks.find((task) => task.status !== "done")?.title ?? base.execution.nextAction ?? null,
        tasks: plan.tasks,
        milestones: plan.milestones,
      },
      memory: {
        ...base.memory,
        misconceptions: plan.misconceptions,
      },
      resources: {
        pinnedResourceIds: Array.from(new Set([...(base.resources?.pinnedResourceIds ?? []), ...resourceIds])),
        preferredTypes: Array.from(new Set([...(base.resources?.preferredTypes ?? []), ...resourceKinds])),
        notes: Array.from(new Set([...(base.resources?.notes ?? []), ...resourceTitles])),
      },
      summary: plan.summary,
    },
    plan.planId,
  );
};

const normalizeProject = (raw: Partial<ProjectState>, projectId: string): ProjectState => ({
  projectId,
  title: raw.title?.trim() || projectId,
  status: raw.status ?? "draft",
  createdAt: raw.createdAt ?? null,
  updatedAt: raw.updatedAt ?? null,
  scope: {
    type: raw.scope?.type === "course" ? "course" : "general",
    courseIds: Array.isArray(raw.scope?.courseIds) ? raw.scope!.courseIds.filter(Boolean) : [],
  },
  goal: {
    summary: raw.goal?.summary?.trim() || raw.summary?.trim() || raw.title?.trim() || projectId,
    targetOutcome: Array.isArray(raw.goal?.targetOutcome) ? raw.goal!.targetOutcome.filter(Boolean) : [],
    constraints: Array.isArray(raw.goal?.constraints) ? raw.goal!.constraints.filter(Boolean) : [],
    successDefinition: Array.isArray(raw.goal?.successDefinition) ? raw.goal!.successDefinition.filter(Boolean) : [],
  },
  execution: {
    mode: raw.execution?.mode ?? "planning",
    nextAction: raw.execution?.nextAction ?? null,
    tasks: Array.isArray(raw.execution?.tasks) ? raw.execution!.tasks : [],
    milestones: Array.isArray(raw.execution?.milestones) ? raw.execution!.milestones : [],
  },
  memory: {
    misconceptions: Array.isArray(raw.memory?.misconceptions) ? raw.memory!.misconceptions.filter(Boolean) : [],
    durableNotes: Array.isArray(raw.memory?.durableNotes) ? raw.memory!.durableNotes.filter(Boolean) : [],
  },
  resources: {
    pinnedResourceIds: Array.isArray(raw.resources?.pinnedResourceIds) ? raw.resources!.pinnedResourceIds.filter(Boolean) : [],
    preferredTypes: Array.isArray(raw.resources?.preferredTypes) ? raw.resources!.preferredTypes.filter(Boolean) : [],
    notes: Array.isArray(raw.resources?.notes) ? raw.resources!.notes.filter(Boolean) : [],
  },
  summary: raw.summary?.trim() || "",
});

const normalizeCron = (raw: Partial<CronDefinition>, cronId: string): CronDefinition => {
  const schedule = raw.schedule?.trim() || "manual";
  let scheduleRule = normalizeCronScheduleRule(raw.scheduleRule);
  if (!scheduleRule) {
    try {
      scheduleRule = parseCronScheduleDescription(schedule, "Asia/Shanghai");
    } catch {
      scheduleRule = { kind: "manual" };
    }
  }
  return {
    cronId,
    title: raw.title?.trim() || cronId,
    enabled: raw.enabled ?? true,
    schedule,
    scheduleRule,
    projectId: typeof raw.projectId === "string" && raw.projectId.trim() ? raw.projectId : null,
    courseIds: Array.isArray(raw.courseIds) ? raw.courseIds.filter(Boolean) : [],
    prompt: raw.prompt?.trim() || "",
    updatedAt: raw.updatedAt ?? null,
  };
};

const normalizeCronScheduleRule = (value: unknown): CronScheduleRule | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<CronScheduleRule>;
  if (record.kind === "manual") return { kind: "manual" };
  if (record.kind === "daily_time") {
    return {
      kind: "daily_time",
      timeOfDay: typeof record.timeOfDay === "string" && record.timeOfDay.trim() ? record.timeOfDay : "21:00",
      timezone: typeof record.timezone === "string" && record.timezone.trim() ? record.timezone : "Asia/Shanghai",
    };
  }
  if (record.kind !== "after_course_class") return undefined;
  return {
    kind: "after_course_class",
    timeOfDay: typeof record.timeOfDay === "string" && record.timeOfDay.trim() ? record.timeOfDay : "21:00",
    timezone: typeof record.timezone === "string" && record.timezone.trim() ? record.timezone : "Asia/Shanghai",
    offsetDays: record.offsetDays === 1 ? 1 : 0,
    source: "course_schedule",
  };
};

export class WorkspaceRepo {
  readonly paths: RuntimePaths;

  constructor(runtimeRoot: string) {
    this.paths = {
      runtimeRoot,
      workspaceRoot: path.join(runtimeRoot, "workspace"),
    };
  }

  get projectsDir(): string {
    return path.join(this.paths.workspaceRoot, "projects");
  }

  get cronsDir(): string {
    return path.join(this.paths.workspaceRoot, "crons");
  }

  get plansDir(): string {
    return path.join(this.paths.workspaceRoot, "agent", "plans");
  }

  get learnerDir(): string {
    return path.join(this.paths.workspaceRoot, "agent", "learner");
  }

  get memoryFile(): string {
    return path.join(this.paths.workspaceRoot, "MEMORY.md");
  }

  async ensureScaffold(): Promise<void> {
    await Promise.all([
      mkdir(this.projectsDir, { recursive: true }),
      mkdir(this.cronsDir, { recursive: true }),
      mkdir(path.join(this.paths.workspaceRoot, ".openclaw"), { recursive: true }),
      mkdir(this.plansDir, { recursive: true }),
      mkdir(path.join(this.paths.workspaceRoot, "agent", "curriculum"), { recursive: true }),
      mkdir(this.learnerDir, { recursive: true }),
    ]);
    await this.writeIfMissing(this.memoryFile, DEFAULT_MEMORY);
    await this.writeIfMissing(
      path.join(this.paths.workspaceRoot, "HEARTBEAT.md"),
      "# HEARTBEAT.md - mentorclaw\n\nDescribe how MentorClaw should check in, follow up, and maintain continuity over time.\n",
    );
  }

  async readBootstrap(): Promise<{ agents: string; soul: string; tools: string }> {
    const [agents, soul, tools] = await Promise.all([
      readFile(path.join(this.paths.workspaceRoot, "AGENTS.md"), "utf8"),
      readFile(path.join(this.paths.workspaceRoot, "SOUL.md"), "utf8"),
      readFile(path.join(this.paths.workspaceRoot, "TOOLS.md"), "utf8"),
    ]);
    return { agents, soul, tools };
  }

  async readGlobalMemory(): Promise<GlobalMemory> {
    const direct = await this.safeRead(this.memoryFile);
    if (direct.trim()) {
      return {
        version: 1,
        updatedAt: null,
        content: direct.trim(),
      };
    }

    const [profile, preferences, globalGoals] = await Promise.all([
      this.safeRead(path.join(this.learnerDir, "PROFILE.md")),
      this.safeRead(path.join(this.learnerDir, "PREFERENCES.md")),
      this.safeRead(path.join(this.learnerDir, "GLOBAL_GOALS.md")),
    ]);

    const content = [profile.trim(), preferences.trim(), globalGoals.trim()].filter(Boolean).join("\n\n") || DEFAULT_MEMORY.trim();
    return {
      version: 1,
      updatedAt: null,
      content,
    };
  }

  async writeGlobalMemory(content: string, updatedAt: string = nowIso()): Promise<void> {
    const body = content.trim() || DEFAULT_MEMORY.trim();
    await writeFile(this.memoryFile, `${body}\n`, "utf8");
    await this.writeIfMissing(path.join(this.learnerDir, "LEARNER_STATE.yaml"), stringifyStructured(defaultLearnerState()));
    const state = await this.readLegacyLearnerState();
    state.updated_at = updatedAt;
    await writeFile(path.join(this.learnerDir, "LEARNER_STATE.yaml"), stringifyStructured(state), "utf8");
  }

  async readLearnerSummary(): Promise<LearnerSummary> {
    const memory = await this.readGlobalMemory();
    const [profile, preferences, globalGoals, misconceptionsRaw, state] = await Promise.all([
      this.safeRead(path.join(this.learnerDir, "PROFILE.md")),
      this.safeRead(path.join(this.learnerDir, "PREFERENCES.md")),
      this.safeRead(path.join(this.learnerDir, "GLOBAL_GOALS.md")),
      this.safeRead(path.join(this.learnerDir, "GLOBAL_MISCONCEPTIONS.yaml")),
      this.readLegacyLearnerState(),
    ]);

    return {
      profile: profile.trim() || memory.content,
      preferences: preferences.trim(),
      globalGoals: globalGoals.trim(),
      misconceptions: extractList<string>(parseStructured(misconceptionsRaw)).filter(Boolean),
      state,
      memory: memory.content,
    };
  }

  async writeLearnerState(state: LearnerState): Promise<void> {
    await mkdir(this.learnerDir, { recursive: true });
    await writeFile(path.join(this.learnerDir, "LEARNER_STATE.yaml"), stringifyStructured(state), "utf8");
  }

  async appendLearnerEvent(event: LearningEvent): Promise<void> {
    const eventsPath = path.join(this.learnerDir, "EVENTS.jsonl");
    const existing = await this.safeRead(eventsPath);
    const prefix = existing.trim().length ? `${existing.trimEnd()}\n` : "";
    await writeFile(eventsPath, `${prefix}${JSON.stringify(event)}\n`, "utf8");
  }

  async listProjectIds(): Promise<string[]> {
    const ids = new Set<string>();

    try {
      const entries = await readdir(this.projectsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".yaml")) continue;
        ids.add(entry.name.replace(/\.yaml$/, ""));
      }
    } catch {}

    try {
      const entries = await readdir(this.plansDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith("_")) continue;
        ids.add(entry.name);
      }
    } catch {}

    return Array.from(ids).sort();
  }

  async createProject(input: ProjectCreationInput, now: string = nowIso()): Promise<ProjectState> {
    await mkdir(this.projectsDir, { recursive: true });
    const baseId = makePlanId(input.title, now);
    let projectId = baseId;
    let suffix = 1;
    while (await this.fileExists(path.join(this.projectsDir, `${projectId}.yaml`))) {
      suffix += 1;
      projectId = `${baseId}-${String(suffix).padStart(2, "0")}`;
    }

    const tasks = buildSeedTasks(input.goals, now);
    const milestones = buildMilestones(input.goals, now);
    const project: ProjectState = {
      projectId,
      title: input.title,
      status: "active",
      createdAt: now,
      updatedAt: now,
      scope: {
        type: input.courseIds?.length ? "course" : "general",
        courseIds: input.courseIds?.filter(Boolean) ?? [],
      },
      goal: {
        summary: input.summary.trim() || input.title,
        targetOutcome: input.targetOutcome,
        constraints: input.constraints,
        successDefinition: input.successDefinition,
      },
      execution: {
        mode: "planning",
        nextAction: tasks[0]?.title ?? null,
        tasks,
        milestones,
      },
      memory: {
        misconceptions: [],
        durableNotes: [],
      },
      resources: {
        pinnedResourceIds: [],
        preferredTypes: [],
        notes: [],
      },
      summary: "Project created. Waiting for the first concrete learning turn.",
    };

    await this.writeProjectState(project);
    return project;
  }

  async listCronIds(): Promise<string[]> {
    try {
      const entries = await readdir(this.cronsDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
        .map((entry) => entry.name.replace(/\.yaml$/, ""))
        .sort();
    } catch {
      return [];
    }
  }

  async createCron(input: CronCreationInput, now: string = nowIso()): Promise<CronDefinition> {
    await mkdir(this.cronsDir, { recursive: true });
    const baseId = makePlanId(input.title, now);
    let cronId = baseId;
    let suffix = 1;
    while (await this.fileExists(path.join(this.cronsDir, `${cronId}.yaml`))) {
      suffix += 1;
      cronId = `${baseId}-${String(suffix).padStart(2, "0")}`;
    }

    const cron: CronDefinition = {
      cronId,
      title: input.title.trim() || cronId,
      enabled: input.enabled ?? true,
      schedule: input.schedule.trim() || "manual",
      scheduleRule: input.scheduleRule,
      projectId: input.projectId?.trim() || null,
      courseIds: input.courseIds?.filter(Boolean) ?? [],
      prompt: input.prompt.trim(),
      updatedAt: now,
    };

    await this.writeCronDefinition(cron);
    return cron;
  }

  async readCronDefinition(cronId: string): Promise<CronDefinition> {
    const raw = await this.safeRead(path.join(this.cronsDir, `${cronId}.yaml`));
    if (!raw.trim()) {
      throw new Error(`Cron not found: ${cronId}`);
    }
    return normalizeCron(parseStructured(raw) as Partial<CronDefinition>, cronId);
  }

  async writeCronDefinition(cron: CronDefinition): Promise<void> {
    await mkdir(this.cronsDir, { recursive: true });
    const normalized = normalizeCron(cron, cron.cronId);
    await writeFile(path.join(this.cronsDir, `${normalized.cronId}.yaml`), stringifyStructured(normalized), "utf8");
  }

  async deleteCronDefinition(cronId: string): Promise<void> {
    const cronPath = path.join(this.cronsDir, `${cronId}.yaml`);
    if (!(await this.fileExists(cronPath))) {
      throw new Error(`Cron not found: ${cronId}`);
    }
    await unlink(cronPath);
  }

  async appendCronRun(record: CronRunRecord): Promise<void> {
    await mkdir(this.cronsDir, { recursive: true });
    const runsPath = path.join(this.cronsDir, "runs.jsonl");
    const existing = await this.safeRead(runsPath);
    const prefix = existing.trim().length ? `${existing.trimEnd()}\n` : "";
    await writeFile(runsPath, `${prefix}${JSON.stringify(record)}\n`, "utf8");
  }

  async readCronRuns(limit: number = 200): Promise<CronRunRecord[]> {
    const raw = await this.safeRead(path.join(this.cronsDir, "runs.jsonl"));
    if (!raw.trim()) return [];
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as CronRunRecord)
      .slice(-limit)
      .reverse();
  }

  async readCronRunState(): Promise<Record<string, string>> {
    const raw = await this.safeRead(path.join(this.cronsDir, "run-state.json"));
    if (!raw.trim()) return {};
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  async writeCronRunState(state: Record<string, string>): Promise<void> {
    await mkdir(this.cronsDir, { recursive: true });
    await writeFile(path.join(this.cronsDir, "run-state.json"), JSON.stringify(state, null, 2), "utf8");
  }

  async readProjectState(projectId: string): Promise<ProjectState> {
    const newPath = path.join(this.projectsDir, `${projectId}.yaml`);
    const rawNew = await this.safeRead(newPath);
    if (rawNew.trim()) {
      return normalizeProject(parseStructured(rawNew) as Partial<ProjectState>, projectId);
    }

    const legacy = await this.readLegacyPlanState(projectId);
    return toProjectState(legacy);
  }

  async writeProjectState(project: ProjectState): Promise<void> {
    await mkdir(this.projectsDir, { recursive: true });
    const normalized = normalizeProject(project, project.projectId);
    await writeFile(path.join(this.projectsDir, `${normalized.projectId}.yaml`), stringifyStructured(normalized), "utf8");
    await this.safeTouch(path.join(this.projectsDir, `${normalized.projectId}.events.jsonl`));
  }

  async appendProjectEvent(projectId: string, event: LearningEvent): Promise<void> {
    const eventsPath = path.join(this.projectsDir, `${projectId}.events.jsonl`);
    const existing = await this.safeRead(eventsPath);
    const prefix = existing.trim().length ? `${existing.trimEnd()}\n` : "";
    await writeFile(eventsPath, `${prefix}${JSON.stringify(event)}\n`, "utf8");
  }

  async readPlansIndex(): Promise<{ version: number; active_plan_id: string | null; plans: string[] }> {
    const projectIds = await this.listProjectIds();
    const raw = await this.safeRead(path.join(this.plansDir, "INDEX.yaml"));
    const persisted = raw.trim() ? (parseStructured(raw) as Partial<{ version: number; active_plan_id: string | null; plans: string[] }>) : null;
    const persistedPlans = Array.isArray(persisted?.plans) ? persisted.plans.filter((id) => projectIds.includes(id)) : [];
    const activePlanId = persisted?.active_plan_id && projectIds.includes(persisted.active_plan_id) ? persisted.active_plan_id : projectIds[0] ?? null;
    return {
      version: persisted?.version ?? 1,
      active_plan_id: activePlanId,
      plans: Array.from(new Set([...persistedPlans, ...projectIds])),
    };
  }

  async writePlansIndex(index: { version: number; active_plan_id: string | null; plans: string[] }): Promise<void> {
    await mkdir(this.plansDir, { recursive: true });
    await writeFile(path.join(this.plansDir, "INDEX.yaml"), stringifyStructured(index), "utf8");
  }

  async createPlan(input: PlanCreationInput, now: string = nowIso()): Promise<PlanState> {
    const project = await this.createProject(
      {
        title: input.title,
        summary: input.targetOutcome[0] ?? input.title,
        targetOutcome: input.targetOutcome,
        constraints: input.constraints,
        successDefinition: input.successDefinition,
        goals: input.goals,
      },
      now,
    );
    return toLegacyPlanState(project);
  }

  async readPlanState(planId: string): Promise<PlanState> {
    const projectPath = path.join(this.projectsDir, `${planId}.yaml`);
    if (await this.fileExists(projectPath)) {
      const [project, threadIds] = await Promise.all([this.readProjectState(planId), this.listThreadIds(planId)]);
      return {
        ...toLegacyPlanState(project),
        threadIds,
      };
    }
    return this.readLegacyPlanState(planId);
  }

  async writePlanState(plan: PlanState): Promise<void> {
    const projectPath = path.join(this.projectsDir, `${plan.planId}.yaml`);
    const existing = (await this.fileExists(projectPath)) ? await this.readProjectState(plan.planId) : null;
    await this.writeProjectState(mergeProjectStateFromPlan(plan, existing));
  }

  async appendPlanEvent(planId: string, event: LearningEvent): Promise<void> {
    await this.appendProjectEvent(planId, { ...event, level: "project", projectId: planId, planId });
  }

  async createThread(input: ThreadCreationInput, now: string = nowIso()): Promise<ThreadState> {
    const threadId = makeThreadId(input.title, now);
    const threadDir = path.join(this.plansDir, input.planId, "threads", threadId);
    await mkdir(threadDir, { recursive: true });

    const state: ThreadState = {
      threadId,
      planId: input.planId,
      title: input.title,
      status: "active",
      createdAt: now,
      updatedAt: now,
      summary: "Thread created. No work logged yet.",
      currentQuestion: input.currentQuestion ?? null,
      workingMemory: input.currentQuestion ? [`Question: ${input.currentQuestion}`] : [],
      blockers: [],
      recentEvidence: [],
    };

    await this.writeThreadState(state);
    return state;
  }

  async readThreadState(planId: string, threadId: string): Promise<ThreadState> {
    const threadDir = path.join(this.plansDir, planId, "threads", threadId);
    const [metaRaw, summaryRaw, workingRaw] = await Promise.all([
      readFile(path.join(threadDir, "meta.json"), "utf8"),
      readFile(path.join(threadDir, "summary.md"), "utf8"),
      readFile(path.join(threadDir, "working_memory.md"), "utf8"),
    ]);
    const meta = JSON.parse(metaRaw) as Omit<ThreadState, "summary" | "workingMemory">;

    return {
      ...meta,
      summary: summaryRaw.trim(),
      workingMemory: workingRaw
        .split(/\r?\n/)
        .map((line) => line.replace(/^- /, "").trim())
        .filter(Boolean),
    };
  }

  async writeThreadState(thread: ThreadState): Promise<void> {
    const threadDir = path.join(this.plansDir, thread.planId, "threads", thread.threadId);
    await mkdir(threadDir, { recursive: true });
    await Promise.all([
      writeFile(path.join(threadDir, "meta.json"), JSON.stringify({ ...thread, summary: undefined, workingMemory: undefined }, null, 2), "utf8"),
      writeFile(path.join(threadDir, "summary.md"), `${thread.summary.trim()}\n`, "utf8"),
      writeFile(path.join(threadDir, "working_memory.md"), `${thread.workingMemory.map((line) => `- ${line}`).join("\n")}\n`, "utf8"),
      this.safeTouch(path.join(threadDir, "events.jsonl")),
    ]);
  }

  async appendThreadEvent(planId: string, threadId: string, event: LearningEvent): Promise<void> {
    const eventsPath = path.join(this.plansDir, planId, "threads", threadId, "events.jsonl");
    const existing = await this.safeRead(eventsPath);
    const prefix = existing.trim().length ? `${existing.trimEnd()}\n` : "";
    await writeFile(eventsPath, `${prefix}${JSON.stringify(event)}\n`, "utf8");
  }

  async validateRuntime(): Promise<RuntimeValidationResult> {
    const requiredPaths = [
      path.join(this.paths.workspaceRoot, "AGENTS.md"),
      path.join(this.paths.workspaceRoot, "SOUL.md"),
      path.join(this.paths.workspaceRoot, "TOOLS.md"),
      this.memoryFile,
    ];
    const errors: string[] = [];
    for (const filePath of requiredPaths) {
      if (!(await this.fileExists(filePath))) {
        errors.push(`Missing required runtime file: ${filePath}`);
      }
    }
    return { valid: errors.length === 0, errors, warnings: [] };
  }

  private async readLegacyLearnerState(): Promise<LearnerState> {
    const raw = await this.safeRead(path.join(this.learnerDir, "LEARNER_STATE.yaml"));
    if (!raw.trim()) return defaultLearnerState();
    return {
      ...defaultLearnerState(),
      ...(parseStructured(raw) as Partial<LearnerState>),
    };
  }

  private async readLegacyPlanState(planId: string): Promise<PlanState> {
    const planDir = path.join(this.plansDir, planId);
    const [planRaw, goalsRaw, progressRaw, tasksRaw, milestonesRaw, misconceptionsRaw, resourcesRaw, summaryRaw] =
      await Promise.all([
        readFile(path.join(planDir, "PLAN.md"), "utf8"),
        readFile(path.join(planDir, "GOALS.md"), "utf8"),
        readFile(path.join(planDir, "PROGRESS.yaml"), "utf8"),
        readFile(path.join(planDir, "TASKS.yaml"), "utf8"),
        readFile(path.join(planDir, "MILESTONES.yaml"), "utf8"),
        readFile(path.join(planDir, "MISCONCEPTIONS.yaml"), "utf8"),
        readFile(path.join(planDir, "RESOURCES.md"), "utf8"),
        readFile(path.join(planDir, "SUMMARY.md"), "utf8"),
      ]);

    const { attrs, body } = parseFrontmatter(planRaw);
    const progress = parseStructured(progressRaw) as {
      updated_at: string | null;
      status: PlanState["status"];
      current_phase: string | null;
      focus_topics: string[];
      mastery_snapshot: PlanState["masterySnapshot"];
      next_checkpoint: string | null;
    };
    const taskBuckets = (parseStructured(tasksRaw) as {
      today?: TaskItem[];
      next?: TaskItem[];
      backlog?: TaskItem[];
      blocked?: TaskItem[];
    }) ?? { today: [], next: [], backlog: [], blocked: [] };

    return {
      planId,
      title: String(attrs.title ?? planId),
      status: progress.status ?? (attrs.status as PlanState["status"]) ?? "draft",
      createdAt: typeof attrs.created_at === "string" ? attrs.created_at : null,
      updatedAt: progress.updated_at ?? (typeof attrs.updated_at === "string" ? attrs.updated_at : null),
      timebox: String(attrs.timebox ?? ""),
      curriculumRefs: Array.isArray(attrs.curriculum_refs) ? (attrs.curriculum_refs as string[]) : [],
      targetOutcome: sectionContent(body, "Target Outcome"),
      constraints: sectionContent(body, "Constraints"),
      successDefinition: sectionContent(body, "Success Definition"),
      goals: goalsRaw
        .split(/\r?\n/)
        .map((line) => line.replace(/^- /, "").trim())
        .filter(Boolean),
      currentPhase: progress.current_phase,
      focusTopics: progress.focus_topics ?? [],
      masterySnapshot: progress.mastery_snapshot ?? [],
      nextCheckpoint: progress.next_checkpoint ?? null,
      tasks: [...(taskBuckets.today ?? []), ...(taskBuckets.next ?? []), ...(taskBuckets.backlog ?? []), ...(taskBuckets.blocked ?? [])],
      milestones: extractList<Milestone>(parseStructured(milestonesRaw)).filter(Boolean),
      misconceptions: extractList<string>(parseStructured(misconceptionsRaw)).filter(Boolean),
      resources: parseResourceMarkdown(resourcesRaw),
      summary: summaryRaw.trim(),
      rubricRefs: [],
      threadIds: await this.listThreadIds(planId),
    };
  }

  private async listThreadIds(planId: string): Promise<string[]> {
    try {
      const entries = await readdir(path.join(this.plansDir, planId, "threads"), { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch {
      return [];
    }
  }

  private async safeRead(filePath: string): Promise<string> {
    try {
      return await readFile(filePath, "utf8");
    } catch {
      return "";
    }
  }

  private async safeTouch(filePath: string): Promise<void> {
    try {
      await readFile(filePath, "utf8");
    } catch {
      await writeFile(filePath, "", "utf8");
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await readFile(filePath, "utf8");
      return true;
    } catch {
      return false;
    }
  }

  private async writeIfMissing(filePath: string, content: string): Promise<void> {
    if (!(await this.fileExists(filePath))) {
      await writeFile(filePath, content, "utf8");
    }
  }
}
