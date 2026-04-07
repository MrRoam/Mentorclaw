import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { mentorclawOrchestrator } from "../core/orchestrator.ts";
import {
  mentorclaw_STATIC_SYSTEM_APPEND,
  SessionBindingStore,
  type mentorclawSessionBinding,
  recordAgentEnd,
  renderPromptContext,
} from "../integration/openclaw-adapter.ts";
import type {
  LearnerSummary,
  LearningEvent,
  PlanCreationInput,
  PlanState,
  ThreadState,
  TurnOutcome,
  WorkflowType,
} from "../schemas/models.ts";
import { WorkspaceRepo } from "../storage/workspace-repo.ts";
import { nowIso } from "../utils/time.ts";

export interface DebugThreadSnapshot extends ThreadState {
  boundSessions: mentorclawSessionBinding[];
  events: LearningEvent[];
  localFiles: DebugLocalFileRef[];
}

export interface DebugPlanSnapshot extends PlanState {
  threads: DebugThreadSnapshot[];
  boundSessions: mentorclawSessionBinding[];
  events: LearningEvent[];
  openTaskCount: number;
  blockedTaskCount: number;
  localFiles: DebugLocalFileRef[];
}

export interface DebugLocalFileRef {
  id: string;
  label: string;
  scope: "runtime" | "learner" | "plan" | "thread" | "binding";
  absolutePath: string;
  relativePath: string;
  description: string;
}

export interface DebugFileContent {
  absolutePath: string;
  relativePath: string;
  content: string;
  truncated: boolean;
}

export interface DebugDashboardSnapshot {
  runtimeRoot: string;
  workspaceRoot: string;
  generatedAt: string;
  validation: Awaited<ReturnType<WorkspaceRepo["validateRuntime"]>>;
  learner: LearnerSummary;
  learnerEvents: LearningEvent[];
  activePlanId: string | null;
  sessionBindings: mentorclawSessionBinding[];
  plans: DebugPlanSnapshot[];
  localFiles: DebugLocalFileRef[];
}

export interface CreatePlanRequest {
  title: string;
  targetOutcome?: string[];
  constraints?: string[];
  successDefinition?: string[];
  timebox?: string;
  goals?: string[];
  focusTopics?: string[];
}

export interface CreateThreadRequest {
  planId: string;
  title: string;
  currentQuestion?: string | null;
}

export interface BindSessionRequest {
  sessionKey: string;
  planId: string;
  threadId: string;
}

export interface HandleTurnRequest {
  sessionKey: string;
  message: string;
  planId?: string;
  threadId?: string;
  forceWorkflow?: WorkflowType;
}

export interface RecordAssistantReplyRequest {
  sessionKey: string;
  text: string;
  success?: boolean;
  error?: string;
  durationMs?: number;
}

export interface DebugTurnResponse {
  binding: mentorclawSessionBinding;
  outcome: TurnOutcome;
  assistantReply: string;
  promptContext: string;
  systemAppend: string;
  snapshot: DebugDashboardSnapshot;
}

const dedupeTrimmed = (values: string[]): string[] => Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));

const slugifyLabel = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24) || "session";

const browserSessionKey = (label?: string): string => `${slugifyLabel(label ?? "browser")}-${Date.now().toString(36)}`;

const parseJsonl = <T>(raw: string): T[] =>
  raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);

const MAX_FILE_PREVIEW_CHARS = 80_000;

const workflowLabels = {
  planning: { zh: "规划", en: "planning" },
  tutoring: { zh: "辅导", en: "tutoring" },
  evaluation: { zh: "评估", en: "evaluation" },
  review: { zh: "评审", en: "review" },
  replanning: { zh: "重规划", en: "replanning" },
} as const;

const workflowPrompt = (workflow: WorkflowType, zh: boolean): string => {
  if (zh) {
    if (workflow === "planning") return "接下来我会先把目标、约束和下一步行动钉清楚。";
    if (workflow === "evaluation") return "接下来我会基于证据判断你现在的掌握情况，再决定要不要补强。";
    if (workflow === "review") return "接下来我会围绕你提交的材料给出具体反馈和修改建议。";
    if (workflow === "replanning") return "接下来我会根据新的约束重新调整路径和节奏。";
    return "接下来我会围绕这个问题继续讲解、拆解，并给出最直接的下一步。";
  }

  if (workflow === "planning") return "Next I will pin down the goal, constraints, and the next executable step.";
  if (workflow === "evaluation") return "Next I will judge your current mastery from evidence before deciding what to reinforce.";
  if (workflow === "review") return "Next I will review the material you submitted and turn that into concrete feedback.";
  if (workflow === "replanning") return "Next I will reshape the path based on the new constraints and timing.";
  return "Next I will keep teaching against this question and turn it into a concrete next step.";
};

const nextActionHint = (workflow: WorkflowType, zh: boolean): string => {
  if (zh) {
    if (workflow === "planning") return "如果你现在把截止时间、目标结果、每天可投入时长发给我，我就能继续把计划细化。";
    if (workflow === "evaluation") return "如果你愿意，下一条直接发你的答案、草稿或做题结果，我会继续判断并反馈。";
    if (workflow === "review") return "如果你愿意，下一条直接贴需要我看的内容，我会继续逐段给你改。";
    if (workflow === "replanning") return "如果你愿意，下一条直接告诉我哪里变了，我会马上重新排。";
    return "如果你愿意，下一条直接继续问细节、贴题目或说你卡住的地方，我会接着往下讲。";
  }

  if (workflow === "planning") return "If you share the deadline, target outcome, and daily time budget next, I can refine the plan immediately.";
  if (workflow === "evaluation") return "If you want, send your answer or draft next and I will continue from the evidence.";
  if (workflow === "review") return "If you want, paste the material you want reviewed next and I will keep going line by line.";
  if (workflow === "replanning") return "If you want, tell me what changed next and I will rework the path immediately.";
  return "If you want, keep asking, paste the problem, or tell me where you are stuck next and I will continue from there.";
};

const synthesizeAssistantReply = (message: string, outcome: TurnOutcome): string => {
  const zh = (outcome.learner.state.language || "").toLowerCase().startsWith("zh");
  const workflow = workflowLabels[outcome.decision.primary];
  const workflowName = zh ? workflow.zh : workflow.en;
  const planTitle = outcome.plan?.title || (zh ? "当前项目" : "the current plan");
  const threadTitle = outcome.thread?.title || (zh ? "当前会话" : "the current thread");
  const reason = outcome.decision.reasons[0];
  const openTasks = outcome.plan?.tasks?.filter((task) => task.status !== "done").length ?? 0;
  const memoryLines = outcome.thread?.workingMemory.length ?? 0;
  const actionPreview = outcome.proactiveActions
    .slice(0, 2)
    .map((action) => action.reason)
    .filter(Boolean)
    .join(zh ? "；" : "; ");

  const intro = zh
    ? `我已经收到你的消息「${message}」。这次我会按${workflowName}模式，在《${planTitle}》下的「${threadTitle}」里继续推进。`
    : `I received your message "${message}". I will continue in ${workflowName} mode inside "${threadTitle}" under "${planTitle}".`;

  const stateLine = zh
    ? [
        reason ? `系统这次这样判断的原因是: ${reason}。` : "",
        openTasks ? `当前项目里还有 ${openTasks} 个未完成事项。` : "当前项目里还没有排出明确任务。",
        memoryLines ? `这个会话已经积累了 ${memoryLines} 条工作记忆，我会沿着它继续。` : "这个会话还没有积累太多工作记忆，我会从这轮开始继续建立。",
      ]
        .filter(Boolean)
        .join("")
    : [
        reason ? `The router chose this path because ${reason}.` : "",
        openTasks ? `There are ${openTasks} unfinished items in the current plan.` : "There are no concrete tasks scheduled in the current plan yet.",
        memoryLines ? `This thread already carries ${memoryLines} working-memory lines that I can build on.` : "This thread does not have much working memory yet, so I will start anchoring it from this turn.",
      ]
        .filter(Boolean)
        .join(" ");

  const actionsLine = actionPreview
    ? zh
      ? `我接下来优先处理的是: ${actionPreview}。`
      : `The most immediate follow-up I see is: ${actionPreview}.`
    : workflowPrompt(outcome.decision.primary, zh);

  return [intro, stateLine, actionsLine, nextActionHint(outcome.decision.primary, zh)].filter(Boolean).join("\n\n");
};

export class DebugUiService {
  readonly repo: WorkspaceRepo;
  readonly bindingStore: SessionBindingStore;
  readonly runtimeRoot: string;

  constructor(runtimeRoot: string) {
    this.runtimeRoot = runtimeRoot;
    this.repo = new WorkspaceRepo(runtimeRoot);
    this.bindingStore = new SessionBindingStore(this.repo.paths.workspaceRoot);
  }

  makeBrowserSessionKey(label?: string): string {
    return browserSessionKey(label);
  }

  async getSnapshot(): Promise<DebugDashboardSnapshot> {
    const [validation, learner, index, sessionBindings, learnerEvents, planIds] = await Promise.all([
      this.repo.validateRuntime(),
      this.repo.readLearnerSummary(),
      this.repo.readPlansIndex(),
      this.bindingStore.list(),
      this.readEvents(path.join(this.repo.learnerDir, "EVENTS.jsonl")),
      this.listPlanIds(),
    ]);

    const plans = await Promise.all(
      planIds.map(async (planId) => {
        const plan = await this.repo.readPlanState(planId);
        const [events, threads] = await Promise.all([
          this.readEvents(path.join(this.repo.plansDir, planId, "EVENTS.jsonl")),
          Promise.all(
            plan.threadIds.map(async (threadId) => {
              const thread = await this.repo.readThreadState(plan.planId, threadId);
              return {
                ...thread,
                boundSessions: sessionBindings.filter(
                  (binding) => binding.planId === plan.planId && binding.threadId === thread.threadId,
                ),
                events: await this.readEvents(
                  path.join(this.repo.plansDir, plan.planId, "threads", thread.threadId, "events.jsonl"),
                ),
                localFiles: this.threadLocalFiles(plan.planId, thread.threadId),
              } satisfies DebugThreadSnapshot;
            }),
          ),
        ]);

        return {
          ...plan,
          threads: threads.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
          boundSessions: sessionBindings.filter((binding) => binding.planId === plan.planId),
          events,
          openTaskCount: plan.tasks.filter((task) => task.status !== "done").length,
          blockedTaskCount: plan.tasks.filter((task) => task.status === "blocked").length,
          localFiles: this.planLocalFiles(plan.planId),
        } satisfies DebugPlanSnapshot;
      }),
    );

    return {
      runtimeRoot: this.runtimeRoot,
      workspaceRoot: this.repo.paths.workspaceRoot,
      generatedAt: nowIso(),
      validation,
      learner,
      learnerEvents,
      activePlanId: index.active_plan_id,
      sessionBindings,
      plans: plans.sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "")),
      localFiles: this.runtimeLocalFiles(),
    };
  }

  async readLocalFile(filePath: string): Promise<DebugFileContent> {
    const absolutePath = this.resolveRuntimePath(filePath);
    const raw = await readFile(absolutePath, "utf8");
    const truncated = raw.length > MAX_FILE_PREVIEW_CHARS;
    const content = truncated ? `${raw.slice(0, MAX_FILE_PREVIEW_CHARS)}\n\n...<truncated>` : raw;
    return {
      absolutePath,
      relativePath: path.relative(this.runtimeRoot, absolutePath) || path.basename(absolutePath),
      content,
      truncated,
    };
  }

  async createPlan(request: CreatePlanRequest): Promise<DebugDashboardSnapshot> {
    const title = request.title.trim();
    if (!title) {
      throw new Error("Plan title is required.");
    }

    const now = nowIso();
    const input: PlanCreationInput = {
      title,
      targetOutcome: dedupeTrimmed(request.targetOutcome ?? [title]),
      constraints: dedupeTrimmed(request.constraints ?? ["Need learner confirmation for exact scope."]),
      successDefinition: dedupeTrimmed(
        request.successDefinition ?? ["Learner can state the target and show evidence through tasks or assessment."],
      ),
      timebox: request.timebox?.trim() || "to-be-confirmed",
      goals: dedupeTrimmed(
        request.goals ?? [
          "Clarify the learning target and deadline",
          "Map current ability and blockers",
          "Generate an executable task queue",
        ],
      ),
      focusTopics: dedupeTrimmed(request.focusTopics ?? []),
    };

    const plan = await this.repo.createPlan(input, now);
    const learner = await this.repo.readLearnerSummary();
    learner.state.active_plan_ids = Array.from(new Set([...learner.state.active_plan_ids, plan.planId]));
    learner.state.active_plan_count = learner.state.active_plan_ids.length;
    learner.state.current_focus = plan.title;
    learner.state.updated_at = now;
    await this.repo.writeLearnerState(learner.state);

    await this.repo.appendLearnerEvent({
      ts: now,
      level: "learner",
      type: "plan_created_via_debug_ui",
      planId: plan.planId,
      evidence: [plan.title],
      impact: `Debug UI created plan ${plan.planId}.`,
      promotion: "learner",
    });

    await this.repo.appendPlanEvent(plan.planId, {
      ts: now,
      level: "plan",
      type: "plan_created_via_debug_ui",
      planId: plan.planId,
      evidence: [plan.title],
      impact: "Plan created from local debug UI.",
      promotion: "plan",
    });

    return this.getSnapshot();
  }

  async activatePlan(planId: string): Promise<DebugDashboardSnapshot> {
    const plan = await this.repo.readPlanState(planId);
    const [index, learner] = await Promise.all([this.repo.readPlansIndex(), this.repo.readLearnerSummary()]);
    const now = nowIso();

    await this.repo.writePlansIndex({
      ...index,
      active_plan_id: plan.planId,
      plans: Array.from(new Set([...index.plans, plan.planId])),
    });

    learner.state.active_plan_ids = Array.from(new Set([...learner.state.active_plan_ids, plan.planId]));
    learner.state.active_plan_count = learner.state.active_plan_ids.length;
    learner.state.current_focus = plan.title;
    learner.state.updated_at = now;
    await this.repo.writeLearnerState(learner.state);

    await this.repo.appendLearnerEvent({
      ts: now,
      level: "learner",
      type: "active_plan_changed_via_debug_ui",
      planId: plan.planId,
      evidence: [plan.title],
      impact: `Active plan switched to ${plan.planId}.`,
      promotion: "learner",
    });

    return this.getSnapshot();
  }

  async createThread(request: CreateThreadRequest): Promise<DebugDashboardSnapshot> {
    const plan = await this.repo.readPlanState(request.planId);
    const title = request.title.trim();
    if (!title) {
      throw new Error("Thread title is required.");
    }

    const now = nowIso();
    const thread = await this.repo.createThread(
      {
        planId: plan.planId,
        title,
        currentQuestion: request.currentQuestion?.trim() || null,
      },
      now,
    );

    plan.threadIds = Array.from(new Set([...plan.threadIds, thread.threadId]));
    plan.updatedAt = now;
    plan.summary = `${plan.summary}\nThread created via debug UI: ${thread.title}`.trim();
    await this.repo.writePlanState(plan);

    await this.repo.appendPlanEvent(plan.planId, {
      ts: now,
      level: "plan",
      type: "thread_created_via_debug_ui",
      planId: plan.planId,
      threadId: thread.threadId,
      evidence: [thread.title],
      impact: "Debug UI created a new thread under this plan.",
      promotion: "plan",
    });

    await this.repo.appendThreadEvent(plan.planId, thread.threadId, {
      ts: now,
      level: "thread",
      type: "thread_created_via_debug_ui",
      planId: plan.planId,
      threadId: thread.threadId,
      evidence: [thread.title],
      impact: "Thread created from local debug UI.",
      promotion: "thread",
    });

    return this.getSnapshot();
  }

  async bindSession(request: BindSessionRequest): Promise<DebugDashboardSnapshot> {
    const sessionKey = request.sessionKey.trim();
    if (!sessionKey) {
      throw new Error("Session key is required.");
    }
    const thread = await this.ensureThread(request.planId, request.threadId);
    await this.bindingStore.set({
      sessionKey,
      planId: thread.planId,
      threadId: thread.threadId,
      updatedAt: nowIso(),
      lastWorkflow: "manual-bind",
    });
    return this.getSnapshot();
  }

  async unbindSession(sessionKey: string): Promise<DebugDashboardSnapshot> {
    await this.bindingStore.remove(sessionKey);
    return this.getSnapshot();
  }

  async handleUserTurn(request: HandleTurnRequest): Promise<DebugTurnResponse> {
    const sessionKey = request.sessionKey.trim() || browserSessionKey("browser");
    const message = request.message.trim();
    if (!message) {
      throw new Error("Message is required.");
    }

    const bound = await this.bindingStore.get(sessionKey);
    const planId = request.planId ?? bound?.planId;
    const threadId =
      request.threadId ?? (request.planId && bound?.planId !== request.planId ? undefined : bound?.threadId);
    if (request.planId && request.threadId) {
      await this.ensureThread(request.planId, request.threadId);
    }

    const orchestrator = new mentorclawOrchestrator(this.repo);
    const outcome = await orchestrator.handleTurn({
      message,
      now: nowIso(),
      planId,
      threadId,
      signals: request.forceWorkflow ? { forceWorkflow: request.forceWorkflow } : undefined,
    });

    if (!outcome.plan || !outcome.thread) {
      throw new Error("Turn did not resolve to a concrete plan/thread binding.");
    }

    const binding: mentorclawSessionBinding = {
      sessionKey,
      planId: outcome.plan.planId,
      threadId: outcome.thread.threadId,
      updatedAt: nowIso(),
      lastWorkflow: outcome.decision.primary,
    };
    await this.bindingStore.set(binding);
    const assistantReply = synthesizeAssistantReply(message, outcome);
    await recordAgentEnd(this.repo, binding, {
      success: true,
      messages: [
        {
          role: "assistant",
          content: assistantReply,
        },
      ],
    });

    return {
      binding,
      outcome,
      assistantReply,
      promptContext: renderPromptContext(outcome),
      systemAppend: mentorclaw_STATIC_SYSTEM_APPEND,
      snapshot: await this.getSnapshot(),
    };
  }

  async recordAssistantReply(request: RecordAssistantReplyRequest): Promise<DebugDashboardSnapshot> {
    const sessionKey = request.sessionKey.trim();
    if (!sessionKey) {
      throw new Error("Session key is required.");
    }
    if (!request.text.trim() && request.success !== false) {
      throw new Error("Assistant reply text is required when recording a successful reply.");
    }

    const binding = await this.bindingStore.get(sessionKey);
    if (!binding) {
      throw new Error(`No binding found for session ${sessionKey}.`);
    }

    await recordAgentEnd(this.repo, binding, {
      success: request.success ?? true,
      error: request.error,
      durationMs: request.durationMs,
      messages: [
        {
          role: "assistant",
          content: request.text,
        },
      ],
    });

    return this.getSnapshot();
  }

  private async listPlanIds(): Promise<string[]> {
    try {
      const entries = await readdir(this.repo.plansDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
        .map((entry) => entry.name)
        .sort();
    } catch {
      return [];
    }
  }

  private async readEvents(filePath: string, limit: number = 20): Promise<LearningEvent[]> {
    try {
      const raw = await readFile(filePath, "utf8");
      return parseJsonl<LearningEvent>(raw).slice(-limit).reverse();
    } catch {
      return [];
    }
  }

  private async ensureThread(planId: string, threadId: string): Promise<ThreadState> {
    const thread = await this.repo.readThreadState(planId, threadId);
    if (thread.planId !== planId) {
      throw new Error(`Thread ${threadId} does not belong to plan ${planId}.`);
    }
    return thread;
  }

  private runtimeLocalFiles(): DebugLocalFileRef[] {
    return [
      this.makeFileRef(
        path.join(this.repo.paths.workspaceRoot, ".openclaw", "mentorclaw-session-bindings.json"),
        "Session Bindings",
        "binding",
        "Maps external session keys to the current plan/thread binding.",
      ),
      this.makeFileRef(
        path.join(this.repo.learnerDir, "PROFILE.md"),
        "Learner Profile",
        "learner",
        "Stable learner facts and long-term context.",
      ),
      this.makeFileRef(
        path.join(this.repo.learnerDir, "PREFERENCES.md"),
        "Learner Preferences",
        "learner",
        "Preferred explanation and task style.",
      ),
      this.makeFileRef(
        path.join(this.repo.learnerDir, "GLOBAL_GOALS.md"),
        "Global Goals",
        "learner",
        "High-level learner goals and tradeoffs.",
      ),
      this.makeFileRef(
        path.join(this.repo.learnerDir, "LEARNER_STATE.yaml"),
        "Learner State",
        "learner",
        "Current learner focus, active plans, and risk flags.",
      ),
      this.makeFileRef(
        path.join(this.repo.learnerDir, "EVENTS.jsonl"),
        "Learner Events",
        "learner",
        "Global learner-level events appended over time.",
      ),
      this.makeFileRef(
        path.join(this.repo.plansDir, "INDEX.yaml"),
        "Plans Index",
        "runtime",
        "Active plan pointer plus the known plan ids.",
      ),
    ];
  }

  private planLocalFiles(planId: string): DebugLocalFileRef[] {
    const planDir = path.join(this.repo.plansDir, planId);
    return [
      this.makeFileRef(path.join(planDir, "PLAN.md"), "Plan Brief", "plan", "Plan metadata and target outcome."),
      this.makeFileRef(path.join(planDir, "GOALS.md"), "Goals", "plan", "Human-readable goal list for the plan."),
      this.makeFileRef(path.join(planDir, "PROGRESS.yaml"), "Progress", "plan", "Current phase, focus topics, and next checkpoint."),
      this.makeFileRef(path.join(planDir, "TASKS.yaml"), "Tasks", "plan", "Task queue bucketed by priority and status."),
      this.makeFileRef(path.join(planDir, "MILESTONES.yaml"), "Milestones", "plan", "Plan milestones and due dates."),
      this.makeFileRef(path.join(planDir, "MISCONCEPTIONS.yaml"), "Misconceptions", "plan", "Known plan-level misconceptions."),
      this.makeFileRef(path.join(planDir, "RESOURCES.md"), "Resources", "plan", "Bound learning resources for this plan."),
      this.makeFileRef(path.join(planDir, "SUMMARY.md"), "Plan Summary", "plan", "Working summary for the plan."),
      this.makeFileRef(path.join(planDir, "EVENTS.jsonl"), "Plan Events", "plan", "Plan-level events written by the kernel."),
    ];
  }

  private threadLocalFiles(planId: string, threadId: string): DebugLocalFileRef[] {
    const threadDir = path.join(this.repo.plansDir, planId, "threads", threadId);
    return [
      this.makeFileRef(path.join(threadDir, "meta.json"), "Thread Meta", "thread", "Thread identity, status, and timestamps."),
      this.makeFileRef(path.join(threadDir, "summary.md"), "Thread Summary", "thread", "Thread summary updated over time."),
      this.makeFileRef(
        path.join(threadDir, "working_memory.md"),
        "Working Memory",
        "thread",
        "Compact memory lines that should change when assistant replies are recorded.",
      ),
      this.makeFileRef(
        path.join(threadDir, "events.jsonl"),
        "Thread Events",
        "thread",
        "Thread-level event log for turns, reviews, and memory writes.",
      ),
    ];
  }

  private makeFileRef(
    absolutePath: string,
    label: string,
    scope: DebugLocalFileRef["scope"],
    description: string,
  ): DebugLocalFileRef {
    return {
      id: `${scope}:${path.basename(absolutePath)}`,
      label,
      scope,
      absolutePath,
      relativePath: path.relative(this.runtimeRoot, absolutePath) || path.basename(absolutePath),
      description,
    };
  }

  private resolveRuntimePath(filePath: string): string {
    const runtimeRoot = path.resolve(this.runtimeRoot);
    const absolutePath = path.resolve(filePath);
    const relative = path.relative(runtimeRoot, absolutePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Requested file is outside the runtime root.");
    }
    return absolutePath;
  }
}
