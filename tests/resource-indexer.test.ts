import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { importEducationDocument } from "../src/education/importer.ts";
import { ResourceIndexer } from "../src/education/resource-indexer.ts";
import { EducationRepo } from "../src/storage/education-repo.ts";
import { createImageFixture, createPdfFixture, createPptxFixture, createRuntimeFixture, withTestServer } from "./helpers.ts";

describe("ResourceIndexer", () => {
  test("indexes subtitle segments by timestamp", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const subtitlePath = path.join(runtimeRoot, "subtitle.srt");
    await writeFile(
      subtitlePath,
      `1
00:00:05,000 --> 00:00:12,000
The instructor first explains convolution graphically.

2
00:00:12,500 --> 00:00:20,000
Then the lecture writes the convolution integral formally.
`,
      "utf8",
    );

    const repo = new EducationRepo(runtimeRoot);
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
              sourceResourceId: "subtitle-5",
              resourceType: "subtitle",
              title: "Lecture 5 subtitle",
              url: "https://example.com/subtitle-5",
              localPath: subtitlePath,
            },
          ],
        },
      ],
    });

    const resource = (await repo.readCourseResources())[0];
    assert.ok(resource);
    const indexer = new ResourceIndexer(repo);
    const index = await indexer.ensureIndexed(resource);

    assert.ok(index);
    assert.equal(index.segments.length, 2);
    assert.equal(index.segments[0]?.kind, "timestamp");
    assert.equal(index.segments[0]?.startSec, 5);
  });

  test("indexes html slides and pdf pages, and rebuilds when source changes", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const htmlPath = path.join(runtimeRoot, "slides.html");
    await writeFile(
      htmlPath,
      `
      <html><body>
        <section><h1>Slide 1</h1><p>Graphical view of convolution</p></section>
        <section><h1>Slide 2</h1><p>Convolution integral definition</p></section>
      </body></html>
      `,
      "utf8",
    );
    const pdfPath = await createPdfFixture(runtimeRoot, "textbook.pdf", [
      "Page 1 covers impulse response.",
      "Page 2 covers the convolution definition and convolution integral.",
    ]);

    const repo = new EducationRepo(runtimeRoot);
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
              sourceResourceId: "ppt-5",
              resourceType: "ppt",
              title: "Lecture 5 slides",
              url: "https://example.com/slides-5",
              localPath: htmlPath,
            },
            {
              sourceResourceId: "book",
              resourceType: "pdf",
              title: "Signals textbook",
              url: "https://example.com/book",
              localPath: pdfPath,
            },
          ],
        },
      ],
    });

    const resources = await repo.readCourseResources();
    const ppt = resources.find((resource) => resource.resourceType === "ppt");
    const pdf = resources.find((resource) => resource.resourceType === "pdf");
    assert.ok(ppt);
    assert.ok(pdf);

    const indexer = new ResourceIndexer(repo);
    const pptIndex = await indexer.ensureIndexed(ppt);
    const pdfIndex = await indexer.ensureIndexed(pdf);
    assert.ok(pptIndex);
    assert.ok(pdfIndex);
    assert.equal(pptIndex.segments[0]?.kind, "page");
    assert.equal(pptIndex.segments.length, 2);
    assert.equal(pdfIndex.segments.length, 2);

    await writeFile(
      htmlPath,
      `
      <html><body>
        <section><h1>Slide 1</h1><p>Updated graphical view of convolution</p></section>
      </body></html>
      `,
      "utf8",
    );
    const rebuilt = await indexer.ensureIndexed(ppt);
    assert.ok(rebuilt);
    assert.equal(rebuilt.sourceFingerprint === pptIndex.sourceFingerprint, false);
    assert.equal(rebuilt.segments.length, 1);
  });

  test("indexes pptx slides by page order", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const pptxPath = await createPptxFixture(runtimeRoot, "ai-intro.pptx", [
      "AI history overview",
      "Perception, knowledge representation, and reasoning",
    ]);

    const repo = new EducationRepo(runtimeRoot);
    await importEducationDocument(repo, {
      sourceType: "fixture",
      courses: [
        {
          sourceCourseId: "ai-101",
          title: "Introduction to Artificial Intelligence",
          teacher: "Prof. Zhang",
          term: "2026 Spring",
          resources: [
            {
              sourceResourceId: "pptx-2",
              resourceType: "pptx",
              title: "AI Intro Lecture 2",
              url: "file://ai-intro.pptx",
              localPath: pptxPath,
            },
          ],
        },
      ],
    });

    const resource = (await repo.readCourseResources())[0];
    assert.ok(resource);
    const indexer = new ResourceIndexer(repo);
    const index = await indexer.ensureIndexed(resource);

    assert.ok(index);
    assert.equal(index.segments.length, 2);
    assert.equal(index.segments[0]?.kind, "page");
    assert.equal(index.segments[0]?.page, 1);
    assert.match(index.segments[0]?.text ?? "", /AI history overview/);
    assert.match(index.segments[1]?.text ?? "", /Perception/);
  });

  test("indexes image-only platform slides via OCR", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const slide1Path = await createImageFixture(runtimeRoot, "0.jpg", "Convolution graph method");
    const slide2Path = await createImageFixture(runtimeRoot, "82370.jpg", "Convolution integral definition");
    const htmlPath = path.join(runtimeRoot, "slides.html");
    await writeFile(
      htmlPath,
      `<html><body><img src="${slide1Path}" /><img src="${slide2Path}" /></body></html>`,
      "utf8",
    );

    const repo = new EducationRepo(runtimeRoot);
    await importEducationDocument(repo, {
      sourceType: "fixture",
      courses: [
        {
          sourceCourseId: "ai-101",
          title: "Introduction to Artificial Intelligence",
          teacher: "Prof. Zhang",
          term: "2026 Spring",
          resources: [
            {
              sourceResourceId: "platform-ppt",
              resourceType: "ppt",
              title: "Lecture slides",
              url: "file://slides.html",
              localPath: htmlPath,
              metaJson: {
                imageUrls: [slide1Path, slide2Path],
              },
            },
          ],
        },
      ],
    });

    const resource = (await repo.readCourseResources())[0];
    const indexer = new ResourceIndexer(repo);
    const index = await indexer.ensureIndexed(resource);

    assert.ok(index);
    assert.equal(index.segments.length, 2);
    assert.equal(index.segments[0]?.kind, "page");
    assert.match((index.segments[0]?.text ?? "").toLowerCase(), /convolution/);
  });

  test("indexes remote image-only platform slides via OCR", async () => {
    const runtimeRoot = await createRuntimeFixture();
    const slide1Path = await createImageFixture(runtimeRoot, "0.jpg", "Neural network overview");
    const slide2Path = await createImageFixture(runtimeRoot, "12000.jpg", "Gradient descent steps");

    await withTestServer((request, response) => {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const fileName = url.pathname.slice(1);
      const source = fileName === "0.jpg" ? slide1Path : fileName === "12000.jpg" ? slide2Path : null;
      if (!source) {
        response.writeHead(404);
        response.end("missing");
        return;
      }
      void readFile(source)
        .then((buffer) => {
          response.writeHead(200, { "content-type": "image/jpeg" });
          response.end(buffer);
        })
        .catch(() => {
          response.writeHead(500);
          response.end("error");
        });
    }, async (baseUrl) => {
      const htmlPath = path.join(runtimeRoot, "remote-slides.html");
      await writeFile(
        htmlPath,
        `<html><body><img src="${baseUrl}/0.jpg" /><img src="${baseUrl}/12000.jpg" /></body></html>`,
        "utf8",
      );

      const repo = new EducationRepo(runtimeRoot);
      await importEducationDocument(repo, {
        sourceType: "fixture",
        courses: [
          {
            sourceCourseId: "ml-101",
            title: "Machine Learning",
            teacher: "Prof. Liu",
            term: "2026 Spring",
            resources: [
              {
                sourceResourceId: "remote-ppt",
                resourceType: "ppt",
                title: "Remote slides",
                url: `${baseUrl}/0.jpg`,
                localPath: htmlPath,
                metaJson: {
                  imageUrls: [`${baseUrl}/0.jpg`, `${baseUrl}/12000.jpg`],
                },
              },
            ],
          },
        ],
      });

      const resource = (await repo.readCourseResources())[0];
      const indexer = new ResourceIndexer(repo);
      const index = await indexer.ensureIndexed(resource);
      assert.ok(index);
      assert.equal(index.segments.length, 2);
      assert.match(index.segments.map((segment) => segment.text).join(" ").toLowerCase(), /gradient|neural/);
    });
  });
});
