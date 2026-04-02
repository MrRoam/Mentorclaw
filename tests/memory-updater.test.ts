import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MemoryUpdater } from "../src/core/memory-updater.ts";
import { WorkspaceRepo } from "../src/storage/workspace-repo.ts";
import { createRuntimeFixture } from "./helpers.ts";

describe("MemoryUpdater", () => {
  test("promotes learner-level events conservatively", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const repo = new WorkspaceRepo(runtimeRoot);
    const learner = await repo.readLearnerSummary();
    const updater = new MemoryUpdater(repo);

    await updater.applyEvents(learner, undefined, undefined, [
      {
        ts: "2026-04-02T10:00:00.000Z",
        level: "learner",
        type: "preference_confirmed",
        evidence: ["Repeated request for derivation-first explanations"],
        impact: "Preference promoted to learner level.",
        promotion: "learner",
      },
    ]);

    const refreshed = await repo.readLearnerSummary();
    assert.equal(refreshed.state.updated_at, "2026-04-02T10:00:00.000Z");
  });
});
