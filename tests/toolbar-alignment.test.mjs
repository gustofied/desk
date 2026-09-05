import assert from "node:assert/strict";
import test from "node:test";
import { toolbarCenterY } from "../src/toolbar-alignment.js";

test("the toolbar has equal gaps above and below without moving the content", () => {
  for (const contentTop of [80, 200, 440.296875]) {
    const height = 38;
    const center = toolbarCenterY(contentTop, height);
    assert.equal(center - height / 2, contentTop - (center + height / 2));
  }
});

test("the toolbar stays on screen when the available gap is too short", () => {
  assert.equal(toolbarCenterY(24, 38) - 38 / 2, 8);
  assert.equal(toolbarCenterY(0, 46) - 46 / 2, 8);
});
