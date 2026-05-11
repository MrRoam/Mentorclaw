import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { EducationRepo } from "../src/storage/education-repo.ts";
import { createRuntimeFixture } from "./helpers.ts";

describe("EducationRepo", () => {
  test("creates the education scaffold and persists course data", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const repo = new EducationRepo(runtimeRoot);

    await repo.ensureScaffold();
    const empty = await repo.readSnapshot();
    assert.deepEqual(empty.connections, []);
    assert.deepEqual(empty.courses, []);
    assert.deepEqual(empty.courseItems, []);
    assert.deepEqual(empty.courseResources, []);
    assert.deepEqual(empty.schedulePreferences, {
      showTimetableInSchedule: true,
      scheduleDefaultView: "week",
    });

    await repo.writeCourses([
      {
        id: "course-linear-algebra",
        stableKey: "2026-spring-linear-algebra",
        title: "Linear Algebra",
        teacher: "Prof. Zhao",
        term: "2026 Spring",
        sourceType: "manual-import",
        sourceCourseId: "LA-01",
        status: "active",
        displayColor: "#4d7de0",
        metadata: {},
      },
    ]);
    await repo.writeCourseItems([
      {
        id: "item-la-001",
        courseId: "course-linear-algebra",
        type: "class",
        sourceItemId: "source-la-001",
        title: "Linear Algebra",
        teacher: "Prof. Zhao",
        startAt: "2026-04-13T08:00:00.000+08:00",
        endAt: "2026-04-13T09:35:00.000+08:00",
        dueAt: null,
        location: "J3-201",
        body: "",
        metaJson: {},
        isHidden: false,
        manualTitle: null,
        manualLocation: null,
        manualStartAt: null,
        manualEndAt: null,
        manualNote: null,
        lastSyncedAt: "2026-04-09T12:00:00.000Z",
      },
    ]);
    await repo.writeCourseResources([
      {
        id: "resource-la-replay-subtitle",
        courseId: "course-linear-algebra",
        linkedItemId: "item-la-001",
        parentId: null,
        resourceType: "subtitle",
        title: "Lecture Subtitle",
        url: "https://example.com/lecture.srt",
        localPath: null,
        metaJson: { language: "zh-CN" },
      },
    ]);

    const stored = await repo.readSnapshot();
    assert.equal(stored.courses.length, 1);
    assert.equal(stored.courseItems.length, 1);
    assert.equal(stored.courseResources.length, 1);
    assert.equal(stored.courseItems[0].location, "J3-201");
    assert.equal(stored.courseResources[0].linkedItemId, "item-la-001");
  });

  test("updates schedule preferences without losing the other field", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const repo = new EducationRepo(runtimeRoot);

    await repo.ensureScaffold();
    await repo.updateSchedulePreferences({ scheduleDefaultView: "month" });
    await repo.updateSchedulePreferences({ showTimetableInSchedule: false });

    const preferences = await repo.readSchedulePreferences();
    assert.deepEqual(preferences, {
      showTimetableInSchedule: false,
      scheduleDefaultView: "month",
    });
  });
});
