import assert from "node:assert/strict";
import test from "node:test";
import { getCardDefinition } from "../src/card-registry.js";
import { createMonitorDataModel } from "../src/monitor-data-model.js";

const card = getCardDefinition("equities");
const first = new Date("2026-08-28T00:00:00.000Z");
const latest = new Date("2026-08-31T00:00:00.000Z");
const state = { symbol: "NVDA", layers: ["NVDA", "MSFT"], range: "1y", scale: "price" };
const source = { name: "Demo data", url: "https://github.com/gustofied/desk/blob/main/README.md", status: "ready" };
const runtime = {
  asOf: latest.getTime() / 1000,
  dataset: { source, kind: "demo", status: "ready", priceBasis: "demo-close" },
};
const series = state.layers.map((id, index) => ({
  layer: card.layers.find(layer => layer.id === id),
  rows: [{ date: first, value: 100 + index }, { date: latest, value: 101 + index }],
}));

test("Sandbox detail attributes the dated benchmark without a Desk API or billing claim", () => {
  const sandbox = getCardDefinition("sandbox-cost");
  const asOf = Date.parse("2026-08-06T12:34:56.789Z");
  const sandboxModel = { providers: sandbox.layers.map(layer => ({ id: layer.id, label: layer.label })), primary: "novita", range: "now", asOf };
  const model = createMonitorDataModel({ card: sandbox, cardState: { range: "now" }, sandboxModel });
  assert.equal(model.label, "HPC Sandbox Benchmarks");
  assert.equal(model.accessKind, "source");
  assert.equal(model.sourceUrl, "https://github.com/starslingdev/hpc-sandbox-benchmarks");
  assert.equal(+model.asOf, asOf, "Model milliseconds must not become seconds or the current clock");
  assert.equal(model.status, "ready");
  assert.equal(model.unit, "USD per job");
  assert.equal(model.summary, "2026-08-06");
  assert.equal(model.description, "Median and range across 12 runs.");
  assert.equal(model.detailDescription, "Estimated CPU and memory cost per benchmark job, calculated from measured runtime and provider rates.");
  for (const field of ["endpoint", "command", "sql"]) assert.equal(model[field], undefined);
  assert(Object.isFrozen(model));
});

test("Sandbox history describes batch medians and makes no cross-methodology trend claim", () => {
  const sandbox = getCardDefinition("sandbox-cost");
  const base = { providers: [{ id: "novita" }], primary: "novita", asOf: Date.parse("2026-08-06T00:00:00Z"), rows: [{ date: new Date("2026-08-05") }, { date: new Date("2026-08-06") }] };
  const week = createMonitorDataModel({ card: sandbox, sandboxModel: { ...base, range: "7d" } });
  const all = createMonitorDataModel({ card: sandbox, sandboxModel: { ...base, range: "all" } });
  assert.equal(week.rowCount, 2);
  assert.equal(week.summary, "2026-08-06");
  assert.equal(week.description, "Methodology varies across runs.");
  assert.equal(week.detailDescription, "Daily medians of CPU and memory cost estimates across benchmark batches. Each provider uses its own price scale.");
  assert.equal(all.detailDescription, "Daily medians of CPU and memory cost estimates across benchmark batches. Each provider uses its own price scale.");
  assert.notEqual(week.key, all.key, "Range changes must update details even when observation counts match");
  assert.equal(week.breadcrumbs.at(-1), "7D");
  const missing = createMonitorDataModel({ card: sandbox });
  assert.equal(missing.asOf, null);
  assert.equal(missing.summary, "No observations");
  assert.equal(missing.status, "unavailable");
  assert.equal(missing.sourceUrl, week.sourceUrl);
  assert.equal(missing.detailDescription, "Estimated CPU and memory cost per benchmark job, calculated from measured runtime and provider rates.");
});

test("latest-price details say GPU or GPUs without renaming the card or API", () => {
  const snapshot = getCardDefinition("gpu-price-snapshot");
  for (const ids of [["H100"], ["H100", "H200", "B200", "B300"]]) {
    const model = createMonitorDataModel({ card: snapshot, cardState: {}, barModel: {
      bars: ids.map(id => ({ id })), asOf: latest.getTime() / 1000,
    } });
    assert.equal(model.summary, ids.length === 1 ? "1 GPU" : "4 GPUs");
    assert.equal(model.label, "Latest prices");
    assert.equal(model.detailDescription, "The latest available rental rate for each selected GPU, in USD per GPU-hour.");
    assert.match(model.command, /accelerator-prices/);
    assert.match(model.endpoint, /accelerator-prices\.json$/);
  }
});

test("power details omit demo and estimate notes while retaining the matching SQL and docs", () => {
  const power = getCardDefinition("power-basis");
  const model = {
    location: { id: "PJM-DOMINION", label: "PJM Dominion", unit: "USD per MWh" },
    rows: [{ date: first }, { date: latest }], latest: {},
  };
  const cardState = { location: "PJM-DOMINION", range: "1y", scale: "price" };
  const price = createMonitorDataModel({ card: power, cardState, powerModel: model });
  assert.equal(price.provenance, "");
  assert.equal(price.description, "");
  assert.equal(price.detailDescription, "Hourly day-ahead and real-time wholesale electricity prices at PJM Dominion, in USD per MWh.");
  assert.match(price.command, /--range=1y/);
  assert.match(price.sql, /instrument = 'PJM-DOMINION'/);
  assert.doesNotMatch(price.sql, /usd_gpu_hour/);
  const energy = createMonitorDataModel({ card: power,
    cardState: { ...cardState, scale: "energy" }, powerModel: { ...model, energy: {} } });
  assert.equal(energy.provenance, "");
  assert.equal(energy.description, "");
  assert.equal(energy.detailDescription, "Estimated electricity cost per H100-hour, assuming a 10.2 kW eight-GPU system and 20% facility overhead.");
  assert.match(energy.sql, /real_time_price_usd_mwh \* 0\.00153 AS rt_usd_gpu_hour/);
  assert.match(energy.sql, /day_ahead_price_usd_mwh \* 0\.00153 AS da_usd_gpu_hour/);
  assert.match(energy.sourceUrl, /docs.nvidia.com/);
  assert.notEqual(energy.key, price.key);
});

test("equities monitor keeps source docs without a visible demo note or Desk API", () => {
  const model = createMonitorDataModel({ card, cardState: state, series, runtimePayload: runtime });
  assert.equal(model.rowCount, 4);
  assert.equal(model.asOf.toISOString(), latest.toISOString());
  assert.equal(model.accessKind, "source");
  assert.equal(model.command, undefined);
  assert.equal(model.endpoint, undefined);
  assert.equal(model.sql, undefined);
  assert.equal(model.label, "Equities");
  assert.equal(model.sourceUrl, source.url);
  assert.deepEqual(model.breadcrumbs, ["Desk", "NVDA + MSFT", "1Y"]);
  assert.equal(model.description, "");
  assert.equal(model.detailDescription, "Daily share-price series for chipmakers and cloud providers, in USD per share.");
  assert.match(model.provenance, /Synthetic price history.*as of 2026-08-31/);
  assert.equal(model.priceBasis, "demo-close");
  assert.equal(model.unit, "USD per share");
  assert.deepEqual(model.source, source);
  assert.equal(model.status, "ready");
  assert.doesNotMatch(`${model.summary}\n${model.command}\n${model.sql}`, /GPU|gpu.hour|desk.*data sync|\blive\b/i);
  assert(Object.isFrozen(model));
});

test("indexed equities retain source attribution without exposing SQL", () => {
  const model = createMonitorDataModel({ card, cardState: { ...state, scale: "index" }, series, runtimePayload: runtime });
  assert.equal(model.sql, undefined);
  assert.equal(model.accessKind, "source");
  assert.doesNotMatch(model.description, /gpu|\blower\b|\bupper\b/i);
  assert.equal(model.detailDescription, "Percentage changes in the selected share prices from a shared starting date.");
});

test("mixed market source details use the common chart date and one concise demo attribution", () => {
  const mixedState = { ...state, symbol: "NVDA", layers: ["NVDA", "H100", "H200"], scale: "index", range: "90d" };
  const common = new Date("2026-08-28T00:00:00Z");
  const mixedSeries = mixedState.layers.map(id => ({
    layer: card.layers.find(layer => layer.id === id),
    rows: [{ date: common, value: 100, plotValue: 100 }],
  }));
  const model = createMonitorDataModel({ card, cardState: mixedState,
    series: mixedSeries, runtimePayload: runtime,
    runtimePayloads: new Map([["gpu-index", { dataset: { kind: "scenario" } }]]),
  });
  assert.equal(model.asOf.toISOString(), common.toISOString());
  assert.equal(model.summary, "Compared through 2026-08-28");
  assert.equal(model.label, "Equities");
  assert.equal(model.description, "");
  assert.equal(model.unit, "percent change");
  assert.equal(model.detailDescription, "Share prices and GPU rental rates compared as percentage changes over shared dates.");
  assert.equal(model.priceBasis, "relative-change");
  assert.equal(model.accessKind, "source");
  assert.equal(model.command, undefined);
  assert.equal(model.sql, undefined);
  assert.equal(model.endpoint, undefined);
  const queryModel = createMonitorDataModel({ card,
    cardState: { ...mixedState, layers: mixedState.layers.join(",") },
    series: mixedSeries, runtimePayload: runtime,
    runtimePayloads: new Map([["gpu-index", { dataset: { kind: "scenario" } }]]),
  });
  assert.equal(queryModel.key, model.key);
  assert.equal(queryModel.detailDescription, model.detailDescription);
  const missing = createMonitorDataModel({ card, cardState: mixedState, runtimePayload: runtime });
  assert.equal(missing.summary, "No shared data");
  assert.equal(missing.asOf, null);
  assert.equal(missing.status, "unavailable");
  assert.equal(missing.detailDescription, model.detailDescription);
});

test("equity attribution links exclude credentials and unsafe protocols", () => {
  for (const url of ["file:///private/data", "javascript:alert(1)", "https://user:password@example.com"]) {
    const model = createMonitorDataModel({ card, cardState: state, series, runtimePayload: {
      ...runtime, dataset: { ...runtime.dataset, source: { ...source, url } },
    } });
    assert.equal(model.sourceUrl, null);
  }
  const model = createMonitorDataModel({ card, cardState: state, series, runtimePayload: {
    ...runtime, dataset: { ...runtime.dataset, source: { ...source, url: `${source.url}?api_token=secret#private` } },
  } });
  assert.equal(model.sourceUrl, source.url);
});

test("unavailable equity data reports no data without a fake date or export", () => {
  const unavailable = {
    asOf: null,
    dataset: { ...runtime.dataset, status: "unavailable", source: { ...source, status: "unavailable", message: "Historical prices are unavailable." } },
  };
  const model = createMonitorDataModel({ card, cardState: state, runtimePayload: unavailable });
  assert.equal(model.asOf, null);
  assert.equal(model.rowCount, 0);
  assert.equal(model.status, "unavailable");
  assert.equal(model.summary, "No data");
  assert.equal(model.description, "");
  assert.match(model.provenance, /Synthetic price history.*no observations/);
  assert.equal(model.detailDescription, "Daily share-price series for chipmakers and cloud providers, in USD per share.");
  assert.doesNotMatch(model.provenance, /1970|2026|as of/);
  assert.equal(model.accessKind, "source");
  assert.equal(model.endpoint, undefined);
});

test("equities source provenance changes invalidate the monitor model cache key", () => {
  const first = createMonitorDataModel({ card, cardState: state, series, runtimePayload: runtime });
  const next = createMonitorDataModel({ card, cardState: state, series, runtimePayload: {
    ...runtime, dataset: { ...runtime.dataset, source: { ...source, name: "Another official source" } },
  } });
  assert.notEqual(first.key, next.key);
});

test("GPU monitor access retains its supported CLI command and GPU-hour SQL", () => {
  const gpu = getCardDefinition("gpu-index");
  const model = createMonitorDataModel({
    card: gpu, cardState: { gpu: "H200", layers: ["H200"], range: "7d", scale: "price" },
    series: [{ layer: gpu.layers.find(layer => layer.id === "H200"), rows: [{ date: first, value: 4 }, { date: latest, value: 5 }] }],
  });
  assert.equal(model.accessKind, undefined);
  assert.equal(model.detailDescription, "GPU rental rates in USD per GPU-hour, with the median and middle 50% price band.");
  assert.match(model.command, /data sync/);
  assert.match(model.command, /compute-prices/);
  assert.match(model.command, /--series=H200/);
  assert.match(model.sql, /price_usd_gpu_hour/);
});

test("intro-only changes invalidate the data-panel key without altering equity provenance or source details", () => {
  const options = { card, series, runtimePayload: runtime };
  const price = createMonitorDataModel({ ...options, cardState: state });
  const index = createMonitorDataModel({ ...options, cardState: { ...state, scale: "index" } });
  const { key: priceKey, detailDescription: priceIntro, ...priceFields } = price;
  const { key: indexKey, detailDescription: indexIntro, ...indexFields } = index;
  assert.equal(priceIntro, "Daily share-price series for chipmakers and cloud providers, in USD per share.");
  assert.equal(indexIntro, "Percentage changes in the selected share prices from a shared starting date.");
  assert.deepEqual(priceFields, indexFields, "The introductory copy must not replace source metadata");
  assert.notEqual(priceKey, indexKey, "An otherwise identical panel must not retain the previous intro");
  const restored = createMonitorDataModel({ ...options, cardState: state });
  assert.equal(restored.detailDescription, priceIntro);
  assert.equal(restored.key, priceKey);
  assert.equal(index.detailDescription, indexIntro, "Later calls must not mutate earlier models");
});

test("single-company details update with selection without replacing source attribution", () => {
  const models = ["NVDA", "MSFT"].map(symbol => createMonitorDataModel({ card,
    cardState: { ...state, symbol, layers: [symbol] },
    series: series.filter(candidate => candidate.layer.id === symbol), runtimePayload: runtime,
  }));
  assert.equal(models[0].detailDescription, "Daily share-price series for NVIDIA, in USD per share.");
  assert.equal(models[1].detailDescription, "Daily share-price series for Microsoft, in USD per share.");
  assert.notEqual(models[0].key, models[1].key);
  for (const model of models) {
    assert.equal(model.sourceUrl, source.url);
    assert.deepEqual(model.source, source);
    assert.equal(model.provenance, models[0].provenance);
    assert.equal(model.priceBasis, "demo-close");
    assert.equal(model.accessKind, "source");
    assert.equal(model.sql, undefined);
  }
});

test("multi-GPU details remove the single-series band claim and keep the API contract", () => {
  const gpu = getCardDefinition("gpu-index");
  const make = layers => createMonitorDataModel({ card: gpu,
    cardState: { gpu: "H100", layers, range: "7d", scale: "price" },
    series: layers.map(id => ({ layer: gpu.layers.find(layer => layer.id === id),
      rows: [{ date: first, value: 3 }, { date: latest, value: 4 }] })),
  });
  const single = make(["H100"]);
  const multiple = make(["H100", "H200"]);
  assert.match(single.detailDescription, /median and middle 50% price band/);
  assert.equal(multiple.detailDescription, "Rental rates for the selected GPUs, in USD per GPU-hour.");
  assert.doesNotMatch(multiple.detailDescription, /band|IQR|median/);
  assert.notEqual(single.key, multiple.key);
  assert.equal(single.endpoint, multiple.endpoint);
  assert.match(multiple.command, /compute-prices/);
  assert.match(multiple.sql, /price_usd_gpu_hour/);
  assert.equal(make(["H100"]).key, single.key, "Returning to one GPU must restore its own copy and key");
});

test("Sandbox introduction follows the effective model range rather than stale requested state", () => {
  const sandbox = getCardDefinition("sandbox-cost");
  const model = { providers: [{ id: "novita" }], primary: "novita", asOf: Date.parse("2026-08-06T00:00:00Z") };
  const history = createMonitorDataModel({ card: sandbox, cardState: { range: "now" },
    sandboxModel: { ...model, range: "7d" } });
  const latest = createMonitorDataModel({ card: sandbox, cardState: { range: "all" },
    sandboxModel: { ...model, range: "now" } });
  assert.equal(history.detailDescription, "Daily medians of CPU and memory cost estimates across benchmark batches. Each provider uses its own price scale.");
  assert.equal(latest.detailDescription, "Estimated CPU and memory cost per benchmark job, calculated from measured runtime and provider rates.");
  assert.equal(history.breadcrumbs.at(-1), "7D");
  assert.equal(latest.breadcrumbs.at(-1), "NOW");
  assert.notEqual(history.key, latest.key);
  assert.equal(history.sourceUrl, latest.sourceUrl);
  assert.deepEqual(history.source, latest.source);
});

test("depth introductions follow the displayed mode while retaining their CLI and SQL", () => {
  const depth = getCardDefinition("gpu-market-depth");
  const depthModel = { current: { buckets: [{}, {}] }, history: [{}, {}],
    instrument: { gpuLabel: "H100" }, targetNodes: 256, asOf: latest.getTime() / 1000 };
  const now = createMonitorDataModel({ card: depth, cardState: { scale: "depth" }, depthModel });
  const history = createMonitorDataModel({ card: depth, cardState: { scale: "history" }, depthModel });
  assert.equal(now.detailDescription, "US H100 capacity for 30-day rentals, in eight-GPU InfiniBand nodes. The target marks the lowest rate covering the requested capacity.");
  assert.equal(history.detailDescription, "Daily US H100 rental rates in USD per GPU-hour for the selected capacity target. Each InfiniBand node has eight GPUs on 30-day terms.");
  assert.match(now.command, /--view=now/);
  assert.match(history.command, /--view=history/);
  assert(now.sql && history.sql);
  assert.notEqual(now.key, history.key);
  assert.equal(now.rowCount, history.rowCount);
});
