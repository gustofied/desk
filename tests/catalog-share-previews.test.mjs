import assert from "node:assert/strict";
import test from "node:test";
import {
  CARD_REGISTRY, getCardDefinition, normalizeCardState, PALETTES,
  publishedCardSharePath, THEMES,
} from "../src/card-registry.js";
import {
  CATALOG_SHARE_CARD_IDS, catalogShareStates, supportsCatalogShareState,
} from "../src/catalog-share-previews.js";

const cloudComparison = {
  symbol: "CRWV", layers: ["CRWV", "NBIS", "H100", "H200"],
  scale: "index", range: "90d", palette: "sage", theme: "light",
};

test("catalog preview support is bounded to the four new card families", () => {
  assert.deepEqual(CATALOG_SHARE_CARD_IDS, ["equities", "sandbox-cost", "quote-view", "deal-view"]);
  assert(Object.isFrozen(CATALOG_SHARE_CARD_IDS));
  const counts = { equities: 936, "sandbox-cost": 144, "quote-view": 16, "deal-view": 8 };
  for (const id of CATALOG_SHARE_CARD_IDS) {
    assert.equal(catalogShareStates(id).length, counts[id], id);
    assert.equal(getCardDefinition(id).publishable, false, "Enumeration must not enable unrestricted publication");
  }
  for (const id of [undefined, null, "unknown", "toString", ...CARD_REGISTRY
    .filter(card => !CATALOG_SHARE_CARD_IDS.includes(card.id)).map(card => card.id)]) {
    assert.deepEqual(catalogShareStates(id), []);
    assert(Object.isFrozen(catalogShareStates(id)));
    assert.equal(supportsCatalogShareState(id, {}), false);
  }
});

test("every default and registered preset has previews for its normalized settings", () => {
  for (const id of CATALOG_SHARE_CARD_IDS) {
    const card = getCardDefinition(id);
    assert(supportsCatalogShareState(id), `${id} implicit default`);
    for (const seed of [card.defaults, ...(card.catalogPresets || []).map(preset => preset.state || {})]) {
      const before = JSON.stringify(seed);
      assert(supportsCatalogShareState(id, seed), `${id}: ${before}`);
      assert(supportsCatalogShareState(id, normalizeCardState(id, seed)));
      assert.equal(JSON.stringify(seed), before);
    }
  }
});

test("the requested cloud and compute comparison supports normalized CSV, ordering and UI identifiers", () => {
  const normalized = normalizeCardState("equities", cloudComparison);
  const expectedPath = publishedCardSharePath("equities", normalized);
  assert.equal(expectedPath, "/cards/equities/published/crwv/index/crwv~nbis~h100~h200/90d/sage/light/");
  assert(catalogShareStates("equities").some(state => publishedCardSharePath("equities", state) === expectedPath));
  for (const state of [
    cloudComparison,
    { ...cloudComparison, layers: " h200, nbis, CRWV, h100, H200 " },
    { ...cloudComparison, layers: [...cloudComparison.layers].reverse(), entry: "preset-equities-clouds-compute", name: "My desk", item: "local-only" },
    { ...cloudComparison, symbol: undefined, gpu: "crwv", scale: "INDEX", range: "90D", palette: "SAGE", theme: "LIGHT" },
    { ...cloudComparison, scale: "price" }, // Mixed layers normalize to index.
  ]) assert(supportsCatalogShareState("equities", state), JSON.stringify(state));
});

test("registered compositions vary only their valid primary, ranges, modes and appearance", () => {
  const card = getCardDefinition("equities");
  for (const symbol of ["CRWV", "NBIS"]) {
    for (const range of card.ranges) {
      for (const palette of PALETTES) {
        for (const theme of THEMES) {
          assert(supportsCatalogShareState(card.id, { ...cloudComparison, symbol, range, palette: palette.id, theme }));
        }
      }
    }
  }
  for (const scale of ["price", "index"]) {
    assert(supportsCatalogShareState("equities", { symbol: "AMD", layers: ["NVDA", "AMD", "TSM"], scale }));
  }
  assert(catalogShareStates(card.id).every(state => !["H100", "H200"].includes(state.symbol)));
  assert(supportsCatalogShareState(card.id, { ...cloudComparison, range: "all" }), "Legacy ALL normalizes to the supported 1Y state");
  const sandbox = getCardDefinition("sandbox-cost");
  for (const provider of sandbox.layers) {
    for (const range of sandbox.ranges) {
      assert(supportsCatalogShareState(sandbox.id, { ...sandbox.defaults, provider: provider.id, range }));
    }
  }
});

test("unregistered equity combinations and Sandbox subsets use the fallback", () => {
  for (const state of [
    { symbol: "NVDA", layers: ["NVDA", "MSFT"], scale: "index" },
    { symbol: "CRWV", layers: ["CRWV", "NBIS", "H100"], scale: "index" },
    { symbol: "AMD", layers: ["AMD", "H100", "H200"], scale: "index" },
  ]) assert.equal(supportsCatalogShareState("equities", state), false);
  for (const layers of [["novita"], ["novita", "e2b"]]) {
    assert.equal(supportsCatalogShareState("sandbox-cost", { provider: "novita", layers, range: "7d" }), false);
  }
  assert.equal(supportsCatalogShareState("equities", null), false);
  assert.equal(supportsCatalogShareState("equities", "NVDA"), false);
});

test("Quote and Deal publish only the exact preset private terms", () => {
  for (const id of ["quote-view", "deal-view"]) {
    const card = getCardDefinition(id);
    const presetTerms = new Set([card.defaults, ...card.catalogPresets.map(preset => preset.state || {})]
      .map(seed => privateTerms(normalizeCardState(id, seed))));
    for (const state of catalogShareStates(id)) {
      assert(presetTerms.has(privateTerms(state)), `${id} introduced non-preset terms`);
      assert.equal(state.range, card.defaults.range);
      assert.equal(state.scale, card.defaults.scale);
    }
    for (const patch of [{ gpu: "H100" }, { quantity: 257 }, { quote: 3.66 }, { rfs: "2026-11" }]) {
      assert.equal(supportsCatalogShareState(id, { ...card.defaults, ...patch }), false, `${id}: ${JSON.stringify(patch)}`);
    }
    assert(supportsCatalogShareState(id, { ...card.defaults, quantity: "256", quote: "3.650", name: "Private name", entry: "saved-quote" }));
  }
  assert(supportsCatalogShareState("quote-view", { gpu: "H200", quote: 2.85 }));
  assert.equal(supportsCatalogShareState("quote-view", { gpu: "H200", quote: 3.65 }), false,
    "A preset GPU and another preset's price must not be combined");
  assert.equal(supportsCatalogShareState("deal-view", { gpu: "H200", quote: 2.85 }), false,
    "Quote presets must not leak into Deal support");
});

test("generated states are unique, complete, cached and immutable", () => {
  const registryBefore = JSON.stringify(CARD_REGISTRY);
  const input = Object.freeze({ ...cloudComparison, layers: Object.freeze([...cloudComparison.layers]) });
  assert(supportsCatalogShareState("equities", input));
  assert.deepEqual(input.layers, cloudComparison.layers);
  for (const id of CATALOG_SHARE_CARD_IDS) {
    const states = catalogShareStates(id);
    assert.strictEqual(catalogShareStates(id), states);
    assert(Object.isFrozen(states));
    assert.equal(new Set(states.map(state => publishedCardSharePath(id, state))).size, states.length);
    for (const state of states) {
      assert(Object.isFrozen(state));
      assert(Object.isFrozen(state.layers));
      assert.deepEqual(state, normalizeCardState(id, state));
      assert(supportsCatalogShareState(id, state));
    }
    assert.throws(() => states.push({}), TypeError);
    assert.throws(() => { states[0].palette = "invalid"; }, TypeError);
    assert.throws(() => states[0].layers.push("invalid"), TypeError);
  }
  assert.equal(JSON.stringify(CARD_REGISTRY), registryBefore);
});

function privateTerms(state) {
  return JSON.stringify([state.gpu, state.quantity, state.quote, state.rfs]);
}
