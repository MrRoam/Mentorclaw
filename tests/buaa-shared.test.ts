import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { normalizeTeacherLabel } from "../src/education/providers/buaa/shared.ts";

describe("BUAA shared parsing", () => {
  test("removes BYXT week fragments before keeping the teacher name", () => {
    assert.equal(normalizeTeacherLabel("周,周单[实践] 武在冶"), "武在冶");
    assert.equal(normalizeTeacherLabel("周,周 单[实践] 武在冶"), "武在冶");
    assert.equal(normalizeTeacherLabel("第1-16周[理论]/张永飞[主讲]"), "张永飞");
  });
});
