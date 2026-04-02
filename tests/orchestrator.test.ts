import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { EduclawOrchestrator } from "../src/core/orchestrator.ts";
import { WorkspaceRepo } from "../src/storage/workspace-repo.ts";
import { createRuntimeFixture } from "./helpers.ts";

describe("EduclawOrchestrator", () => {
  test("creates a plan and thread when a new goal arrives", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const repo = new WorkspaceRepo(runtimeRoot);
    const orchestrator = new EduclawOrchestrator(repo);

    const outcome = await orchestrator.handleTurn({
      message: "我两周后有考试，帮我制定一个学习计划",
      now: "2026-04-02T10:00:00.000Z",
    });

    assert.equal(outcome.decision.primary, "planning");
    assert.ok(outcome.plan?.planId);
    assert.ok(outcome.thread?.threadId);
    assert.equal(outcome.learner.state.active_plan_count, 1);
  });
});
