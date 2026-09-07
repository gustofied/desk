import assert from "node:assert/strict";
import test from "node:test";
import { CARD_REGISTRY, getCardDefinition } from "../src/card-registry.js";
import { cardDetailDescription } from "../src/card-descriptions.js";

const cases = [
  ["gpu-index", { scale: "price", layers: ["H100"] }, "GPU rental rates in USD per GPU-hour, with the median and middle 50% price band."],
  ["gpu-index", { scale: "price", layers: ["H100", "H200"] }, "Rental rates for the selected GPUs, in USD per GPU-hour."],
  ["gpu-index", { scale: "index", layers: ["H100", "H200"] }, "Percentage changes in GPU rental rates from a shared starting date."],
  ["gpu-index", { scale: "spread", layers: ["H100", "B200"] }, "The difference between two GPUs’ rental-rate changes, in percentage points."],
  ["gpu-index", { scale: "index", layers: ["TOKEN"] }, "Changes in the token-price benchmark from the selected starting date."],
  ["gpu-index", { scale: "index", layers: ["H100", "TOKEN"] }, "GPU rental rates and the token-price benchmark, compared from a shared starting date."],
  ["gpu-price-snapshot", {}, "The latest available rental rate for each selected GPU, in USD per GPU-hour."],
  ["gpu-market-depth", {}, "US H100 capacity for 30-day rentals, in eight-GPU InfiniBand nodes. The target marks the lowest rate covering the requested capacity."],
  ["gpu-market-depth", { scale: "history" }, "Daily US H100 rental rates in USD per GPU-hour for the selected capacity target. Each InfiniBand node has eight GPUs on 30-day terms."],
  ["power-basis", { scale: "price" }, "Hourly day-ahead and real-time wholesale electricity prices at PJM West, in USD per MWh."],
  ["power-basis", { scale: "basis" }, "Real-time minus day-ahead wholesale electricity prices at PJM West, in USD per MWh."],
  ["power-basis", { scale: "energy" }, "Estimated electricity cost per H100-hour, assuming a 10.2 kW eight-GPU system and 20% facility overhead."],
  ["equities", { scale: "price", layers: ["NVDA"] }, "Daily share-price series for NVIDIA, in USD per share."],
  ["equities", { scale: "price", layers: ["NVDA", "MSFT"] }, "Daily share-price series for chipmakers and cloud providers, in USD per share."],
  ["equities", { scale: "index", layers: ["NVDA", "MSFT"] }, "Percentage changes in the selected share prices from a shared starting date."],
  ["equities", { scale: "index", layers: ["NVDA", "H100", "H200"] }, "Share prices and GPU rental rates compared as percentage changes over shared dates."],
  ["quote-view", {}, "Buyer bids and seller asks through a reserved-capacity negotiation, in USD per GPU-hour."],
  ["deal-view", {}, "Reserved-capacity negotiations, including quote revisions, capacity, contract terms and service dates."],
  ["sandbox-cost", { range: "now" }, "Estimated CPU and memory cost per benchmark job, calculated from measured runtime and provider rates."],
  ["sandbox-cost", { range: "7d" }, "Daily medians of CPU and memory cost estimates across benchmark batches. Each provider uses its own price scale."],
  ["sandbox-cost", { range: "all" }, "Daily medians of CPU and memory cost estimates across benchmark batches. Each provider uses its own price scale."],
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
    assert.equal(cardDetailDescription(card, { ...state, layers: ` , ${state.layers.join(" , ")}, ${state.layers[0]}, ` }), expected);
    assert.equal(cardDetailDescription(card, { ...state, layers: [...state.layers].reverse() }), expected);
    assert.equal(cardDetailDescription(card, { ...state, layers: [...state.layers, ...state.layers] }), expected);
  }
});

test("missing chart state uses each registered card's defaults", () => {
  const expected = {
    "gpu-index": "GPU rental rates in USD per GPU-hour, with the median and middle 50% price band.",
    "gpu-price-snapshot": "The latest available rental rate for each selected GPU, in USD per GPU-hour.",
    "gpu-market-depth": "US H100 capacity for 30-day rentals, in eight-GPU InfiniBand nodes. The target marks the lowest rate covering the requested capacity.",
    "power-basis": "Hourly day-ahead and real-time wholesale electricity prices at PJM West, in USD per MWh.",
    equities: "Daily share-price series for NVIDIA, in USD per share.",
    "quote-view": "Buyer bids and seller asks through a reserved-capacity negotiation, in USD per GPU-hour.",
    "deal-view": "Reserved-capacity negotiations, including quote revisions, capacity, contract terms and service dates.",
    "sandbox-cost": "Estimated CPU and memory cost per benchmark job, calculated from measured runtime and provider rates.",
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
  assert.equal(cardDetailDescription(card, state), "GPU rental rates and the token-price benchmark, compared from a shared starting date.");
  assert.equal(cardDetailDescription(getCardDefinition("sandbox-cost"), { range: "all" }), "Daily medians of CPU and memory cost estimates across benchmark batches. Each provider uses its own price scale.");
  assert.equal(cardDetailDescription(card), "GPU rental rates in USD per GPU-hour, with the median and middle 50% price band.");
  assert.equal(cardDetailDescription(card, state), "GPU rental rates and the token-price benchmark, compared from a shared starting date.");
  assert.deepEqual(state.layers, ["H100", "TOKEN"]);
  assert.equal(JSON.stringify(card), before);
});

test("single equities name the selected company through layers or the primary parameter", () => {
  const equities = getCardDefinition("equities");
  for (const layer of equities.layers.filter(layer => layer.companyName)) {
    const expected = `Daily share-price series for ${layer.companyName}, in USD per share.`;
    for (const state of [
      { layers: [layer.id] }, { layers: ` ${layer.id}, ${layer.id} ` },
      { symbol: layer.id }, { gpu: layer.id },
    ]) {
      assert.equal(cardDetailDescription(equities, state), expected, JSON.stringify(state));
    }
  }
  assert.equal(cardDetailDescription(equities, { symbol: "MSFT", gpu: "NVDA" }),
    "Daily share-price series for Microsoft, in USD per share.");
  assert.equal(cardDetailDescription(equities, { symbol: "MSFT", layers: ["NVDA"] }),
    "Daily share-price series for NVIDIA, in USD per share.");
});

test("power introductions name the selected location and separate prices, basis and energy assumptions", () => {
  const power = getCardDefinition("power-basis");
  for (const layer of power.layers) {
    for (const selection of [{ location: layer.id }, { gpu: layer.id }, { layers: [layer.id] }]) {
      assert.equal(cardDetailDescription(power, { ...selection, scale: "price" }),
        `Hourly day-ahead and real-time wholesale electricity prices at ${layer.label}, in USD per MWh.`);
      assert.equal(cardDetailDescription(power, { ...selection, scale: "basis" }),
        `Real-time minus day-ahead wholesale electricity prices at ${layer.label}, in USD per MWh.`);
      assert.equal(cardDetailDescription(power, { ...selection, scale: "energy" }),
        "Estimated electricity cost per H100-hour, assuming a 10.2 kW eight-GPU system and 20% facility overhead.");
    }
  }
  assert.match(cardDetailDescription(power, { location: "unknown" }), /at the selected location, in USD per MWh\./);
});

test("only single-GPU price copy claims a displayed median and middle-50-percent band", () => {
  const gpu = getCardDefinition("gpu-index");
  assert.match(cardDetailDescription(gpu, { gpu: "H100", scale: "price" }), /median and middle 50% price band/);
  assert.match(cardDetailDescription(gpu, { layers: " H100, H100, ", scale: "price" }), /median and middle 50% price band/);
  for (const state of [
    { layers: ["H100", "H200"], scale: "price" },
    { layers: ["H100"], scale: "index" },
    { layers: ["H100", "B200"], scale: "spread" },
    { layers: ["H100", "TOKEN"], scale: "index" },
  ]) assert.doesNotMatch(cardDetailDescription(gpu, state), /band|IQR|median|middle 50%/);
});

test("Sandbox latest and history describe different statistics without billing or uncertainty claims", () => {
  const sandbox = getCardDefinition("sandbox-cost");
  const now = cardDetailDescription(sandbox, { range: "now" });
  assert.match(now, /Estimated CPU and memory cost per benchmark job.*measured runtime and provider rates/);
  assert.doesNotMatch(now, /daily|batch medians|own price scale/i);
  for (const range of ["7d", "all"]) {
    const history = cardDetailDescription(sandbox, { range });
    assert.match(history, /Daily medians.*cost estimates across benchmark batches/);
    assert.match(history, /Each provider uses its own price scale/);
    assert.doesNotMatch(history, /confidence|uncertainty|metered|billed|live/i);
    assert.notEqual(history, now);
  }
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
