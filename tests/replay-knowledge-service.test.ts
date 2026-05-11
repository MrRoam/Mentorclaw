import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { importBuaaLivingroomCapture } from "../src/education/providers/buaa/msa.ts";
import { ReplayKnowledgeService } from "../src/education/replay-knowledge-service.ts";
import { ResourceLocatorService } from "../src/education/resource-locator-service.ts";
import type { ProjectState } from "../src/schemas/models.ts";
import { EducationRepo } from "../src/storage/education-repo.ts";
import { createRuntimeFixture } from "./helpers.ts";

const makeProject = (courseId: string): ProjectState => ({
  projectId: "calculus-project",
  title: "Calculus Review",
  status: "active",
  createdAt: null,
  updatedAt: null,
  scope: {
    type: "course",
    courseIds: [courseId],
  },
  goal: {
    summary: "Review lecture resources",
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
    preferredTypes: ["subtitle", "ppt"],
    notes: [],
  },
  summary: "",
});

describe("ReplayKnowledgeService", () => {
  test("builds replay knowledge segments and aligns subtitle windows to slide timings", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const repo = new EducationRepo(runtimeRoot);

    await importBuaaLivingroomCapture(repo, {
      courseId: "course-1",
      replaySourceId: "msa-replay:course-1:sub-1",
      replayTitle: "Lecture 01",
      courseTitle: "Signals and Systems",
      teacher: "Prof. Li",
      term: "2026 Spring",
      subtitleData: [
        {
          all_content: [
            { BeginSec: 0, EndSec: 4, Text: "We first review impulse response." },
            { BeginSec: 6, EndSec: 12, Text: "Now we define the convolution integral." },
          ],
        },
      ],
      pptData: [
        {
          created_sec: 0,
          content: JSON.stringify({ pptimgurl: "https://cdn.example/slide-1.jpg" }),
        },
        {
          created_sec: 5,
          content: JSON.stringify({ pptimgurl: "https://cdn.example/slide-2.jpg" }),
        },
      ],
    });

    const snapshot = await repo.readSnapshot();
    const replay = snapshot.courseItems.find((item) => item.type === "replay");
    assert.ok(replay);

    const service = new ReplayKnowledgeService(repo);
    const index = await service.ensureIndexedReplay(replay, snapshot);

    assert.ok(index);
    assert.equal(index.segments.length, 2);
    assert.equal(index.slideTimeline.length, 2);
    assert.equal(index.segments[0]?.pptPage, 1);
    assert.equal(index.segments[1]?.pptPage, 2);
    assert.equal(index.segments[1]?.pptTimeSec, 5);
  });

  test("lets PPT pages inherit subtitle semantics for replay knowledge lookup", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const repo = new EducationRepo(runtimeRoot);

    await importBuaaLivingroomCapture(repo, {
      courseId: "course-1",
      replaySourceId: "msa-replay:course-1:sub-1",
      replayTitle: "Lecture 01",
      courseTitle: "Signals and Systems",
      teacher: "Prof. Li",
      term: "2026 Spring",
      subtitleData: [
        {
          all_content: [
            { BeginSec: 0, EndSec: 4, Text: "We first review impulse response." },
            { BeginSec: 6, EndSec: 12, Text: "Now we define the convolution integral." },
          ],
        },
      ],
      pptData: [
        {
          created_sec: 0,
          content: JSON.stringify({ pptimgurl: "https://cdn.example/slide-1.jpg" }),
        },
        {
          created_sec: 5,
          content: JSON.stringify({ pptimgurl: "https://cdn.example/slide-2.jpg" }),
        },
      ],
    });

    const snapshot = await repo.readSnapshot();
    const course = snapshot.courses[0];
    assert.ok(course);

    const locator = new ResourceLocatorService(repo);
    const result = await locator.locate(makeProject(course.id), "Which slide covers the convolution integral?");

    assert.equal(result.matches.some((match) => match.resourceType === "subtitle" && match.locator.kind === "timestamp"), true);
    assert.equal(
      result.matches.some(
        (match) => match.resourceType === "ppt" && match.locator.kind === "page" && match.locator.page === 2,
      ),
      true,
    );
  });
});
