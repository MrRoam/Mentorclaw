import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { importEducationDocument } from "../src/education/importer.ts";
import { listScheduleEvents, updateCourseItemOverrides } from "../src/education/query.ts";
import { EducationRepo } from "../src/storage/education-repo.ts";
import { createRuntimeFixture } from "./helpers.ts";

describe("education query helpers", () => {
  test("lists schedule events with manual overrides applied", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const repo = new EducationRepo(runtimeRoot);

    await importEducationDocument(repo, {
      sourceType: "fixture",
      courses: [
        {
          sourceCourseId: "course-1",
          title: "Signals",
          teacher: "Prof. Wang",
          term: "2026 Spring",
          items: [
            {
              sourceItemId: "class-1",
              type: "class",
              title: "Signals",
              startAt: "2026-04-13T08:00:00.000+08:00",
              endAt: "2026-04-13T09:35:00.000+08:00",
              location: "J3-201",
            },
          ],
        },
      ],
    });

    const snapshot = await repo.readSnapshot();
    const itemId = snapshot.courseItems[0].id;
    await updateCourseItemOverrides(repo, itemId, {
      manualTitle: "Signals (Adjusted)",
      manualLocation: "J3-999",
    });

    const updated = await repo.readSnapshot();
    const events = listScheduleEvents(
      updated,
      "2026-04-12T00:00:00.000+08:00",
      "2026-04-14T00:00:00.000+08:00",
      true,
    );

    assert.equal(events.length, 1);
    assert.equal(events[0].title, "Signals (Adjusted)");
    assert.equal(events[0].location, "J3-999");
  });

  test("can hide a course item without deleting it", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const repo = new EducationRepo(runtimeRoot);

    await importEducationDocument(repo, {
      sourceType: "fixture",
      courses: [
        {
          sourceCourseId: "course-1",
          title: "Signals",
          teacher: "Prof. Wang",
          term: "2026 Spring",
          items: [
            {
              sourceItemId: "class-1",
              type: "class",
              title: "Signals",
              startAt: "2026-04-13T08:00:00.000+08:00",
              endAt: "2026-04-13T09:35:00.000+08:00",
            },
          ],
        },
      ],
    });

    const before = await repo.readSnapshot();
    await updateCourseItemOverrides(repo, before.courseItems[0].id, { isHidden: true });
    const after = await repo.readSnapshot();
    const events = listScheduleEvents(
      after,
      "2026-04-12T00:00:00.000+08:00",
      "2026-04-14T00:00:00.000+08:00",
      true,
    );

    assert.equal(after.courseItems.length, 1);
    assert.equal(after.courseItems[0].isHidden, true);
    assert.equal(events.length, 0);
  });
});
