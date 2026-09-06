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
