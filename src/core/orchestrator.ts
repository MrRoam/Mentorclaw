import type { LearningEvent, PlanCreationInput, TurnInput, TurnOutcome } from "../schemas/models.ts";
import { WorkspaceRepo } from "../storage/workspace-repo.ts";
import { nowIso } from "../utils/time.ts";
import { ContextBuilder } from "./context-builder.ts";
import { MemoryUpdater } from "./memory-updater.ts";
import { PlanManager } from "./plan-manager.ts";
import { TaskEngine } from "./task-engine.ts";
import { ThreadManager } from "./thread-manager.ts";
import { WorkflowRouter } from "./workflow-router.ts";

const derivePlanInput = (message: string): PlanCreationInput => ({
  title: message.slice(0, 48) || "new-plan",
  targetOutcome: [message],
  constraints: ["Need learner confirmation for exact scope."],
  successDefinition: ["Learner can state the target and show evidence through tasks or assessment."],
  timebox: "to-be-confirmed",
  goals: [
    "Clarify the learning target and deadline",
    "Map current ability and blockers",
    "Generate an executable task queue",
  ],
  focusTopics: [],
});

export class EduclawOrchestrator {
  private readonly repo: WorkspaceRepo;
  private readonly taskEngine: TaskEngine;
  private readonly workflowRouter: WorkflowRouter;
  private readonly contextBuilder: ContextBuilder;
  private readonly memoryUpdater: MemoryUpdater;
  private readonly planManager: PlanManager;
  private readonly threadManager: ThreadManager;

  constructor(repo: WorkspaceRepo) {
    this.repo = repo;
    this.taskEngine = new TaskEngine();
    this.workflowRouter = new WorkflowRouter();
    this.contextBuilder = new ContextBuilder(repo);
    this.memoryUpdater = new MemoryUpdater(repo);
    this.planManager = new PlanManager(repo, this.taskEngine);
    this.threadManager = new ThreadManager(repo);
  }

  async handleTurn(input: TurnInput): Promise<TurnOutcome> {
    const now = input.now ?? nowIso();
    const learner = await this.repo.readLearnerSummary();
    const index = await this.repo.readPlansIndex();
    let plan =
      input.planId ? await this.repo.readPlanState(input.planId) : index.active_plan_id ? await this.repo.readPlanState(index.active_plan_id) : undefined;
    let thread = input.threadId && plan ? await this.repo.readThreadState(plan.planId, input.threadId) : undefined;

    const decision = this.workflowRouter.decide(input, learner, plan, thread);

    if (decision.shouldCreatePlan) {
      plan = await this.planManager.createPlan(derivePlanInput(input.message), now);
      learner.state.active_plan_ids = Array.from(new Set([...learner.state.active_plan_ids, plan.planId]));
      learner.state.active_plan_count = learner.state.active_plan_ids.length;
      learner.state.current_focus = plan.title;
      await this.repo.writeLearnerState(learner.state);
    }

    if (decision.shouldCreateThread && plan) {
      thread = await this.threadManager.createThread(
        {
          planId: plan.planId,
          title: `${decision.primary}-thread`,
          currentQuestion: input.message,
        },
        now,
      );
      plan.threadIds = Array.from(new Set([...plan.threadIds, thread.threadId]));
      await this.repo.writePlanState(plan);
    }

    if (plan) {
      plan.tasks = this.taskEngine.rebalanceTasks(plan, now);
      await this.repo.writePlanState(plan);
    }

    const context = await this.contextBuilder.build(learner, plan, thread, input.attachments);
    const proactiveActions = plan ? this.taskEngine.computeProactiveActions(plan, now) : [];

    const events: LearningEvent[] = [
      {
        ts: now,
        level: thread ? "thread" : plan ? "plan" : "learner",
        type: "turn_processed",
        planId: plan?.planId,
        threadId: thread?.threadId,
        evidence: [input.message],
        impact: `Workflow ${decision.primary} selected.`,
        promotion: "thread",
        metadata: { reasons: decision.reasons },
      },
      ...proactiveActions.map((action) => ({
        ts: now,
        level: "plan" as const,
        type: action.kind,
        planId: plan?.planId,
        evidence: [action.reason],
        impact: action.reason,
        promotion: "plan" as const,
      })),
    ];

    await this.memoryUpdater.applyEvents(learner, plan, thread, events);

    return {
      decision,
      context,
      learner,
      plan,
      thread,
      proactiveActions,
      events,
    };
  }
}
