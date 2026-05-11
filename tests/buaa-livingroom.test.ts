import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import { importBuaaLivingroomCapture } from "../src/education/providers/buaa/msa.ts";
import { EducationRepo } from "../src/storage/education-repo.ts";
import { createRuntimeFixture } from "./helpers.ts";

describe("importBuaaLivingroomCapture", () => {
  test("stores subtitle, notes, and PPT print assets under the runtime", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const repo = new EducationRepo(runtimeRoot);

    const result = await importBuaaLivingroomCapture(repo, {
      courseId: "course-1",
      replaySourceId: "msa-replay:course-1:sub-1",
      replayTitle: "Lecture 01",
      courseTitle: "Operating Systems",
      teacher: "Prof. Li",
      term: "2026 Spring",
      subtitleData: [
        {
          all_content: [
            { BeginSec: 0, EndSec: 2, Text: "First line" },
            { BeginSec: 3, EndSec: 5, Text: "Second line" },
          ],
        },
      ],
      pptData: [
        {
          created_sec: 0,
          content: JSON.stringify({ pptimgurl: "https://cdn.example/slide-1.jpg" }),
        },
      ],
    });

    assert.equal(result.importedCourses, 1);
    assert.equal(result.importedItems, 1);
    assert.equal(result.importedResources, 3);

    const snapshot = await repo.readSnapshot();
    assert.equal(snapshot.courseItems.length, 1);
    assert.equal(snapshot.courseResources.length, 3);

    const subtitle = snapshot.courseResources.find((resource) => resource.resourceType === "subtitle");
    const notes = snapshot.courseResources.find((resource) => resource.resourceType === "notes");
    const ppt = snapshot.courseResources.find((resource) => resource.resourceType === "ppt");

    assert.ok(subtitle?.localPath);
    assert.ok(notes?.localPath);
    assert.ok(ppt?.localPath);

    const subtitleText = await readFile(path.join(runtimeRoot, subtitle!.localPath!), "utf8");
    const notesText = await readFile(path.join(runtimeRoot, notes!.localPath!), "utf8");
    const pptHtml = await readFile(path.join(runtimeRoot, ppt!.localPath!), "utf8");

    assert.match(subtitleText, /First line/);
    assert.match(notesText, /\[00:00:00\] First line/);
    assert.match(pptHtml, /Operating Systems - Lecture 01/);
  });
});
