import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { importEducationDocument } from "../src/education/importer.ts";
import { EducationRepo } from "../src/storage/education-repo.ts";
import { createRuntimeFixture } from "./helpers.ts";

describe("importEducationDocument", () => {
  test("imports courses, timetable items, replay items, and resources into the education store", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const repo = new EducationRepo(runtimeRoot);

    const result = await importEducationDocument(repo, {
      sourceType: "fixture-import",
      connection: {
        sourceType: "fixture-import",
        accountLabel: "sample-learner",
      },
      courses: [
        {
          sourceCourseId: "LA-01",
          title: "Linear Algebra",
          teacher: "Prof. Zhao",
          term: "2026 Spring",
          items: [
            {
              sourceItemId: "LA-CLASS-001",
              type: "class",
              title: "Linear Algebra",
              teacher: "Prof. Zhao",
              startAt: "2026-04-13T08:00:00.000+08:00",
              endAt: "2026-04-13T09:35:00.000+08:00",
              location: "J3-201",
            },
            {
              sourceItemId: "LA-REPLAY-008",
              type: "replay",
              title: "Lecture 08 Replay",
              startAt: "2026-04-12T19:00:00.000+08:00",
              endAt: "2026-04-12T20:35:00.000+08:00",
            },
          ],
          resources: [
            {
              sourceResourceId: "LA-REPLAY-008-SRT",
              linkedItemSourceId: "LA-REPLAY-008",
              resourceType: "subtitle",
              title: "Lecture 08 Subtitle",
              url: "https://example.com/subtitle.srt",
            },
          ],
        },
      ],
    });

    const snapshot = await repo.readSnapshot();
    assert.equal(result.importedCourses, 1);
    assert.equal(result.importedItems, 2);
    assert.equal(result.importedResources, 1);
    assert.equal(snapshot.connections.length, 1);
    assert.equal(snapshot.courses.length, 1);
    assert.equal(snapshot.courseItems.length, 2);
    assert.equal(snapshot.courseResources.length, 1);
    assert.equal(snapshot.courseResources[0].linkedItemId, snapshot.courseItems.find((item) => item.type === "replay")?.id ?? null);
  });

  test("preserves manual overrides when the same item is imported again", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const repo = new EducationRepo(runtimeRoot);

    await importEducationDocument(repo, {
      sourceType: "fixture-import",
      courses: [
        {
          sourceCourseId: "LA-01",
          title: "Linear Algebra",
          teacher: "Prof. Zhao",
          term: "2026 Spring",
          items: [
            {
              sourceItemId: "LA-CLASS-001",
              type: "class",
              title: "Linear Algebra",
              startAt: "2026-04-13T08:00:00.000+08:00",
              endAt: "2026-04-13T09:35:00.000+08:00",
              location: "J3-201",
            },
          ],
        },
      ],
    });

    const snapshot = await repo.readSnapshot();
    snapshot.courseItems[0].manualLocation = "Updated Room";
    await repo.writeCourseItems(snapshot.courseItems);

    await importEducationDocument(repo, {
      sourceType: "fixture-import",
      courses: [
        {
          sourceCourseId: "LA-01",
          title: "Linear Algebra",
          teacher: "Prof. Zhao",
          term: "2026 Spring",
          items: [
            {
              sourceItemId: "LA-CLASS-001",
              type: "class",
              title: "Linear Algebra",
              startAt: "2026-04-13T08:00:00.000+08:00",
              endAt: "2026-04-13T09:35:00.000+08:00",
              location: "J3-202",
            },
          ],
        },
      ],
    });

    const updated = await repo.readSnapshot();
    assert.equal(updated.courseItems.length, 1);
    assert.equal(updated.courseItems[0].location, "J3-202");
    assert.equal(updated.courseItems[0].manualLocation, "Updated Room");
  });

  test("merges courses from different sources when they share the same stable key hint", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const repo = new EducationRepo(runtimeRoot);

    await importEducationDocument(repo, {
      sourceType: "buaa-byxt",
      courses: [
        {
          stableKeyHint: "linear-algebra|prof-zhao",
          sourceCourseId: "BYXT-LA-01",
          title: "Linear Algebra",
          teacher: "Prof. Zhao",
          term: "2026 Spring",
        },
      ],
    });

    await importEducationDocument(repo, {
      sourceType: "buaa-msa",
      courses: [
        {
          stableKeyHint: "linear-algebra|prof-zhao",
          sourceCourseId: "MSA-LA-77",
          title: "Linear Algebra",
          teacher: "Prof. Zhao",
          term: "2026 Spring",
          items: [
            {
              sourceItemId: "MSA-REPLAY-01",
              type: "replay",
              title: "Lecture 01 Replay",
            },
          ],
        },
      ],
    });

    const snapshot = await repo.readSnapshot();
    assert.equal(snapshot.courses.length, 1);
    assert.equal(snapshot.courseItems.length, 1);
    assert.equal(snapshot.courseItems[0].courseId, snapshot.courses[0].id);
  });

  test("does not collapse same-source courses when source course ids are distinct", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const repo = new EducationRepo(runtimeRoot);

    await importEducationDocument(repo, {
      sourceType: "buaa-byxt",
      courses: [
        {
          stableKeyHint: "英语阅读（2）|周欢",
          sourceCourseId: "B120013014:069",
          title: "英语阅读（2）",
          teacher: "周欢",
          term: "2026春季",
        },
        {
          stableKeyHint: "体育（2）|高胜杰",
          sourceCourseId: "P000000001:001",
          title: "体育（2）",
          teacher: "高胜杰",
          term: "2026春季",
        },
      ],
    });

    const snapshot = await repo.readSnapshot();
    assert.equal(snapshot.courses.length, 2);
    assert.notEqual(snapshot.courses[0].id, snapshot.courses[1].id);
  });
});
