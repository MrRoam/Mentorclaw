import type { ContextPacket, LearnerSummary, PlanState, ResourceRef, ThreadState } from "../schemas/models.ts";
import { WorkspaceRepo } from "../storage/workspace-repo.ts";

const summarizeResources = (resources: ResourceRef[]): string[] =>
  resources.map((resource) => `${resource.title} (${resource.kind}) trust=${resource.trustScore} via ${resource.sourceType}`);

export class ContextBuilder {
  private readonly repo: WorkspaceRepo;

  constructor(repo: WorkspaceRepo) {
    this.repo = repo;
  }

  async build(learner: LearnerSummary, plan?: PlanState, thread?: ThreadState, attachments: ResourceRef[] = []): Promise<ContextPacket> {
    const bootstrap = await this.repo.readBootstrap();
    const planResources = plan?.resources ?? [];
    const resources = [...planResources, ...attachments];

    return {
      bootstrap,
      learnerSummary: [
        learner.state.current_focus ? `Current focus: ${learner.state.current_focus}` : "Current focus: not set",
        `Active plans: ${learner.state.active_plan_ids.join(", ") || "none"}`,
        `Risk flags: ${learner.state.risk_flags.join(", ") || "none"}`,
      ],
      planSummary: plan
        ? [
            `Plan: ${plan.title}`,
            `Phase: ${plan.currentPhase ?? "unknown"}`,
            `Timebox: ${plan.timebox || "unspecified"}`,
            `Tasks open: ${plan.tasks.filter((task) => task.status !== "done").length}`,
          ]
        : [],
      threadSummary: thread
        ? [
            `Thread: ${thread.title}`,
            `Current question: ${thread.currentQuestion ?? "none"}`,
            `Blockers: ${thread.blockers.join(", ") || "none"}`,
          ]
        : [],
      resourceSummary: summarizeResources(resources),
      readSet: [
        "workspace/AGENTS.md",
        "workspace/SOUL.md",
        "workspace/TOOLS.md",
        "workspace/agent/learner/*",
        ...(plan ? [`workspace/agent/plans/${plan.planId}/*`] : []),
        ...(thread ? [`workspace/agent/plans/${thread.planId}/threads/${thread.threadId}/*`] : []),
      ],
    };
  }
}
