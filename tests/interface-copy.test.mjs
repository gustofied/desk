import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("authored interface copy has no decorative dot separators", async () => {
  for (const file of [
    "src/main.js", "src/monitor-data-model.js", "src/monitor-data-rail.js",
    "src/desk-sharing-ui.js", "scripts/build-card-previews.mjs", "index.html",
  ]) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /[·•]|&(?:middot|bull);|\\u(?:00b7|2022)/i, file);
  }
});
