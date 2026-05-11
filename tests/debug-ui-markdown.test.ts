import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderMarkdown } from "../src/debug-ui/static/markdown.js";

describe("renderMarkdown", () => {
  test("renders headings, lists, and tables for chat bubbles", () => {
    const html = renderMarkdown(`
### 最重要的一步

1. **先找题**
2. 看答案

| 天 | 核心任务 |
| --- | --- |
| Day1 | 找真题 |
| Day2 | 阅读 |
    `);

    assert.match(html, /<h3>最重要的一步<\/h3>/);
    assert.match(html, /<ol>/);
    assert.match(html, /<strong>先找题<\/strong>/);
    assert.match(html, /<table>/);
    assert.match(html, /<td>Day1<\/td>/);
  });

  test("escapes raw html before rendering markdown", () => {
    const html = renderMarkdown(`<script>alert(1)</script>\n\n**safe**`);

    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /<strong>safe<\/strong>/);
  });
});
