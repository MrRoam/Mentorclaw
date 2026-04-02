import type {
  AssessmentResult,
  LearnerSummary,
  LearningEvent,
  PlanState,
  PromotionTarget,
  ThreadState,
} from "../schemas/models.ts";
import { WorkspaceRepo } from "../storage/workspace-repo.ts";

const inferPromotion = (event: LearningEvent): PromotionTarget => {
  if (event.type === "preference_confirmed" || event.type === "cross_plan_pattern") return "learner";
  if (event.type === "plan_blocked" || event.type === "mastery_changed" || event.type === "task_status_changed") return "plan";
  return "thread";
};

export class MemoryUpdater {
  private readonly repo: WorkspaceRepo;

  constructor(repo: WorkspaceRepo) {
    this.repo = repo;
  }

  async applyEvents(
    learner: LearnerSummary,
    plan: PlanState | undefined,
    thread: ThreadState | undefined,
    events: LearningEvent[],
  ): Promise<void> {
    for (const baseEvent of events) {
      const event: LearningEvent = { ...baseEvent, promotion: inferPromotion(baseEvent) };
      if (thread && event.level === "thread") {
        await this.repo.appendThreadEvent(thread.planId, thread.threadId, event);
      }
      if (plan && (event.promotion === "plan" || event.level === "plan")) {
        await this.repo.appendPlanEvent(plan.planId, { ...event, level: "plan" });
      }
      if (event.promotion === "learner" || event.level === "learner") {
        await this.repo.appendLearnerEvent({ ...event, level: "learner" });
      }
    }

    if (thread) {
      thread.updatedAt = events.at(-1)?.ts ?? thread.updatedAt;
      thread.recentEvidence = [...thread.recentEvidence, ...events.flatMap((event) => event.evidence)].slice(-8);
      if (events.length > 0) {
        thread.summary = `${thread.summary}\n${events.at(-1)?.impact ?? ""}`.trim();
      }
      await this.repo.writeThreadState(thread);
    }

    if (plan) {
      const blockedEvents = events.filter((event) => event.type === "plan_blocked").length;
      if (blockedEvents > 0) {
        plan.currentPhase = "replanning";
      }
      plan.updatedAt = events.at(-1)?.ts ?? plan.updatedAt;
      await this.repo.writePlanState(plan);
    }

    if (events.some((event) => event.promotion === "learner")) {
      learner.state.updated_at = events.at(-1)?.ts ?? learner.state.updated_at;
      await this.repo.writeLearnerState(learner.state);
    }
  }

  applyAssessment(plan: PlanState, assessment: AssessmentResult, now: string): PlanState {
    const existing = plan.masterySnapshot.find((record) => record.topic === assessment.topic);
    if (existing) {
      existing.state = assessment.mastery;
      existing.evidence = assessment.evidenceTypes;
      existing.updatedAt = now;
    } else {
      plan.masterySnapshot.push({
        topic: assessment.topic,
        state: assessment.mastery,
        evidence: assessment.evidenceTypes,
        updatedAt: now,
      });
    }

    if (assessment.nextAction === "rollback" || assessment.nextAction === "replan") {
      plan.currentPhase = "replanning";
    }
    if (assessment.nextAction === "reinforce") {
      plan.misconceptions = Array.from(new Set([...plan.misconceptions, assessment.topic]));
    }
    plan.updatedAt = now;
    return plan;
  }
}
