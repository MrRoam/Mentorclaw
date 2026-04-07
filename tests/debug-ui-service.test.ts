import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DebugUiService } from "../src/debug-ui/service.ts";
import { createRuntimeFixture } from "./helpers.ts";

describe("DebugUiService", () => {
  test("creates plans and threads, binds sessions, and writes turn memory through the shared runtime files", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const service = new DebugUiService(runtimeRoot);

    const afterPlan = await service.createPlan({
      title: "Constitutional law sprint",
      timebox: "14 days",
      goals: ["Clarify doctrine", "Practice cases"],
    });

    assert.equal(afterPlan.activePlanId?.startsWith("constitutional-law-sprint-"), true);
    const plan = afterPlan.plans.find((item) => item.planId === afterPlan.activePlanId);
    assert.ok(plan);

    const afterThread = await service.createThread({
      planId: plan.planId,
      title: "Case discussion",
      currentQuestion: "How should I compare the core doctrines?",
    });

    const refreshedPlan = afterThread.plans.find((item) => item.planId === plan.planId);
    assert.ok(refreshedPlan);
    assert.equal(refreshedPlan.threads.length, 1);

    const thread = refreshedPlan.threads[0];
    const sessionKey = "browser-debug-001";

    const afterBinding = await service.bindSession({
      sessionKey,
      planId: refreshedPlan.planId,
      threadId: thread.threadId,
    });
    assert.equal(afterBinding.sessionBindings.some((binding) => binding.sessionKey === sessionKey), true);

    const turn = await service.handleUserTurn({
      sessionKey,
      planId: refreshedPlan.planId,
      threadId: thread.threadId,
      message: "今天我先做案例比较。",
      forceWorkflow: "tutoring",
    });

    assert.equal(turn.binding.planId, refreshedPlan.planId);
    assert.equal(turn.binding.threadId, thread.threadId);
    assert.equal(turn.outcome.decision.primary, "tutoring");

    const afterReply = await service.recordAssistantReply({
      sessionKey,
      text: "先按争点、规范、适用结论三个层次比较。",
    });

    const finalPlan = afterReply.plans.find((item) => item.planId === refreshedPlan.planId);
    const finalThread = finalPlan?.threads.find((item) => item.threadId === thread.threadId);
    assert.ok(finalThread);
    assert.equal(finalThread.workingMemory.some((entry) => entry.includes("Assistant reply:")), true);
    assert.equal(finalThread.events.some((event) => event.type === "assistant_reply_recorded"), true);
  });

  test("allocates a unique plan id when the same title is created twice on the same day", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const service = new DebugUiService(runtimeRoot);

    const first = await service.createPlan({ title: "Duplicate title" });
    const second = await service.createPlan({ title: "Duplicate title" });

    const ids = second.plans.map((plan) => plan.planId).filter((planId) => planId.startsWith("duplicate-title-"));
    assert.equal(ids.length, 2);
    assert.notEqual(ids[0], ids[1]);
    assert.equal(first.plans.length <= second.plans.length, true);
  });
});
