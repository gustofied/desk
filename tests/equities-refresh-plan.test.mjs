import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createEquitiesSource, createUnavailableEquitiesSource, EQUITIES_TICKERS } from "../src/equities-data.js";
import { assertEquitiesCacheDay, planEquitiesRefresh } from "../scripts/plan-equities-refresh.mjs";

const now = new Date("2026-09-06T06:17:00Z");
const defaults = { publicDisplayRights: "confirmed", eventName: "schedule", runAttempt: "1", now };
function observedSource(retrievedAt = "2026-09-05T06:17:00Z") {
  // Small synthetic policy-test fixture, never installed in the chart runtime.
  return createEquitiesSource(Object.fromEntries(EQUITIES_TICKERS.map(ticker => [ticker, [
    { date: "2026-09-01", adjusted_close: 100 },
    { date: "2026-09-04", adjusted_close: 101 },
  ]])), { from: "2026-09-01", to: "2026-09-04", retrievedAt });
}

test("only exact confirmed rights enable the daily refresh", () => {
  for (const publicDisplayRights of [undefined, "", "true", "Confirmed", " confirmed", "not-confirmed"]) {
    assert.equal(planEquitiesRefresh({ ...defaults, publicDisplayRights }).refresh, false);
  }
  assert.equal(planEquitiesRefresh(defaults).refresh, true);
  assert.equal(planEquitiesRefresh({ ...defaults, cachedSource: observedSource() }).refresh, true);
});

test("same UTC day cache prevents all provider calls, even when the market was closed", () => {
  const cachedSource = observedSource("2026-09-06T00:01:00Z");
  for (const eventName of ["schedule", "push", "workflow_dispatch"]) {
    const plan = planEquitiesRefresh({ ...defaults, eventName, cachedSource });
    assert.equal(plan.refresh, false);
    assert.match(plan.message, /2026-09-06.*no API calls/);
    assert.equal(plan.warning, undefined);
  }
  assert.equal(planEquitiesRefresh({ ...defaults, cachedSource, now: new Date("2026-09-07T00:00:00Z") }).refresh, true);
});

test("pushes, manual runs and reruns reuse older observations without claiming freshness", () => {
  const cachedSource = observedSource();
  for (const change of [{ eventName: "push" }, { eventName: "workflow_dispatch" }, { runAttempt: "2" }, { runAttempt: "3" }, { runAttempt: undefined }]) {
    const plan = planEquitiesRefresh({ ...defaults, ...change, cachedSource });
    assert.equal(plan.refresh, false);
    assert.equal(plan.warning, true);
    assert.match(plan.message, /retrieved 2026-09-05.*closes through 2026-09-04.*no API calls/);
    assert.throws(() => planEquitiesRefresh({ ...defaults, ...change }), /No equity cache.*existing site/);
  }
});

test("malformed, partial, unavailable and future caches fail closed", () => {
  const partial = observedSource();
  partial.series.MSFT = [];
  for (const cachedSource of [{}, partial, createUnavailableEquitiesSource(), observedSource("2026-09-07T06:17:00Z")]) {
    assert.throws(() => planEquitiesRefresh({ ...defaults, cachedSource }));
  }
});

test("immutable daily keys cannot be filled with yesterday's restored snapshot", () => {
  const source = observedSource();
  assert.doesNotThrow(() => assertEquitiesCacheDay(source, "2026-09-05"));
  assert.throws(() => assertEquitiesCacheDay(source, "2026-09-06"), /cache key's UTC date/);
  assert.throws(() => assertEquitiesCacheDay(source, "2026-9-5"), /cache key's UTC date/);
  assert.throws(() => assertEquitiesCacheDay(createUnavailableEquitiesSource(), "2026-09-06"));
});

test("Pages workflow confines the provider token and cache and validates after building", async () => {
  const workflow = await readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");
  const steps = workflow.split(/^      - name: /m).slice(1);
  const named = name => steps.find(step => step.startsWith(`${name}\n`));
  const fetch = named("Fetch daily equity observations");
  assert.equal(workflow.match(/secrets\.EODHD_API_TOKEN/g)?.length, 1);
  assert(fetch.includes("secrets.EODHD_API_TOKEN"));
  assert(fetch.includes("vars.EQUITIES_PUBLIC_DISPLAY_RIGHTS == 'confirmed'"));
  assert(fetch.includes("steps.equity-plan.outputs.refresh == 'true'"));
  assert.equal(workflow.match(/run: node scripts\/refresh-equities\.mjs/g)?.length, 1);
  assert.match(workflow, /cron: '17 6 \* \* \*'/);
  assert.match(workflow, /group: pages\n  cancel-in-progress: false\n  queue: max/);
  for (const name of ["Restore equity observations", "Cache refreshed equity observations"]) {
    const step = named(name);
    assert.match(step, /if: vars\.EQUITIES_PUBLIC_DISPLAY_RIGHTS == 'confirmed'/);
    assert.match(step, /path: \.cache\/equities-source\.json\n/);
    assert.match(step, /key: desk-equities-source-v1-\$\{\{ steps\.equity-date\.outputs\.day \}\}/);
  }
  assert(named("Cache refreshed equity observations").includes("steps.equity-plan.outputs.refresh == 'true'"));
  assert(workflow.indexOf("name: Validate refreshed equity cache identity") < workflow.indexOf("name: Cache refreshed equity observations"));
  assert(workflow.indexOf("name: Build Desk") < workflow.indexOf("name: Validate market snapshots"));
  assert(workflow.indexOf("name: Build Desk") < workflow.indexOf("name: Run unit tests"));
  assert(workflow.indexOf("name: Run unit tests") < workflow.indexOf("name: Assemble deployment"));
  assert.doesNotMatch(workflow, /git (?:add|commit|push)|continue-on-error/);
});
