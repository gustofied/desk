import assert from "node:assert/strict";
import test from "node:test";
import {
  EQUITY_LAYERS, getCardDefinition, getLayerDefinition, normalizeCardState,
} from "../src/card-registry.js";
import { normalizeCardVisualization } from "../src/card-document.js";
import { createDealViewModel, DEAL_041_PAYLOAD } from "../src/deal-view-model.js";

const COMPARISONS = [
  { id: "chips", label: "Chips", symbol: "NVDA", layers: ["NVDA", "AMD", "TSM"], range: "1y" },
  { id: "hyperscalers", label: "Hyperscalers", symbol: "MSFT", layers: ["MSFT", "AMZN", "GOOGL", "ORCL"], range: "1y" },
  { id: "neoclouds", label: "Neoclouds", symbol: "CRWV", layers: ["CRWV", "NBIS"], range: "1y" },
  { id: "nvidia-compute", label: "NVIDIA + compute", symbol: "NVDA", layers: ["NVDA", "H100", "H200"], range: "90d" },
  { id: "clouds-compute", label: "Clouds + compute", symbol: "CRWV", layers: ["CRWV", "NBIS", "H100", "H200"], range: "90d" },
];

test("showcase comparisons follow all nine unchanged individual equity presets", () => {
  const card = getCardDefinition("equities");
  assert.deepEqual(card.catalogPresets.map(preset => preset.id), [
    ...EQUITY_LAYERS.map(layer => layer.id.toLowerCase()), ...COMPARISONS.map(preset => preset.id),
  ]);
  for (const [index, layer] of EQUITY_LAYERS.entries()) {
    const preset = card.catalogPresets[index];
    assert.equal(preset.label, layer.id);
    assert.deepEqual(preset.state, { symbol: layer.id, layers: [layer.id], scale: "price", range: "1y" });
    const state = normalizeCardState(card.id, preset.state);
    assert.equal(state.symbol, layer.id);
    assert.deepEqual(state.layers, [layer.id]);
    assert.equal(state.scale, "price");
    assert.equal(state.range, "1y");
  }
  assert(Object.isFrozen(card.catalogPresets));
});

test("every comparison preset has a stable canonical symbol and supported index components", () => {
  const card = getCardDefinition("equities");
  for (const expected of COMPARISONS) {
    const preset = card.catalogPresets.find(candidate => candidate.id === expected.id);
    assert.equal(preset.label, expected.label);
    assert(Object.isFrozen(preset));
    assert(Object.isFrozen(preset.state));
    assert(Object.isFrozen(preset.state.layers));
    const state = normalizeCardState(card.id, preset.state);
    assert.equal(state.symbol, expected.symbol);
    assert.equal(state.gpu, expected.symbol, "The internal primary alias remains the selected stock");
    assert.deepEqual(state.layers, expected.layers);
    assert.equal(state.scale, "index");
    assert.equal(state.range, expected.range);
    assert.notEqual(getLayerDefinition(card, state.symbol).primary, false);
    for (const id of state.layers) {
      const layer = getLayerDefinition(card, id);
      assert(layer, `${expected.id} must resolve its ${id} component`);
      assert(layer.views.includes("index"), `${expected.id} must support an indexed ${id} component`);
      const sourceCard = getCardDefinition(layer.sourceCardId || card.id);
      assert(sourceCard.layers.some(sourceLayer => sourceLayer.id === id), `${id} must exist in its source`);
    }
    const canonical = normalizeCardVisualization(card.id, preset.state);
    assert.equal(canonical.symbol, expected.symbol);
    assert.equal(Object.hasOwn(canonical, "gpu"), false, "Persisted equities use symbol, not the internal gpu alias");
    assert.deepEqual(canonical.layers, expected.layers);
    assert.deepEqual(normalizeCardVisualization(card.id, JSON.parse(JSON.stringify(canonical))), canonical);
  }
});

test("compute comparison presets cannot combine hourly and share prices on a dollar scale", () => {
  const card = getCardDefinition("equities");
  const gpuCard = getCardDefinition("gpu-index");
  for (const expected of COMPARISONS.filter(preset => preset.id.endsWith("-compute"))) {
    const preset = card.catalogPresets.find(candidate => candidate.id === expected.id);
    const state = normalizeCardState(card.id, { ...preset.state, scale: "price" });
    assert.equal(state.scale, "index");
    assert.equal(state.symbol, expected.symbol);
    assert.deepEqual(state.layers, expected.layers);
    for (const id of ["H100", "H200"]) {
      const layer = getLayerDefinition(card, id);
      const original = getLayerDefinition(gpuCard, id);
      assert.equal(layer.primary, false);
      assert.equal(layer.sourceCardId, gpuCard.id);
      assert.equal(layer.unit, "usd-hour");
      assert.deepEqual(layer.views, ["index"]);
      assert.equal(layer.strokeDasharray, original.strokeDasharray);
      assert.equal(layer.strokeOpacity, original.strokeOpacity);
      assert.equal(original.sourceCardId, undefined, "The original GPU layer is unchanged");
    }
  }
});

test("quote showcase presets keep the Quote name and select their intended GPU and terms", () => {
  const card = getCardDefinition("quote-view");
  assert.equal(card.title, "Quote");
  assert.equal(card.craftLabel, "Quote");
  assert.equal(card.dataTable.label, "Quote");
  assert.deepEqual(card.catalogPresets.map(preset => [preset.id, preset.label]), [
    ["b200", "Quote B200"], ["h200", "Quote H200"],
  ]);
  assert.deepEqual(normalizeCardState(card.id, card.catalogPresets[0].state), normalizeCardState(card.id));
  for (const [index, asset] of ["B200", "H200"].entries()) {
    const preset = card.catalogPresets[index];
    const state = normalizeCardState(card.id, preset.state);
    assert(Object.isFrozen(preset));
    assert.equal(state.gpu, asset);
    assert.deepEqual(state.layers, [asset]);
    assert.equal(state.quote, asset === "H200" ? 2.85 : 3.65);
    assert.equal(state.quantity, 256);
    assert.equal(state.rfs, "2026-10");
    assert.equal(state.range, "7d");
    assert.equal(state.scale, "price");
    assert(getLayerDefinition(card, asset).views.includes(state.scale));
    const model = createDealViewModel(DEAL_041_PAYLOAD, { kind: "quote", viewName: preset.label, overrides: state });
    assert.equal(model.label, preset.label);
    assert.equal(model.asset, asset);
    assert.equal(model.quote.value, state.quote);
    assert(model.ariaLabel.startsWith(`${preset.label},`));
    assert(!model.ariaLabel.includes("Quote 041"));
    assert.equal(model.id, "041", "Quote preset display names do not rewrite the negotiation source identity");
  }
});

test("quote examples retain their existing private source and leave the Deal preset unchanged", () => {
  const quote = getCardDefinition("quote-view");
  const deal = getCardDefinition("deal-view");
  assert.equal(quote.sourceCardId, deal.id);
  assert.equal(quote.dataFile, deal.dataFile);
  assert.equal(quote.publishable, false);
  assert.equal(deal.publishable, false);
  assert.equal(quote.allowComparisons, false);
  assert.deepEqual(deal.catalogPresets, [{ id: "deal-041", label: "Deal 041" }]);
  assert.equal(deal.title, "Deal 041");
});
