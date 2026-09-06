import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getCardDefinition } from "../src/card-registry.js";
import { createSandboxCostModel } from "../src/sandbox-cost-model.js";
import { buildSandboxRuntime } from "../scripts/sandbox-runtime.mjs";

const source = JSON.parse(await readFile(new URL("../api/dashboard-snapshots/sandbox-cost.json", import.meta.url), "utf8"));
const card = getCardDefinition("sandbox-cost");
const runtime = buildSandboxRuntime(source, card);
const expectedMedians = {
  novita: 0.0133100175, "daytona-vm": 0.01481085, blaxel: 0.015063252,
  e2b: 0.027827286, "modal-vm": 0.043525206, "modal-gvisor": 0.0904468905,
};

test("Sandbox preserves the six original latest job distributions and screenshot medians in USD", () => {
  const model = createSandboxCostModel(runtime, card);
  assert.equal(runtime.version, 2);
  assert.equal(runtime.timestampUnit, "milliseconds");
  assert.equal(runtime.asOf, Date.parse("2026-08-06T03:32:15.839Z"));
  assert.equal(model.range, "now");
  assert.deepEqual(model.providers.map(provider => provider.id), Object.keys(expectedMedians));
  assert.deepEqual(model.providers.map(provider => (provider.median * 100).toFixed(2)),
    ["1.33", "1.48", "1.51", "2.78", "4.35", "9.04"]);
  for (const provider of model.providers) {
    assert.equal(provider.median, expectedMedians[provider.id]);
    assert.equal(provider.sampleCount, 12);
    const original = source.providers.find(item => item.id === provider.id);
    for (const field of ["minimum", "p25", "median", "p75", "maximum"]) {
      assert.equal(provider[field], original[field]);
    }
  }
  assert.equal(model.primary.id, "novita");
  assert.equal(model.latest, model.primary);
  assert.deepEqual(model.rows, [{ time: runtime.asOf }]);
  assert.equal(model.start, runtime.asOf);
  assert.equal(model.end, runtime.asOf);
});

test("Sandbox retains exact date-bucket history, with no appended job median or interpolated dates", () => {
  const model = createSandboxCostModel(runtime, card, { range: "all" });
  assert.equal(model.providers.reduce((count, provider) => count + provider.history.length, 0), 69);
  assert.equal(model.rows.length, 12);
  assert.equal(model.start, Date.parse("2026-07-19T00:00:00Z"));
  assert.equal(model.end, Date.parse("2026-08-06T00:00:00Z"));
  assert.equal(model.providers.find(provider => provider.id === "modal-vm").history.length, 9);
  assert.equal(model.primary.history.at(-1).value, 0.01404567);
  assert.notEqual(model.primary.history.at(-1).value, model.primary.median);
  for (const provider of model.providers) {
    const original = source.providers.find(item => item.id === provider.id);
    assert.deepEqual(provider.history.map(({ time, value }) => ({ time, value })),
      original.history.map(({ time, value }) => ({ time, value })));
    for (const [index, point] of provider.history.entries()) {
      assert.equal(point.time % 86_400_000, 0);
      assert.equal(point.gapBefore, index > 0 && point.time - provider.history[index - 1].time > 86_400_000);
    }
  }
  assert(model.providers.some(provider => provider.history.some(point => point.gapBefore)));
  assert(!model.rows.some(row => row.time === Date.parse("2026-07-24T00:00:00Z")));
});

test("Sandbox seven-day range uses the last seven calendar dates, retaining observed gaps and mixed methodologies", () => {
  const model = createSandboxCostModel(runtime, card, { range: "7d" });
  const cutoff = Date.parse("2026-07-31T00:00:00Z");
  const all = createSandboxCostModel(runtime, card, { range: "all" });
  assert.deepEqual(model.rows, all.rows.filter(row => row.time >= cutoff));
  for (const provider of model.providers) {
    assert(provider.history.every(point => point.time >= cutoff));
  }
  const mixed = all.providers.flatMap(provider => provider.history).filter(point => point.methodologyIds.length > 1);
  assert.equal(mixed.length, 18);
  assert(mixed.every(point => point.methodologyId === null));
  assert(mixed.every(point => point.runIds.length === 2 && point.sourceUrls.length === 2));
  assert(all.providers.flatMap(provider => provider.history).filter(point => point.methodologyIds.length === 1)
    .every(point => point.methodologyId === point.methodologyIds[0]));
});

test("Sandbox primary and comparison selection preserve ascending provider order and union actual dates", () => {
  const model = createSandboxCostModel(runtime, card, {
    range: "all", primaryId: "modal-vm", layerIds: ["e2b", "novita", "not-a-provider"],
  });
  assert.deepEqual(model.providers.map(provider => provider.id), ["novita", "e2b", "modal-vm"]);
  assert.equal(model.primary.id, "modal-vm");
  assert.equal(model.latest, model.primary);
  assert.deepEqual(model.rows.map(row => row.time), [...new Set(model.providers.flatMap(provider =>
    provider.history.map(point => point.time)))].sort((a, b) => a - b));
  const single = createSandboxCostModel(runtime, card, { layerIds: [], primaryId: "blaxel" });
  assert.deepEqual(single.providers.map(provider => provider.id), ["blaxel"]);
  assert.equal(createSandboxCostModel(runtime, card, { range: "invalid", primaryId: "missing" }).range, "now");
});

test("Sandbox preserves workload, historical pricing, measured runtime and immutable source provenance", () => {
  const model = createSandboxCostModel(runtime, card, { range: "all" });
  assert.equal(model.sourceLabel, "HPC Sandbox Benchmarks");
  assert.equal(model.sourceUrl, "https://github.com/starslingdev/hpc-sandbox-benchmarks");
  assert.equal(model.dataset.kind, "observed");
  assert.equal(model.dataset.costBasis, "public_rate_card_unmetered");
  assert.equal(model.dataset.costScope, "processor_and_memory_only");
  assert.equal(model.dataset.latestRuntimeBasis, "sum_of_ten_task_samples_with_same_replicate_index");
  assert.equal(model.dataset.historyRuntimeBasis, "sum_of_published_task_means");
  assert.equal(model.dataset.historicalComparability, "methodology_stratified");
  assert.equal(model.dataset.sourceSnapshot.sha256, "9ae75fe695f1fd548719c2619dd11335029999b7f8af8738d11231e6f2ec747f");
  assert.deepEqual(model.dataset.target, { vcpus: 4, memoryGiB: 8, diskGB: 40 });
  assert.match(model.dataset.notice, /not metered bills/);
  assert.match(model.dataset.notice, /not confidence intervals/);
  const blaxel = model.providers.find(provider => provider.id === "blaxel");
  assert.equal(blaxel.runtime.median, 163.731);
  assert.equal(blaxel.runtime.unit, "seconds");
  assert.equal(blaxel.runtime.cpuModel, "AMD EPYC");
  assert.equal(blaxel.pricing.hourlyUsd, 0.3312);
  assert.equal(blaxel.pricing.date, "2026-07-24");
  assert.match(blaxel.sourceUrl, /\/blob\/c85e6a096b463c4a7be558f5c701605a3dbc2441\/data\/dataset\/runs\/31066359914.json$/);
  assert(model.providers.every(provider => provider.history.every(point => point.sourceUrls.every(url =>
    url.startsWith("https://github.com/starslingdev/hpc-sandbox-benchmarks/blob/")))));
});

test("Sandbox rejects broken distributions, fake dates, unsafe sources and ambiguous history provenance", () => {
  for (const [mutate, expected] of [
    [payload => { payload.providers[0].p25 = payload.providers[0].maximum + 1; }, /distribution/],
    [payload => { payload.providers[0].median = NaN; }, /finite/],
    [payload => { payload.providers[0].runtime.minimum = -1; }, /nonnegative/],
    [payload => { payload.asOf /= 1000; }, /millisecond/],
    [payload => { payload.providers[0].history[0].time += 1; }, /UTC date/],
    [payload => { payload.providers[0].history[1].time = payload.providers[0].history[0].time; }, /increasing/],
    [payload => { payload.providers[0].history[0].methodologyId = null; }, /mixed methodologies/],
    [payload => { payload.providers[0].history[0].value = null; }, /finite/],
    [payload => { payload.sourceUrl = "https://secret:password@example.com"; }, /public HTTPS/],
    [payload => { payload.providers[0].history[0].sourceUrls[0] = "javascript:alert(1)"; }, /public HTTPS/],
  ]) {
    const payload = structuredClone(runtime);
    mutate(payload);
    assert.throws(() => createSandboxCostModel(payload, card), expected);
  }
});

test("Sandbox build is deterministic, validates exact provider coverage and does not mutate inputs", () => {
  const before = JSON.stringify(source);
  assert.deepEqual(buildSandboxRuntime(source, card), runtime);
  assert.match(runtime.revision, /^[a-f0-9]{12}$/);
  const model = createSandboxCostModel(runtime, card, { range: "7d" });
  model.providers[0].history[0].runIds.push("mutation");
  model.dataset.excluded.push("mutation");
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(buildSandboxRuntime(source, card), runtime);
  const missing = structuredClone(source);
  missing.providers.pop();
  assert.throws(() => buildSandboxRuntime(missing, card), /exactly the six/);
  const unknownRun = structuredClone(source);
  unknownRun.providers[0].history[0].runIds = ["missing"];
  assert.throws(() => buildSandboxRuntime(unknownRun, card), /run\/date/);
  const wrongCoverage = structuredClone(source);
  wrongCoverage.dataset.coverage.historyObservationCount++;
  assert.throws(() => buildSandboxRuntime(wrongCoverage, card), /coverage/);
});
