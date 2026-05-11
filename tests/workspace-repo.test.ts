import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { WorkspaceRepo } from "../src/storage/workspace-repo.ts";
import { createRuntimeFixture } from "./helpers.ts";

describe("WorkspaceRepo", () => {
  test("creates and reads projects using the new runtime workspace contract", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const repo = new WorkspaceRepo(runtimeRoot);

    const project = await repo.createProject(
      {
        title: "Calculus sprint",
        summary: "Finish the target module",
        targetOutcome: ["Finish the target module"],
        constraints: ["Two hours per day"],
        successDefinition: ["Can solve standard problems without help"],
        goals: ["Clarify scope", "Practice key exercises"],
        courseIds: ["course-calculus"],
      },
      "2026-04-02T10:00:00.000Z",
    );

    const loaded = await repo.readProjectState(project.projectId);
    assert.equal(loaded.title, "Calculus sprint");
    assert.deepEqual(loaded.scope.courseIds, ["course-calculus"]);
    assert.equal(loaded.execution.tasks.length, 2);
  });

  test("preserves course scope and exposes thread history when a project is round-tripped through the legacy plan view", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const repo = new WorkspaceRepo(runtimeRoot);

    const project = await repo.createProject(
      {
        title: "Physics same-night recap",
        summary: "Summarize subtitles after class.",
        targetOutcome: ["Generate a same-night recap after each class."],
        constraints: ["Only bind to the physics course"],
        successDefinition: ["The project stays bound to the course after new chats are created."],
        goals: ["Capture subtitles", "Generate review prompts"],
        courseIds: ["course-physics"],
      },
      "2026-04-16T12:00:00.000Z",
    );

    const createdThread = await repo.createThread(
      {
        planId: project.projectId,
        title: "Conversation Apr 16",
        currentQuestion: "Summarize today's lecture.",
      },
      "2026-04-16T13:00:00.000Z",
    );

    const legacyPlan = await repo.readPlanState(project.projectId);
    assert.deepEqual(legacyPlan.threadIds, [createdThread.threadId]);

    legacyPlan.summary = `${legacyPlan.summary}\nThread created for recap.`;
    legacyPlan.updatedAt = "2026-04-16T13:05:00.000Z";
    await repo.writePlanState(legacyPlan);

    const reloadedProject = await repo.readProjectState(project.projectId);
    const reloadedPlan = await repo.readPlanState(project.projectId);

    assert.deepEqual(reloadedProject.scope.courseIds, ["course-physics"]);
    assert.equal(reloadedProject.scope.type, "course");
    assert.deepEqual(reloadedPlan.threadIds, [createdThread.threadId]);
    assert.match(reloadedProject.summary, /Thread created for recap/);
  });

  test("backfills schedule rules for legacy cron definitions that only stored schedule text", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const repo = new WorkspaceRepo(runtimeRoot);
    await repo.ensureScaffold();

    const cronId = "legacy-physics-cron";
    await writeFile(
      path.join(repo.paths.workspaceRoot, "crons", `${cronId}.yaml`),
      [
        `cron_id: "${cronId}"`,
        'title: "Physics recap"',
        'enabled: true',
        'schedule: "After each class, same night at 21:30"',
        'project_id: null',
        'course_ids:',
        '  - "course-physics"',
        'prompt: "Summarize the class."',
        'updated_at: "2026-04-16T12:00:00.000Z"',
        "",
      ].join("\n"),
      "utf8",
    );

    const cron = await repo.readCronDefinition(cronId);
    assert.deepEqual(cron.scheduleRule, {
      kind: "after_course_class",
      timeOfDay: "21:30",
      timezone: "Asia/Shanghai",
      offsetDays: 0,
      source: "course_schedule",
    });
  });
});
