import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EQUITIES_TICKERS,
  createUnavailableEquitiesSource,
  dateToEquitiesTimestamp,
  equitiesDateRange,
  normalizeEodhdHistory,
  validateEquitiesSource,
} from "../src/equities-data.js";
import { fetchEquitiesSource, installEquitiesSource, refreshEquitiesSource } from "../scripts/refresh-equities.mjs";

const now = new Date("2026-09-06T12:00:00.000Z");
const range = { from: "2026-09-01", to: "2026-09-04" };
const rows = [
  { date: "2026-09-04", close: 110, adjusted_close: 99.5 },
  { date: "2026-09-01", close: 100, adjusted_close: 90 },
];

test("unavailable source contains no claimed dates or fabricated prices", async () => {
  const source = createUnavailableEquitiesSource();
  assert.equal(validateEquitiesSource(source), source);
  assert.equal(source.asOf, null);
  assert.deepEqual(Object.keys(source.series), EQUITIES_TICKERS);
  assert.ok(Object.values(source.series).every((points) => points.length === 0));
  const checkedIn = JSON.parse(await readFile(new URL("../data/equities-source.json", import.meta.url), "utf8"));
  validateEquitiesSource(checkedIn);
});

test("daily dates are UTC seconds and normalization uses adjusted close exclusively", () => {
  assert.deepEqual(equitiesDateRange(now), { from: "2025-09-06", to: "2026-09-06" });
  assert.deepEqual(normalizeEodhdHistory(rows, { ticker: "MSFT", ...range }), [
    [Date.parse("2026-09-01T00:00:00Z") / 1000, 90],
    [Date.parse("2026-09-04T00:00:00Z") / 1000, 99.5],
  ]);
  assert.throws(() => dateToEquitiesTimestamp("2026-02-30"), /Invalid/);
  assert.throws(() => normalizeEodhdHistory([{ date: "2026-09-01", close: 100 }], { ticker: "MSFT", ...range }), /adjusted close/);
  assert.throws(() => normalizeEodhdHistory([...rows, rows[0]], { ticker: "MSFT", ...range }), /duplicate/);
  assert.throws(() => normalizeEodhdHistory([{ date: "2026-09-07", adjusted_close: 100 }], { ticker: "MSFT", ...range }), /out-of-range/);
  assert.throws(() => normalizeEodhdHistory({ error: "quota" }, { ticker: "MSFT", ...range }), /history array/);
});

test("missing/demo tokens do not make requests; provider failures do not expose credentials", async () => {
  let requests = 0;
  const fetchImpl = async () => { requests += 1; throw new Error("secret-in-upstream-url"); };
  await assert.rejects(fetchEquitiesSource({ fetchImpl, now }), /EODHD_API_TOKEN is missing/);
  await assert.rejects(fetchEquitiesSource({ token: "demo", fetchImpl, now }), /does not cover/);
  assert.equal(requests, 0);
  await assert.rejects(fetchEquitiesSource({ token: "secret-in-upstream-url", fetchImpl, now }), (error) => {
    assert.match(error.message, /could not reach EODHD/);
    assert.equal(error.message.includes("secret-in-upstream-url"), false);
    return true;
  });
  assert.equal(requests, 1);
  await assert.rejects(fetchEquitiesSource({ token: "test-token", now, fetchImpl: async () => new Response("secret", { status: 401 }) }), /HTTP 401/);
});

test("refresh requests all nine complete histories and writes only normalized public fields", async () => {
  const requests = [];
  // Deliberately synthetic unit-test rows, never installed as a production source.
  const testRows = [];
  for (let time = Date.parse("2025-09-08T00:00:00Z"); time <= Date.parse("2026-09-04T00:00:00Z"); time += 86400000) {
    const date = new Date(time);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) {
      testRows.push({ date: date.toISOString().slice(0, 10), close: 100, adjusted_close: 95 });
    }
  }
  const source = await fetchEquitiesSource({ token: "private-test-token", now, fetchImpl: async (url, options) => {
    requests.push(url.pathname);
    assert.equal(url.origin, "https://eodhd.com");
    assert.equal(url.searchParams.get("api_token"), "private-test-token");
    assert.equal(url.searchParams.get("from"), "2025-09-06");
    assert.equal(options.redirect, "error");
    return Response.json(testRows);
  } });
  assert.deepEqual(requests, EQUITIES_TICKERS.map((ticker) => `/api/eod/${ticker}.US`));
  assert.equal(source.source.status, "ready");
  assert.equal(source.asOf, dateToEquitiesTimestamp("2026-09-04"));
  assert.equal(JSON.stringify(source).includes("private-test-token"), false);
  assert.equal(source.source.publicDisplayRights, "not-confirmed");
  const folder = await mkdtemp(join(tmpdir(), "desk-equities-test-"));
  try {
    const output = join(folder, "equities-source.json");
    await installEquitiesSource(source, output);
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), source);
    const sameDay = await refreshEquitiesSource({ output, now, fetchImpl: async () => {
      assert.fail("Same-day cache must not spend API calls");
    } });
    assert.equal(sameDay.refreshed, false);
    assert.deepEqual(sameDay.source, source);
    let nextDayCalls = 0;
    const nextDay = await refreshEquitiesSource({ output, token: "test-token", now: new Date("2026-09-07T12:00:00Z"), fetchImpl: async () => {
      nextDayCalls += 1;
      return Response.json(testRows);
    } });
    assert.equal(nextDay.refreshed, true);
    assert.equal(nextDayCalls, 9);
    await installEquitiesSource(source, output);
    const malformed = structuredClone(source);
    malformed.series.MSFT = [];
    await assert.rejects(installEquitiesSource(malformed, output), /availability/);
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), source);
    const truncated = structuredClone(source);
    truncated.series.MSFT = truncated.series.MSFT.slice(-2);
    assert.throws(() => validateEquitiesSource(truncated), /cover the requested year/);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
