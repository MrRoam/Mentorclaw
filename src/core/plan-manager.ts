import type { PlanCreationInput, PlanState } from "../schemas/models.ts";
import { WorkspaceRepo } from "../storage/workspace-repo.ts";
import { TaskEngine } from "./task-engine.ts";

export class PlanManager {
  private readonly repo: WorkspaceRepo;
  private readonly taskEngine: TaskEngine;

  constructor(
    repo: WorkspaceRepo,
    taskEngine: TaskEngine,
  ) {
    this.repo = repo;
    this.taskEngine = taskEngine;
  }

  async createPlan(input: PlanCreationInput, now: string): Promise<PlanState> {
    const created = await this.repo.createPlan(input, now);
    created.tasks = this.taskEngine.generateSeedTasks(created, now);
    await this.repo.writePlanState(created);
    return created;
  }

  async setStatus(planId: string, status: PlanState["status"], now: string): Promise<PlanState> {
    const plan = await this.repo.readPlanState(planId);
    plan.status = status;
    plan.updatedAt = now;
    await this.repo.writePlanState(plan);
    return plan;
  }

  async replan(planId: string, now: string, reason: string): Promise<PlanState> {
    const plan = await this.repo.readPlanState(planId);
    plan.currentPhase = "replanning";
    plan.summary = `${plan.summary}\nReplanning triggered: ${reason}`.trim();
    plan.tasks = this.taskEngine.rebalanceTasks(plan, now);
    plan.updatedAt = now;
    await this.repo.writePlanState(plan);
    return plan;
  }
}
