export type WorkflowType =
  | "planning"
  | "tutoring"
  | "evaluation"
  | "review"
  | "replanning";

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
export type PromotionTarget = "none" | "thread" | "plan" | "learner";

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
  binding: "learner" | "plan" | "thread" | "curriculum";
  bindingId?: string;
  trustScore: number;
  relevanceScore: number;
  rights: "unknown" | "link_only" | "quote_only" | "cache_allowed";
}

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
  level: "thread" | "plan" | "learner";
  type: string;
  planId?: string;
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
  planId?: string | null;
  threadId?: string | null;
  attachments?: ResourceRef[];
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
  shouldCreatePlan: boolean;
  shouldCreateThread: boolean;
}

export interface ContextPacket {
  bootstrap: {
    agents: string;
    soul: string;
    tools: string;
  };
  learnerSummary: string[];
  planSummary: string[];
  threadSummary: string[];
  resourceSummary: string[];
  readSet: string[];
}

export interface ProactiveAction {
  kind: "remind_due_task" | "prompt_review" | "suggest_replan" | "trigger_assessment";
  reason: string;
  planId?: string;
  taskId?: string;
}

export interface TurnOutcome {
  decision: WorkflowDecision;
  context: ContextPacket;
  learner: LearnerSummary;
  plan?: PlanState;
  thread?: ThreadState;
  proactiveActions: ProactiveAction[];
  events: LearningEvent[];
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
