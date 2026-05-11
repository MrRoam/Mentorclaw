export type WorkflowType = "planning" | "tutoring" | "review";

export type ProjectStatus = "draft" | "active" | "paused" | "completed" | "archived";
export type PlanStatus = "draft" | "active" | "paused" | "completed" | "dropped";
export type ThreadStatus = "active" | "archived" | "closed";
export type TaskStatus = "todo" | "in_progress" | "done" | "blocked";
export type MasteryState = "unknown" | "fragile" | "working" | "stable";
export type EvidenceType =
  | "recognition"
  | "reproduction"
  | "application"
  | "transfer"
  | "retention";
export type PromotionTarget = "none" | "project" | "plan" | "learner" | "memory" | "thread";

export interface RuntimePaths {
  runtimeRoot: string;
  workspaceRoot: string;
}

export interface LearnerState {
  version: number;
  updated_at: string | null;
  language: string;
  timezone: string;
  active_plan_count: number;
  active_plan_ids: string[];
  current_focus: string | null;
  risk_flags: string[];
  capability_signals: string[];
}

export interface LearnerSummary {
  profile: string;
  preferences: string;
  globalGoals: string;
  misconceptions: string[];
  state: LearnerState;
  memory: string;
}

export interface GlobalMemory {
  version: number;
  updatedAt: string | null;
  content: string;
}

export interface MasteryRecord {
  topic: string;
  state: MasteryState;
  evidence: EvidenceType[];
  updatedAt: string | null;
}

export interface Milestone {
  id: string;
  title: string;
  dueAt: string | null;
  successCriteria: string[];
  status: "pending" | "active" | "done";
}

export interface TaskItem {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: "low" | "medium" | "high";
  dueAt: string | null;
  acceptanceCriteria: string[];
  dependencies: string[];
  evidenceRequired: EvidenceType[];
  tags: string[];
}

export interface ResourceRef {
  id: string;
  title: string;
  kind: "document" | "video" | "question_bank" | "web" | "user_upload" | "rubric" | "other";
  sourceType: string;
  uri: string;
  binding: "learner" | "plan" | "project" | "thread" | "curriculum";
  bindingId?: string;
  trustScore: number;
  relevanceScore: number;
  rights: "unknown" | "link_only" | "quote_only" | "cache_allowed";
}

export interface ProjectScope {
  type: "course" | "general";
  courseIds: string[];
}

export interface ProjectGoal {
  summary: string;
  targetOutcome: string[];
  constraints: string[];
  successDefinition: string[];
}

export interface ProjectExecution {
  mode: WorkflowType;
  nextAction: string | null;
  tasks: TaskItem[];
  milestones: Milestone[];
}

export interface ProjectMemory {
  misconceptions: string[];
  durableNotes: string[];
}

export interface ProjectResources {
  pinnedResourceIds: string[];
  preferredTypes: string[];
  notes: string[];
}

export interface ProjectState {
  projectId: string;
  title: string;
  status: ProjectStatus;
  createdAt: string | null;
  updatedAt: string | null;
  scope: ProjectScope;
  goal: ProjectGoal;
  execution: ProjectExecution;
  memory: ProjectMemory;
  resources: ProjectResources;
  summary: string;
}

export interface CronScheduleRule {
  kind: "manual" | "after_course_class" | "daily_time";
  timeOfDay?: string;
  timezone?: string;
  offsetDays?: number;
  source?: "course_schedule";
}

export interface CronDefinition {
  cronId: string;
  title: string;
  enabled: boolean;
  schedule: string;
  scheduleRule?: CronScheduleRule;
  projectId?: string | null;
  courseIds?: string[];
  prompt: string;
  updatedAt: string | null;
}

export interface CronCreationInput {
  title: string;
  schedule: string;
  scheduleRule?: CronScheduleRule;
  prompt: string;
  enabled?: boolean;
  projectId?: string | null;
  courseIds?: string[];
}

export interface CronRunRecord {
  id: string;
  cronId: string;
  kind?: "created" | "updated" | "manual_run" | "scheduled_run" | "follow_up";
  triggeredAt: string;
  scheduledFor: string;
  courseItemId?: string | null;
  projectId?: string | null;
  courseIds: string[];
  status: "completed" | "skipped" | "failed";
  reason?: string | null;
  userMessage?: string | null;
  assistantReply?: string | null;
  scheduleExplanation?: string | null;
  summaryTitle?: string | null;
  summaryPoints?: string[];
  reviewQuestions?: string[];
  nextActions?: string[];
  output?: string | null;
}

// Legacy compatibility type kept so old modules can keep compiling while
// the runtime moves to project-centric state.
export interface PlanState {
  planId: string;
  title: string;
  status: PlanStatus;
  createdAt: string | null;
  updatedAt: string | null;
  timebox: string;
  curriculumRefs: string[];
  targetOutcome: string[];
  constraints: string[];
  successDefinition: string[];
  goals: string[];
  currentPhase: string | null;
  focusTopics: string[];
  masterySnapshot: MasteryRecord[];
  nextCheckpoint: string | null;
  tasks: TaskItem[];
  milestones: Milestone[];
  misconceptions: string[];
  resources: ResourceRef[];
  summary: string;
  rubricRefs: string[];
  threadIds: string[];
}

export interface ThreadState {
  threadId: string;
  planId: string;
  title: string;
  status: ThreadStatus;
  createdAt: string;
  updatedAt: string;
  summary: string;
  currentQuestion: string | null;
  workingMemory: string[];
  blockers: string[];
  recentEvidence: string[];
}

export interface LearningEvent {
  ts: string;
  level: "thread" | "plan" | "project" | "learner" | "memory";
  type: string;
  planId?: string;
  projectId?: string;
  threadId?: string;
  topic?: string;
  evidence: string[];
  impact: string;
  promotion: PromotionTarget;
  metadata?: Record<string, unknown>;
}

export interface AssessmentResult {
  topic: string;
  mastery: MasteryState;
  confidence: number;
  evidenceTypes: EvidenceType[];
  rationale: string;
  nextAction: "continue" | "reinforce" | "test_again" | "rollback" | "replan";
}

export interface TurnInput {
  message: string;
  now?: string;
  projectId?: string | null;
  planId?: string | null;
  threadId?: string | null;
  attachments?: ResourceRef[];
  courseIds?: string[];
  signals?: {
    submittedWork?: boolean;
    requestReview?: boolean;
    forceWorkflow?: WorkflowType;
  };
}

export interface WorkflowDecision {
  primary: WorkflowType;
  secondary?: WorkflowType;
  reasons: string[];
  shouldCreateProject: boolean;
  shouldCreatePlan: boolean;
  shouldCreateThread: boolean;
}

export interface ContextPacket {
  bootstrap: {
    agents: string;
    soul: string;
    tools: string;
  };
  memorySummary: string[];
  projectSummary: string[];
  resourceSummary: string[];
  locatorSummary: string[];
  locators: ResourceLocatorMatch[];
  readSet: string[];
}

export interface ProactiveAction {
  kind: "remind_due_task" | "prompt_review" | "suggest_replan";
  reason: string;
  projectId?: string;
  planId?: string;
  taskId?: string;
}

export interface TurnOutcome {
  decision: WorkflowDecision;
  context: ContextPacket;
  learner: LearnerSummary;
  project?: ProjectState;
  plan?: PlanState;
  proactiveActions: ProactiveAction[];
  events: LearningEvent[];
}

export interface TimestampLocator {
  kind: "timestamp";
  startSec: number;
  endSec: number;
}

export interface PageLocator {
  kind: "page";
  page: number;
}

export type ResourceLocator = TimestampLocator | PageLocator;

export interface ResourceLocatorMatch {
  resourceId: string;
  resourceType: string;
  title: string;
  courseId: string;
  linkedItemId: string | null;
  locator: ResourceLocator;
  snippet: string;
  score: number;
  localPath: string | null;
  url: string;
}

export interface ProjectCreationInput {
  title: string;
  summary: string;
  targetOutcome: string[];
  constraints: string[];
  successDefinition: string[];
  goals: string[];
  courseIds?: string[];
}

export interface PlanCreationInput {
  title: string;
  targetOutcome: string[];
  constraints: string[];
  successDefinition: string[];
  timebox: string;
  goals: string[];
  focusTopics?: string[];
}

export interface ThreadCreationInput {
  planId: string;
  title: string;
  currentQuestion?: string | null;
}

export interface RuntimeValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
