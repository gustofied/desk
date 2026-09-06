import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createMarketStripModel } from "../src/market-strip-model.js";

const AS_OF = Date.parse("2026-08-29T16:00:00.000Z") / 1000;
const GPU_IDS = ["H100", "H200", "B200", "B300"];
const GPU_PRICES = [2.67, 3.89, 5.58, 7.34];
const POWER_ID = "PJM-WEST-RT";
const iso = timestamp => new Date(timestamp * 1000).toISOString();

function gpuFixture({ timestamp = AS_OF, kind = "scenario" } = {}) {
  return {
    version: 2, cardId: "gpu-index", revision: "gpu-test", asOf: timestamp,
    columns: ["timestamp", "value", "lower", "upper"],
    dataset: { kind },
    series: Object.fromEntries(GPU_IDS.map((id, index) => {
      const value = GPU_PRICES[index];
      return [id, [[timestamp, value, value - 0.1, value + 0.1]]];
    })),
  };
}

function powerFixture({ timestamp = AS_OF, kind = "scenario" } = {}) {
  return {
    version: 1, cardId: "power-basis", revision: "power-test", asOf: timestamp,
    columns: ["timestamp", "realTime", "dayAhead", "basis"],
    locations: [{
      id: "PJM-WEST", label: "PJM West", market: "PJM", location: "Western Hub",
      timezone: "America/New_York", currency: "USD", unit: "USD per MWh", intervalMinutes: 60,
    }],
    dataset: {
      kind, cadence: "hourly", cadenceSeconds: 3600,
      start: timestamp - 3600, end: timestamp, observationCount: 2,
    },
    series: { "PJM-WEST": [[timestamp - 3600, 46.73, 40.46, 6.27], [timestamp, 43.36, 39.76, 3.6]] },
  };
}

function fixtures() { return { gpuPayload: gpuFixture(), powerPayload: powerFixture() }; }
function ids(model) { return model.items.map(item => item.id); }
function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

test("actual market files yield the five exact scenario prices with their observation time", () => {
  const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
  const model = createMarketStripModel({
    gpuPayload: read("../data/gpu-price-index.json"),
    powerPayload: read("../data/power-basis.json"),
  });
  assert.deepEqual(model.items, [
    ...GPU_IDS.map((id, index) => ({
      id, label: id, value: GPU_PRICES[index], unit: "USD per GPU-hour",
      observedAt: "2026-08-29T16:00:00.000Z", kind: "scenario",
    })),
    { id: POWER_ID, label: "PJM West RT", value: 43.36, unit: "USD per MWh", observedAt: "2026-08-29T16:00:00.000Z", kind: "scenario" },
  ]);
  assert.equal(model.kind, "scenario");
  assert.equal(model.observationLabel, "As of 2026-08-29 16:00 UTC");
  assert.equal(model.key, JSON.stringify(model.items));
});

test("the strip keeps registry order and excludes TOKEN and unrequested source series", () => {
  const payloads = fixtures();
  payloads.gpuPayload.series = {
    TOKEN: [[AS_OF, 2.34, 2.34, 2.34]],
    ...Object.fromEntries(Object.entries(payloads.gpuPayload.series).reverse()),
    OTHER: [[AS_OF, 99, 99, 99]],
  };
  assert.deepEqual(ids(createMarketStripModel(payloads)), [...GPU_IDS, POWER_ID]);
});

test("GPU selection uses the newest valid observation, not input order or a malformed later row", () => {
  const gpuPayload = gpuFixture();
  for (const [index, id] of GPU_IDS.entries()) {
    const value = GPU_PRICES[index];
    gpuPayload.series[id] = [
      [AS_OF, value, value, value],
      [AS_OF + 3600, null, 0, 0],
      [AS_OF - 3600, 1, 1, 1],
      [AS_OF + 7200, 2, 3, 4],
      [AS_OF - 7200, 9, 9, 9],
    ];
  }
  const model = createMarketStripModel({ gpuPayload });
  assert.deepEqual(model.items.map(item => item.value), GPU_PRICES);
  assert.ok(model.items.every(item => item.observedAt === iso(AS_OF)));
});

test("a missing or unusable GPU layer drops the entire GPU group without losing power", () => {
  for (const id of GPU_IDS) {
    for (const unusable of [undefined, [], [[AS_OF, -1, -1, -1]]]) {
      const payloads = fixtures();
      if (unusable === undefined) delete payloads.gpuPayload.series[id];
      else payloads.gpuPayload.series[id] = unusable;
      assert.deepEqual(ids(createMarketStripModel(payloads)), [POWER_ID]);
    }
  }
  assert.deepEqual(ids(createMarketStripModel({ powerPayload: powerFixture() })), [POWER_ID]);
});

test("missing or invalid power leaves all four valid GPU prices available", () => {
  for (const invalidate of [
    payloads => { delete payloads.powerPayload; },
    payloads => { payloads.powerPayload.series["PJM-WEST"] = []; },
    payloads => { payloads.powerPayload.asOf -= 3600; },
    payloads => { payloads.powerPayload.series["PJM-WEST"][1][3] = 999; },
  ]) {
    const payloads = fixtures();
    invalidate(payloads);
    assert.deepEqual(ids(createMarketStripModel(payloads)), GPU_IDS);
  }
});

test("null, blank, boolean, and nonfinite GPU columns cannot become fake zero observations", () => {
  for (const value of [null, undefined, "", " ", true, false, NaN, Infinity, -Infinity]) {
    for (const column of [0, 1, 2, 3]) {
      const payloads = fixtures();
      const row = [AS_OF, 0, 0, 0];
      row[column] = value;
      payloads.gpuPayload.series.H100 = [row];
      assert.deepEqual(ids(createMarketStripModel(payloads)), [POWER_ID], `GPU column ${column}, ${String(value)}`);
    }
  }
});

test("malformed numeric power columns reject that source instead of coercing missing prices to zero", () => {
  for (const value of [null, undefined, "", " ", true, false, NaN, Infinity, -Infinity]) {
    for (const rowIndex of [0, 1]) {
      for (const column of [0, 1, 2, 3]) {
        const payloads = fixtures();
        const row = [AS_OF - (1 - rowIndex) * 3600, 0, 0, 0];
        row[column] = value;
        payloads.powerPayload.series["PJM-WEST"][rowIndex] = row;
        assert.deepEqual(ids(createMarketStripModel(payloads)), GPU_IDS, `power row ${rowIndex}, column ${column}, ${String(value)}`);
      }
    }
  }
});

test("valid zero GPU prices and negative power prices remain intact", () => {
  const payloads = fixtures();
  payloads.gpuPayload.series.H100 = [[AS_OF, 0, 0, 0]];
  payloads.powerPayload.series["PJM-WEST"][1] = [AS_OF, -5, -2, -3];
  const model = createMarketStripModel(payloads);
  assert.deepEqual(ids(model), [...GPU_IDS, POWER_ID]);
  assert.equal(model.items[0].value, 0);
  assert.equal(model.items.at(-1).value, -5);
});

test("malformed payloads fail independently without throwing", () => {
  for (const malformed of [null, undefined, false, 42, "bad", [], {}, { series: null }, { version: 1, revision: "bad", series: [] }]) {
    assert.doesNotThrow(() => createMarketStripModel({ gpuPayload: malformed, powerPayload: malformed }));
    assert.deepEqual(ids(createMarketStripModel({ gpuPayload: malformed, powerPayload: powerFixture() })), [POWER_ID]);
    assert.deepEqual(ids(createMarketStripModel({ gpuPayload: gpuFixture(), powerPayload: malformed })), GPU_IDS);
  }
});

test("unavailable sources produce an explicit empty snapshot", () => {
  assert.deepEqual(createMarketStripModel(), { items: [], key: "[]", kind: "unknown", observationLabel: "" });
  assert.deepEqual(createMarketStripModel({ gpuPayload: {}, powerPayload: {} }), createMarketStripModel());
});

test("observation labels use actual item times, preserve seconds, and disclose differing timestamps", () => {
  const cases = [
    [AS_OF, AS_OF, "As of 2026-08-29 16:00 UTC"],
    [AS_OF - 3600, AS_OF, "Observations 2026-08-29 15:00 UTC – 2026-08-29 16:00 UTC"],
    [AS_OF + 17, AS_OF + 17, "As of 2026-08-29 16:00:17 UTC"],
    [AS_OF - 3600 + 5, AS_OF + 17, "Observations 2026-08-29 15:00:05 UTC – 2026-08-29 16:00:17 UTC"],
  ];
  for (const [gpuTime, powerTime, expected] of cases) {
    const model = createMarketStripModel({ gpuPayload: gpuFixture({ timestamp: gpuTime }), powerPayload: powerFixture({ timestamp: powerTime }) });
    assert.equal(model.observationLabel, expected);
    assert.equal(model.items[0].observedAt, iso(gpuTime));
    assert.equal(model.items.at(-1).observedAt, iso(powerTime));
  }
  const payloads = fixtures();
  payloads.gpuPayload.series.H100[0][0] -= 3600;
  assert.equal(createMarketStripModel(payloads).observationLabel,
    "Observations 2026-08-29 15:00 UTC – 2026-08-29 16:00 UTC");
});

test("construction preserves caller data and freezes the full returned snapshot", () => {
  const payloads = fixtures();
  const original = structuredClone(payloads);
  deepFreeze(payloads);
  const model = createMarketStripModel(payloads);
  assert.deepEqual(payloads, original);
  assert.equal(Object.isFrozen(model), true);
  assert.equal(Object.isFrozen(model.items), true);
  assert.ok(model.items.every(Object.isFrozen));
  assert.throws(() => { model.items[0].value = 99; }, TypeError);
  assert.throws(() => model.items.push({}), TypeError);
  assert.throws(() => { model.kind = "observed"; }, TypeError);
});

test("source revision-only changes do not change the stable item key", () => {
  const payloads = fixtures();
  const before = createMarketStripModel(payloads);
  payloads.gpuPayload.revision = "gpu-revised";
  payloads.powerPayload.revision = "power-revised";
  const after = createMarketStripModel(payloads);
  assert.equal(before.key, after.key);
  assert.deepEqual(before, after);
  assert.equal(after.key, JSON.stringify(after.items));
});

test("price, observation time, and provenance changes each change the stable item key", () => {
  const before = createMarketStripModel(fixtures()).key;
  for (const change of [
    payloads => { payloads.gpuPayload.series.H100 = [[AS_OF, 3, 3, 3]]; },
    payloads => { payloads.powerPayload.series["PJM-WEST"][1] = [AS_OF, 45, 40, 5]; },
    payloads => { payloads.gpuPayload = gpuFixture({ timestamp: AS_OF + 1 }); },
    payloads => { payloads.powerPayload = powerFixture({ timestamp: AS_OF + 1 }); },
    payloads => { payloads.gpuPayload.dataset.kind = "observed"; },
    payloads => { payloads.powerPayload.dataset.kind = "observed"; },
  ]) {
    const payloads = fixtures();
    change(payloads);
    const model = createMarketStripModel(payloads);
    assert.equal(model.items.length, 5);
    assert.notEqual(model.key, before);
    assert.equal(model.key, JSON.stringify(model.items));
  }
});

test("provenance maps declared kinds honestly and retains unknown sources as unknown", () => {
  for (const [sourceKind, expected] of [["scenario", "scenario"], ["showcase", "scenario"], ["observed", "observed"], ["mixed", "mixed"], ["unrecognized", "unknown"], [undefined, "unknown"]]) {
    const payloads = fixtures();
    payloads.gpuPayload.dataset.kind = sourceKind;
    payloads.powerPayload.dataset.kind = sourceKind;
    const model = createMarketStripModel(payloads);
    assert.equal(model.kind, expected);
    assert.ok(model.items.every(item => item.kind === expected));
  }
  const payloads = fixtures();
  delete payloads.gpuPayload.dataset;
  delete payloads.powerPayload.dataset;
  const unknown = createMarketStripModel(payloads);
  assert.equal(unknown.kind, "unknown");
  assert.ok(unknown.items.every(item => item.kind === "unknown"));
});

test("mixed provenance is disclosed and unavailable groups do not influence the aggregate", () => {
  for (const powerKind of ["observed", "mixed", "unrecognized"]) {
    const model = createMarketStripModel({ gpuPayload: gpuFixture(), powerPayload: powerFixture({ kind: powerKind }) });
    assert.equal(model.kind, "mixed");
    assert.ok(model.items.slice(0, 4).every(item => item.kind === "scenario"));
    assert.equal(model.items.at(-1).kind, powerKind === "unrecognized" ? "unknown" : powerKind);
  }
  const payloads = fixtures();
  payloads.gpuPayload.dataset.kind = "observed";
  delete payloads.gpuPayload.series.H100;
  const powerOnly = createMarketStripModel(payloads);
  assert.deepEqual(ids(powerOnly), [POWER_ID]);
  assert.equal(powerOnly.kind, "scenario");
});
