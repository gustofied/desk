import assert from "node:assert/strict";
import test from "node:test";
import { createPriceSeriesIndex } from "../src/price-series.js";
import { createCrossMarketSeries, hasCrossMarketLayers } from "../src/cross-market-series.js";

const DAY_MS = 86400000;
const definition = {
  id: "equities",
  layers: [
    { id: "NVDA", label: "NVIDIA" },
    { id: "MSFT", label: "Microsoft" },
    { id: "H100", sourceCardId: "gpu-index", label: "H100" },
    { id: "H200", sourceCardId: "gpu-index", label: "H200" },
  ],
};
const normalized = { gpu: "NVDA", layers: ["H100", "NVDA"], scale: "index", range: "all" };
const point = (date, value, lower = value - 1, upper = value + 1) => [Date.parse(date) / 1000, value, lower, upper];
const day = date => `${date}T00:00:00.000Z`;
function fixture() {
  return createPriceSeriesIndex(new Map([
    ["equities", { series: {
      NVDA: [point("2026-08-27", 90), point("2026-08-28", 100), point("2026-08-31", 110), point("2026-09-01", 120), point("2026-09-04", 125)],
      MSFT: [point("2026-08-28", 200), point("2026-09-01", 220), point("2026-09-04", 230)],
      H100: [point("2026-08-28", 999), point("2026-08-31", 999)],
    } }],
    ["gpu-index", { series: {
      H100: [point("2026-08-28T03:00:00Z", 3), point("2026-08-28T23:00:00Z", 4), point("2026-08-29T12:00:00Z", 5), point("2026-08-30T23:00:00Z", 6), point("2026-08-31T22:00:00Z", 8), point("2026-09-01T04:00:00Z", 9), point("2026-09-01T23:59:00Z", 10)],
      H200: [point("2026-08-28T09:00:00Z", 10), point("2026-09-01T16:00:00Z", 20), point("2026-09-06T23:00:00Z", 30)],
    } }],
  ]), [definition, { id: "gpu-index" }]);
}
const dates = candidate => candidate.rows.map(row => row.date.toISOString());
const values = candidate => candidate.rows.map(row => row.plotValue);

test("cross-market detection considers only selected layers with another source card", () => {
  assert.equal(hasCrossMarketLayers(definition, ["NVDA", "MSFT"]), false);
  assert.equal(hasCrossMarketLayers(definition, ["NVDA", "H100"]), true);
  assert.equal(hasCrossMarketLayers(definition, ["H200"]), true);
  assert.equal(hasCrossMarketLayers(definition, ["unknown"]), false);
  assert.equal(hasCrossMarketLayers({ id: "equities", layers: [{ id: "NVDA", sourceCardId: "equities" }] }, ["NVDA"]), false);
  assert.equal(hasCrossMarketLayers(null, []), false);
});

test("irregular hourly and daily observations align on shared UTC dates and rebase together", () => {
  const series = createCrossMarketSeries(fixture(), definition, normalized);
  assert.deepEqual(series.map(candidate => [candidate.layer.id, candidate.primary]), [["NVDA", true], ["H100", false]]);
  const expectedDates = ["2026-08-28", "2026-08-31", "2026-09-01"].map(day);
  assert.deepEqual(dates(series[0]), expectedDates);
  assert.deepEqual(dates(series[1]), expectedDates);
  assert.deepEqual(series[1].rows.map(row => row.value), [4, 8, 10], "Use the GPU source and latest observed hour, not same-named equities data");
  assert.deepEqual(values(series[1]), [100, 200, 250]);
  assert.equal(series[0].rows[0].plotValue, 100);
  assert.equal(series[0].rows.at(-1).plotValue, 120);
  for (const candidate of series) for (const row of candidate.rows) {
    assert.equal(row.plotLower, row.plotValue);
    assert.equal(row.plotUpper, row.plotValue);
  }
});

test("range anchors to the latest common day instead of either market's newer clock", () => {
  const index = fixture();
  index.get("gpu-index").end = Date.parse("2026-12-31T23:00:00Z");
  const series = createCrossMarketSeries(index, definition, normalized, { milliseconds: 2 * DAY_MS });
  assert.deepEqual(dates(series[0]), ["2026-08-31", "2026-09-01"].map(day));
  assert.deepEqual(values(series[1]), [100, 125]);
  assert.equal(series[0].rows[0].plotValue, 100);
  assert.equal(series[0].rows.at(-1).plotValue, 120 / 110 * 100);
});

test("all selected calendars intersect without weekend fill or partial-series omission", () => {
  const series = createCrossMarketSeries(fixture(), definition, { ...normalized, layers: ["MSFT", "H100", "H200", "NVDA"] });
  assert.deepEqual(series.map(candidate => candidate.layer.id), ["NVDA", "MSFT", "H100", "H200"]);
  for (const candidate of series) assert.deepEqual(dates(candidate), ["2026-08-28", "2026-09-01"].map(day));
  assert.deepEqual(values(series[3]), [100, 200]);
});

test("missing sources, missing layers and empty comparisons fail as one series group", () => {
  const mutations = [
    index => index.delete("gpu-index"),
    index => index.get("gpu-index").layers.delete("H100"),
    index => index.get("gpu-index").layers.set("H100", []),
    index => index.get("equities").layers.delete("NVDA"),
  ];
  for (const mutate of mutations) {
    const index = fixture();
    mutate(index);
    assert.deepEqual(createCrossMarketSeries(index, definition, normalized), []);
  }
  assert.deepEqual(createCrossMarketSeries(fixture(), definition, { ...normalized, layers: ["NVDA", "unknown"] }), []);
});

test("unused invalid layers and feeds do not prevent a valid selected comparison", () => {
  const index = fixture();
  index.get("gpu-index").layers.get("H200")[0].value = 0;
  index.get("equities").layers.set("MSFT", []);
  index.set("unused-source", { layers: new Map([["BAD", [{ date: new Date(NaN), value: NaN }]]]) });
  const series = createCrossMarketSeries(index, definition, { ...normalized, layers: ["H100", "NVDA", "H100"] });
  assert.deepEqual(series.map(candidate => candidate.layer.id), ["NVDA", "H100"]);
  assert.deepEqual(values(series[1]), [100, 200, 250]);
});

test("nonpositive, invalid or unrepresentable return observations fail closed", () => {
  for (const value of [0, -1, NaN, Infinity, "4"]) {
    const index = fixture();
    index.get("gpu-index").layers.get("H100")[0].value = value;
    assert.deepEqual(createCrossMarketSeries(index, definition, normalized), []);
  }
  const invalidDate = fixture();
  invalidDate.get("gpu-index").layers.get("H100")[0].date = new Date(NaN);
  assert.deepEqual(createCrossMarketSeries(invalidDate, definition, normalized), []);
  const overflow = fixture();
  overflow.get("gpu-index").layers.get("H100")[1].value = Number.MIN_VALUE;
  assert.deepEqual(createCrossMarketSeries(overflow, definition, normalized), []);
});

test("fewer than two common dates or range dates produces no comparison", () => {
  const index = fixture();
  index.get("gpu-index").layers.set("H100", index.get("gpu-index").layers.get("H100").slice(-1));
  assert.deepEqual(createCrossMarketSeries(index, definition, normalized), []);
  assert.deepEqual(createCrossMarketSeries(fixture(), definition, normalized, { milliseconds: DAY_MS / 2 }), []);
  index.get("gpu-index").layers.get("H100")[0].date = new Date("2026-01-01");
  assert.deepEqual(createCrossMarketSeries(index, definition, normalized), [], "No shared calendar never invents observations");
});

test("zoom filters already-rebased values and never moves the return baseline", () => {
  const zoomWindow = [new Date("2026-08-31"), new Date("2026-09-01")];
  const series = createCrossMarketSeries(fixture(), definition, normalized, { zoomWindow });
  assert.deepEqual(dates(series[1]), ["2026-08-31", "2026-09-01"].map(day));
  assert.deepEqual(values(series[1]), [200, 250]);
  assert.deepEqual(createCrossMarketSeries(fixture(), definition, normalized, { zoomWindow: [new Date("2026-09-01"), new Date("2026-09-01")] }), []);
  assert.deepEqual(createCrossMarketSeries(fixture(), definition, normalized, { zoomWindow: [Infinity, NaN] }), []);
});

test("UTC aggregation keeps original observed dates and is independent of source row order", () => {
  const index = fixture();
  index.get("gpu-index").layers.get("H100").reverse();
  const series = createCrossMarketSeries(index, definition, normalized);
  assert.deepEqual(series[1].rows.map(row => row.observedAt.toISOString()), [
    "2026-08-28T23:00:00.000Z", "2026-08-31T22:00:00.000Z", "2026-09-01T23:59:00.000Z",
  ]);
  assert.deepEqual(series[0].rows.map(row => row.observedAt.toISOString()), dates(series[0]));
  const utcOffset = createPriceSeriesIndex(new Map([
    ["equities", { series: { NVDA: [point("2026-08-31T01:00:00+02:00", 100), point("2026-09-01T01:00:00+02:00", 110)] } }],
    ["gpu-index", { series: { H100: [point("2026-08-30T20:00:00Z", 4), point("2026-08-31T20:00:00Z", 5)] } }],
  ]), [definition, { id: "gpu-index" }]);
  assert.deepEqual(dates(createCrossMarketSeries(utcOffset, definition, normalized)[0]), ["2026-08-30", "2026-08-31"].map(day));
});

test("inputs remain unchanged and returned dates are independent objects", () => {
  const index = fixture();
  const before = structuredClone({ index, definition, normalized });
  const result = createCrossMarketSeries(index, definition, normalized);
  assert.deepEqual({ index, definition, normalized }, before);
  result[0].rows[0].date.setUTCFullYear(2000);
  result[1].rows[0].observedAt.setUTCFullYear(2000);
  result[1].rows[0].value = 0;
  assert.deepEqual({ index, definition, normalized }, before);
});
