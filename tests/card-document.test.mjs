import assert from "node:assert/strict";
import test from "node:test";
import {
  createCardDocument, migrateCardVisualizationState, normalizeCardDocument,
} from "../src/card-document.js";

test("the legacy visualization adapter copies only exact equities All to one year", () => {
  const state = Object.freeze({ symbol: "NVDA", range: "all", invalid: "preserved" });
  assert.deepEqual(migrateCardVisualizationState("equities", state), {
    symbol: "NVDA", range: "1y", invalid: "preserved",
  });
  assert.equal(state.range, "all");
  assert.notEqual(migrateCardVisualizationState("equities", state), state);
  for (const cardId of ["gpu-index", "power-basis", "unknown"]) {
    assert.equal(migrateCardVisualizationState(cardId, state), state);
  }
  for (const value of [null, undefined, [], "all", { range: "ALL" }, { range: "invalid" }, { range: "1y" }, {}]) {
    assert.equal(migrateCardVisualizationState("equities", value), value);
  }
});

test("ordinary saved equity documents retain identity and composition when All becomes one year", () => {
  const document = createCardDocument({
    id: "saved-equities", cardId: "equities", name: "NVIDIA and compute",
    state: { symbol: "NVDA", layers: ["NVDA", "H100", "H200"], scale: "index", range: "1y" },
    createdAt: "2026-09-06T00:00:00.000Z",
  });
  const legacy = structuredClone(document);
  legacy.visualization.range = "all";
  assert.deepEqual(normalizeCardDocument(legacy), document);
  assert.equal(legacy.visualization.range, "all");
});
