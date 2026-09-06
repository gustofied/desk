import assert from "node:assert/strict";
import test from "node:test";
import { getCardDefinition } from "../src/card-registry.js";
import { createMonitorDataModel } from "../src/monitor-data-model.js";

const card = getCardDefinition("equities");
const first = new Date("2026-08-28T00:00:00.000Z");
const latest = new Date("2026-08-31T00:00:00.000Z");
const state = { symbol: "NVDA", layers: ["NVDA", "MSFT"], range: "1y", scale: "price" };
const source = { name: "EODHD", url: "https://eodhd.com/financial-apis/api-for-historical-data-and-volumes", status: "ready" };
const runtime = {
  asOf: latest.getTime() / 1000,
  dataset: { source, status: "ready", priceBasis: "split-dividend-adjusted-close" },
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
  assert.equal(model.description, "Estimated CPU + memory cost per job. Median and range across 12 runs.");
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
  assert.equal(week.description, "Estimated CPU + memory cost per job. Daily batch medians; independent scales. Methodology varies across runs.");
  assert.notEqual(week.key, all.key, "Range changes must update details even when observation counts match");
  assert.equal(week.breadcrumbs.at(-1), "7D");
  const missing = createMonitorDataModel({ card: sandbox });
  assert.equal(missing.asOf, null);
  assert.equal(missing.summary, "No observations");
  assert.equal(missing.status, "unavailable");
  assert.equal(missing.sourceUrl, week.sourceUrl);
});

test("latest-price details say GPU or GPUs without renaming the card or API", () => {
  const snapshot = getCardDefinition("gpu-price-snapshot");
  for (const ids of [["H100"], ["H100", "H200", "B200", "B300"]]) {
    const model = createMonitorDataModel({ card: snapshot, cardState: {}, barModel: {
      bars: ids.map(id => ({ id })), asOf: latest.getTime() / 1000,
    } });
    assert.equal(model.summary, ids.length === 1 ? "1 GPU" : "4 GPUs");
    assert.equal(model.label, "Latest prices");
    assert.match(model.command, /accelerator-prices/);
    assert.match(model.endpoint, /accelerator-prices\.json$/);
  }
});

test("power details label demo prices and expose the matching H100 estimate SQL", () => {
  const power = getCardDefinition("power-basis");
  const model = {
    location: { id: "PJM-DOMINION", label: "PJM Dominion", unit: "USD per MWh" },
    rows: [{ date: first }, { date: latest }], latest: {},
  };
  const cardState = { location: "PJM-DOMINION", range: "1y", scale: "price" };
  const price = createMonitorDataModel({ card: power, cardState, powerModel: model });
  assert.equal(price.provenance, "Demo");
  assert.match(price.description, /Generated.*not an exchange feed/);
  assert.match(price.command, /--range=1y/);
  assert.match(price.sql, /instrument = 'PJM-DOMINION'/);
  assert.doesNotMatch(price.sql, /usd_gpu_hour/);
  const energy = createMonitorDataModel({ card: power,
    cardState: { ...cardState, scale: "energy" }, powerModel: { ...model, energy: {} } });
  assert.equal(energy.provenance, "Estimate");
  assert.match(energy.description, /10.2 kW node max.*8 GPUs.*PUE 1.2 assumed/);
  assert.match(energy.sql, /real_time_price_usd_mwh \* 0\.00153 AS rt_usd_gpu_hour/);
  assert.match(energy.sql, /day_ahead_price_usd_mwh \* 0\.00153 AS da_usd_gpu_hour/);
  assert.match(energy.description, /not a delivered bill or GPU rental rate/);
  assert.notEqual(energy.key, price.key);
});

test("equities monitor attributes external share prices without exposing a Desk API", () => {
  const model = createMonitorDataModel({ card, cardState: state, series, runtimePayload: runtime });
  assert.equal(model.rowCount, 4);
  assert.equal(model.asOf.toISOString(), latest.toISOString());
  assert.equal(model.accessKind, "source");
  assert.equal(model.command, undefined);
  assert.equal(model.endpoint, undefined);
  assert.equal(model.sql, undefined);
  assert.equal(model.label, "EODHD");
  assert.equal(model.sourceUrl, source.url);
  assert.deepEqual(model.breadcrumbs, ["EODHD", "NVDA + MSFT", "1Y"]);
  assert.equal(model.description, "Data by EODHD");
  assert.match(model.provenance, /EODHD.*as of 2026-08-31/);
  assert.equal(model.priceBasis, "split-dividend-adjusted-close");
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
});

test("mixed market source details use the common chart date and identify demo GPUs", () => {
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
  assert.equal(model.label, "EODHD + Desk");
  assert.equal(model.description, "Data by EODHD · GPU demo data");
  assert.equal(model.unit, "percent change");
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
  const missing = createMonitorDataModel({ card, cardState: mixedState, runtimePayload: runtime });
  assert.equal(missing.summary, "No shared data");
  assert.equal(missing.asOf, null);
  assert.equal(missing.status, "unavailable");
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

test("unavailable equity data reports the missing connection without a fake date or export", () => {
  const unavailable = {
    asOf: null,
    dataset: { ...runtime.dataset, status: "unavailable", source: { ...source, status: "unavailable", message: "Historical prices are unavailable." } },
  };
  const model = createMonitorDataModel({ card, cardState: state, runtimePayload: unavailable });
  assert.equal(model.asOf, null);
  assert.equal(model.rowCount, 0);
  assert.equal(model.status, "unavailable");
  assert.equal(model.summary, "Not connected");
  assert.equal(model.description, "Data by EODHD");
  assert.match(model.provenance, /EODHD.*no observations/);
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
  assert.match(model.command, /data sync/);
  assert.match(model.command, /compute-prices/);
  assert.match(model.command, /--series=H200/);
  assert.match(model.sql, /price_usd_gpu_hour/);
});
