import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getCardDefinition } from "../src/card-registry.js";
import { createDemoEquitiesSource, EQUITIES_TICKERS } from "../src/equities-data.js";
import { assertEquitiesPublicDisplay, buildEquitiesRuntime, readEquitiesSource } from "../scripts/equities-runtime.mjs";

const card = getCardDefinition("equities");

test("the demo runtime preserves synthetic closes, USD/share units, weekday gaps and source provenance", () => {
  const source = createDemoEquitiesSource();
  const before = structuredClone(source);
  const runtime = buildEquitiesRuntime(source, card);
  assert.equal(runtime.version, 2);
  assert.equal(runtime.cardId, "equities");
  assert.deepEqual(runtime.columns, ["timestamp", "value"]);
  assert.deepEqual(Object.keys(runtime.series), EQUITIES_TICKERS);
  assert.deepEqual(runtime.series, source.series);
  assert.deepEqual(source, before);
  assert.equal(runtime.asOf, 1788480000);
  assert.equal(runtime.dataset.start, source.series.MSFT[0][0]);
  assert.equal(runtime.dataset.end, runtime.asOf);
  assert.equal(runtime.dataset.observationCount, 9 * 262);
  assert.equal(runtime.dataset.kind, "demo");
  assert.equal(runtime.dataset.label, "Demo");
  assert.equal(runtime.dataset.status, "ready");
  assert.equal(runtime.dataset.unit, "USD per share");
  assert.equal(runtime.dataset.timestampUnit, "seconds");
  assert.equal(runtime.dataset.priceBasis, "demo-close");
  assert.equal(runtime.dataset.priceBasisLabel, "Daily close (demo)");
  assert.equal(runtime.dataset.source.name, "Demo data");
  assert.equal(runtime.dataset.source.notice, source.source.notice);
  assert.equal(runtime.dataset.source.notice, "Daily share-price series. USD per share.");
  assert.equal(runtime.dataset.source.message, "Daily share-price series.");
  assert.deepEqual(runtime.dataset.generation, source.generation);
  assert.deepEqual(runtime.dataset.sampleWindow, source.sampleWindow);
  assert.equal(Object.hasOwn(runtime.dataset.source, "publicDisplayRights"), false);
  assert.match(runtime.revision, /^[a-f0-9]{12}$/);
  assert.equal(buildEquitiesRuntime(source, card).revision, runtime.revision);
  assert.notEqual(buildEquitiesRuntime(createDemoEquitiesSource({ seed: 1 }), card).revision, runtime.revision);
  runtime.series.NVDA[0][1] = 1;
  runtime.dataset.generation.seed = 1;
  assert.deepEqual(source, before, "The runtime does not share mutable arrays or metadata with its source");
});

test("the fixed sample supports 7D, 90D and 1Y with identical clocks for every equity", () => {
  const runtime = buildEquitiesRuntime(createDemoEquitiesSource(), card);
  for (const [days, count] of [[7, 6], [90, 65], [365, 262]]) {
    const clocks = Object.values(runtime.series).map(points => points.filter(point => point[0] >= runtime.asOf - days * 86400));
    assert(clocks.every(points => points.length === count));
    assert(clocks.every(points => points.at(-1)[0] === runtime.asOf));
    assert(clocks.every(points => JSON.stringify(points.map(point => point[0])) === JSON.stringify(clocks[0].map(point => point[0]))));
  }
});

test("GPU comparison layers stay outside the exact nine-ticker equities source", () => {
  const source = createDemoEquitiesSource();
  assert.deepEqual(card.layers.filter(layer => layer.sourceCardId).map(layer => layer.id), ["H100", "H200"]);
  const runtime = buildEquitiesRuntime(source, card);
  assert.deepEqual(Object.keys(runtime.series), EQUITIES_TICKERS);
  assert.equal(Object.hasOwn(runtime.series, "H100"), false);
  assert.equal(Object.hasOwn(runtime.series, "H200"), false);
  for (const symbol of ["H100", "H200"]) {
    const invalid = structuredClone(source);
    invalid.series[symbol] = [[source.asOf, 2]];
    assert.throws(() => buildEquitiesRuntime(invalid, card), /exactly the nine configured tickers/);
  }
  assert.throws(() => buildEquitiesRuntime(source, { ...card, layers: card.layers.filter(layer => layer.id !== "NVDA") }), /exactly the nine equity source symbols/);
  assert.throws(() => buildEquitiesRuntime(source, { ...card, layers: [...card.layers, { id: "EXTRA" }] }), /exactly the nine equity source symbols/);
});

test("only bundled demo runtimes pass the publication safety check", () => {
  const runtime = buildEquitiesRuntime(createDemoEquitiesSource(), card);
  assert.doesNotThrow(() => assertEquitiesPublicDisplay(runtime));
  const mutations = [
    value => { value.dataset.kind = "observed"; },
    value => { value.dataset.status = "unavailable"; },
    value => { value.dataset.source.kind = "observed"; },
    value => { value.dataset.source.id = "external-provider"; },
    value => { value.dataset.priceBasis = "split-dividend-adjusted-close"; },
    value => { value.dataset.source.notice = "Live market data"; },
    value => { value.asOf = null; },
    value => { value.series.NVDA = []; },
    value => { value.series.NVDA[0][1] = -1; },
    value => { value.dataset.observationCount = 1; },
    value => { value.dataset.start += 86400; },
    value => { value.columns = ["timestamp", "close"]; },
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(runtime);
    mutate(invalid);
    assert.throws(() => assertEquitiesPublicDisplay(invalid), mutate.toString());
  }
  const observed = structuredClone(runtime);
  observed.dataset.kind = "observed";
  observed.dataset.source.publicDisplayRights = "confirmed";
  assert.throws(() => assertEquitiesPublicDisplay(observed), /Only a bundled demo/);
  assert.throws(() => assertEquitiesPublicDisplay(null), /Only a bundled demo/);
});

test("equities reader uses only committed demo data and ignores even a corrupt private-cache decoy", async t => {
  const root = await mkdtemp(join(tmpdir(), "desk-demo-equities-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "data"));
  await mkdir(join(root, ".cache"));
  const committed = createDemoEquitiesSource();
  const sourceFile = join(root, "data", "equities-source.json");
  await writeFile(sourceFile, JSON.stringify(committed));
  assert.deepEqual(await readEquitiesSource(root), committed);
  // This is a test-owned temporary decoy, never the user's private cache.
  const cacheDecoy = join(root, ".cache", "equities-source.json");
  await writeFile(cacheDecoy, "{not valid JSON");
  assert.deepEqual(await readEquitiesSource(root, "data/equities-source.json"), committed);
  const alternate = createDemoEquitiesSource({ seed: 1 });
  await writeFile(cacheDecoy, JSON.stringify(alternate));
  assert.deepEqual(await readEquitiesSource(root), committed);
  await unlink(sourceFile);
  await assert.rejects(readEquitiesSource(root), { code: "ENOENT" }, "A cache cannot replace a missing committed source");
  await writeFile(sourceFile, "{invalid demo JSON");
  await assert.rejects(readEquitiesSource(root), SyntaxError);
});

test("the runtime cannot copy unknown provider metadata or require deployment settings", async () => {
  const source = createDemoEquitiesSource();
  source.source.privateMarker = "do-not-publish-test-marker";
  source.source.publicDisplayRights = "confirmed";
  const runtime = buildEquitiesRuntime(source, card, { publicDisplayRights: "confirmed" });
  assert.equal(JSON.stringify(runtime).includes("do-not-publish-test-marker"), false);
  assert.equal(Object.hasOwn(runtime.dataset.source, "publicDisplayRights"), false);
  assert.doesNotThrow(() => assertEquitiesPublicDisplay(runtime));
  const code = await readFile(new URL("../scripts/equities-runtime.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(code, /process\.env|fetch\(|["']\.cache["']/,
    "Runtime construction and source loading have no provider, environment or cache dependency");
});
