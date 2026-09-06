import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createPowerBasisSource, powerLocalTime } from "../scripts/generate-power-basis.mjs";
import { getCardDefinition } from "../src/card-registry.js";
import { createPowerBasisModel } from "../src/power-basis-model.js";

const source = createPowerBasisSource();
const card = { ...getCardDefinition("power-basis"),
  defaults: { ...getCardDefinition("power-basis").defaults, layer: "PJM-WEST", range: "1d" },
  ranges: ["1d", "7d", "90d", "1y"],
};
function runtimePayload() {
  const series = Object.fromEntries(source.locations.map(location => [location.id,
    source.series[location.id].map(row => [Date.parse(row.observed_at) / 1000,
      row.real_time_price, row.day_ahead_price,
      Math.round((row.real_time_price - row.day_ahead_price) * 100) / 100]),
  ]));
  return {
    version: 1, cardId: "power-basis", revision: source.revision,
    asOf: Date.parse(source.as_of) / 1000,
    columns: ["timestamp", "realTime", "dayAhead", "basis"],
    locations: source.locations.map(({ interval_minutes, ...location }) => ({ ...location, intervalMinutes: interval_minutes })),
    series,
    dataset: { kind: "scenario", cadence: "hourly", cadenceSeconds: 3600,
      start: Date.parse(source.observation_window.started_at) / 1000,
      end: Date.parse(source.as_of) / 1000,
      observationCount: source.observation_window.observation_count },
  };
}

test("power demo generation is deterministic, explicit and provides an aligned hourly year for all three locations", () => {
  assert.deepEqual(createPowerBasisSource(), source);
  assert.match(source.revision, /^[a-f0-9]{12}$/);
  assert.deepEqual(source.locations.map(location => location.id), ["PJM-WEST", "PJM-DOMINION", "ERCOT-NORTH"]);
  assert.equal(source.locations[1].settlement_point, "DOM");
  assert.equal(source.locations[2].settlement_point, "LZ_NORTH");
  assert.equal(source.locations[1].timezone, "America/New_York");
  assert.equal(source.locations[2].timezone, "America/Chicago");
  assert.equal(source.dataset.kind, "showcase");
  assert.equal(source.dataset.label, "Demo");
  assert.match(source.dataset.notice, /not observed/);
  assert.match(source.dataset.aggregation, /not a native settlement interval/);
  assert.equal(source.observation_window.observation_count, 8761);
  for (const rows of Object.values(source.series)) {
    assert.equal(rows.length, 8761);
    assert.equal(rows[0].observed_at, "2025-08-29T16:00:00.000Z");
    assert.equal(rows.at(-1).observed_at, source.as_of);
    rows.forEach((row, index) => {
      assert(Number.isFinite(row.real_time_price));
      assert(Number.isFinite(row.day_ahead_price));
      if (index) assert.equal(Date.parse(row.observed_at) - Date.parse(rows[index - 1].observed_at), 3600000);
    });
    assert(rows.some(row => row.real_time_price < 0));
  }
  const dominionMax = Math.max(...source.series["PJM-DOMINION"].map(row => row.real_time_price));
  const texasMax = Math.max(...source.series["ERCOT-NORTH"].map(row => row.real_time_price));
  assert(dominionMax > 150);
  assert(texasMax > 350 && texasMax > dominionMax);
  assert(source.series["ERCOT-NORTH"].some(row => row.day_ahead_price < 0));
  assert.notDeepEqual(source.series["PJM-DOMINION"], source.series["ERCOT-NORTH"]);
});

test("the original final ninety days of PJM West remain byte-equivalent", () => {
  const legacy = source.series["PJM-WEST"].slice(-2161);
  assert.equal(createHash("sha256").update(JSON.stringify(legacy)).digest("hex"),
    "1985eab61904eab037968a5e1446c6fb0bd2f0f8dd72652edca75328494cd081");
  assert.deepEqual(legacy.at(-1), {
    observed_at: "2026-08-29T16:00:00.000Z", real_time_price: 43.36, day_ahead_price: 39.76,
  });
});

test("local power profiles observe Eastern and Central DST while UTC observations stay hourly", () => {
  for (const [timezone, spring, fall] of [
    ["America/New_York", ["2026-03-08T06:00Z", "2026-03-08T07:00Z"], ["2025-11-02T05:00Z", "2025-11-02T06:00Z", "2025-11-02T07:00Z"]],
    ["America/Chicago", ["2026-03-08T07:00Z", "2026-03-08T08:00Z"], ["2025-11-02T06:00Z", "2025-11-02T07:00Z", "2025-11-02T08:00Z"]],
  ]) {
    assert.deepEqual(spring.map(date => powerLocalTime(new Date(date), timezone).hour), [1, 3]);
    assert.deepEqual(fall.map(date => powerLocalTime(new Date(date), timezone).hour), [1, 1, 2]);
    assert(spring.every(date => powerLocalTime(new Date(date), timezone).weekday === "Sun"));
  }
  assert.equal(powerLocalTime(new Date("2026-08-29T16:00Z"), "America/New_York").hour, 12);
  assert.equal(powerLocalTime(new Date("2026-08-29T16:00Z"), "America/Chicago").hour, 11);
});

test("power ranges preserve native observations including a legacy all request", () => {
  const payload = runtimePayload();
  for (const [range, count] of [["1d", 25], ["7d", 169], ["90d", 2161], ["1y", 8761], ["all", 8761]]) {
    const model = createPowerBasisModel(payload, card, { range });
    assert.equal(model.range, range);
    assert.equal(model.rows.length, count);
    assert.equal(model.latest.timestamp, payload.asOf);
    assert.equal(model.unit, "USD per MWh");
    assert.equal(model.precision, 2);
    assert.equal(model.energy, null);
    assert.equal(model.mode, "price");
    assert.equal(model.kind, "scenario");
    assert.match(model.provenance.notice, /Demo/);
  }
  assert.equal(createPowerBasisModel(payload, card, { range: "invalid" }).range, "1d");
  assert.match(createPowerBasisModel(payload, card, { range: "90d" }).ariaLabel, /ninety days/);
  assert.match(createPowerBasisModel(payload, card, { range: "1y" }).ariaLabel, /one year/);
});

test("each location and basis mode retain the original wholesale-price contract", () => {
  const payload = runtimePayload();
  for (const location of payload.locations) {
    const model = createPowerBasisModel(payload, card, { locationId: location.id, range: "all", mode: "basis" });
    const expected = payload.series[location.id].at(-1);
    assert.equal(model.mode, "basis");
    assert.deepEqual([model.latest.timestamp, model.latest.realTime, model.latest.dayAhead, model.latest.basis], expected);
    assert.equal(model.location.timezone, location.timezone);
    assert.equal(model.location.unit, "USD per MWh");
    assert.equal(model.energy, null);
    assert(model.rows.some(row => row.realTime < 0));
    assert(Object.isFrozen(model) && Object.isFrozen(model.rows) && Object.isFrozen(model.latest));
  }
});

test("energy mode converts RT, DA and basis without rounding, fabricating margins or mutating source prices", () => {
  const payload = runtimePayload();
  const before = structuredClone(payload);
  for (const location of payload.locations) {
    const options = { locationId: location.id, range: "1y" };
    const prices = createPowerBasisModel(payload, card, options);
    const energy = createPowerBasisModel(payload, card, { ...options, mode: "energy" });
    assert.equal(energy.mode, "energy");
    assert.equal(energy.kind, "estimate");
    assert.equal(energy.unit, "USD per GPU-hour");
    assert.equal(energy.precision, 4);
    assert.equal(energy.location.unit, "USD per MWh", "source location keeps the raw unit");
    assert.equal(energy.energy.factor, 0.00153);
    assert.deepEqual(energy.energy.assumptions, {
      system: "NVIDIA DGX H100", systemPowerKw: 10.2, gpuCount: 8, pue: 1.2, powerBasis: "full-system maximum",
    });
    assert.equal(energy.energy.provenance.priceKind, "scenario");
    assert.equal(energy.energy.provenance.priceUnit, "USD per MWh");
    assert.match(energy.energy.notice, /not measured consumption, delivered electricity cost, or compute margin/);
    assert(Object.isFrozen(energy.energy) && Object.isFrozen(energy.energy.assumptions) && Object.isFrozen(energy.energy.provenance));
    energy.rows.forEach((row, index) => {
      const price = prices.rows[index];
      assert.equal(row.timestamp, price.timestamp);
      assert.equal(row.date.getTime(), price.date.getTime());
      for (const key of ["realTime", "dayAhead", "basis"]) {
        assert.equal(row[key], price[key] * 0.00153);
        assert.equal(row.rawPrice[key], price[key]);
      }
      assert(Math.abs(row.realTime - row.dayAhead - row.basis) < 1e-12);
      assert(Object.isFrozen(row.rawPrice));
    });
    assert(energy.rows.some(row => row.realTime < 0), "negative wholesale energy components remain negative");
    assert.match(energy.ariaLabel, /H100 power cost estimate over one year/);
    assert.match(energy.ariaLabel, /\$\d+\.\d{4} per GPU-hour/);
    assert.match(energy.ariaLabel, /10\.2 kilowatt.*eight GPUs.*PUE 1\.2/);
  }
  assert.deepEqual(payload, before);
});

test("power model rejects malformed numeric values, broken clocks and false metadata without rejecting zero or negative prices", () => {
  for (const mutate of [
    payload => { payload.series["PJM-WEST"][0][1] = null; },
    payload => { payload.series["PJM-WEST"][0][1] = "0"; },
    payload => { payload.series["PJM-WEST"][0][1] = true; },
    payload => { payload.series["PJM-WEST"][0][1] = NaN; },
    payload => { payload.series["PJM-WEST"][0][1] = Infinity; },
    payload => { payload.series["PJM-WEST"][1][0] += 1; },
    payload => { payload.series["PJM-WEST"][1][0] = payload.series["PJM-WEST"][0][0]; },
    payload => { payload.series["PJM-WEST"][0][3] += 1; },
    payload => { payload.asOf += 3600; },
    payload => { payload.dataset.observationCount -= 1; },
    payload => { payload.locations[0].timezone = "Not/A_Zone"; },
    payload => { payload.locations[0].intervalMinutes = 15; },
  ]) {
    const payload = runtimePayload();
    mutate(payload);
    assert.throws(() => createPowerBasisModel(payload, card, { mode: "energy" }), mutate.toString());
  }
  const payload = runtimePayload();
  for (const realTime of [0, -20]) {
    const row = payload.series["PJM-WEST"].at(-1);
    row[1] = realTime;
    row[3] = realTime - row[2];
    const model = createPowerBasisModel(payload, card, { mode: "energy" });
    assert.equal(model.latest.realTime, realTime * 0.00153);
  }
  assert.throws(() => createPowerBasisModel(payload, card, { locationId: "HB_NORTH" }), /Unknown power location/);
});
