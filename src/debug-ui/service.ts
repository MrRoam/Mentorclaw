import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { ResourceIndexer } from "../education/resource-indexer.ts";
import { resolveMsaCourseIdForCourse } from "../education/course-relations.ts";
import { updateCourseItemOverrides } from "../education/query.ts";
import { syncBuaaByxt } from "../education/providers/buaa/byxt.ts";
import { discoverBuaaMsaCourseMappings, syncBuaaMsa, type BuaaMsaAuth } from "../education/providers/buaa/msa.ts";
import { mentorclawOrchestrator } from "../core/orchestrator.ts";
import {
  mentorclaw_STATIC_SYSTEM_APPEND,
  SessionBindingStore,
  type mentorclawSessionBinding,
  recordAgentEnd,
  renderPromptContext,
} from "../integration/openclaw-adapter.ts";
import { OpenClawTurnBridge, type OpenClawTurnBridgeLike, type OpenClawTurnResult } from "../integration/openclaw-turn-bridge.ts";
import type {
  CronCreationInput,
  CronDefinition,
  CronRunRecord,
  LearnerSummary,
  LearningEvent,
  PlanCreationInput,
  PlanState,
  ProjectState,
  ThreadState,
  TurnOutcome,
  WorkflowType,
} from "../schemas/models.ts";
import type {
  CourseItemRecord,
  CourseResourceRecord,
  CourseResourceType,
  ConnectionRecord,
  EducationSnapshot,
  ScheduleViewMode,
} from "../schemas/education.ts";
import { EducationRepo } from "../storage/education-repo.ts";
import { WorkspaceRepo } from "../storage/workspace-repo.ts";
import { dueCronTriggers, parseCronScheduleDescription } from "../runtime/cron-schedule.ts";
import { nowIso } from "../utils/time.ts";

export interface DebugThreadSnapshot extends ThreadState {
  boundSessions: mentorclawSessionBinding[];
  events: LearningEvent[];
  localFiles: DebugLocalFileRef[];
}

export interface DebugPlanSnapshot extends PlanState {
  courseIds: string[];
  projectStatus: ProjectState["status"];
  threads: DebugThreadSnapshot[];
  boundSessions: mentorclawSessionBinding[];
  events: LearningEvent[];
  openTaskCount: number;
  blockedTaskCount: number;
  localFiles: DebugLocalFileRef[];
}

export interface CronRunPreview {
  cron: CronDefinition;
  courseIds: string[];
  projectId: string | null;
  courseTitle: string | null;
  latestClass: {
    itemId: string;
    title: string;
    startAt: string | null;
    endAt: string | null;
  } | null;
  sourceResource: {
    resourceId: string;
    title: string;
    resourceType: string;
    localPath: string | null;
  } | null;
  usedFallback: boolean;
  canRun: boolean;
  reason: string | null;
  summaryTitle: string;
  summaryPoints: string[];
  reviewQuestions: string[];
  nextActions: string[];
  preparedContext: string | null;
  output: string | null;
}

export interface CronExecutionSummary {
  checkedAt: string;
  dueCount: number;
  completed: number;
  skipped: number;
  failed: number;
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

export interface DebugRuntimeConfigFile {
  id: "soul" | "agents" | "heartbeat";
  label: string;
  absolutePath: string;
  relativePath: string;
  content: string;
  exists: boolean;
}

export interface DebugResourceFile {
  absolutePath: string;
  fileName: string;
  contentType: string;
  content: Buffer;
}

export interface DebugDashboardSnapshot {
  runtimeRoot: string;
  workspaceRoot: string;
  generatedAt: string;
  validation: Awaited<ReturnType<WorkspaceRepo["validateRuntime"]>>;
  education: EducationSnapshot;
  learner: LearnerSummary;
  learnerEvents: LearningEvent[];
  activePlanId: string | null;
  activeProjectId?: string | null;
  sessionBindings: mentorclawSessionBinding[];
  crons: CronDefinition[];
  cronRuns: CronRunRecord[];
  plans: DebugPlanSnapshot[];
  projects?: Array<DebugPlanSnapshot & { projectId: string }>;
  localFiles: DebugLocalFileRef[];
  configFiles: DebugRuntimeConfigFile[];
}

export interface CreatePlanRequest {
  title: string;
  targetOutcome?: string[];
  constraints?: string[];
  successDefinition?: string[];
  timebox?: string;
  goals?: string[];
  focusTopics?: string[];
  courseIds?: string[];
}

export interface CreateThreadRequest {
  planId: string;
  title: string;
  currentQuestion?: string | null;
}

export interface BindSessionRequest {
  sessionKey: string;
  planId?: string;
  projectId?: string;
  threadId?: string;
}

export interface HandleTurnRequest {
  sessionKey: string;
  message: string;
  planId?: string;
  projectId?: string;
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

export interface UpdateRuntimeConfigRequest {
  id: DebugRuntimeConfigFile["id"];
  content: string;
}

export interface BuaaLoginRequest {
  username: string;
  password: string;
  msaCourseIds?: string[];
}

export interface CreateCronRequest extends CronCreationInput {}

export interface UpdateCronRequest extends CronCreationInput {
  cronId: string;
}

export interface CronMessageRequest {
  cronId: string;
  message: string;
}

export interface AddCourseResourceRequest {
  courseId: string;
  title?: string | null;
  resourceType?: CourseResourceType | null;
  projectId?: string | null;
  linkedItemId?: string | null;
  url?: string | null;
  localPath?: string | null;
}

export interface UploadCourseResourceRequest {
  courseId?: string | null;
  projectId?: string | null;
  fileName: string;
  contentType?: string | null;
  base64: string;
}

export interface AddManualScheduleItemRequest {
  title: string;
  startAt: string;
  endAt?: string | null;
  location?: string | null;
  note?: string | null;
}

export interface UpdateScheduleItemRequest extends AddManualScheduleItemRequest {
  itemId: string;
}

export interface DebugTurnResponse {
  binding: mentorclawSessionBinding;
  outcome: TurnOutcome | null;
  assistantReply: string;
  assistantReplySource: "openclaw" | "local";
  liveTurn: OpenClawTurnResult | null;
  promptContext: string;
  systemAppend: string;
  snapshot: DebugDashboardSnapshot;
}

export interface DebugUiServiceOptions {
  turnBridge?: OpenClawTurnBridgeLike | null;
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
const SUBTITLE_PREVIEW_SEGMENT_LIMIT = 8;

const uniq = <T>(values: T[]): T[] => Array.from(new Set(values));

const inferResourceType = (request: AddCourseResourceRequest): CourseResourceType => {
  if (request.resourceType) return request.resourceType;
  const source = `${request.localPath ?? ""} ${request.url ?? ""}`.toLowerCase();
  if (source.includes(".srt")) return "subtitle";
  if (source.includes(".pptx")) return "pptx";
  if (source.includes(".ppt") || source.includes(".html") || source.includes(".htm")) return "ppt";
  if (source.includes(".pdf")) return "pdf";
  if (source.includes(".mp4") || source.includes(".m3u8")) return "video";
  if (source.includes(".md") || source.includes(".txt")) return "notes";
  return request.localPath ? "notes" : "link";
};

const inferResourceTypeFromName = (fileName: string): CourseResourceType =>
  inferResourceType({ courseId: "manual", localPath: fileName });

const inferResourceTitle = (request: AddCourseResourceRequest): string => {
  const explicit = request.title?.trim();
  if (explicit) return explicit;
  const localPath = request.localPath?.trim();
  if (localPath) return path.basename(localPath);
  const rawUrl = request.url?.trim();
  if (rawUrl) {
    try {
      const url = new URL(rawUrl);
      const lastSegment = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
      return lastSegment || url.hostname || "Linked resource";
    } catch {
      return rawUrl.split(/[\\/]/).filter(Boolean).pop() || "Linked resource";
    }
  }
  return "";
};

const readSourceAliases = (metadata: Record<string, unknown> | null | undefined): Record<string, string> => {
  const raw = metadata?.sourceAliases;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" && value.trim()) result[key] = value.trim();
  }
  return result;
};

const resourceContentType = (filePath: string): string => {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".html" || extension === ".htm") return "text/html; charset=utf-8";
  if (extension === ".txt" || extension === ".srt" || extension === ".md") return "text/plain; charset=utf-8";
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (extension === ".ppt") return "application/vnd.ms-powerpoint";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".gif") return "image/gif";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".mp4") return "video/mp4";
  return "application/octet-stream";
};

const summarizeTextPoint = (value: string): string => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length <= 88 ? text : `${text.slice(0, 85)}...`;
};

const reviewQuestionsFromPoints = (courseTitle: string | null, points: string[]): string[] => {
  const [first, second, third] = points;
  const title = courseTitle || "这门课";
  return [
    first ? `不看资料，复述今天 ${title} 里最核心的一点：${first}` : `不看资料，回忆今天 ${title} 的三个核心概念。`,
    second ? `解释第二个重点为什么重要：${second}` : `解释今天最容易混淆的概念，以及你为什么会混淆它。`,
    third ? `把这节课和已有知识连起来：${third}` : `把这节课和前一讲或作业联系起来，说清楚它解决了什么问题。`,
  ];
};

const explainCronSchedule = (cron: CronDefinition): string => {
  const rule = cron.scheduleRule;
  const time = rule?.timeOfDay || "manual";
  if (rule?.kind === "after_course_class") {
    const dayText = rule.offsetDays === 1 ? "next day" : "same day";
    const courses = cron.courseIds?.length ? cron.courseIds.join(", ") : "the selected course context";
    return `I understood this as: after each class for ${courses}, run on the ${dayText} at ${time} (${rule.timezone || "Asia/Shanghai"}).`;
  }
  if (rule?.kind === "daily_time") {
    return `I understood this as: run once every day at ${time} (${rule.timezone || "Asia/Shanghai"}), independent of any project.`;
  }
  return "I understood this as: manual only; it will run when you press Run.";
};

const cronConversationSessionRef = (cronId: string): string => `cron-${cronId.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;

const cronResourcePriority = (resourceType: string): number => {
  if (resourceType === "subtitle") return 5;
  if (resourceType === "notes") return 4;
  if (resourceType === "pptx" || resourceType === "ppt") return 3;
  if (resourceType === "pdf") return 2;
  return 0;
};

const formatCronContextBlock = (title: string, lines: string[]): string => {
  const content = lines.map((line) => `- ${line}`).join("\n");
  return content ? `${title}:\n${content}` : "";
};

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

const sanitizeEducationSnapshot = (snapshot: EducationSnapshot): EducationSnapshot => ({
  ...snapshot,
  connections: snapshot.connections.map((connection) => ({
    ...connection,
    auth: {
      mode: typeof connection.auth.mode === "string" ? connection.auth.mode : undefined,
      account: typeof connection.auth.account === "string" ? connection.auth.account : undefined,
      username: typeof connection.auth.username === "string" ? connection.auth.username : undefined,
      displayName: typeof connection.auth.displayName === "string" ? connection.auth.displayName : undefined,
      studentName: typeof connection.auth.studentName === "string" ? connection.auth.studentName : undefined,
      realname: typeof connection.auth.realname === "string" ? connection.auth.realname : undefined,
      name: typeof connection.auth.name === "string" ? connection.auth.name : undefined,
      hasCookie: typeof connection.auth.cookie === "string" && connection.auth.cookie.length > 0,
      hasToken: typeof connection.auth.token === "string" && connection.auth.token.length > 0,
      hasPassword: typeof connection.auth.password === "string" && connection.auth.password.length > 0,
    },
  })),
});

const readAuthString = (auth: Record<string, unknown> | null | undefined, key: string): string | null => {
  const value = auth?.[key];
  return typeof value === "string" && value.trim() ? value : null;
};

const connectionAuth = (connection: ConnectionRecord | null | undefined): BuaaMsaAuth | null => {
  if (!connection) return null;
  return {
    ...(connection.auth as Record<string, unknown>),
    accountLabel: connection.accountLabel,
  } as BuaaMsaAuth;
};

const buildReusableMsaAuth = (
  msaAuth: BuaaMsaAuth | null | undefined,
  byxtAuth: BuaaMsaAuth | null | undefined,
): BuaaMsaAuth | null => {
  const msaRecord = msaAuth as Record<string, unknown> | null | undefined;
  const byxtRecord = byxtAuth as Record<string, unknown> | null | undefined;
  const username = readAuthString(msaRecord, "username") || readAuthString(byxtRecord, "username");
  const password = readAuthString(msaRecord, "password") || readAuthString(byxtRecord, "password");
  const accountLabel = readAuthString(msaRecord, "accountLabel") || readAuthString(byxtRecord, "accountLabel");
  const displayName = readAuthString(msaRecord, "displayName") || readAuthString(byxtRecord, "displayName");

  if (username && password) {
    return { username, password, accountLabel, displayName };
  }

  const token = readAuthString(msaRecord, "token");
  const cookie = readAuthString(msaRecord, "cookie");
  if (token || cookie) {
    return {
      token,
      cookie,
      account: readAuthString(msaRecord, "account"),
      username,
      accountLabel,
      displayName,
    };
  }

  return null;
};

export class DebugUiService {
  readonly repo: WorkspaceRepo;
  readonly bindingStore: SessionBindingStore;
  readonly educationRepo: EducationRepo;
  readonly resourceIndexer: ResourceIndexer;
  readonly runtimeRoot: string;
  private readonly turnBridge: OpenClawTurnBridgeLike | null;

  constructor(runtimeRoot: string, options: DebugUiServiceOptions = {}) {
    this.runtimeRoot = runtimeRoot;
    this.repo = new WorkspaceRepo(runtimeRoot);
    this.bindingStore = new SessionBindingStore(this.repo.paths.workspaceRoot);
    this.educationRepo = new EducationRepo(runtimeRoot);
    this.resourceIndexer = new ResourceIndexer(this.educationRepo);
    this.turnBridge = options.turnBridge === undefined ? new OpenClawTurnBridge() : options.turnBridge;
  }

  makeBrowserSessionKey(label?: string): string {
    return browserSessionKey(label);
  }

  async getSnapshot(): Promise<DebugDashboardSnapshot> {
    await this.repo.ensureScaffold();
    const [validation, education, learner, index, sessionBindings, learnerEvents, planIds, cronIds, cronRuns] = await Promise.all([
      this.repo.validateRuntime(),
      this.educationRepo.readSnapshot(),
      this.repo.readLearnerSummary(),
      this.repo.readPlansIndex(),
      this.bindingStore.list(),
      this.readEvents(path.join(this.repo.learnerDir, "EVENTS.jsonl")),
      this.repo.listProjectIds(),
      this.repo.listCronIds(),
      this.repo.readCronRuns(),
    ]);

    const crons = await Promise.all(cronIds.map((cronId) => this.repo.readCronDefinition(cronId)));

    const plans = await Promise.all(
      planIds.map(async (planId) => {
        const [plan, project, events] = await Promise.all([
          this.repo.readPlanState(planId),
          this.repo.readProjectState(planId),
          this.readPlanEvents(planId),
        ]);
        const threads = await Promise.all(
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
        );

        return {
          ...plan,
          courseIds: project.scope.courseIds,
          projectStatus: project.status,
          threads: threads.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
          boundSessions: sessionBindings.filter((binding) => binding.planId === plan.planId),
          events,
          openTaskCount: plan.tasks.filter((task) => task.status !== "done").length,
          blockedTaskCount: plan.tasks.filter((task) => task.status === "blocked").length,
          localFiles: this.planLocalFiles(plan.planId),
        } satisfies DebugPlanSnapshot;
      }),
    );

    const sortedPlans = plans.sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
    return {
      runtimeRoot: this.runtimeRoot,
      workspaceRoot: this.repo.paths.workspaceRoot,
      generatedAt: nowIso(),
      validation,
      education: sanitizeEducationSnapshot(education),
      learner,
      learnerEvents,
      activePlanId: index.active_plan_id,
      activeProjectId: index.active_plan_id,
      sessionBindings,
      crons,
      cronRuns,
      plans: sortedPlans,
      projects: sortedPlans.map((plan) => ({ ...plan, projectId: plan.planId })),
      localFiles: this.runtimeLocalFiles(),
      configFiles: await this.runtimeConfigFiles(),
    };
  }

  async updateRuntimeConfig(request: UpdateRuntimeConfigRequest): Promise<DebugDashboardSnapshot> {
    const target = this.runtimeConfigFileTarget(request.id);
    await mkdir(path.dirname(target.absolutePath), { recursive: true });
    await writeFile(target.absolutePath, `${String(request.content ?? "").replace(/\s+$/u, "")}\n`, "utf8");
    return this.getSnapshot();
  }

  async updateSchedulePreferences(
    patch: Partial<{ showTimetableInSchedule: boolean; scheduleDefaultView: ScheduleViewMode }>,
  ): Promise<DebugDashboardSnapshot> {
    await this.educationRepo.updateSchedulePreferences(patch);
    return this.getSnapshot();
  }

  async connectBuaaAccount(request: BuaaLoginRequest): Promise<DebugDashboardSnapshot> {
    const username = String(request.username ?? "").trim();
    const password = String(request.password ?? "");
    if (!username || !password.trim()) {
      throw new Error("BUAA username and password are required.");
    }

    const byxtResult = await syncBuaaByxt(this.educationRepo, {
      auth: {
        username,
        password,
        accountLabel: username,
      },
    });

    await discoverBuaaMsaCourseMappings(this.educationRepo, {
      auth: {
        username,
        password,
        accountLabel: username,
      },
      term: byxtResult.termName,
    });

    const msaCourseIds = (request.msaCourseIds ?? []).map((value) => value.trim()).filter(Boolean);
    if (msaCourseIds.length) {
      await syncBuaaMsa(this.educationRepo, {
        auth: {
          username,
          password,
          accountLabel: username,
        },
        term: byxtResult.termName,
        courseIds: Array.from(new Set(msaCourseIds)),
      });
    }

    return this.getSnapshot();
  }

  async syncBuaaCourseResources(courseId: string): Promise<DebugDashboardSnapshot> {
    const trimmedCourseId = courseId.trim();
    if (!trimmedCourseId) {
      throw new Error("courseId is required.");
    }

    let snapshot = await this.educationRepo.readSnapshot();
    let course = snapshot.courses.find((item) => item.id === trimmedCourseId);
    if (!course) {
      throw new Error(`Course not found: ${trimmedCourseId}`);
    }

    const connections = await this.educationRepo.readConnections();
    const msaConnection = connections
      .filter((connection) => connection.sourceType === "buaa-msa" && connection.status === "connected")
      .sort((left, right) => String(right.lastSyncedAt || "").localeCompare(String(left.lastSyncedAt || "")))[0];
    const byxtConnection = connections
      .filter((connection) => connection.sourceType === "buaa-byxt" && connection.status === "connected")
      .sort((left, right) => String(right.lastSyncedAt || "").localeCompare(String(left.lastSyncedAt || "")))[0];
    const auth = buildReusableMsaAuth(connectionAuth(msaConnection), connectionAuth(byxtConnection));
    if (!auth) {
      throw new Error("No reusable BUAA login state is available. Log in once with your BUAA username and password, then sync course resources.");
    }

    let aliases = readSourceAliases(course.metadata);
    let msaCourseId =
      resolveMsaCourseIdForCourse(snapshot, course) ||
      aliases["buaa-msa"] ||
      (typeof course.metadata?.msaCourseId === "string" ? course.metadata.msaCourseId : "");
    if (!msaCourseId) {
      await discoverBuaaMsaCourseMappings(this.educationRepo, {
        auth,
        term: course.term || (typeof byxtConnection?.metadata?.termName === "string" ? byxtConnection.metadata.termName : null),
      });
      snapshot = await this.educationRepo.readSnapshot();
      course = snapshot.courses.find((item) => item.id === trimmedCourseId);
      if (!course) {
        throw new Error(`Course not found after MSA discovery: ${trimmedCourseId}`);
      }
      aliases = readSourceAliases(course.metadata);
      msaCourseId =
        resolveMsaCourseIdForCourse(snapshot, course) ||
        aliases["buaa-msa"] ||
        (typeof course.metadata?.msaCourseId === "string" ? course.metadata.msaCourseId : "");
    }
    if (!msaCourseId) {
      throw new Error(
        `MentorClaw could not match ${course.title} to a BUAA MSA course automatically, so it still cannot fetch real PPT/video/subtitle resources for this class.`,
      );
    }

    try {
      await syncBuaaMsa(this.educationRepo, {
        auth,
        term: course.term || (typeof byxtConnection?.metadata?.termName === "string" ? byxtConnection.metadata.termName : null),
        courseIds: [msaCourseId],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/HTTP 401|unauthorized|invalid/i.test(message) && msaConnection) {
        await this.educationRepo.writeConnections(
          connections.map((connection) =>
            connection.id === msaConnection.id
              ? { ...connection, status: "invalid", lastError: "MSA login expired. Please log in again.", lastSyncedAt: nowIso() }
              : connection,
          ),
        );
        throw new Error("BUAA MSA login has expired. Please log in again, then sync course resources.");
      }
      throw error;
    }

    return this.getSnapshot();
  }

  async addManualScheduleItem(request: AddManualScheduleItemRequest): Promise<DebugDashboardSnapshot> {
    const title = request.title.trim();
    if (!title) {
      throw new Error("Schedule title is required.");
    }
    const start = new Date(request.startAt);
    if (Number.isNaN(start.getTime())) {
      throw new Error("Schedule start time is invalid.");
    }
    const end = request.endAt ? new Date(request.endAt) : null;
    if (end && Number.isNaN(end.getTime())) {
      throw new Error("Schedule end time is invalid.");
    }
    if (end && end.getTime() <= start.getTime()) {
      throw new Error("Schedule end time must be after the start time.");
    }

    const items = await this.educationRepo.readCourseItems();
    const now = nowIso();
    const record: CourseItemRecord = {
      id: `item-manual-${Date.now().toString(36)}`,
      courseId: "manual",
      type: "manual",
      sourceItemId: null,
      title,
      teacher: null,
      startAt: start.toISOString(),
      endAt: end ? end.toISOString() : start.toISOString(),
      dueAt: null,
      location: request.location?.trim() || null,
      body: request.note?.trim() || "",
      metaJson: {
        origin: "debug_ui_manual",
        createdAt: now,
      },
      isHidden: false,
      manualTitle: null,
      manualLocation: null,
      manualStartAt: null,
      manualEndAt: null,
      manualNote: request.note?.trim() || null,
      lastSyncedAt: now,
    };

    await this.educationRepo.writeCourseItems([...items, record]);
    return this.getSnapshot();
  }

  async updateScheduleItem(request: UpdateScheduleItemRequest): Promise<DebugDashboardSnapshot> {
    const itemId = request.itemId.trim();
    if (!itemId) {
      throw new Error("Schedule item id is required.");
    }
    const title = request.title.trim();
    if (!title) {
      throw new Error("Schedule title is required.");
    }
    const start = new Date(request.startAt);
    if (Number.isNaN(start.getTime())) {
      throw new Error("Schedule start time is invalid.");
    }
    const end = request.endAt ? new Date(request.endAt) : null;
    if (end && Number.isNaN(end.getTime())) {
      throw new Error("Schedule end time is invalid.");
    }
    if (end && end.getTime() <= start.getTime()) {
      throw new Error("Schedule end time must be after the start time.");
    }

    await updateCourseItemOverrides(this.educationRepo, itemId, {
      manualTitle: title,
      manualLocation: request.location?.trim() || null,
      manualStartAt: start.toISOString(),
      manualEndAt: end ? end.toISOString() : start.toISOString(),
      manualNote: request.note?.trim() || null,
    });
    return this.getSnapshot();
  }

  async deleteScheduleItem(itemId: string): Promise<DebugDashboardSnapshot> {
    const trimmedItemId = itemId.trim();
    if (!trimmedItemId) {
      throw new Error("Schedule item id is required.");
    }
    const items = await this.educationRepo.readCourseItems();
    const target = items.find((item) => item.id === trimmedItemId);
    if (!target) {
      throw new Error(`Schedule item ${trimmedItemId} was not found.`);
    }

    if (target.type === "manual") {
      await this.educationRepo.writeCourseItems(items.filter((item) => item.id !== trimmedItemId));
    } else {
      await updateCourseItemOverrides(this.educationRepo, trimmedItemId, { isHidden: true });
    }
    return this.getSnapshot();
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

  async readResourceFile(resourceId: string): Promise<DebugResourceFile> {
    const trimmed = resourceId.trim();
    if (!trimmed) {
      throw new Error("resourceId is required.");
    }

    const snapshot = await this.educationRepo.readSnapshot();
    const resource = snapshot.courseResources.find((item) => item.id === trimmed);
    if (!resource) {
      throw new Error(`Resource not found: ${trimmed}`);
    }
    if (!resource.localPath?.trim()) {
      throw new Error("This resource does not have a local cached file.");
    }

    const absolutePath = this.resolveRuntimePath(
      path.isAbsolute(resource.localPath) ? resource.localPath : path.join(this.runtimeRoot, resource.localPath),
    );
    const fileInfo = await stat(absolutePath).catch(() => null);
    if (!fileInfo?.isFile()) {
      throw new Error(`Local resource file not found: ${absolutePath}`);
    }

    return {
      absolutePath,
      fileName: path.basename(absolutePath),
      contentType: resourceContentType(absolutePath),
      content: await readFile(absolutePath),
    };
  }

  async createPlan(request: CreatePlanRequest): Promise<DebugDashboardSnapshot> {
    const title = request.title.trim();
    if (!title) {
      throw new Error("Plan title is required.");
    }

    const now = nowIso();
    const project = await this.repo.createProject(
      {
        title,
        summary: dedupeTrimmed(request.targetOutcome ?? [title])[0] ?? title,
        targetOutcome: dedupeTrimmed(request.targetOutcome ?? [title]),
        constraints: dedupeTrimmed(request.constraints ?? ["Need learner confirmation for exact scope."]),
        successDefinition: dedupeTrimmed(
          request.successDefinition ?? ["Learner can state the target and show evidence through tasks or assessment."],
        ),
        goals: dedupeTrimmed(
          request.goals ?? [
            "Clarify the learning target and deadline",
            "Map current ability and blockers",
            "Generate an executable task queue",
          ],
        ),
        courseIds: dedupeTrimmed(request.courseIds ?? []),
      },
      now,
    );
    const plan = await this.repo.readPlanState(project.projectId);
    const [index, learner] = await Promise.all([this.repo.readPlansIndex(), this.repo.readLearnerSummary()]);
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

  async createProject(request: CreatePlanRequest): Promise<DebugDashboardSnapshot> {
    return this.createPlan(request);
  }

  async createCron(request: CreateCronRequest): Promise<DebugDashboardSnapshot> {
    const title = request.title.trim();
    if (!title) {
      throw new Error("Cron title is required.");
    }
    if (!request.prompt.trim()) {
      throw new Error("Cron prompt is required.");
    }
    if (!request.schedule.trim()) {
      throw new Error("Cron schedule is required.");
    }
    const learner = await this.repo.readLearnerSummary();
    const timezone = learner.state.timezone || "Asia/Shanghai";
    const scheduleRule = parseCronScheduleDescription(request.schedule.trim(), timezone);
    let courseIds = dedupeTrimmed(request.courseIds ?? []);
    if (request.projectId?.trim()) {
      const project = await this.repo.readProjectState(request.projectId.trim()).catch(() => null);
      courseIds = dedupeTrimmed([...courseIds, ...(project?.scope.courseIds ?? [])]);
    }

    const cron = await this.repo.createCron({
      title,
      schedule: request.schedule.trim(),
      scheduleRule,
      prompt: request.prompt.trim(),
      enabled: request.enabled ?? true,
      projectId: request.projectId?.trim() || null,
      courseIds,
    }, nowIso());
    await this.recordCronConversation(cron, {
      kind: "created",
      userMessage: [
        "The local MentorClaw scheduler has created this Cron. Confirm your understanding of it.",
        `Name: ${cron.title}`,
        `Schedule: ${cron.schedule}`,
        `Prompt: ${cron.prompt}`,
      ].join("\n"),
      scheduledFor: cron.updatedAt || nowIso(),
    });
    return this.getSnapshot();
  }

  async updateCron(request: UpdateCronRequest): Promise<DebugDashboardSnapshot> {
    const cronId = request.cronId.trim();
    if (!cronId) {
      throw new Error("cronId is required.");
    }
    const existing = await this.repo.readCronDefinition(cronId);
    const title = request.title.trim();
    if (!title) {
      throw new Error("Cron title is required.");
    }
    if (!request.prompt.trim()) {
      throw new Error("Cron prompt is required.");
    }
    if (!request.schedule.trim()) {
      throw new Error("Cron schedule is required.");
    }

    const learner = await this.repo.readLearnerSummary();
    const timezone = learner.state.timezone || "Asia/Shanghai";
    const scheduleRule = parseCronScheduleDescription(request.schedule.trim(), timezone);
    let courseIds = dedupeTrimmed(request.courseIds ?? []);
    if (request.projectId?.trim()) {
      const project = await this.repo.readProjectState(request.projectId.trim()).catch(() => null);
      courseIds = dedupeTrimmed([...courseIds, ...(project?.scope.courseIds ?? [])]);
    }

    await this.repo.writeCronDefinition({
      ...existing,
      title,
      schedule: request.schedule.trim(),
      scheduleRule,
      prompt: request.prompt.trim(),
      enabled: request.enabled ?? existing.enabled,
      projectId: request.projectId?.trim() || null,
      courseIds,
      updatedAt: nowIso(),
    });
    const updated = await this.repo.readCronDefinition(cronId);
    await this.recordCronConversation(updated, {
      kind: "updated",
      userMessage: [
        "The local MentorClaw scheduler has updated this Cron. Confirm your understanding of it.",
        `Name: ${updated.title}`,
        `Schedule: ${updated.schedule}`,
        `Prompt: ${updated.prompt}`,
      ].join("\n"),
      scheduledFor: updated.updatedAt || nowIso(),
    });
    return this.getSnapshot();
  }

  async deleteCron(cronId: string): Promise<DebugDashboardSnapshot> {
    const trimmedCronId = cronId.trim();
    if (!trimmedCronId) {
      throw new Error("cronId is required.");
    }
    await this.repo.deleteCronDefinition(trimmedCronId);
    return this.getSnapshot();
  }

  async addCourseResource(request: AddCourseResourceRequest): Promise<DebugDashboardSnapshot> {
    const snapshot = await this.educationRepo.readSnapshot();
    const course = snapshot.courses.find((item) => item.id === request.courseId);
    if (!course) {
      throw new Error(`Course not found: ${request.courseId}`);
    }
    const title = inferResourceTitle(request);
    if (!title) {
      throw new Error("Provide a local path or URL so the resource name can be inferred.");
    }
    if (!request.localPath?.trim() && !request.url?.trim()) {
      throw new Error("Provide either a local path or a URL.");
    }

    const resourceType = inferResourceType(request);
    let storedLocalPath: string | null = null;
    let resolvedUrl = request.url?.trim() || "";
    const inputLocalPath = request.localPath?.trim() || "";

    if (inputLocalPath) {
      const sourcePath = path.isAbsolute(inputLocalPath) ? inputLocalPath : path.resolve(inputLocalPath);
      const fileInfo = await stat(sourcePath).catch(() => null);
      if (!fileInfo?.isFile()) {
        throw new Error(`Local file not found: ${sourcePath}`);
      }
      const uploadScope = slugifyLabel(request.projectId || request.courseId || "manual");
      const targetDir = this.educationRepo.projectUploadDir(uploadScope);
      await mkdir(targetDir, { recursive: true });
      const targetName = `${Date.now().toString(36)}-${path.basename(sourcePath)}`;
      const targetPath = path.join(targetDir, targetName);
      await copyFile(sourcePath, targetPath);
      storedLocalPath = path.relative(this.runtimeRoot, targetPath) || targetName;
      if (!resolvedUrl) {
        resolvedUrl = `local://${path.basename(sourcePath)}`;
      }
    }

    const record: CourseResourceRecord = {
      id: `resource-debug-${Date.now().toString(36)}`,
      courseId: request.courseId,
      linkedItemId: request.linkedItemId?.trim() || null,
      parentId: null,
      resourceType,
      title,
      url: resolvedUrl || "local://manual-resource",
      localPath: storedLocalPath,
      metaJson: {
        origin: "debug_ui_manual",
        projectId: request.projectId?.trim() || null,
        addedAt: nowIso(),
      },
    };

    await this.educationRepo.writeCourseResources([...snapshot.courseResources, record]);
    if (record.localPath) {
      await this.resourceIndexer.ensureIndexed(record);
    }

    if (request.projectId?.trim()) {
      const project = await this.repo.readProjectState(request.projectId.trim());
      project.resources.pinnedResourceIds = uniq([...project.resources.pinnedResourceIds, record.id]);
      project.resources.preferredTypes = uniq([...project.resources.preferredTypes, record.resourceType]);
      project.resources.notes = uniq([...project.resources.notes, record.title]);
      project.updatedAt = nowIso();
      await this.repo.writeProjectState(project);
      await this.repo.appendProjectEvent(project.projectId, {
        ts: nowIso(),
        level: "project",
        type: "resource_added_via_debug_ui",
        projectId: project.projectId,
        planId: project.projectId,
        evidence: [record.title],
        impact: `Manual resource added: ${record.title}.`,
        promotion: "project",
      });
    }

    return this.getSnapshot();
  }

  async uploadCourseResource(request: UploadCourseResourceRequest): Promise<DebugDashboardSnapshot> {
    const fileName = path.basename(request.fileName.trim());
    if (!fileName) {
      throw new Error("File name is required.");
    }
    if (!request.base64.trim()) {
      throw new Error("File content is required.");
    }

    const snapshot = await this.educationRepo.readSnapshot();
    const requestedCourseId = request.courseId?.trim() || "";
    const courseId = requestedCourseId && snapshot.courses.some((course) => course.id === requestedCourseId)
      ? requestedCourseId
      : "manual";
    const bytes = Buffer.from(request.base64, "base64");
    if (!bytes.length) {
      throw new Error("Uploaded file is empty.");
    }

    const uploadScope = slugifyLabel(request.projectId || courseId || "manual");
    const targetDir = this.educationRepo.projectUploadDir(uploadScope);
    await mkdir(targetDir, { recursive: true });
    const targetName = `${Date.now().toString(36)}-${fileName}`;
    const targetPath = path.join(targetDir, targetName);
    await writeFile(targetPath, bytes);

    const storedLocalPath = path.relative(this.runtimeRoot, targetPath) || targetName;
    const resourceType = inferResourceTypeFromName(fileName);
    const record: CourseResourceRecord = {
      id: `resource-upload-${Date.now().toString(36)}`,
      courseId,
      linkedItemId: null,
      parentId: null,
      resourceType,
      title: fileName,
      url: `local://${fileName}`,
      localPath: storedLocalPath,
      metaJson: {
        origin: "debug_ui_upload",
        projectId: request.projectId?.trim() || null,
        addedAt: nowIso(),
        contentType: request.contentType?.trim() || null,
      },
    };

    await this.educationRepo.writeCourseResources([...snapshot.courseResources, record]);
    await this.resourceIndexer.ensureIndexed(record);

    if (request.projectId?.trim()) {
      const project = await this.repo.readProjectState(request.projectId.trim());
      project.resources.pinnedResourceIds = uniq([...project.resources.pinnedResourceIds, record.id]);
      project.resources.preferredTypes = uniq([...project.resources.preferredTypes, record.resourceType]);
      project.resources.notes = uniq([...project.resources.notes, record.title]);
      project.updatedAt = nowIso();
      await this.repo.writeProjectState(project);
      await this.repo.appendProjectEvent(project.projectId, {
        ts: nowIso(),
        level: "project",
        type: "resource_uploaded_via_debug_ui",
        projectId: project.projectId,
        planId: project.projectId,
        evidence: [record.title],
        impact: `Local resource uploaded: ${record.title}.`,
        promotion: "project",
      });
    }

    return this.getSnapshot();
  }

  async runCron(cronId: string): Promise<CronRunPreview> {
    const cron = await this.repo.readCronDefinition(cronId);
    let education = await this.educationRepo.readSnapshot();
    const project = cron.projectId ? await this.repo.readProjectState(cron.projectId).catch(() => null) : null;
    const courseIds = uniq([...(cron.courseIds ?? []), ...(project?.scope.courseIds ?? [])]).filter(Boolean);
    let courseMap = new Map(education.courses.map((course) => [course.id, course]));
    let sourceResource = this.pickCronSourceResource(education, courseIds);
    const syncNotes: string[] = [];
    if (courseIds.length && !sourceResource) {
      const hydration = await this.hydrateCronResourcesForRun(education, courseIds);
      education = hydration.education;
      courseMap = new Map(education.courses.map((course) => [course.id, course]));
      sourceResource = this.pickCronSourceResource(education, courseIds);
      syncNotes.push(...hydration.notes);
    }
    const courseTitle = courseIds[0] ? courseMap.get(courseIds[0])?.title ?? null : null;
    const latestClass = education.courseItems
      .filter((item) => item.type === "class" && courseIds.includes(item.courseId))
      .filter((item) => {
        const endAt = item.manualEndAt || item.endAt || item.startAt;
        if (!endAt) return false;
        const end = new Date(endAt);
        return !Number.isNaN(end.getTime()) && end.getTime() <= Date.now();
      })
      .sort((left, right) => (right.endAt || right.startAt || "").localeCompare(left.endAt || left.startAt || ""))[0] ?? null;
    if (!courseIds.length) {
      const preparedContext = "This standalone automation does not depend on a bound course resource.";
      return {
        cron,
        courseIds,
        projectId: cron.projectId ?? null,
        courseTitle,
        latestClass: null,
        sourceResource: null,
        usedFallback: false,
        canRun: true,
        reason: null,
        summaryTitle: cron.title,
        summaryPoints: [cron.prompt],
        reviewQuestions: [],
        nextActions: ["Cron output is stored in the global cron run history."],
        preparedContext,
        output: preparedContext,
      };
    }

    if (!sourceResource) {
      const relatedItems = education.courseItems
        .filter((item) => courseIds.includes(item.courseId) && !item.isHidden)
        .slice()
        .sort((left, right) => String(right.dueAt || right.endAt || right.startAt || "").localeCompare(String(left.dueAt || left.endAt || left.startAt || "")))
        .slice(0, 6)
        .map((item) => `- ${item.type}: ${item.title}${item.dueAt ? ` (due ${item.dueAt})` : ""}`);
      const reason = syncNotes.length
        ? "No local subtitle, notes, or slide file was available after an automatic course-resource sync."
        : "No local subtitle, notes, or slide file is available for this course yet.";
      const preparedContext = [
        courseTitle ? `Course context: ${courseTitle}` : "",
        latestClass ? `Most recent finished class: ${latestClass.title}` : "",
        syncNotes.length ? formatCronContextBlock("Resource sync attempts", syncNotes) : "",
        relatedItems.length ? `Recent course items:\n${relatedItems.join("\n")}` : "Recent course items: none available yet.",
      ].filter(Boolean).join("\n\n");
      return {
        cron,
        courseIds,
        projectId: cron.projectId ?? null,
        courseTitle,
        latestClass: latestClass
          ? {
              itemId: latestClass.id,
              title: latestClass.title,
              startAt: latestClass.startAt,
              endAt: latestClass.endAt,
            }
          : null,
        sourceResource: null,
        usedFallback: true,
        canRun: Boolean(relatedItems.length),
        reason,
        summaryTitle: `${courseTitle || "课程"} · 课后复盘`,
        summaryPoints: relatedItems.length ? relatedItems : [reason],
        reviewQuestions: [],
        nextActions: [
          ...(syncNotes.length ? syncNotes : []),
          "Cron output is stored in the global cron run history.",
        ],
        preparedContext,
        output: preparedContext,
      };
    }

    const index = sourceResource.localPath ? await this.resourceIndexer.ensureIndexed(sourceResource) : null;
    const segments = (index?.segments ?? [])
      .map((segment) => segment.text)
      .map((text) => summarizeTextPoint(text))
      .filter(Boolean);
    const summaryPoints = uniq(segments).slice(0, 3);
    const usedFallback = sourceResource.resourceType !== "subtitle";
    const nextActions = latestClass
      ? [
          "今晚先不看资料，回忆 3 个重点，再和总结对照。",
          "明天晚上做 3 个自测问题，不先看答案。",
          "第 3 天把今天的重点和作业/上一讲连起来。",
        ]
      : [
          "先把今天最容易混淆的概念写下来。",
          "明晚做一次闭卷回忆。",
          "第 3 天再做一次短测。",
        ];
    const preparedContext = [
      courseTitle ? `Course context: ${courseTitle}` : "",
      latestClass ? `Most recent finished class: ${latestClass.title}` : "",
      `Prepared resource: ${sourceResource.title} (${sourceResource.resourceType})`,
      summaryPoints.length ? formatCronContextBlock("Prepared study notes", summaryPoints) : "",
      syncNotes.length ? formatCronContextBlock("Resource sync attempts", syncNotes) : "",
    ].filter(Boolean).join("\n\n");

    return {
      cron,
      courseIds,
      projectId: cron.projectId ?? null,
      courseTitle,
      latestClass: latestClass
        ? {
            itemId: latestClass.id,
            title: latestClass.title,
            startAt: latestClass.startAt,
            endAt: latestClass.endAt,
          }
        : null,
      sourceResource: {
        resourceId: sourceResource.id,
        title: sourceResource.title,
        resourceType: sourceResource.resourceType,
        localPath: sourceResource.localPath,
      },
      usedFallback,
      canRun: Boolean(summaryPoints.length),
      reason: summaryPoints.length ? null : "A resource exists, but it did not yield readable segments yet.",
      summaryTitle: `${courseTitle || "课程"} · 当晚复盘`,
      summaryPoints,
      reviewQuestions: reviewQuestionsFromPoints(courseTitle, summaryPoints),
      nextActions,
      preparedContext,
      output: [
        preparedContext,
        nextActions.length ? formatCronContextBlock("Suggested next actions", nextActions) : "",
      ].filter(Boolean).join("\n\n"),
    };
  }

  async runCronNow(cronId: string): Promise<CronRunPreview> {
    const triggeredAt = nowIso();
    try {
      const preview = await this.runCron(cronId);
      const userMessage = preview.cron.prompt.trim();
      const assistantReply = await this.runCronConversationTurn(
        preview.cron,
        userMessage,
        preview.preparedContext || preview.output,
      );
      const record: CronRunRecord = {
        id: `${preview.cron.cronId}-${Date.now().toString(36)}`,
        cronId: preview.cron.cronId,
        kind: "manual_run",
        triggeredAt,
        scheduledFor: triggeredAt,
        courseItemId: preview.latestClass?.itemId ?? null,
        projectId: preview.projectId,
        courseIds: preview.courseIds,
        status: preview.canRun ? "completed" : "skipped",
        reason: preview.reason,
        summaryTitle: preview.summaryTitle,
        summaryPoints: preview.summaryPoints,
        reviewQuestions: preview.reviewQuestions,
        nextActions: preview.nextActions,
        userMessage,
        assistantReply,
        scheduleExplanation: explainCronSchedule(preview.cron),
        output: assistantReply,
      };
      await this.repo.appendCronRun(record);
      return preview;
    } catch (error) {
      const cron = await this.repo.readCronDefinition(cronId);
      await this.repo.appendCronRun({
        id: `${cron.cronId}-${Date.now().toString(36)}`,
        cronId: cron.cronId,
        kind: "manual_run",
        triggeredAt,
        scheduledFor: triggeredAt,
        courseItemId: null,
        projectId: cron.projectId ?? null,
        courseIds: cron.courseIds ?? [],
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
        userMessage: cron.prompt.trim(),
        assistantReply: null,
        scheduleExplanation: explainCronSchedule(cron),
        output: null,
      });
      throw error;
    }
  }

  async sendCronMessage(request: CronMessageRequest): Promise<DebugDashboardSnapshot> {
    const cron = await this.repo.readCronDefinition(request.cronId.trim());
    const message = request.message.trim();
    if (!message) {
      throw new Error("Message is required.");
    }
    const triggeredAt = nowIso();
    try {
      const assistantReply = await this.runCronConversationTurn(cron, message);
      await this.repo.appendCronRun({
        id: `${cron.cronId}-${Date.now().toString(36)}`,
        cronId: cron.cronId,
        kind: "follow_up",
        triggeredAt,
        scheduledFor: triggeredAt,
        courseItemId: null,
        projectId: cron.projectId ?? null,
        courseIds: cron.courseIds ?? [],
        status: "completed",
        userMessage: message,
        assistantReply,
        scheduleExplanation: explainCronSchedule(cron),
        summaryTitle: "Follow-up",
        output: assistantReply,
      });
    } catch (error) {
      await this.repo.appendCronRun({
        id: `${cron.cronId}-${Date.now().toString(36)}`,
        cronId: cron.cronId,
        kind: "follow_up",
        triggeredAt,
        scheduledFor: triggeredAt,
        courseItemId: null,
        projectId: cron.projectId ?? null,
        courseIds: cron.courseIds ?? [],
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
        userMessage: message,
        assistantReply: null,
        scheduleExplanation: explainCronSchedule(cron),
        output: null,
      });
      throw error;
    }
    return this.getSnapshot();
  }

  async executeDueCrons(now: Date = new Date()): Promise<CronExecutionSummary> {
    const checkedAt = now.toISOString();
    const [cronIds, education, runState] = await Promise.all([
      this.repo.listCronIds(),
      this.educationRepo.readSnapshot(),
      this.repo.readCronRunState(),
    ]);
    const rawCrons = await Promise.all(cronIds.map((cronId) => this.repo.readCronDefinition(cronId)));
    const crons = await Promise.all(
      rawCrons.map(async (cron) => {
        const project = cron.projectId ? await this.repo.readProjectState(cron.projectId).catch(() => null) : null;
        return {
          ...cron,
          courseIds: dedupeTrimmed([...(cron.courseIds ?? []), ...(project?.scope.courseIds ?? [])]),
        };
      }),
    );
    const triggers = dueCronTriggers(crons, education.courseItems, runState, now);
    const summary: CronExecutionSummary = {
      checkedAt,
      dueCount: triggers.length,
      completed: 0,
      skipped: 0,
      failed: 0,
    };

    for (const trigger of triggers) {
      try {
        const preview = await this.runCron(trigger.cron.cronId);
        const status: CronRunRecord["status"] = preview.canRun ? "completed" : "skipped";
        const userMessage = preview.cron.prompt.trim();
        const assistantReply = await this.runCronConversationTurn(
          preview.cron,
          userMessage,
          preview.preparedContext || preview.output,
        );
        const record: CronRunRecord = {
          id: `${trigger.cron.cronId}-${Date.now().toString(36)}`,
          cronId: trigger.cron.cronId,
          kind: "scheduled_run",
          triggeredAt: checkedAt,
          scheduledFor: trigger.scheduledFor,
          courseItemId: trigger.courseItem?.id ?? null,
          projectId: preview.projectId,
          courseIds: preview.courseIds,
          status,
          reason: preview.reason,
          summaryTitle: preview.summaryTitle,
          summaryPoints: preview.summaryPoints,
          reviewQuestions: preview.reviewQuestions,
          nextActions: preview.nextActions,
          userMessage,
          assistantReply,
          scheduleExplanation: explainCronSchedule(preview.cron),
          output: assistantReply ?? preview.output,
        };
        await this.repo.appendCronRun(record);
        if (preview.projectId) {
          await this.repo.appendProjectEvent(preview.projectId, {
            ts: checkedAt,
            level: "project",
            type: status === "completed" ? "cron_triggered" : "cron_skipped",
            projectId: preview.projectId,
            planId: preview.projectId,
            evidence: [trigger.cron.title, trigger.courseItem?.title ?? "Standalone cron"],
            impact: status === "completed" ? `Cron executed: ${preview.summaryTitle}.` : `Cron skipped: ${preview.reason || "no runnable content"}.`,
            promotion: "project",
            metadata: {
              cronId: trigger.cron.cronId,
              courseItemId: trigger.courseItem?.id ?? null,
              scheduledFor: trigger.scheduledFor,
              runRecordId: record.id,
            },
          });
        }
        runState[trigger.stateKey] = checkedAt;
        summary[status === "completed" ? "completed" : "skipped"] += 1;
      } catch (error) {
        const record: CronRunRecord = {
          id: `${trigger.cron.cronId}-${Date.now().toString(36)}`,
          cronId: trigger.cron.cronId,
          kind: "scheduled_run",
          triggeredAt: checkedAt,
          scheduledFor: trigger.scheduledFor,
          courseItemId: trigger.courseItem?.id ?? null,
          projectId: trigger.cron.projectId ?? null,
          courseIds: trigger.cron.courseIds ?? [],
          status: "failed",
          reason: error instanceof Error ? error.message : String(error),
          userMessage: trigger.cron.prompt.trim(),
          assistantReply: null,
          scheduleExplanation: explainCronSchedule(trigger.cron),
        };
        await this.repo.appendCronRun(record);
        runState[trigger.stateKey] = checkedAt;
        summary.failed += 1;
      }
    }

    if (triggers.length) await this.repo.writeCronRunState(runState);
    return summary;
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
    const project = await this.repo.readProjectState(plan.planId).catch(() => null);
    const thread = await this.repo.createThread(
      {
        planId: plan.planId,
        title,
        currentQuestion: request.currentQuestion?.trim() || null,
      },
      now,
    );

    if (project) {
      project.updatedAt = now;
      project.summary = `${project.summary}\nThread created via debug UI: ${thread.title}`.trim();
      await this.repo.writeProjectState(project);
    } else {
      plan.updatedAt = now;
      plan.summary = `${plan.summary}\nThread created via debug UI: ${thread.title}`.trim();
      await this.repo.writePlanState(plan);
    }

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
    const rawSessionKey = request.sessionKey.trim();
    if (!rawSessionKey) {
      throw new Error("Session key is required.");
    }
    const session = this.turnBridge
      ? await this.turnBridge.resolveSessionHandle(this.runtimeRoot, rawSessionKey)
      : { sessionKey: rawSessionKey };
    const planId = request.planId ?? request.projectId;
    if (!planId) {
      throw new Error("Project is required.");
    }
    const thread = await this.ensureThread(planId, request.threadId);
    await this.bindingStore.set({
      sessionKey: session.sessionKey,
      projectId: thread.planId,
      planId: thread.planId,
      threadId: thread.threadId,
      updatedAt: nowIso(),
      lastWorkflow: "manual-bind",
    });
    if (session.sessionKey !== rawSessionKey) {
      await this.bindingStore.remove(rawSessionKey);
    }
    return this.getSnapshot();
  }

  async unbindSession(sessionKey: string): Promise<DebugDashboardSnapshot> {
    await this.bindingStore.remove(sessionKey);
    return this.getSnapshot();
  }

  async handleUserTurn(request: HandleTurnRequest): Promise<DebugTurnResponse> {
    const rawSessionKey = request.sessionKey.trim() || browserSessionKey("browser");
    const message = request.message.trim();
    if (!message) {
      throw new Error("Message is required.");
    }

    const session = this.turnBridge
      ? await this.turnBridge.resolveSessionHandle(this.runtimeRoot, rawSessionKey)
      : { sessionKey: rawSessionKey };
    const sessionKey = session.sessionKey;
    const bound = await this.bindingStore.get(sessionKey);
    const requestedPlanId = request.planId ?? request.projectId;
    const planId = requestedPlanId ?? bound?.planId ?? bound?.projectId;
    const threadId =
      request.threadId ?? (requestedPlanId && bound?.planId !== requestedPlanId ? undefined : bound?.threadId);
    let prebound: mentorclawSessionBinding | null = null;
    if (planId) {
      const thread = await this.ensureThread(planId, threadId);
      prebound = {
        sessionKey,
        projectId: thread.planId,
        planId: thread.planId,
        threadId: thread.threadId,
        updatedAt: nowIso(),
        lastWorkflow: "pending-turn",
        pendingSignals: request.forceWorkflow ? { forceWorkflow: request.forceWorkflow } : undefined,
      };
      await this.bindingStore.set(prebound);
      if (sessionKey !== rawSessionKey) {
        await this.bindingStore.remove(rawSessionKey);
      }
    } else if (requestedPlanId && request.threadId) {
      await this.ensureThread(requestedPlanId, request.threadId);
    }

    if (this.turnBridge) {
      const liveTurn = await this.turnBridge.runTurn({
        runtimeRoot: this.runtimeRoot,
        sessionRef: sessionKey,
        message,
      });
      const liveBinding = await this.bindingStore.get(liveTurn.sessionKey);
      const projectId = liveBinding?.projectId ?? prebound?.projectId;
      if (!projectId) {
        throw new Error("OpenClaw turn completed, but MentorClaw still could not resolve a project binding for the session.");
      }
      const binding: mentorclawSessionBinding = {
        sessionKey: liveTurn.sessionKey,
        projectId,
        planId: liveBinding?.planId ?? prebound?.planId ?? projectId,
        threadId: prebound?.threadId ?? liveBinding?.threadId,
        updatedAt: nowIso(),
        lastWorkflow: liveBinding?.lastWorkflow ?? prebound?.lastWorkflow ?? "openclaw",
      };
      await this.bindingStore.set(binding);
      await recordAgentEnd(this.repo, binding, {
        success: true,
        messages: [
          {
            role: "assistant",
            content: liveTurn.assistantReply,
          },
        ],
        durationMs: liveTurn.durationMs ?? undefined,
      });

      return {
        binding,
        outcome: null,
        assistantReply: liveTurn.assistantReply,
        assistantReplySource: "openclaw",
        liveTurn,
        promptContext: "",
        systemAppend: mentorclaw_STATIC_SYSTEM_APPEND,
        snapshot: await this.getSnapshot(),
      };
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
      projectId: outcome.plan.planId,
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
      assistantReplySource: "local",
      liveTurn: null,
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

  private async readEvents(filePath: string, limit: number = 20): Promise<LearningEvent[]> {
    try {
      const raw = await readFile(filePath, "utf8");
      return parseJsonl<LearningEvent>(raw).slice(-limit).reverse();
    } catch {
      return [];
    }
  }

  private async readPlanEvents(planId: string, limit: number = 20): Promise<LearningEvent[]> {
    const [projectEvents, legacyEvents] = await Promise.all([
      this.readEvents(path.join(this.repo.projectsDir, `${planId}.events.jsonl`), limit),
      this.readEvents(path.join(this.repo.plansDir, planId, "EVENTS.jsonl"), limit),
    ]);
    const seen = new Set<string>();
    return [...projectEvents, ...legacyEvents]
      .filter((event) => {
        const key = `${event.type}:${event.ts}:${event.impact}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((left, right) => right.ts.localeCompare(left.ts))
      .slice(0, limit);
  }

  private async recordCronConversation(
    cron: CronDefinition,
    options: {
      kind: NonNullable<CronRunRecord["kind"]>;
      userMessage: string;
      scheduledFor: string;
    },
  ): Promise<void> {
    const triggeredAt = nowIso();
    const scheduleExplanation = await this.explainCronScheduleForUser(cron);
    const assistantReply = [
      options.kind === "created" ? "Cron 已创建。" : "Cron 已更新。",
      "",
      scheduleExplanation,
      "",
      `我会执行的动作：${cron.prompt}`,
      "",
      "每次运行后，结果会写入 workspace/crons/runs.jsonl，并显示在这个 Cron 的对话记录里。你可以直接在这里继续追问某次运行结果。",
    ].join("\n");
    await this.repo.appendCronRun({
      id: `${cron.cronId}-${Date.now().toString(36)}`,
      cronId: cron.cronId,
      kind: options.kind,
      triggeredAt,
      scheduledFor: options.scheduledFor,
      courseItemId: null,
      projectId: cron.projectId ?? null,
      courseIds: cron.courseIds ?? [],
      status: "completed",
      userMessage: options.userMessage,
      assistantReply,
      scheduleExplanation,
      summaryTitle: options.kind === "created" ? "Cron created" : "Cron updated",
      output: assistantReply,
    });
  }

  private async runCronConversationTurn(
    cron: CronDefinition,
    message: string,
    preparedContext?: string | null,
  ): Promise<string> {
    const prompt = [
      "You are MentorClaw handling a standalone Cron automation conversation.",
      "Important: the local MentorClaw backend has already created, updated, or triggered the Cron.",
      "The scheduler has already decided when to run, so do not discuss schedule text unless the user explicitly asks.",
      "Do not create another external gateway task. Your job is to execute or explain the automation using the instruction and local runtime context below.",
      "",
      `Automation instruction:\n${cron.prompt}`,
      preparedContext?.trim() ? `Prepared runtime context:\n${preparedContext.trim()}` : "",
      `Conversation message:\n${message}`,
    ].filter(Boolean).join("\n\n");

    if (this.turnBridge) {
      try {
        const result = await this.turnBridge.runTurn({
          runtimeRoot: this.runtimeRoot,
          sessionRef: cronConversationSessionRef(cron.cronId),
          message: prompt,
        });
        if (result.assistantReply?.trim()) return result.assistantReply.trim();
      } catch (error) {
        if (!preparedContext) throw error;
      }
    }

    return [
      preparedContext || "No prepared runtime context is available yet.",
      "",
      `I will run: ${cron.prompt}`,
      "Outputs are stored under workspace/crons/runs.jsonl and shown in this Cron conversation.",
    ].join("\n").trim();
  }

  private pickCronSourceResource(education: EducationSnapshot, courseIds: string[]): CourseResourceRecord | null {
    return education.courseResources
      .filter((resource) => courseIds.includes(resource.courseId))
      .filter((resource) => cronResourcePriority(resource.resourceType) > 0)
      .filter((resource) => Boolean(resource.localPath?.trim()))
      .sort((left, right) => {
        const priorityDiff = cronResourcePriority(right.resourceType) - cronResourcePriority(left.resourceType);
        if (priorityDiff !== 0) return priorityDiff;
        const leftTs = String(left.metaJson.addedAt ?? left.lastSyncedAt ?? "");
        const rightTs = String(right.metaJson.addedAt ?? right.lastSyncedAt ?? "");
        return rightTs.localeCompare(leftTs);
      })[0] ?? null;
  }

  private async hydrateCronResourcesForRun(
    education: EducationSnapshot,
    courseIds: string[],
  ): Promise<{ education: EducationSnapshot; notes: string[] }> {
    const notes: string[] = [];
    for (const courseId of uniq(courseIds)) {
      const courseTitle = education.courses.find((course) => course.id === courseId)?.title || courseId;
      try {
        await this.syncBuaaCourseResources(courseId);
        notes.push(`I automatically synced course resources for ${courseTitle}.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        notes.push(`I tried to sync course resources for ${courseTitle}, but ${message}`);
      }
    }
    return {
      education: await this.educationRepo.readSnapshot(),
      notes,
    };
  }

  private async explainCronScheduleForUser(cron: CronDefinition): Promise<string> {
    const education = await this.educationRepo.readSnapshot().catch(() => null);
    const courseMap = new Map((education?.courses || []).map((course) => [course.id, course.title || course.id]));
    const courseLabels = cron.courseIds?.length
      ? cron.courseIds.map((courseId) => courseMap.get(courseId) || courseId).join(", ")
      : "";
    const rule = cron.scheduleRule;
    const time = rule?.timeOfDay || "manual";
    if (rule?.kind === "after_course_class") {
      const dayText = rule.offsetDays === 1 ? "下一天" : "当天";
      return `我把 schedule 理解为：每次${courseLabels || "所选课程"}上课后，在${dayText} ${time}（${rule.timezone || "Asia/Shanghai"}）触发。`;
    }
    if (rule?.kind === "daily_time") {
      return `我把 schedule 理解为：每天 ${time}（${rule.timezone || "Asia/Shanghai"}）触发一次，不依附于任何 Project。${courseLabels ? `课程上下文是：${courseLabels}。` : ""}`;
    }
    return "我把 schedule 理解为：不自动触发，只在你点击 Run 时手动执行。";
  }

  private async ensureThread(planId: string, threadId?: string): Promise<ThreadState> {
    const resolvedThreadId = threadId || (await this.repo.readPlanState(planId)).threadIds[0];
    const thread = resolvedThreadId
      ? await this.repo.readThreadState(planId, resolvedThreadId)
      : await this.repo.createThread(
          {
            planId,
            title: "Browser session",
            currentQuestion: null,
          },
          nowIso(),
        );
    if (thread.planId !== planId) {
      throw new Error(`Thread ${thread.threadId} does not belong to plan ${planId}.`);
    }
    return thread;
  }

  private runtimeLocalFiles(): DebugLocalFileRef[] {
    return [
      this.makeFileRef(
        path.join(this.repo.paths.workspaceRoot, "SOUL.md"),
        "Soul",
        "runtime",
        "MentorClaw's stable identity, values, and interaction posture.",
      ),
      this.makeFileRef(
        path.join(this.repo.paths.workspaceRoot, "AGENTS.md"),
        "Agent Instructions",
        "runtime",
        "Runtime instructions loaded by MentorClaw and OpenClaw.",
      ),
      this.makeFileRef(
        path.join(this.repo.paths.workspaceRoot, "HEARTBEAT.md"),
        "Heartbeat",
        "runtime",
        "Follow-up and continuity rules for proactive MentorClaw behavior.",
      ),
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
      this.makeFileRef(
        path.join(this.repo.paths.workspaceRoot, "state", "education", "courses.json"),
        "Courses",
        "runtime",
        "Imported course catalog for schedule and bindings.",
      ),
      this.makeFileRef(
        path.join(this.repo.paths.workspaceRoot, "state", "education", "course-items.json"),
        "Course Items",
        "runtime",
        "Classes, assignments, replays, and notices.",
      ),
      this.makeFileRef(
        path.join(this.repo.paths.workspaceRoot, "state", "education", "course-resources.json"),
        "Course Resources",
        "runtime",
        "Subtitles, PPTs, notes, PDFs, and links bound to courses.",
      ),
      this.makeFileRef(
        path.join(this.repo.paths.workspaceRoot, "state", "education", "schedule-preferences.json"),
        "Schedule Preferences",
        "runtime",
        "Week/month view and timetable visibility preferences.",
      ),
      this.makeFileRef(
        path.join(this.repo.paths.workspaceRoot, "crons", "README.md"),
        "Cron Directory",
        "runtime",
        "Scheduled course-support tasks live in this directory.",
      ),
    ];
  }

  private runtimeConfigFileTarget(id: DebugRuntimeConfigFile["id"]): Omit<DebugRuntimeConfigFile, "content" | "exists"> {
    const targets: Record<DebugRuntimeConfigFile["id"], { label: string; fileName: string }> = {
      soul: { label: "soul.md", fileName: "SOUL.md" },
      agents: { label: "agent.md", fileName: "AGENTS.md" },
      heartbeat: { label: "heartbeat.md", fileName: "HEARTBEAT.md" },
    };
    const target = targets[id];
    if (!target) {
      throw new Error("Unknown MentorClaw config file.");
    }
    const absolutePath = path.join(this.repo.paths.workspaceRoot, target.fileName);
    return {
      id,
      label: target.label,
      absolutePath,
      relativePath: path.relative(this.runtimeRoot, absolutePath) || target.fileName,
    };
  }

  private async runtimeConfigFiles(): Promise<DebugRuntimeConfigFile[]> {
    return Promise.all(
      (["soul", "agents", "heartbeat"] as const).map(async (id) => {
        const target = this.runtimeConfigFileTarget(id);
        try {
          return {
            ...target,
            content: await readFile(target.absolutePath, "utf8"),
            exists: true,
          };
        } catch {
          return {
            ...target,
            content: "",
            exists: false,
          };
        }
      }),
    );
  }

  private planLocalFiles(planId: string): DebugLocalFileRef[] {
    return [
      this.makeFileRef(
        path.join(this.repo.projectsDir, `${planId}.yaml`),
        "Project State",
        "plan",
        "Project-centric state bound to courses, tasks, and preferred resources.",
      ),
      this.makeFileRef(
        path.join(this.repo.projectsDir, `${planId}.events.jsonl`),
        "Project Events",
        "plan",
        "Project event log written by the kernel and debug UI.",
      ),
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
