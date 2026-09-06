import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getCardDefinition } from "../src/card-registry.js";
import { createUnavailableEquitiesSource } from "../src/equities-data.js";
import {
  assertEquitiesPublicDisplay, buildEquitiesRuntime, readEquitiesSource,
} from "../scripts/equities-runtime.mjs";

const card = getCardDefinition("equities");
const first = Date.parse("2026-08-28T00:00:00.000Z") / 1000;
const last = Date.parse("2026-08-31T00:00:00.000Z") / 1000;
function observedSource() {
  const source = createUnavailableEquitiesSource();
  source.source.status = "ready";
  source.source.code = null;
  source.source.message = "Observed historical daily closes.";
  source.asOf = last;
  source.series = Object.fromEntries(card.layers.map((layer, index) => [
    layer.id, [[first, 100.1234567 + index], [last, 101.1234567 + index]],
  ]));
  return source;
}

test("equities runtime preserves observed prices and trading-day gaps without inventing bands", () => {
  const source = observedSource();
  const before = structuredClone(source);
  const runtime = buildEquitiesRuntime(source, card);
  assert.equal(runtime.version, 2);
  assert.equal(runtime.cardId, "equities");
  assert.deepEqual(runtime.columns, ["timestamp", "value"]);
  assert.deepEqual(Object.keys(runtime.series), card.layers.map(layer => layer.id));
  assert.deepEqual(runtime.series, source.series);
  assert.deepEqual(source, before);
  assert.equal(runtime.asOf, last);
  assert.equal(runtime.dataset.start, first);
  assert.equal(runtime.dataset.end, last);
  assert.equal(runtime.dataset.observationCount, 18);
  assert.equal(runtime.dataset.kind, "observed");
  assert.equal(runtime.dataset.status, "ready");
  assert.equal(runtime.dataset.cadence, "daily");
  assert.equal(runtime.dataset.unit, "USD per share");
  assert.equal(runtime.dataset.priceBasis, "split-dividend-adjusted-close");
  assert.equal(runtime.dataset.source.name, "EODHD");
  assert.equal(runtime.dataset.source.notice, source.source.notice);
  assert.equal(runtime.dataset.source.publicDisplayRights, "not-confirmed");
  assert.match(runtime.revision, /^[a-f0-9]{12}$/);
  assert.equal(buildEquitiesRuntime(source, card).revision, runtime.revision);
  source.series.NVDA[1][1] += 0.01;
  assert.notEqual(buildEquitiesRuntime(source, card).revision, runtime.revision);
});

test("explicit millisecond source timestamps become Unix seconds without changing prices", () => {
  const source = observedSource();
  const expected = buildEquitiesRuntime(source, card);
  source.timestampUnit = "milliseconds";
  source.asOf *= 1000;
  for (const points of Object.values(source.series)) for (const point of points) point[0] *= 1000;
  assert.deepEqual(buildEquitiesRuntime(source, card), expected);
});

test("an unavailable equities feed stays empty with no fabricated as-of date", () => {
  const source = createUnavailableEquitiesSource();
  const runtime = buildEquitiesRuntime(source, card);
  assert.equal(runtime.asOf, null);
  assert.equal(runtime.dataset.start, null);
  assert.equal(runtime.dataset.end, null);
  assert.equal(runtime.dataset.observationCount, 0);
  assert.equal(runtime.dataset.kind, "unavailable");
  assert.equal(runtime.dataset.status, "unavailable");
  assert.equal(runtime.dataset.source.code, "missing-api-token");
  assert.equal(runtime.dataset.source.message, source.source.message);
  assert(Object.values(runtime.series).every(points => points.length === 0));
});

test("invalid price data and misleading availability fail the build instead of being dropped", () => {
  const mutations = [
    source => { source.version = 2; },
    source => { source.series.NVDA[0][1] = NaN; },
    source => { source.series.NVDA[0][1] = 0; },
    source => { source.series.NVDA[0][1] = "100"; },
    source => { source.series.NVDA[1][0] = first; },
    source => { source.series.NVDA[1][0] = first - 86400; },
    source => { source.series.NVDA[0][0] += 0.5; },
    source => { source.asOf = last + 86400; },
    source => { source.series.NVDA = []; },
    source => { delete source.series.NVDA; },
    source => { source.series.FAKE = [[last, 1]]; },
    source => { source.currency = "EUR"; },
    source => { source.priceBasis = "unknown"; },
    source => { source.priceBasis = "close"; },
    source => { source.priceBasis = "split-adjusted-close"; },
    source => { source.timestampUnit = "minutes"; },
    source => { source.source.status = "unavailable"; },
    source => { source.source.url = "file:///private/data"; },
  ];
  for (const mutate of mutations) {
    const source = observedSource();
    mutate(source);
    assert.throws(() => buildEquitiesRuntime(source, card), mutate.toString());
  }
  const unavailable = createUnavailableEquitiesSource();
  unavailable.asOf = last;
  assert.throws(() => buildEquitiesRuntime(unavailable, card), /null asOf/);
});

test("public builds allow the unavailable placeholder and require confirmed display rights for observed prices", () => {
  const unavailable = buildEquitiesRuntime(createUnavailableEquitiesSource(), card);
  assert.doesNotThrow(() => assertEquitiesPublicDisplay(unavailable));
  const ready = buildEquitiesRuntime(observedSource(), card);
  assert.throws(() => assertEquitiesPublicDisplay(ready), /rights.*confirmed/);
  ready.dataset.source.publicDisplayRights = "confirmed";
  assert.doesNotThrow(() => assertEquitiesPublicDisplay(ready));
  const disguised = structuredClone(unavailable);
  disguised.series.NVDA = [[last, 123]];
  assert.throws(() => assertEquitiesPublicDisplay(disguised), /rights.*confirmed/);
  assert.throws(() => assertEquitiesPublicDisplay(null), /runtime/);
});

test("local equities cache wins, and corrupt cache never silently falls back to the placeholder", async t => {
  const root = await mkdtemp(join(tmpdir(), "desk-equities-runtime-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "data"));
  await mkdir(join(root, ".cache"));
  const placeholder = createUnavailableEquitiesSource();
  await writeFile(join(root, "data", "equities-source.json"), JSON.stringify(placeholder));
  assert.deepEqual(await readEquitiesSource(root, "data/equities-source.json"), placeholder);
  const cacheFile = join(root, ".cache", "equities-source.json");
  const ready = observedSource();
  await writeFile(cacheFile, JSON.stringify(ready));
  assert.deepEqual(await readEquitiesSource(root, "data/equities-source.json"), ready);
  await writeFile(cacheFile, "{invalid JSON");
  await assert.rejects(readEquitiesSource(root, "data/equities-source.json"), SyntaxError);
  ready.asOf = last + 86400;
  await writeFile(cacheFile, JSON.stringify(ready));
  assert.throws(() => buildEquitiesRuntime(ready, card), /asOf/);
  const loaded = await readEquitiesSource(root, "data/equities-source.json");
  assert.throws(() => buildEquitiesRuntime(loaded, card), /asOf/);
});

test("only an explicit confirmed deployment override permits public equity display", () => {
  const source = observedSource();
  const before = structuredClone(source);
  const privateRuntime = buildEquitiesRuntime(source, card, { publicDisplayRights: "" });
  for (const publicDisplayRights of ["", "true", "yes", "Confirmed", " confirmed", "not-confirmed"]) {
    const runtime = buildEquitiesRuntime(source, card, { publicDisplayRights });
    assert.throws(() => assertEquitiesPublicDisplay(runtime), /rights.*confirmed/);
    assert.equal(runtime.revision, privateRuntime.revision);
  }
  const publicRuntime = buildEquitiesRuntime(source, card, { publicDisplayRights: "confirmed" });
  assert.doesNotThrow(() => assertEquitiesPublicDisplay(publicRuntime));
  assert.equal(publicRuntime.dataset.source.publicDisplayRights, "confirmed");
  assert.notEqual(publicRuntime.revision, privateRuntime.revision);
  assert.deepEqual(publicRuntime.series, privateRuntime.series);
  assert.deepEqual(source, before, "deployment confirmation must not mutate the cached provider source");
});

test("the build-time rights environment override is read without changing source provenance", () => {
  const runtimeModule = new URL("../scripts/equities-runtime.mjs", import.meta.url).href;
  const registryModule = new URL("../src/card-registry.js", import.meta.url).href;
  const program = `
    import { buildEquitiesRuntime, assertEquitiesPublicDisplay } from ${JSON.stringify(runtimeModule)};
    import { getCardDefinition } from ${JSON.stringify(registryModule)};
    const source = ${JSON.stringify(observedSource())};
    const runtime = buildEquitiesRuntime(source, getCardDefinition("equities"));
    assertEquitiesPublicDisplay(runtime);
    console.log(runtime.dataset.source.publicDisplayRights, source.source.publicDisplayRights);
  `;
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", program], {
    env: { EQUITIES_PUBLIC_DISPLAY_RIGHTS: "confirmed" },
    encoding: "utf8",
  });
  assert.equal(output.trim(), "confirmed not-confirmed");
});
