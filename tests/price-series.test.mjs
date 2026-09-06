import assert from "node:assert/strict";
import test from "node:test";
import { alignIndexedPriceSeries, createPriceSeriesIndex, normalizePricePoints, priceRowsForRange } from "../src/price-series.js";

test("price histories use independent source clocks and never leak across cards", () => {
  const definitions = [{ id: "gpu" }, { id: "equities" }, { id: "snapshot", sourceCardId: "gpu" }];
  const index = createPriceSeriesIndex(new Map([
    ["gpu", { series: { H200: [[100, 3], [200, 4]] } }],
    ["equities", { series: { NVDA: [[1000, 100], [1100, 105]] } }],
  ]), definitions);
  assert.equal(priceRowsForRange(index, definitions[0], "H200", 150000).length, 2);
  assert.equal(priceRowsForRange(index, definitions[1], "NVDA", 150000).length, 2);
  assert.equal(priceRowsForRange(index, definitions[0], "NVDA", null).length, 0);
  assert.deepEqual(priceRowsForRange(index, definitions[2], "H200", null), priceRowsForRange(index, definitions[0], "H200", null));
});

test("daily closes preserve observation dates and do not fabricate uncertainty bands", () => {
  const rows = normalizePricePoints([[300, 105], [100, 100], [null, 3], [200, null], [300, 106]], "NVDA");
  assert.deepEqual(rows.map(row => [+row.date, row.value, row.lower, row.upper]), [
    [100000, 100, 100, 100], [300000, 106, 106, 106],
  ]);
});

test("unavailable histories remain empty", () => {
  const definition = { id: "equities" };
  const index = createPriceSeriesIndex(new Map([["equities", { series: { NVDA: [] } }]]), [definition]);
  assert.deepEqual(priceRowsForRange(index, definition, "NVDA", 604800000), []);
});

test("equity comparisons rebase on the same trading session without fabricating missing closes", () => {
  const a = { rows: normalizePricePoints([[100, 10], [200, 20], [300, 40], [400, 50]], "A") };
  const b = { rows: normalizePricePoints([[200, 100], [400, 110]], "B") };
  const compared = alignIndexedPriceSeries([a, b]);
  assert.deepEqual(compared.map(candidate => candidate.rows.map(row => [+row.date, row.plotValue])), [
    [[200000, 100], [400000, 250]],
    [[200000, 100], [400000, 110.00000000000001]],
  ]);
  assert.equal(a.rows.length, 4, "Source history must remain unchanged");
  assert.deepEqual(alignIndexedPriceSeries([a, { rows: normalizePricePoints([[500, 30]], "C") }]), []);
});
