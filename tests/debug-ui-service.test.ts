import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { mentorclawOrchestrator } from "../src/core/orchestrator.ts";
import { DebugUiService } from "../src/debug-ui/service.ts";
import { SessionBindingStore, recordAgentEnd } from "../src/integration/openclaw-adapter.ts";
import { EducationRepo } from "../src/storage/education-repo.ts";
import type {
  OpenClawSessionHandle,
  OpenClawTurnBridgeLike,
  OpenClawTurnRequest,
  OpenClawTurnResult,
} from "../src/integration/openclaw-turn-bridge.ts";
import { WorkspaceRepo } from "../src/storage/workspace-repo.ts";
import { nowIso } from "../src/utils/time.ts";
import { createRuntimeFixture } from "./helpers.ts";

class FakeOpenClawTurnBridge implements OpenClawTurnBridgeLike {
  async resolveSessionHandle(_runtimeRoot: string, sessionRef: string): Promise<OpenClawSessionHandle> {
    const trimmed = sessionRef.trim();
    if (trimmed.startsWith("agent:main:explicit:")) {
      return {
        agentId: "main",
        sessionId: trimmed.replace(/^agent:main:explicit:/, ""),
        sessionKey: trimmed,
      };
    }

    return {
      agentId: "main",
      sessionId: trimmed,
      sessionKey: `agent:main:explicit:${trimmed}`,
    };
  }

  async runTurn(request: OpenClawTurnRequest): Promise<OpenClawTurnResult> {
    const session = await this.resolveSessionHandle(request.runtimeRoot, request.sessionRef);
    const repo = new WorkspaceRepo(request.runtimeRoot);
    const bindingStore = new SessionBindingStore(repo.paths.workspaceRoot);
    const existing = await bindingStore.get(session.sessionKey);
    if (!existing?.projectId && request.sessionRef.startsWith("cron-")) {
      return {
        assistantReply: `Cron reply for ${request.sessionRef}: ${request.message.slice(0, 80)}`,
        sessionId: session.sessionId,
        sessionKey: session.sessionKey,
        agentId: "main",
        durationMs: 12,
        stopReason: "stop",
        workspaceDir: repo.paths.workspaceRoot,
        raw: { fake: true, cron: true },
      };
    }
    const orchestrator = new mentorclawOrchestrator(repo);
    const outcome = await orchestrator.handleTurn({
      message: request.message,
      now: nowIso(),
      projectId: existing?.projectId,
      signals: existing?.pendingSignals,
    });

    assert.ok(outcome.project);

    const binding = {
      sessionKey: session.sessionKey,
      projectId: outcome.project.projectId,
      updatedAt: nowIso(),
      lastWorkflow: outcome.decision.primary,
    };
    await bindingStore.set(binding);

    const assistantReply = `Live reply for ${outcome.project.projectId}`;
    await recordAgentEnd(repo, binding, {
      success: true,
      messages: [
        {
          role: "assistant",
          content: assistantReply,
        },
      ],
      durationMs: 12,
    });

    return {
      assistantReply,
      sessionId: session.sessionId,
      sessionKey: session.sessionKey,
      agentId: "main",
      durationMs: 12,
      stopReason: "stop",
      workspaceDir: repo.paths.workspaceRoot,
      raw: { fake: true },
    };
  }
}

class AssertingProjectEntryBridge extends FakeOpenClawTurnBridge {
  override async runTurn(request: OpenClawTurnRequest): Promise<OpenClawTurnResult> {
    const session = await this.resolveSessionHandle(request.runtimeRoot, request.sessionRef);
    const repo = new WorkspaceRepo(request.runtimeRoot);
    const bindingStore = new SessionBindingStore(repo.paths.workspaceRoot);
    const existing = await bindingStore.get(session.sessionKey);
    assert.ok(existing?.projectId, "project-entry turns should bind to a concrete project before OpenClaw runs");
    return super.runTurn(request);
  }
}

class CapturingCronBridge extends FakeOpenClawTurnBridge {
  requests: OpenClawTurnRequest[] = [];

  override async runTurn(request: OpenClawTurnRequest): Promise<OpenClawTurnResult> {
    if (request.sessionRef.startsWith("cron-")) {
      this.requests.push(request);
    }
    return super.runTurn(request);
  }
}

class SyncingCronDebugUiService extends DebugUiService {
  syncAttempts: string[] = [];

  override async syncBuaaCourseResources(courseId: string) {
    this.syncAttempts.push(courseId);
    const snapshot = await this.educationRepo.readSnapshot();
    const localPath = path.join(this.runtimeRoot, "synced-course-notes.txt");
    await writeFile(localPath, "Professor assigned problem set 3 after class.\nReview chapter 5 before Friday.\n", "utf8");
    await this.educationRepo.writeCourseResources([
      ...snapshot.courseResources,
      {
        id: `resource-${courseId}-synced-notes`,
        courseId,
        linkedItemId: null,
        parentId: null,
        resourceType: "notes",
        title: "Synced replay notes",
        url: "local://synced-course-notes.txt",
        localPath,
        metaJson: {
          addedAt: nowIso(),
        },
      },
    ]);
    return this.getSnapshot();
  }
}

describe("DebugUiService", () => {
  test("runs a live bridged turn and records assistant replies on the bound project", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const service = new DebugUiService(runtimeRoot, { turnBridge: new FakeOpenClawTurnBridge() });

    const afterProject = await service.createProject({
      title: "Constitutional law sprint",
      goals: ["Clarify doctrine", "Practice cases"],
    });

    assert.equal(afterProject.activeProjectId?.startsWith("constitutional-law-sprint-"), true);
    const project = afterProject.projects.find((item) => item.projectId === afterProject.activeProjectId);
    assert.ok(project);

    const sessionKey = "browser-debug-001";
    const afterBinding = await service.bindSession({
      sessionKey,
      projectId: project.projectId,
    });
    assert.equal(
      afterBinding.sessionBindings.some((binding) => binding.sessionKey === "agent:main:explicit:browser-debug-001"),
      true,
    );

    const turn = await service.handleUserTurn({
      sessionKey,
      projectId: project.projectId,
      message: "今天我先做案例比较。",
      forceWorkflow: "tutoring",
    });

    assert.equal(turn.binding.projectId, project.projectId);
    assert.equal(turn.binding.sessionKey, "agent:main:explicit:browser-debug-001");
    assert.equal(turn.outcome, null);
    assert.equal(turn.assistantReplySource, "openclaw");
    assert.equal(turn.liveTurn.sessionId, sessionKey);

    const afterTurnProject = turn.snapshot.projects.find((item) => item.projectId === project.projectId);
    assert.ok(afterTurnProject);
    assert.equal(afterTurnProject.events.some((event) => event.type === "assistant_reply_recorded"), true);
    assert.equal(afterTurnProject.events.some((event) => event.type === "turn_processed"), true);

    const afterReply = await service.recordAssistantReply({
      sessionKey: turn.binding.sessionKey,
      text: "先按争点、规范、适用结论三个层次比较。",
    });

    const finalProject = afterReply.projects.find((item) => item.projectId === project.projectId);
    assert.ok(finalProject);
    assert.equal(finalProject.events.filter((event) => event.type === "assistant_reply_recorded").length >= 2, true);
  });

  test("binds the live session to the explicitly selected project before the OpenClaw turn runs", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const service = new DebugUiService(runtimeRoot, { turnBridge: new AssertingProjectEntryBridge() });

    const first = await service.createProject({ title: "Signals A" });
    const projectA = first.projects.find((item) => item.projectId === first.activeProjectId);
    assert.ok(projectA);

    const second = await service.createProject({ title: "Signals B" });
    const projectB = second.projects.find((item) => item.title === "Signals B");
    assert.ok(projectB);

    const turn = await service.handleUserTurn({
      sessionKey: "browser-signals-b",
      projectId: projectB.projectId,
      message: "从这个项目继续，帮我解释老师第五讲的卷积。",
    });

    assert.equal(turn.binding.projectId, projectB.projectId);
    assert.equal(turn.binding.sessionKey, "agent:main:explicit:browser-signals-b");

    const updatedProjectB = turn.snapshot.projects.find((item) => item.projectId === projectB.projectId);
    const updatedProjectA = turn.snapshot.projects.find((item) => item.projectId === projectA.projectId);
    assert.ok(updatedProjectB);
    assert.ok(updatedProjectA);
    assert.equal(updatedProjectB.events.some((event) => event.type === "turn_processed"), true);
    assert.equal(updatedProjectA.events.some((event) => event.type === "turn_processed"), false);
  });

  test("allocates a unique project id when the same title is created twice on the same day", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const service = new DebugUiService(runtimeRoot, { turnBridge: new FakeOpenClawTurnBridge() });

    const first = await service.createProject({ title: "Duplicate title" });
    const second = await service.createProject({ title: "Duplicate title" });

    const ids = second.projects
      .map((project) => project.projectId)
      .filter((projectId) => projectId.startsWith("duplicate-title-"));
    assert.equal(ids.length, 2);
    assert.notEqual(ids[0], ids[1]);
    assert.equal(first.projects.length <= second.projects.length, true);
  });

  test("surfaces cron definitions as a top-level object", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const service = new DebugUiService(runtimeRoot, { turnBridge: new FakeOpenClawTurnBridge() });

    const snapshot = await service.createCron({
      title: "Post-class summary",
      schedule: "After every class, same night at 21:30",
      prompt: "Summarize the just-finished class and list the next review action.",
      courseIds: ["signals-101"],
    });

    assert.equal(snapshot.crons.length, 1);
    assert.equal(snapshot.crons[0]?.title, "Post-class summary");
    assert.equal(snapshot.crons[0]?.courseIds?.includes("signals-101"), true);
    assert.equal(snapshot.crons[0]?.scheduleRule?.kind, "after_course_class");
    assert.equal(snapshot.crons[0]?.scheduleRule?.timeOfDay, "21:30");
  });

  test("creates standalone cron definitions without a project binding", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const service = new DebugUiService(runtimeRoot, { turnBridge: new FakeOpenClawTurnBridge() });

    const snapshot = await service.createCron({
      title: "Extract assignments",
      schedule: "Every night at 21:00",
      prompt: "Extract assignments from recent course updates.",
    });

    assert.equal(snapshot.crons.length, 1);
    assert.equal(snapshot.crons[0]?.projectId, null);
    assert.deepEqual(snapshot.crons[0]?.courseIds, []);
    assert.equal(snapshot.crons[0]?.scheduleRule?.kind, "daily_time");
  });

  test("rejects cron schedules that cannot be turned into runtime triggers", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const service = new DebugUiService(runtimeRoot, { turnBridge: new FakeOpenClawTurnBridge() });

    await assert.rejects(
      service.createCron({
        title: "Vague summary",
        schedule: "After every class, same night sometime",
        prompt: "Summarize the class.",
        courseIds: ["signals-101"],
      }),
      /exact trigger time/,
    );
  });

  test("updates and deletes cron definitions from the debug ui service", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const service = new DebugUiService(runtimeRoot, { turnBridge: new FakeOpenClawTurnBridge() });

    const created = await service.createCron({
      title: "Manual review",
      schedule: "manual",
      prompt: "Review recent material.",
      courseIds: ["physics-101"],
    });
    const cron = created.crons[0];
    assert.ok(cron);

    const updated = await service.updateCron({
      cronId: cron.cronId,
      title: "Manual review updated",
      schedule: "manual",
      prompt: "Review recent material and ask two questions.",
      enabled: false,
      courseIds: ["physics-101"],
    });
    assert.equal(updated.crons[0]?.title, "Manual review updated");
    assert.equal(updated.crons[0]?.enabled, false);
    assert.equal(updated.crons[0]?.prompt, "Review recent material and ask two questions.");

    const afterDelete = await service.deleteCron(cron.cronId);
    assert.equal(afterDelete.crons.some((entry) => entry.cronId === cron.cronId), false);
  });

  test("runs cron turns with only the action prompt instead of leaking internal schedule metadata", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const bridge = new CapturingCronBridge();
    const service = new DebugUiService(runtimeRoot, { turnBridge: bridge });

    const snapshot = await service.createCron({
      title: "Physics subtitle wrap-up",
      schedule: "Every night at 21:00",
      prompt: "Extract the homework from the latest class updates.",
    });
    const cron = snapshot.crons[0];
    assert.ok(cron);

    await service.runCronNow(cron.cronId);

    const request = bridge.requests.at(-1);
    assert.ok(request);
    assert.match(request.message, /Extract the homework from the latest class updates\./);
    assert.doesNotMatch(request.message, /Schedule text:/);
    assert.doesNotMatch(request.message, /Cron title:/);

    const runs = await service.repo.readCronRuns();
    assert.equal(runs[0]?.userMessage, "Extract the homework from the latest class updates.");
  });

  test("executes due class-based crons once through runtime state", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const educationRepo = new EducationRepo(runtimeRoot);
    const workspaceRepo = new WorkspaceRepo(runtimeRoot);
    const service = new DebugUiService(runtimeRoot, { turnBridge: new FakeOpenClawTurnBridge() });

    await educationRepo.writeCourses([
      {
        id: "physics-101",
        stableKey: "physics-101",
        title: "基础物理",
        teacher: "",
        term: "2026",
        sourceType: "test",
        sourceCourseId: null,
        status: "active",
        displayColor: null,
        metadata: {},
      },
    ]);
    await educationRepo.writeCourseItems([
      {
        id: "physics-class-1",
        courseId: "physics-101",
        type: "class",
        sourceItemId: null,
        title: "基础物理第 1 讲",
        teacher: null,
        startAt: "2026-04-28T11:00:00.000Z",
        endAt: "2026-04-28T12:30:00.000Z",
        dueAt: null,
        location: null,
        body: "",
        metaJson: {},
        isHidden: false,
        manualTitle: null,
        manualLocation: null,
        manualStartAt: null,
        manualEndAt: null,
        manualNote: null,
        lastSyncedAt: null,
      },
    ]);
    await workspaceRepo.createCron(
      {
        title: "Physics same-night summary",
        schedule: "每次基础物理课当天晚上9点",
        scheduleRule: {
          kind: "after_course_class",
          timeOfDay: "21:00",
          timezone: "Asia/Shanghai",
          offsetDays: 0,
          source: "course_schedule",
        },
        prompt: "Summarize the class.",
        courseIds: ["physics-101"],
      },
      "2026-04-28T09:00:00.000Z",
    );

    const first = await service.executeDueCrons(new Date("2026-04-28T13:05:00.000Z"));
    const second = await service.executeDueCrons(new Date("2026-04-28T13:10:00.000Z"));

    assert.equal(first.dueCount, 1);
    assert.equal(first.completed, 1);
    assert.equal(second.dueCount, 0);
    const runs = await workspaceRepo.readCronRuns();
    assert.equal(runs[0]?.status, "completed");
    assert.match(runs[0]?.userMessage || "", /Summarize the class/);
    assert.match(runs[0]?.assistantReply || "", /Cron reply/);
  });

  test("auto-syncs missing course resources before giving up on a course-bound cron", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const educationRepo = new EducationRepo(runtimeRoot);
    const service = new SyncingCronDebugUiService(runtimeRoot, { turnBridge: new FakeOpenClawTurnBridge() });

    await educationRepo.writeCourses([
      {
        id: "physics-101",
        stableKey: "physics-101",
        title: "Physics A",
        teacher: "",
        term: "2026",
        sourceType: "test",
        sourceCourseId: null,
        status: "active",
        displayColor: null,
        metadata: {},
      },
    ]);
    await educationRepo.writeCourseItems([
      {
        id: "physics-class-1",
        courseId: "physics-101",
        type: "class",
        sourceItemId: null,
        title: "Wave optics",
        teacher: null,
        startAt: "2026-04-28T11:00:00.000Z",
        endAt: "2026-04-28T12:30:00.000Z",
        dueAt: null,
        location: null,
        body: "",
        metaJson: {},
        isHidden: false,
        manualTitle: null,
        manualLocation: null,
        manualStartAt: null,
        manualEndAt: null,
        manualNote: null,
        lastSyncedAt: null,
      },
    ]);

    const snapshot = await service.createCron({
      title: "Physics wrap-up",
      schedule: "After every class, same night at 21:30",
      prompt: "Summarize the just-finished class and extract any homework.",
      courseIds: ["physics-101"],
    });
    const cron = snapshot.crons[0];
    assert.ok(cron);

    const preview = await service.runCron(cron.cronId);

    assert.deepEqual(service.syncAttempts, ["physics-101"]);
    assert.equal(preview.sourceResource?.resourceType, "notes");
    assert.match(preview.preparedContext || "", /Prepared resource: Synced replay notes \(notes\)/);
  });

  test("persists schedule preferences through the debug ui service snapshot", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const service = new DebugUiService(runtimeRoot, { turnBridge: new FakeOpenClawTurnBridge() });

    const snapshot = await service.updateSchedulePreferences({
      scheduleDefaultView: "month",
      showTimetableInSchedule: false,
    });

    assert.deepEqual(snapshot.education.schedulePreferences, {
      showTimetableInSchedule: false,
      scheduleDefaultView: "month",
    });
    assert.equal(snapshot.localFiles.some((file) => file.label === "Course Items"), true);
  });

  test("updates manual schedule items and hides imported class items", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const service = new DebugUiService(runtimeRoot, { turnBridge: new FakeOpenClawTurnBridge() });

    const afterAdd = await service.addManualScheduleItem({
      title: "Test",
      startAt: "2026-04-13T11:00:00.000+08:00",
      endAt: "2026-04-13T11:30:00.000+08:00",
    });
    const manual = afterAdd.education.courseItems.find((item) => item.type === "manual");
    assert.ok(manual);

    const afterUpdate = await service.updateScheduleItem({
      itemId: manual.id,
      title: "Test updated",
      startAt: "2026-04-13T12:00:00.000+08:00",
      endAt: "2026-04-13T12:30:00.000+08:00",
      location: "Library",
      note: "Bring notes",
    });
    const updatedManual = afterUpdate.education.courseItems.find((item) => item.id === manual.id);
    assert.equal(updatedManual?.manualTitle, "Test updated");
    assert.equal(updatedManual?.manualLocation, "Library");
    assert.equal(updatedManual?.manualNote, "Bring notes");

    const afterManualDelete = await service.deleteScheduleItem(manual.id);
    assert.equal(afterManualDelete.education.courseItems.some((item) => item.id === manual.id), false);

    const classSnapshot = await service.addManualScheduleItem({
      title: "Temporary class-shaped fixture",
      startAt: "2026-04-13T13:00:00.000+08:00",
      endAt: "2026-04-13T13:30:00.000+08:00",
    });
    const manualFixture = classSnapshot.education.courseItems.find((item) => item.type === "manual");
    assert.ok(manualFixture);
    const classLike = { ...manualFixture, type: "class" as const };
    await service.educationRepo.writeCourseItems([classLike]);

    const afterClassDelete = await service.deleteScheduleItem(classLike.id);
    assert.equal(afterClassDelete.education.courseItems[0]?.isHidden, true);
  });
});
