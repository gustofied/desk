import assert from "node:assert/strict";
import test from "node:test";
import {
  CARD_REGISTRY, EQUITY_LAYERS, POWER_BASIS_LAYERS, SANDBOX_PROVIDER_LAYERS, RANGES, cardStateParamIds,
  getCardDefinition, normalizeCardState, publishedCardSharePath, serializeLayerIds,
} from "../src/card-registry.js";
import { createCardDocument, normalizeCardDocument, normalizeCardVisualization } from "../src/card-document.js";
import { createSharedDesk, decodeSharedDesk, encodeSharedDesk } from "../src/shared-desk.js";
import { createMarketWatchlist } from "../src/market-watchlist.js";

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

test("H100 and H200 are styled, index-only external comparison layers, never equity primaries", () => {
  const card = getCardDefinition("equities");
  assert.deepEqual(card.layers.filter(layer => layer.primary !== false).map(layer => layer.id), SYMBOLS);
  assert.deepEqual(card.layers.map(layer => layer.id), [...SYMBOLS, "H100", "H200"]);
  for (const layer of card.layers.filter(layer => layer.primary === false)) {
    const original = getCardDefinition("gpu-index").layers.find(candidate => candidate.id === layer.id);
    assert.equal(layer.sourceCardId, "gpu-index");
    assert.equal(layer.unit, "usd-hour");
    assert.equal(layer.group, "compute");
    assert.equal(layer.groupLabel, "Compute");
    assert.deepEqual(layer.views, ["index"]);
    assert.equal(layer.strokeDasharray, original.strokeDasharray);
    assert.equal(layer.strokeOpacity, original.strokeOpacity);
    assert.notEqual(layer, original);
    assert(Object.isFrozen(layer));
    assert(Object.isFrozen(layer.views));
    assert.equal(original.primary, undefined);
    assert.equal(original.sourceCardId, undefined);
    assert.deepEqual(original.views, ["price", "index", "spread"]);
  }
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

test("equities cannot select compute as the primary or use spread, and old cards keep their ranges", () => {
  const state = normalizeCardState("equities", {
    symbol: "H100", layers: ["H100", "TOKEN"], scale: "spread", range: "1d",
  });
  assert.deepEqual([state.symbol, state.layers, state.scale, state.range], ["NVDA", ["NVDA", "H100"], "index", "1y"]);
  assert.deepEqual(getCardDefinition("gpu-index").ranges, ["1d", "7d", "all"]);
  assert.equal(normalizeCardState("gpu-index", { range: "1y" }).range, "7d");
  assert.equal(normalizeCardState("power-basis", { range: "90d" }).range, "90d");
  assert.deepEqual(getCardDefinition("equities").ranges, ["7d", "90d", "1y"]);
  assert.equal(normalizeCardState("equities", { range: "all" }).range, "1y");
  assert.equal(RANGES["90d"].milliseconds, 90 * 86400000);
  assert.equal(RANGES["1y"].milliseconds, 365 * 86400000);
  assert.equal(RANGES.all.milliseconds, null);
});

test("legacy All equity URLs retain the comparison and use the one-year window", () => {
  const previous = { symbol: "AMD", layers: ["AMD", "H100", "H200"], scale: "index", range: "all", palette: "azure", theme: "dark" };
  const current = normalizeCardState("equities", previous);
  assert.equal(current.range, "1y");
  assert.equal(current.symbol, "AMD");
  assert.deepEqual(current.layers, ["AMD", "H100", "H200"]);
  assert.equal(current.scale, "index");
  assert.equal(current.palette, "azure");
  assert.equal(current.theme, "dark");
});

test("mixed equity query and saved states force index and retain a canonical stock primary", () => {
  const card = getCardDefinition("equities");
  const query = new URLSearchParams("symbol=amd&gpu=H200&layers=H200,msft,AMD,H100,H200,B200,TOKEN&scale=price&range=90d");
  const state = normalizeCardState(card.id, Object.fromEntries(query));
  assert.equal(state.symbol, "AMD");
  assert.equal(state.gpu, "AMD");
  assert.equal(state.scale, "index");
  assert.deepEqual(state.layers, ["MSFT", "AMD", "H100", "H200"]);
  assert.equal(serializeLayerIds(state.layers, card), "MSFT,AMD,H100,H200");
  const saved = createCardDocument({
    id: "mixed-equities", cardId: card.id, name: "Cloud and compute", state,
    createdAt: "2026-09-06T00:00:00.000Z",
  });
  assert.equal(Object.hasOwn(saved.visualization, "gpu"), false);
  assert.deepEqual(saved.visualization, {
    symbol: "AMD", layers: ["MSFT", "AMD", "H100", "H200"], scale: "index",
    range: "90d", palette: "linen", theme: "dark",
  });
  assert.deepEqual(normalizeCardDocument(JSON.parse(JSON.stringify(saved))), saved);
  const canonicalQuery = new URLSearchParams(Object.entries(saved.visualization).map(([key, value]) => [
    key, key === "layers" ? serializeLayerIds(value, card) : value,
  ]));
  assert.equal(canonicalQuery.has("gpu"), false);
  assert.deepEqual(normalizeCardState(card.id, Object.fromEntries(canonicalQuery)), state);
  assert.equal(normalizeCardState(card.id, { ...saved.visualization, scale: "price" }).scale, "index");
  assert.equal(normalizeCardState(card.id, { symbol: "AMD", layers: ["AMD"], scale: "price" }).scale, "price");
  for (const symbol of ["H100", "H200"]) {
    const invalidPrimary = normalizeCardState(card.id, { symbol, layers: [symbol], scale: "price" });
    assert.equal(invalidPrimary.symbol, "NVDA");
    assert.deepEqual(invalidPrimary.layers, ["NVDA", symbol]);
    assert.equal(invalidPrimary.scale, "index");
  }
});

test("equity comparison metadata and selections cannot spill into other cards", () => {
  const gpu = getCardDefinition("gpu-index");
  assert.deepEqual(gpu.layers.map(layer => layer.id), ["H100", "H200", "B200", "B300", "TOKEN"]);
  assert.deepEqual(normalizeCardState(gpu.id, {
    gpu: "H200", symbol: "NVDA", layers: ["NVDA", "H100", "H200"], scale: "price",
  }).layers, ["H100", "H200"]);
  assert.equal(normalizeCardState(gpu.id, { layers: ["H100", "H200"], scale: "price" }).scale, "price");
  assert.equal(normalizeCardState(gpu.id, { gpu: "H100", layers: ["H100", "H200"], scale: "spread" }).scale, "spread");
  assert.deepEqual(normalizeCardState("power-basis", {
    symbol: "NVDA", layers: ["NVDA", "H100", "H200"], scale: "index",
  }).layers, ["PJM-WEST"]);
  for (const card of CARD_REGISTRY.filter(candidate => candidate.id !== "equities")) {
    assert(card.layers.every(layer => layer.sourceCardId !== "gpu-index"));
    assert(card.layers.every(layer => !SYMBOLS.includes(layer.id)));
  }
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

test("Power adds Dominion, ERCOT North and H100 power cost while retaining the renderer and legacy West presets", () => {
  const card = getCardDefinition("power-basis");
  assert.equal(card.renderer, "power-basis");
  assert.equal(card.primaryParam, "location");
  assert.equal(card.allowComparisons, false);
  assert.equal(card.defaults.layer, "PJM-WEST");
  assert.deepEqual(POWER_BASIS_LAYERS.map(layer => layer.id), ["PJM-WEST", "PJM-DOMINION", "ERCOT-NORTH"]);
  assert.deepEqual(card.catalogPresets.map(preset => preset.id), ["pjm-west", "pjm-west-spread", "pjm-dominion", "ercot-north", "gpu-energy"]);
  assert.deepEqual(card.catalogPresets.slice(0, 2).map(preset => preset.state), [
    { location: "PJM-WEST" }, { location: "PJM-WEST", scale: "basis", range: "7d" },
  ]);
  assert.deepEqual(card.catalogPresets.slice(2).map(preset => [preset.label, preset.state.location, preset.state.scale]), [
    ["PJM Dominion", "PJM-DOMINION", "price"],
    ["ERCOT North", "ERCOT-NORTH", "price"],
    ["H100 power cost", "PJM-DOMINION", "energy"],
  ]);
  assert.deepEqual(card.visualizations.map(view => [view.id, view.label, view.unit]), [
    ["price", "Price", "usd-mwh"], ["basis", "Spread", "usd-mwh"], ["energy", "H100 power cost", "usd-gpu-hour"],
  ]);
  assert.deepEqual(cardStateParamIds(card), ["location", "layers", "scale", "range", "palette", "theme"]);
  assert.deepEqual(card.ranges, ["1d", "7d", "90d", "1y", "all"]);
  for (const layer of card.layers) {
    assert.deepEqual(layer.views, ["price", "basis", "energy"]);
    assert.equal(layer.unit, "usd-mwh");
    assert(Object.isFrozen(layer));
    for (const range of card.ranges) {
      const state = normalizeCardState(card.id, { location: layer.id, scale: "energy", range });
      assert.deepEqual([state.location, state.layers, state.scale, state.range], [layer.id, [layer.id], "energy", range]);
    }
  }
});

test("new Power presets round-trip strict documents, shared desks and persisted pins without extra state fields", () => {
  const card = getCardDefinition("power-basis");
  let raw = null;
  const storage = { getItem: () => raw, setItem: (_key, value) => { raw = value; } };
  const watchlist = createMarketWatchlist({ storage });
  const entries = card.catalogPresets.slice(2).map(preset => {
    const state = normalizeCardVisualization(card.id, preset.state);
    assert.deepEqual(Object.keys(state), cardStateParamIds(card));
    const document = createCardDocument({ id: preset.id, cardId: card.id, name: preset.label, state, createdAt: "2026-09-06T00:00:00.000Z" });
    assert.deepEqual(normalizeCardDocument(JSON.parse(JSON.stringify(document))), document);
    const pinned = watchlist.pin({ cardId: card.id, state, label: preset.label });
    assert.deepEqual(pinned.state, state);
    assert.deepEqual(createMarketWatchlist({ storage }).list().find(item => item.id === pinned.id), pinned);
    assert(publishedCardSharePath(card.id, state).includes(`/${state.location.toLowerCase()}/${state.scale}/`));
    return { cardId: card.id, name: preset.label, state };
  });
  const shared = createSharedDesk({ name: "Power", entries, palette: "linen", theme: "dark" });
  assert.deepEqual(decodeSharedDesk(encodeSharedDesk(shared)), shared);
  assert.deepEqual(shared.entries.map(entry => [entry.state.location, entry.state.scale]), [
    ["PJM-DOMINION", "price"], ["ERCOT-NORTH", "price"], ["PJM-DOMINION", "energy"],
  ]);
  assert.throws(() => createSharedDesk({ ...shared, entries: [{ ...entries[2], state: { ...entries[2].state, pue: 1.2 } }] }));
});

test("Sandbox is a source-only six-provider card with two canonical catalog presets", () => {
  const card = getCardDefinition("sandbox-cost");
  const ids = ["novita", "daytona-vm", "blaxel", "e2b", "modal-vm", "modal-gvisor"];
  assert.equal(card.renderer, "sandbox-cost");
  assert.equal(card.dataAdapter, "sandbox");
  assert.equal(card.primaryParam, "provider");
  assert.equal(card.title, "Sandbox cost");
  assert.equal(card.craftLabel, "Sandbox cost");
  assert.equal(card.sourceFile, "api/dashboard-snapshots/sandbox-cost.json");
  assert.equal(card.dataFile, "data/sandbox-cost.json");
  assert.equal(card.publishable, false);
  assert.equal(card.dataTable, undefined);
  assert.equal(card.allowComparisons, true);
  assert.deepEqual(card.ranges, ["now", "7d", "all"]);
  assert.deepEqual(SANDBOX_PROVIDER_LAYERS.map(layer => layer.id), ids);
  assert.deepEqual(card.layers.map(layer => layer.label), ["Novita", "Daytona VM", "Blaxel", "E2B", "Modal VM", "Modal gVisor"]);
  assert.deepEqual(card.visualizations, [{ id: "price", label: "Cost", unit: "usd-job" }]);
  assert.deepEqual(card.layers.map(layer => layer.unit), ids.map(() => "usd-job"));
  assert.deepEqual(normalizeCardState(card.id).layers, ids);
  assert.equal(normalizeCardState(card.id).provider, "novita");
  assert.equal(normalizeCardState(card.id).range, "now");
  assert.deepEqual(card.catalogPresets.map(preset => [preset.id, preset.label, preset.state.range]), [
    ["cost", "Sandbox cost", "now"], ["history", "Sandbox cost", "7d"],
  ]);
  for (const preset of card.catalogPresets) {
    assert.deepEqual(normalizeCardState(card.id, preset.state).layers, ids);
    assert(Object.isFrozen(preset.state));
    assert(Object.isFrozen(preset.state.layers));
  }
});

test("Sandbox lower-case IDs normalize query aliases and survive strict save, share and pin round trips", () => {
  const card = getCardDefinition("sandbox-cost");
  const state = normalizeCardState(card.id, { provider: "DAYTONA-VM", layers: ["MODAL-GVISOR", "Daytona-VM", "NOVITA", "novita"], scale: "index", range: "7D" });
  assert.equal(state.gpu, "daytona-vm");
  assert.equal(state.provider, "daytona-vm");
  assert.deepEqual(state.layers, ["novita", "daytona-vm", "modal-gvisor"]);
  assert.equal(state.scale, "price");
  assert.equal(state.range, "7d");
  assert.equal(serializeLayerIds(state.layers, card), "novita,daytona-vm,modal-gvisor");
  const canonical = normalizeCardVisualization(card.id, state);
  assert.deepEqual(Object.keys(canonical), ["provider", "layers", "scale", "range", "palette", "theme"]);
  const doc = createCardDocument({ id: "sandbox-save", cardId: card.id, name: "Sandbox history", state: canonical, createdAt: "2026-08-06T00:00:00Z" });
  assert.deepEqual(normalizeCardDocument(JSON.parse(JSON.stringify(doc))), doc);
  assert.equal(doc.name, "Sandbox history", "Preset naming updates do not rename existing saved views");
  const shared = createSharedDesk({ name: "Sandbox", entries: [{ cardId: card.id, name: "Providers", state: canonical }] });
  assert.deepEqual(decodeSharedDesk(encodeSharedDesk(shared)), shared);
  let raw = null;
  const storage = { getItem: () => raw, setItem: (_key, value) => { raw = value; } };
  const pin = createMarketWatchlist({ storage }).pin({ cardId: card.id, label: "Sandbox", state: canonical });
  assert.deepEqual(createMarketWatchlist({ storage }).list().find(item => item.id === pin.id).state, canonical);
  assert.equal(normalizeCardState("gpu-index", { gpu: "h200" }).gpu, "H200");
  assert.equal(normalizeCardState("power-basis", { location: "pjm-dominion" }).location, "PJM-DOMINION");
  assert.equal(normalizeCardState("equities", { symbol: "nvda" }).symbol, "NVDA");
});
