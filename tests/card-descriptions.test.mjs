import assert from "node:assert/strict";
import test from "node:test";
import { CARD_REGISTRY, getCardDefinition } from "../src/card-registry.js";
import { cardDetailDescription } from "../src/card-descriptions.js";

const cases = [
  ["gpu-index", { scale: "price", layers: ["H100"] }, "GPU rental prices over time."],
  ["gpu-index", { scale: "index", layers: ["H100", "H200"] }, "GPU price changes from the same starting day."],
  ["gpu-index", { scale: "spread", layers: ["H100", "B200"] }, "The gap between two GPU price changes."],
  ["gpu-index", { scale: "index", layers: ["TOKEN"] }, "Token price changes over time."],
  ["gpu-index", { scale: "index", layers: ["H100", "TOKEN"] }, "GPU and token prices, compared from the same day."],
  ["gpu-price-snapshot", {}, "Hourly rental prices by GPU."],
  ["gpu-market-depth", {}, "Available capacity at each hourly rate."],
  ["gpu-market-depth", { scale: "history" }, "Rates for your capacity target over time."],
  ["power-basis", { scale: "price" }, "Day-ahead and real-time power prices."],
  ["power-basis", { scale: "basis" }, "Real-time minus day-ahead power prices."],
  ["power-basis", { scale: "energy" }, "Power cost per H100 hour."],
  ["equities", { scale: "price", layers: ["NVDA"] }, "Stock prices over time."],
  ["equities", { scale: "index", layers: ["NVDA", "MSFT"] }, "Stock price changes from the same starting day."],
  ["equities", { scale: "index", layers: ["NVDA", "H100", "H200"] }, "Stocks and GPU rental prices, compared from the same day."],
  ["quote-view", {}, "Buyer bids and seller asks."],
  ["deal-view", {}, "Quote changes and deal activity."],
  ["sandbox-cost", { range: "now" }, "Job costs across providers."],
  ["sandbox-cost", { range: "7d" }, "Job costs over time, by provider."],
  ["sandbox-cost", { range: "all" }, "Job costs over time, by provider."],
];

test("each card and chart mode receives its exact plain-language introduction", () => {
  for (const [id, state, expected] of cases) {
    assert.equal(cardDetailDescription(getCardDefinition(id), state), expected, `${id}: ${JSON.stringify(state)}`);
  }
});

test("comma-separated layers and arrays select the same GPU, token and cross-market copy", () => {
  for (const [id, state, expected] of cases.filter(([, state]) => Array.isArray(state.layers))) {
    const card = getCardDefinition(id);
    assert.equal(cardDetailDescription(card, { ...state, layers: state.layers.join(",") }), expected);
    assert.equal(cardDetailDescription(card, { ...state, layers: [...state.layers].reverse() }), expected);
  }
});

test("missing chart state uses each registered card's defaults", () => {
  const expected = {
    "gpu-index": "GPU rental prices over time.",
    "gpu-price-snapshot": "Hourly rental prices by GPU.",
    "gpu-market-depth": "Available capacity at each hourly rate.",
    "power-basis": "Day-ahead and real-time power prices.",
    equities: "Stock prices over time.",
    "quote-view": "Buyer bids and seller asks.",
    "deal-view": "Quote changes and deal activity.",
    "sandbox-cost": "Job costs across providers.",
  };
  for (const card of CARD_REGISTRY) {
    assert.equal(cardDetailDescription(card), expected[card.id], card.id);
    assert.equal(cardDetailDescription(card, {}), expected[card.id], card.id);
    assert.equal(cardDetailDescription(card, card.defaults), expected[card.id], card.id);
  }
});

test("unknown cards have no invented fallback description", () => {
  for (const card of [undefined, null, {}, { id: "unknown", renderer: "line", defaults: { scale: "price" } }]) {
    assert.equal(cardDetailDescription(card), "");
  }
});

test("describing successive modes is stateless and leaves card configuration untouched", () => {
  const card = getCardDefinition("gpu-index");
  const before = JSON.stringify(card);
  const state = Object.freeze({ scale: "index", layers: Object.freeze(["H100", "TOKEN"]), range: "7d" });
  assert.equal(cardDetailDescription(card, state), "GPU and token prices, compared from the same day.");
  assert.equal(cardDetailDescription(getCardDefinition("sandbox-cost"), { range: "all" }), "Job costs over time, by provider.");
  assert.equal(cardDetailDescription(card), "GPU rental prices over time.");
  assert.equal(cardDetailDescription(card, state), "GPU and token prices, compared from the same day.");
  assert.deepEqual(state.layers, ["H100", "TOKEN"]);
  assert.equal(JSON.stringify(card), before);
});

test("every catalog preset receives a nonempty description without changing its saved state", () => {
  for (const card of CARD_REGISTRY) {
    for (const preset of card.catalogPresets || []) {
      const before = JSON.stringify(preset);
      const text = cardDetailDescription(card, preset.state);
      assert.equal(typeof text, "string", `${card.id}/${preset.id}`);
      assert(text.length > 0 && text.endsWith("."), `${card.id}/${preset.id} needs an introduction`);
      assert.equal(JSON.stringify(preset), before);
    }
  }
});
