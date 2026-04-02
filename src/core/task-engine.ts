import type { PlanState, ProactiveAction, TaskItem } from "../schemas/models.ts";
import { makeTaskId } from "../utils/id.ts";
import { daysFrom, isPast } from "../utils/time.ts";

export class TaskEngine {
  generateSeedTasks(plan: PlanState, now: string): TaskItem[] {
    if (plan.tasks.length > 0) return plan.tasks;

    return plan.goals.map((goal, index) => ({
      id: makeTaskId(goal, index),
      title: goal,
      description: `Make progress toward "${goal}" and record evidence.`,
      status: "todo",
      priority: index === 0 ? "high" : "medium",
      dueAt: daysFrom(now, index + 1),
      acceptanceCriteria: [`Show evidence for goal: ${goal}`],
      dependencies: index === 0 ? [] : [makeTaskId(plan.goals[index - 1] ?? goal, index - 1)],
      evidenceRequired: index === 0 ? ["reproduction"] : ["application"],
      tags: ["generated"],
    }));
  }

  rebalanceTasks(plan: PlanState, now: string): TaskItem[] {
    const blockedCount = plan.tasks.filter((task) => task.status === "blocked").length;
    return plan.tasks.map((task, index) => {
      if (task.status === "done") return task;
      return {
        ...task,
        priority: blockedCount > 0 && index === 0 ? "high" : task.priority,
        dueAt: task.dueAt ?? daysFrom(now, index + 1),
      };
    });
  }

  computeProactiveActions(plan: PlanState, now: string): ProactiveAction[] {
    const actions: ProactiveAction[] = [];

    for (const task of plan.tasks) {
      if (task.status !== "done" && isPast(task.dueAt, now)) {
        actions.push({
          kind: "remind_due_task",
          reason: `Task "${task.title}" is overdue.`,
          planId: plan.planId,
          taskId: task.id,
        });
      }
    }

    const blockedCount = plan.tasks.filter((task) => task.status === "blocked").length;
    if (blockedCount >= 2) {
      actions.push({
        kind: "suggest_replan",
        reason: "Multiple tasks are blocked, which suggests the plan path should be revisited.",
        planId: plan.planId,
      });
    }

    if (plan.milestones.length > 0 && plan.milestones.every((milestone) => milestone.status === "done")) {
      actions.push({
        kind: "prompt_review",
        reason: "All milestones are complete; trigger a structured review.",
        planId: plan.planId,
      });
    }

    if (plan.masterySnapshot.some((record) => record.state === "fragile")) {
      actions.push({
        kind: "trigger_assessment",
        reason: "Fragile mastery was detected and should be re-tested.",
        planId: plan.planId,
      });
    }

    return actions;
  }
}
