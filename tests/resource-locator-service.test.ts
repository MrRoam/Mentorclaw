import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { importEducationDocument } from "../src/education/importer.ts";
import { ResourceLocatorService } from "../src/education/resource-locator-service.ts";
import type { ProjectState } from "../src/schemas/models.ts";
import { EducationRepo } from "../src/storage/education-repo.ts";
import { createPdfFixture, createRuntimeFixture } from "./helpers.ts";

const makeProject = (courseId: string): ProjectState => ({
  projectId: "signals-project",
  title: "Signals Review",
  status: "active",
  createdAt: null,
  updatedAt: null,
  scope: {
    type: "course",
    courseIds: [courseId],
  },
  goal: {
    summary: "Review signals and systems",
    targetOutcome: [],
    constraints: [],
    successDefinition: [],
  },
  execution: {
    mode: "tutoring",
    nextAction: null,
    tasks: [],
    milestones: [],
  },
  memory: {
    misconceptions: [],
    durableNotes: [],
  },
  resources: {
    pinnedResourceIds: [],
    preferredTypes: ["subtitle", "ppt", "pdf"],
    notes: [],
  },
  summary: "",
});

describe("ResourceLocatorService", () => {
  test("prefers subtitle timestamps for lecture explanation, ppt for slides, and pdf for textbook queries", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const repo = new EducationRepo(runtimeRoot);
    const subtitlePath = path.join(runtimeRoot, "lecture5.srt");
    const slidePath = path.join(runtimeRoot, "lecture5.html");
    const pdfPath = await createPdfFixture(runtimeRoot, "book.pdf", [
      "Page 1 covers impulse response.",
      "Page 2 covers the convolution definition and convolution integral.",
    ]);

    await writeFile(
      subtitlePath,
      `1
00:12:30,000 --> 00:13:10,000
The instructor explains convolution using the graphical method.
`,
      "utf8",
    );
    await writeFile(
      slidePath,
      `<html><body><section><h1>Page 1</h1><p>Graphical method for convolution</p></section><section><h1>Page 2</h1><p>Convolution integral</p></section></body></html>`,
      "utf8",
    );

    await importEducationDocument(repo, {
      sourceType: "fixture",
      courses: [
        {
          sourceCourseId: "signals-101",
          title: "Signals and Systems",
          teacher: "Prof. Wang",
          term: "2026 Spring",
          items: [
            {
              sourceItemId: "replay-5",
              type: "replay",
              title: "Lecture 5 replay",
              body: "Convolution replay",
            },
            {
              sourceItemId: "assignment-2",
              type: "assignment",
              title: "Homework 2",
              body: "Complete the convolution exercises.",
            },
          ],
          resources: [
            {
              sourceResourceId: "subtitle-5",
              linkedItemSourceId: "replay-5",
              resourceType: "subtitle",
              title: "Lecture 5 subtitle",
              url: "https://example.com/subtitle",
              localPath: subtitlePath,
            },
            {
              sourceResourceId: "slides-5",
              linkedItemSourceId: "replay-5",
              resourceType: "ppt",
              title: "Lecture 5 slides",
              url: "https://example.com/slides",
              localPath: slidePath,
            },
            {
              sourceResourceId: "book",
              resourceType: "pdf",
              title: "Signals textbook",
              url: "https://example.com/book",
              localPath: pdfPath,
            },
            {
              sourceResourceId: "hw-notes",
              linkedItemSourceId: "assignment-2",
              resourceType: "notes",
              title: "Homework notes",
              url: "https://example.com/hw-notes",
              localPath: slidePath,
            },
          ],
        },
      ],
    });

    const project = makeProject("course-2026-spring:fixture:signals-101");
    const locator = new ResourceLocatorService(repo);

    const lecture = await locator.locate(project, "How did lecture 5 explain convolution?");
    assert.equal(lecture.matches[0]?.resourceType, "subtitle");
    assert.equal(lecture.matches[0]?.locator.kind, "timestamp");

    const slides = await locator.locate(project, "Which slide explains convolution?");
    assert.equal(slides.matches[0]?.resourceType, "ppt");
    assert.equal(slides.matches[0]?.locator.kind, "page");

    const textbook = await locator.locate(project, "Which page in the textbook covers the convolution definition?");
    assert.equal(textbook.matches[0]?.resourceType, "pdf");
    assert.equal(textbook.matches[0]?.locator.kind, "page");

    const homework = await locator.locate(project, "What is the homework for this class?");
    assert.equal(homework.matches.some((match) => match.resourceType === "subtitle"), false);
  });

  test("respects project scope for uploaded pdf resources", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const repo = new EducationRepo(runtimeRoot);
    const projectPdf = await createPdfFixture(runtimeRoot, "project.pdf", ["The convolution theorem is explained here."]);
    const otherPdf = await createPdfFixture(runtimeRoot, "other.pdf", ["Fourier series are explained here."]);

    await importEducationDocument(repo, {
      sourceType: "fixture",
      courses: [
        {
          sourceCourseId: "signals-101",
          title: "Signals and Systems",
          teacher: "Prof. Wang",
          term: "2026 Spring",
          resources: [
            {
              sourceResourceId: "project-upload",
              resourceType: "pdf",
              title: "Project Upload",
              url: "",
              localPath: projectPdf,
              metaJson: { origin: "project_upload", projectId: "signals-project" },
            },
            {
              sourceResourceId: "other-upload",
              resourceType: "pdf",
              title: "Other Upload",
              url: "",
              localPath: otherPdf,
              metaJson: { origin: "project_upload", projectId: "other-project" },
            },
          ],
        },
      ],
    });

    const locator = new ResourceLocatorService(repo);
    const result = await locator.locate(
      makeProject("course-2026-spring:fixture:signals-101"),
      "Which page in the textbook covers the convolution theorem?",
    );

    assert.equal(result.matches.some((match) => match.title === "Project Upload"), true);
    assert.equal(result.matches.some((match) => match.title === "Other Upload"), false);
  });
});
