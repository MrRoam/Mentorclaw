import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { importEducationDocument } from "../src/education/importer.ts";
import { ProjectResourceService } from "../src/education/project-resource-service.ts";
import { EducationRepo } from "../src/storage/education-repo.ts";
import { createRuntimeFixture } from "./helpers.ts";

describe("ProjectResourceService", () => {
  test("selects lecture-related course items and linked resources for a course-bound project", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const repo = new EducationRepo(runtimeRoot);

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
              sourceItemId: "class-5",
              type: "class",
              title: "第5讲 卷积",
              startAt: "2026-04-10T08:00:00.000+08:00",
              body: "课堂讲了卷积的直观意义、图形法和积分表达。",
            },
            {
              sourceItemId: "replay-5",
              type: "replay",
              title: "第5讲 回放",
              startAt: "2026-04-10T08:00:00.000+08:00",
              body: "回放资源入口",
            },
          ],
          resources: [
            {
              sourceResourceId: "ppt-5",
              linkedItemSourceId: "class-5",
              resourceType: "ppt",
              title: "第5讲课件",
              url: "https://example.com/signals/ppt-5",
            },
            {
              sourceResourceId: "sub-5",
              linkedItemSourceId: "replay-5",
              resourceType: "subtitle",
              title: "第5讲字幕",
              url: "https://example.com/signals/sub-5",
            },
          ],
        },
      ],
    });

    const service = new ProjectResourceService(repo);
    const context = await service.buildContext(
      {
        projectId: "signals-midterm",
        title: "Signals Midterm Review",
        status: "active",
        createdAt: null,
        updatedAt: null,
        scope: {
          type: "course",
          courseIds: ["course-2026-spring:fixture:signals-101"],
        },
        goal: {
          summary: "Understand lecture 5 and review convolution",
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
      },
      "老师第五讲怎么讲卷积的？",
    );

    assert.equal(context.courses.length, 1);
    assert.equal(context.relevantItems.some((item) => item.title.includes("第5讲")), true);
    assert.equal(context.relevantResources.some((resource) => resource.title.includes("字幕")), true);
    assert.equal(context.summaryLines.some((line) => line.includes("Relevant course items")), true);
  });

  test("treats linked BYXT and MSA course records as one course scope", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const repo = new EducationRepo(runtimeRoot);
    await repo.ensureScaffold();
    await repo.writeCourses([
      {
        id: "course-byxt-ai",
        stableKey: "2026:buaa-byxt:B410026001:015",
        title: "Artificial Intelligence",
        teacher: "[Theory] Prof. Zhang",
        term: "2026 Spring",
        sourceType: "buaa-byxt",
        sourceCourseId: "B410026001:015",
        status: "active",
        displayColor: null,
        metadata: {
          sourceAliases: {
            "buaa-byxt": "B410026001:015",
          },
        },
      },
      {
        id: "course-msa-ai",
        stableKey: "2026:buaa-msa:138894",
        title: "Artificial Intelligence",
        teacher: "Prof. Zhang",
        term: "2026 Spring",
        sourceType: "buaa-msa",
        sourceCourseId: "138894",
        status: "active",
        displayColor: null,
        metadata: {
          msaCourseId: "138894",
          byxtCourseId: "course-byxt-ai",
          sourceAliases: {
            "buaa-msa": "138894",
          },
        },
      },
    ]);
    await repo.writeCourseResources([
      {
        id: "resource-msa-slides",
        courseId: "course-msa-ai",
        linkedItemId: null,
        parentId: null,
        resourceType: "ppt",
        title: "Neural network slides",
        url: "https://example.com/slides",
        localPath: null,
        metaJson: {},
      },
    ]);

    const service = new ProjectResourceService(repo);
    const context = await service.buildContext(
      {
        projectId: "ai-review",
        title: "AI Review",
        status: "active",
        createdAt: null,
        updatedAt: null,
        scope: {
          type: "course",
          courseIds: ["course-byxt-ai"],
        },
        goal: {
          summary: "Review AI slides",
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
          preferredTypes: ["ppt"],
          notes: [],
        },
        summary: "",
      },
      "open the ppt slides",
    );

    assert.equal(context.courses.some((course) => course.id === "course-msa-ai"), true);
    assert.equal(context.relevantResources.some((resource) => resource.id === "resource-msa-slides"), true);
  });
});
