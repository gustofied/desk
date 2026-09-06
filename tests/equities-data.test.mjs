import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import {
  EQUITIES_TICKERS, EQUITIES_PRICE_BASIS, EQUITIES_DEMO_SEED,
  EQUITIES_DEMO_WINDOW, EQUITIES_DEMO_NOTICE, createDemoEquitiesSource,
  dateToEquitiesTimestamp, equitiesDemoDates, validateEquitiesSource,
} from "../src/equities-data.js";

const hashSeries = source => createHash("sha256").update(JSON.stringify(source.series)).digest("hex");
const expectedHash = "955081f715aa62b12bf2a6a878bc2fe56ba08dc35735f806117ef0dd16022445";

test("the committed equity source is exactly the deterministic nine-stock demo", async () => {
  const source = createDemoEquitiesSource();
  const committed = JSON.parse(await readFile(new URL("../data/equities-source.json", import.meta.url), "utf8"));
  assert.deepEqual(committed, source);
  assert.equal(validateEquitiesSource(committed), committed);
  assert.deepEqual(Object.keys(source.series), EQUITIES_TICKERS);
  assert.equal(hashSeries(source), expectedHash);
  assert.equal(source.generation.seed, EQUITIES_DEMO_SEED);
  assert.deepEqual(source.sampleWindow, { from: "2025-09-04", to: "2026-09-04" });
  assert.equal(source.asOf, 1788480000);
  assert.equal(source.priceBasis, EQUITIES_PRICE_BASIS);
  assert.equal(source.priceBasisLabel, "Daily close (demo)");
  assert.equal(source.source.id, "desk-demo");
  assert.equal(source.source.name, "Demo data");
  assert.equal(source.source.url, "https://github.com/gustofied/desk/blob/main/README.md");
  assert.equal(source.source.kind, "demo");
  assert.equal(source.source.status, "ready");
  assert.equal(source.source.notice, EQUITIES_DEMO_NOTICE);
  assert.match(source.source.notice, /Synthetic.*not actual market prices/);
  assert.match(source.source.notice, /do not represent an exchange calendar/);
  assert.equal(Object.hasOwn(source, "retrievedAt"), false, "A generated sample never claims a provider retrieval time");
});

test("the fixed sample covers one year of aligned UTC weekdays without claiming exchange sessions", () => {
  const source = createDemoEquitiesSource();
  const dates = equitiesDemoDates();
  assert.equal(dates.length, 262);
  assert.equal(dates[0], dateToEquitiesTimestamp(EQUITIES_DEMO_WINDOW.from));
  assert.equal(dates.at(-1) - dates[0], 365 * 86400);
  assert(dates.every(time => time % 86400 === 0 && ![0, 6].includes(new Date(time * 1000).getUTCDay())));
  assert(dates.some((time, index) => index && time - dates[index - 1] === 3 * 86400));
  assert(dates.includes(dateToEquitiesTimestamp("2025-12-25")), "The disclosed weekday grid intentionally does not model exchange holidays");
  for (const points of Object.values(source.series)) {
    assert.deepEqual(points.map(point => point[0]), dates);
    assert(points.every(point => Number.isFinite(point[1]) && point[1] > 0));
  }
  assert.throws(() => dateToEquitiesTimestamp("2026-02-30"), /Invalid/);
  assert.throws(() => dateToEquitiesTimestamp("2026-9-4"), /YYYY-MM-DD/);
});

test("synthetic paths have distinct seeded movements and stable sample means", () => {
  const source = createDemoEquitiesSource();
  assert.deepEqual(Object.fromEntries(EQUITIES_TICKERS.map(ticker => [ticker, source.series[ticker].at(-1)[1]])), {
    MSFT: 488.55, AMZN: 235.56, GOOGL: 167.5, ORCL: 171.25, CRWV: 108.14,
    NBIS: 59.96, NVDA: 167.92, AMD: 158.14, TSM: 192.78,
  });
  assert.deepEqual(Object.fromEntries(EQUITIES_TICKERS.map(ticker => [ticker,
    Number((source.series[ticker].reduce((sum, point) => sum + point[1], 0) / 262).toFixed(4))])), {
    MSFT: 420.0363, AMZN: 198.1658, GOOGL: 151.4857, ORCL: 146.7089, CRWV: 85.7294,
    NBIS: 58.6014, NVDA: 137.4489, AMD: 131.3727, TSM: 169.1064,
  });
  const normalized = EQUITIES_TICKERS.map(ticker => JSON.stringify(source.series[ticker].map(point => point[1] / source.series[ticker][0][1])));
  assert.equal(new Set(normalized).size, 9, "The paths are not copies with different price multipliers");
  for (const points of Object.values(source.series)) {
    assert(points.some((point, index) => index && point[1] > points[index - 1][1]));
    assert(points.some((point, index) => index && point[1] < points[index - 1][1]));
  }
});

test("a seed is deterministic, explicit, isolated per generated source and independent of timezone", () => {
  assert.deepEqual(createDemoEquitiesSource(), createDemoEquitiesSource());
  const alternate = createDemoEquitiesSource({ seed: EQUITIES_DEMO_SEED + 1 });
  assert.notEqual(hashSeries(alternate), expectedHash);
  for (const ticker of EQUITIES_TICKERS) assert.notDeepEqual(alternate.series[ticker], createDemoEquitiesSource().series[ticker]);
  const first = createDemoEquitiesSource();
  first.series.MSFT[0][1] = 1;
  first.source.name = "changed";
  assert.equal(hashSeries(createDemoEquitiesSource()), expectedHash);
  for (const seed of [-1, 1.5, 0x100000000, "123", NaN]) assert.throws(() => createDemoEquitiesSource({ seed }), /seed/);
  assert.doesNotThrow(() => createDemoEquitiesSource({ seed: 0 }));
  const moduleUrl = new URL("../src/equities-data.js", import.meta.url).href;
  const program = "import {createHash} from 'node:crypto'; import {createDemoEquitiesSource} from " + JSON.stringify(moduleUrl) +
    "; console.log(createHash('sha256').update(JSON.stringify(createDemoEquitiesSource().series)).digest('hex'));";
  for (const timezone of ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"]) {
    const result = execFileSync(process.execPath, ["--input-type=module", "-e", program], {
      env: { TZ: timezone }, encoding: "utf8",
    });
    assert.equal(result.trim(), expectedHash);
  }
});

test("demo source validation rejects provider labels, invalid prices, broken coverage and false clocks", () => {
  const mutations = [
    source => { source.version = 2; },
    source => { source.source.id = "external-provider"; },
    source => { source.source.name = "Observed prices"; },
    source => { source.source.kind = "observed"; },
    source => { source.source.status = "unavailable"; },
    source => { source.source.notice = "Actual market quotes"; },
    source => { source.source.url = "file:///private/prices"; },
    source => { source.priceBasis = "split-dividend-adjusted-close"; },
    source => { source.priceBasisLabel = "Daily close"; },
    source => { source.currency = "EUR"; },
    source => { source.timestampUnit = "milliseconds"; },
    source => { source.asOf += 86400; },
    source => { source.sampleWindow.from = "2025-09-05"; },
    source => { source.generation.seed = -1; },
    source => { source.generation.calendar = "NYSE trading sessions"; },
    source => { source.series.MSFT[0][1] = NaN; },
    source => { source.series.MSFT[0][1] = 0; },
    source => { source.series.MSFT[0][1] = "100"; },
    source => { source.series.MSFT[1][0] = source.series.MSFT[0][0]; },
    source => { source.series.MSFT[0][0] *= 1000; },
    source => { source.series.MSFT.pop(); },
    source => { delete source.series.NVDA; },
    source => { source.series.H100 = [[source.asOf, 2]]; },
  ];
  for (const mutate of mutations) {
    const source = createDemoEquitiesSource();
    mutate(source);
    assert.throws(() => validateEquitiesSource(source), mutate.toString());
  }
});

test("the checked-in generator validates without fetching, changing files or reading runtime configuration", () => {
  const generator = new URL("../scripts/generate-equities-demo.mjs", import.meta.url);
  const before = execFileSync(process.execPath, [generator.pathname, "--check"], { encoding: "utf8", env: {} });
  assert.match(before, /Validated the bundled nine-stock synthetic demo/);
});
