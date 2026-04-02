import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { PlanState } from "../src/schemas/models.ts";
import { TaskEngine } from "../src/core/task-engine.ts";

const basePlan: PlanState = {
  planId: "plan-1",
  title: "Base plan",
  status: "active",
  createdAt: "2026-04-02T10:00:00.000Z",
  updatedAt: "2026-04-02T10:00:00.000Z",
  timebox: "7d",
  curriculumRefs: [],
  targetOutcome: ["Outcome"],
  constraints: [],
  successDefinition: [],
  goals: ["Task A", "Task B"],
  currentPhase: "execution",
  focusTopics: [],
  masterySnapshot: [],
  nextCheckpoint: null,
  tasks: [],
  milestones: [],
  misconceptions: [],
  resources: [],
  summary: "",
  rubricRefs: [],
  threadIds: [],
};

describe("TaskEngine", () => {
  test("raises proactive signals for overdue and blocked tasks", () => {
    const engine = new TaskEngine();
    const tasks = engine.generateSeedTasks(basePlan, "2026-04-02T10:00:00.000Z");
    tasks[0] = { ...tasks[0], dueAt: "2026-04-01T10:00:00.000Z" };
    tasks[1] = { ...tasks[1], status: "blocked" };
    const actions = engine.computeProactiveActions(
      {
        ...basePlan,
        tasks: [{ ...tasks[0], status: "blocked" }, tasks[1]],
      },
      "2026-04-02T10:00:00.000Z",
    );

    assert.equal(actions.some((action) => action.kind === "remind_due_task"), true);
    assert.equal(actions.some((action) => action.kind === "suggest_replan"), true);
  });
});
