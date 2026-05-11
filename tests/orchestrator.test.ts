import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { importEducationDocument } from "../src/education/importer.ts";
import { mentorclawOrchestrator } from "../src/core/orchestrator.ts";
import { EducationRepo } from "../src/storage/education-repo.ts";
import { WorkspaceRepo } from "../src/storage/workspace-repo.ts";
import { createPdfFixture, createRuntimeFixture } from "./helpers.ts";

describe("mentorclawOrchestrator", () => {
  test("creates a project instead of a thread-centric plan when a new goal arrives", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const repo = new WorkspaceRepo(runtimeRoot);
    const orchestrator = new mentorclawOrchestrator(repo);

    const outcome = await orchestrator.handleTurn({
      message: "Create a new exam project and study goal for the test in two weeks.",
      now: "2026-04-02T10:00:00.000Z",
    });

    assert.equal(outcome.decision.primary, "planning");
    assert.ok(outcome.project?.projectId);
    assert.equal(outcome.plan?.planId, outcome.project?.projectId);
    assert.equal(outcome.learner.state.active_plan_count, 1);
  });

  test("injects relevant course items, resources, and locators for a course-bound project turn", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const repo = new WorkspaceRepo(runtimeRoot);
    const educationRepo = new EducationRepo(runtimeRoot);
    const orchestrator = new mentorclawOrchestrator(repo);
    const subtitlePath = path.join(runtimeRoot, "signals-subtitle.srt");
    const pdfPath = await createPdfFixture(runtimeRoot, "signals-textbook.pdf", [
      "Page 1 covers impulse response.",
      "Page 2 covers the convolution definition and convolution integral.",
    ]);
    await writeFile(
      subtitlePath,
      `1
00:12:30,000 --> 00:13:10,000
The instructor explains convolution with the graphical method and the convolution integral.
`,
      "utf8",
    );

    await importEducationDocument(educationRepo, {
      sourceType: "fixture",
      courses: [
        {
          sourceCourseId: "signals-101",
          title: "Signals and Systems",
          teacher: "Prof. Wang",
          term: "2026 Spring",
          items: [
            {
              sourceItemId: "assignment-2",
              type: "assignment",
              title: "Homework 2",
              dueAt: "2026-04-18T23:59:00.000+08:00",
              body: "Complete the convolution exercises.",
            },
          ],
          resources: [
            {
              sourceResourceId: "notes-2",
              linkedItemSourceId: "assignment-2",
              resourceType: "notes",
              title: "Homework 2 notes",
              url: "https://example.com/signals/homework-2-notes",
            },
            {
              sourceResourceId: "subtitle-5",
              resourceType: "subtitle",
              title: "Lecture 5 subtitle",
              url: "https://example.com/signals/subtitle-5",
              localPath: subtitlePath,
            },
            {
              sourceResourceId: "textbook",
              resourceType: "pdf",
              title: "Signals textbook",
              url: "https://example.com/signals/textbook",
              localPath: pdfPath,
            },
          ],
        },
      ],
    });

    const project = await repo.createProject(
      {
        title: "Signals Homework Review",
        summary: "Use course data to answer homework questions",
        targetOutcome: [],
        constraints: [],
        successDefinition: [],
        goals: ["Finish homework 2"],
        courseIds: ["course-2026-spring:fixture:signals-101"],
      },
      "2026-04-14T10:00:00.000+08:00",
    );

    const outcome = await orchestrator.handleTurn({
      projectId: project.projectId,
      message: "Which page in the textbook covers the convolution integral?",
      now: "2026-04-14T10:30:00.000+08:00",
    });

    assert.equal(outcome.project?.projectId, project.projectId);
    assert.equal(outcome.context.resourceSummary.some((line) => line.includes("Relevant course resources")), true);
    assert.equal(outcome.context.resourceSummary.some((line) => line.includes("Signals textbook")), true);
    assert.equal(outcome.context.locatorSummary.length > 0, true);
    assert.equal(outcome.context.locators.length > 0, true);
    assert.equal(outcome.context.readSet.includes("workspace/state/education/course-items.json"), true);
    assert.equal(outcome.context.readSet.includes("workspace/state/education/course-resources.json"), true);
  });
});
