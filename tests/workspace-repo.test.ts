import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { WorkspaceRepo } from "../src/storage/workspace-repo.ts";
import { createRuntimeFixture } from "./helpers.ts";

describe("WorkspaceRepo", () => {
  test("creates and reads plans using the runtime workspace contract", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const repo = new WorkspaceRepo(runtimeRoot);

    const plan = await repo.createPlan(
      {
        title: "Calculus sprint",
        targetOutcome: ["Finish the target module"],
        constraints: ["Two hours per day"],
        successDefinition: ["Can solve standard problems without help"],
        timebox: "14d",
        goals: ["Clarify scope", "Practice key exercises"],
      },
      "2026-04-02T10:00:00.000Z",
    );

    const loaded = await repo.readPlanState(plan.planId);
    assert.equal(loaded.title, "Calculus sprint");
    assert.deepEqual(loaded.goals, ["Clarify scope", "Practice key exercises"]);
    assert.equal(loaded.tasks.length, 2);
  });
});
