import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  LearnerState,
  LearnerSummary,
  LearningEvent,
  Milestone,
  PlanCreationInput,
  PlanState,
  ResourceRef,
  RuntimePaths,
  RuntimeValidationResult,
  TaskItem,
  ThreadCreationInput,
  ThreadState,
} from "../schemas/models.ts";
import { makeMilestoneId, makePlanId, makeTaskId, makeThreadId } from "../utils/id.ts";
import { parseStructured, stringifyStructured } from "../utils/simple-yaml.ts";
import { daysFrom, nowIso } from "../utils/time.ts";

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
        binding: "plan",
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

export class WorkspaceRepo {
  readonly paths: RuntimePaths;

  constructor(runtimeRoot: string) {
    this.paths = {
      runtimeRoot,
      workspaceRoot: path.join(runtimeRoot, "workspace"),
    };
  }

  get plansDir(): string {
    return path.join(this.paths.workspaceRoot, "agent", "plans");
  }

  get learnerDir(): string {
    return path.join(this.paths.workspaceRoot, "agent", "learner");
  }

  async ensureScaffold(): Promise<void> {
    await mkdir(path.join(this.paths.workspaceRoot, "agent", "plans"), { recursive: true });
    await mkdir(path.join(this.paths.workspaceRoot, "agent", "curriculum"), { recursive: true });
    await mkdir(path.join(this.paths.workspaceRoot, "agent", "learner"), { recursive: true });
  }

  async readBootstrap(): Promise<{ agents: string; soul: string; tools: string }> {
    const [agents, soul, tools] = await Promise.all([
      readFile(path.join(this.paths.workspaceRoot, "AGENTS.md"), "utf8"),
      readFile(path.join(this.paths.workspaceRoot, "SOUL.md"), "utf8"),
      readFile(path.join(this.paths.workspaceRoot, "TOOLS.md"), "utf8"),
    ]);
    return { agents, soul, tools };
  }

  async readLearnerSummary(): Promise<LearnerSummary> {
    const [profile, preferences, globalGoals, misconceptionsRaw, stateRaw] = await Promise.all([
      readFile(path.join(this.learnerDir, "PROFILE.md"), "utf8"),
      readFile(path.join(this.learnerDir, "PREFERENCES.md"), "utf8"),
      readFile(path.join(this.learnerDir, "GLOBAL_GOALS.md"), "utf8"),
      readFile(path.join(this.learnerDir, "GLOBAL_MISCONCEPTIONS.yaml"), "utf8"),
      readFile(path.join(this.learnerDir, "LEARNER_STATE.yaml"), "utf8"),
    ]);

    return {
      profile,
      preferences,
      globalGoals,
      misconceptions: extractList<string>(parseStructured(misconceptionsRaw)).filter(Boolean),
      state: parseStructured(stateRaw) as LearnerState,
    };
  }

  async writeLearnerState(state: LearnerState): Promise<void> {
    await writeFile(path.join(this.learnerDir, "LEARNER_STATE.yaml"), stringifyStructured(state), "utf8");
  }

  async appendLearnerEvent(event: LearningEvent): Promise<void> {
    const eventsPath = path.join(this.learnerDir, "EVENTS.jsonl");
    const existing = await this.safeRead(eventsPath);
    const prefix = existing.trim().length ? `${existing.trimEnd()}\n` : "";
    await writeFile(eventsPath, `${prefix}${JSON.stringify(event)}\n`, "utf8");
  }

  async readPlansIndex(): Promise<{ version: number; active_plan_id: string | null; plans: string[] }> {
    const raw = await readFile(path.join(this.plansDir, "INDEX.yaml"), "utf8");
    return parseStructured(raw) as { version: number; active_plan_id: string | null; plans: string[] };
  }

  async writePlansIndex(index: { version: number; active_plan_id: string | null; plans: string[] }): Promise<void> {
    await writeFile(path.join(this.plansDir, "INDEX.yaml"), stringifyStructured(index), "utf8");
  }

  async createPlan(input: PlanCreationInput, now: string = nowIso()): Promise<PlanState> {
    const { planId, planDir } = await this.reservePlanDirectory(input.title, now);
    await mkdir(path.join(planDir, "threads"), { recursive: true });

    const tasks: TaskItem[] = input.goals.map((goal, index) => ({
      id: makeTaskId(goal, index),
      title: goal,
      description: `Make measurable progress on "${goal}".`,
      status: "todo",
      priority: index === 0 ? "high" : "medium",
      dueAt: daysFrom(now, index + 1),
      acceptanceCriteria: [`Produce evidence for: ${goal}`],
      dependencies: index === 0 ? [] : [makeTaskId(input.goals[index - 1] ?? goal, index - 1)],
      evidenceRequired: index === 0 ? ["reproduction"] : ["application"],
      tags: ["auto-generated"],
    }));

    const milestones: Milestone[] = input.goals
      .slice(0, Math.max(1, Math.min(3, input.goals.length)))
      .map((goal, index) => ({
        id: makeMilestoneId(goal, index),
        title: goal,
        dueAt: daysFrom(now, (index + 1) * 3),
        successCriteria: [`Evidence collected for ${goal}`],
        status: index === 0 ? "active" : "pending",
      }));

    const state: PlanState = {
      planId,
      title: input.title,
      status: "active",
      createdAt: now,
      updatedAt: now,
      timebox: input.timebox,
      curriculumRefs: [],
      targetOutcome: input.targetOutcome,
      constraints: input.constraints,
      successDefinition: input.successDefinition,
      goals: input.goals,
      currentPhase: "planning",
      focusTopics: input.focusTopics ?? [],
      masterySnapshot: [],
      nextCheckpoint: milestones[0]?.dueAt ?? null,
      tasks,
      milestones,
      misconceptions: [],
      resources: [],
      summary: "Plan created. Waiting for the first execution cycle.",
      rubricRefs: [],
      threadIds: [],
    };

    await this.writePlanState(state);
    const index = await this.readPlansIndex();
    await this.writePlansIndex({
      ...index,
      active_plan_id: planId,
      plans: Array.from(new Set([...index.plans, planId])),
    });

    return state;
  }

  async readPlanState(planId: string): Promise<PlanState> {
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

  async writePlanState(plan: PlanState): Promise<void> {
    const planDir = path.join(this.plansDir, plan.planId);
    await mkdir(path.join(planDir, "threads"), { recursive: true });

    const planBody = [
      "# Why This Plan Exists",
      "",
      renderSection("Target Outcome", plan.targetOutcome),
      "",
      renderSection("Constraints", plan.constraints),
      "",
      renderSection("Success Definition", plan.successDefinition),
    ].join("\n");

    await Promise.all([
      writeFile(
        path.join(planDir, "PLAN.md"),
        renderFrontmatter(
          {
            plan_id: plan.planId,
            title: plan.title,
            status: plan.status,
            created_at: plan.createdAt,
            updated_at: plan.updatedAt,
            timebox: plan.timebox,
            curriculum_refs: plan.curriculumRefs,
          },
          planBody,
        ),
        "utf8",
      ),
      writeFile(path.join(planDir, "GOALS.md"), `${plan.goals.map((goal) => `- ${goal}`).join("\n")}\n`, "utf8"),
      writeFile(
        path.join(planDir, "PROGRESS.yaml"),
        stringifyStructured({
          version: 1,
          updated_at: plan.updatedAt,
          status: plan.status,
          current_phase: plan.currentPhase,
          focus_topics: plan.focusTopics,
          mastery_snapshot: plan.masterySnapshot,
          next_checkpoint: plan.nextCheckpoint,
        }),
        "utf8",
      ),
      writeFile(
        path.join(planDir, "TASKS.yaml"),
        stringifyStructured({
          version: 1,
          updated_at: plan.updatedAt,
          today: plan.tasks.filter((task) => task.priority === "high" && task.status !== "done"),
          next: plan.tasks.filter((task) => task.priority === "medium" && task.status !== "done"),
          backlog: plan.tasks.filter((task) => task.priority === "low" && task.status !== "done"),
          blocked: plan.tasks.filter((task) => task.status === "blocked"),
        }),
        "utf8",
      ),
      writeFile(path.join(planDir, "MILESTONES.yaml"), stringifyStructured(plan.milestones), "utf8"),
      writeFile(path.join(planDir, "MISCONCEPTIONS.yaml"), stringifyStructured(plan.misconceptions), "utf8"),
      writeFile(path.join(planDir, "RESOURCES.md"), `${toResourceMarkdown(plan.resources)}\n`, "utf8"),
      writeFile(path.join(planDir, "SUMMARY.md"), `${plan.summary.trim()}\n`, "utf8"),
      this.safeTouch(path.join(planDir, "EVENTS.jsonl")),
    ]);
  }

  async appendPlanEvent(planId: string, event: LearningEvent): Promise<void> {
    const eventsPath = path.join(this.plansDir, planId, "EVENTS.jsonl");
    const existing = await this.safeRead(eventsPath);
    const prefix = existing.trim().length ? `${existing.trimEnd()}\n` : "";
    await writeFile(eventsPath, `${prefix}${JSON.stringify(event)}\n`, "utf8");
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
      path.join(this.learnerDir, "LEARNER_STATE.yaml"),
      path.join(this.plansDir, "INDEX.yaml"),
    ];
    const errors: string[] = [];
    for (const filePath of requiredPaths) {
      try {
        await readFile(filePath, "utf8");
      } catch {
        errors.push(`Missing required runtime file: ${filePath}`);
      }
    }
    return { valid: errors.length === 0, errors, warnings: [] };
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

  private async reservePlanDirectory(title: string, now: string): Promise<{ planId: string; planDir: string }> {
    const basePlanId = makePlanId(title, now);

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const suffix = attempt === 0 ? "" : `-${String(attempt + 1).padStart(2, "0")}`;
      const planId = `${basePlanId}${suffix}`;
      const planDir = path.join(this.plansDir, planId);

      try {
        await mkdir(planDir, { recursive: false });
        return { planId, planDir };
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
        if (code === "EEXIST") continue;
        throw error;
      }
    }

    throw new Error(`Failed to allocate a unique plan id for title "${title}".`);
  }
}
