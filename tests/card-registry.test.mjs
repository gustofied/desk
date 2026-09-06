import assert from "node:assert/strict";
import test from "node:test";
import {
  CARD_REGISTRY, EQUITY_LAYERS, RANGES, cardStateParamIds,
  getCardDefinition, normalizeCardState, publishedCardSharePath,
} from "../src/card-registry.js";
import { normalizeCardVisualization } from "../src/card-document.js";

const SYMBOLS = ["MSFT", "AMZN", "GOOGL", "ORCL", "CRWV", "NBIS", "NVDA", "AMD", "TSM"];

test("Equities has a separate USD-per-share line source without changing existing card order", () => {
  assert.deepEqual(CARD_REGISTRY.slice(0, 6).map(card => card.id), [
    "gpu-index", "gpu-price-snapshot", "gpu-market-depth", "power-basis", "quote-view", "deal-view",
  ]);
  const card = getCardDefinition("equities");
  assert.equal(card.id, "equities");
  assert.equal(card.renderer, "line");
  assert.equal(card.primaryParam, "symbol");
  assert.equal(card.dataAdapter, "series");
  assert.equal(card.dataFile, "data/equities.json");
  assert.equal(card.dataUrl, "./data/equities.json");
  assert.equal(card.dataTable, undefined, "Provider-sourced equities must not be exposed as a Desk API table");
  assert.equal(card.allowComparisons, true);
  assert.deepEqual(card.visualizations.map(view => [view.id, view.unit]), [["price", "usd-share"], ["index", "index"]]);
});

test("all nine equity layers retain company and group metadata in the requested order", () => {
  assert.deepEqual(EQUITY_LAYERS.map(layer => layer.id), SYMBOLS);
  assert.deepEqual(EQUITY_LAYERS.map(layer => layer.group), [
    "hyperscalers", "hyperscalers", "hyperscalers", "hyperscalers",
    "neoclouds", "neoclouds", "semiconductors", "semiconductors", "semiconductors",
  ]);
  for (const layer of EQUITY_LAYERS) {
    assert.equal(layer.label, layer.id);
    assert.equal(layer.unit, "usd-share");
    assert(layer.companyName.length > 0);
    assert(layer.groupLabel.length > 0);
    assert.deepEqual(layer.views, ["price", "index"]);
    assert(Object.isFrozen(layer));
    assert(Object.isFrozen(layer.views));
  }
  assert(Object.isFrozen(EQUITY_LAYERS));
});

test("Equities defaults to NVDA price over one year and stores symbol canonically", () => {
  const state = normalizeCardState("equities");
  assert.deepEqual(state, {
    gpu: "NVDA", symbol: "NVDA", layers: ["NVDA"], scale: "price",
    range: "1y", palette: "linen", theme: "dark",
  });
  const fields = ["symbol", "layers", "scale", "range", "palette", "theme"];
  assert.deepEqual(cardStateParamIds(getCardDefinition("equities")), fields);
  const documentState = normalizeCardVisualization("equities", state);
  assert.deepEqual(Object.keys(documentState), fields);
  assert.equal(Object.hasOwn(documentState, "gpu"), false);
});

test("equity comparison states normalize case/order while preserving the selected symbol", () => {
  const state = normalizeCardState("equities", {
    symbol: "amd", gpu: "H100", layers: ["AMD", "msft", "NVDA", "AMD"],
    scale: "INDEX", range: "90D", palette: "AZURE", theme: "LIGHT",
  });
  assert.deepEqual(state, {
    gpu: "AMD", symbol: "AMD", layers: ["MSFT", "NVDA", "AMD"],
    scale: "index", range: "90d", palette: "azure", theme: "light",
  });
  assert.equal(normalizeCardState("equities", { gpu: "TSM" }).symbol, "TSM", "existing renderer alias remains compatible");
});

test("equities cannot inherit GPU spread or accelerator layers and old cards keep their ranges", () => {
  const state = normalizeCardState("equities", {
    symbol: "H100", layers: ["H100", "TOKEN"], scale: "spread", range: "1d",
  });
  assert.deepEqual([state.symbol, state.layers, state.scale, state.range], ["NVDA", ["NVDA"], "price", "1y"]);
  assert.deepEqual(getCardDefinition("gpu-index").ranges, ["1d", "7d", "all"]);
  assert.equal(normalizeCardState("gpu-index", { range: "1y" }).range, "7d");
  assert.equal(normalizeCardState("power-basis", { range: "90d" }).range, "1d");
  assert.deepEqual(getCardDefinition("equities").ranges, ["7d", "90d", "1y", "all"]);
  assert.equal(RANGES["90d"].milliseconds, 90 * 86400000);
  assert.equal(RANGES["1y"].milliseconds, 365 * 86400000);
  assert.equal(RANGES.all.milliseconds, null);
});

test("each equity preset selects exactly its symbol and retains the one-year price view", () => {
  const card = getCardDefinition("equities");
  assert.deepEqual(card.catalogPresets.map(preset => preset.id), SYMBOLS.map(symbol => symbol.toLowerCase()));
  for (const [index, preset] of card.catalogPresets.entries()) {
    const state = normalizeCardVisualization(card.id, preset.state);
    assert.equal(preset.label, SYMBOLS[index]);
    assert.equal(state.symbol, SYMBOLS[index]);
    assert.deepEqual(state.layers, [SYMBOLS[index]]);
    assert.equal(state.range, "1y");
    assert.equal(state.scale, "price");
    assert(Object.isFrozen(preset.state.layers));
    assert(publishedCardSharePath(card.id, state).startsWith(`/cards/equities/published/${SYMBOLS[index].toLowerCase()}/`));
  }
});
