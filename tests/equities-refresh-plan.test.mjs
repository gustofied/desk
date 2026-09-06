import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { CARD_REGISTRY, getCardDefinition } from "../src/card-registry.js";
import { buildEquitiesRuntime } from "../scripts/equities-runtime.mjs";
import { buildSite } from "../scripts/build-site.mjs";

const projectFile = path => new URL(`../${path}`, import.meta.url);
const publicTables = [
  "data/v1/accelerator-prices.json",
  "data/v1/compute-prices.json",
  "data/v1/h100-market-depth.json",
  "data/v1/power-prices.json",
];
const dataFiles = [...new Set([
  "data/manifest.json",
  ...CARD_REGISTRY.flatMap(card => [card.dataFile, card.dataTable?.file]).filter(Boolean),
])];

async function fixture(t) {
  const projectRoot = await mkdtemp(join(tmpdir(), "desk-demo-build-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  const put = async (path, value) => {
    await mkdir(dirname(join(projectRoot, path)), { recursive: true });
    await writeFile(join(projectRoot, path), typeof value === "string" ? value : JSON.stringify(value));
  };
  const source = JSON.parse(await readFile(projectFile("data/equities-source.json"), "utf8"));
  const equities = buildEquitiesRuntime(source, getCardDefinition("equities"));
  for (const path of [".nojekyll", "CNAME", "index.html", "desk.js", "robots.txt", "sitemap.xml"]) {
    await put(path, `fixture ${path}`);
  }
  for (const path of ["styles", "assets", "cards", "cli"]) await put(`${path}/fixture.txt`, path);
  for (const path of dataFiles) await put(path, path === "data/equities.json" ? equities : { fixture: path });
  // These are harmless test sentinels, never real local credentials or prices.
  for (const path of ["data/equities-source.json", "data/v1/equity-prices.json", "data/local-note.json", ".cache/ignored.txt"]) {
    await put(path, "excluded test sentinel");
  }
  return { projectRoot, put, equities };
}

test("Pages builds bundled data on push or demand without an equity provider, schedule or cache", async () => {
  const workflow = await readFile(projectFile(".github/workflows/pages.yml"), "utf8");
  assert.match(workflow, /push:\n\s+branches:\n\s+- main/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /schedule:|cron:|EODHD|EQUITIES_PUBLIC_DISPLAY_RIGHTS|secrets\.|actions\/cache|\.cache\/|equity-(?:cache|date|plan)/i);
  assert.doesNotMatch(workflow, /refresh-equities|plan-equities-refresh|curl\b|wget\b|continue-on-error/);
  const build = workflow.indexOf("name: Build Desk");
  const check = workflow.indexOf("name: Validate market snapshots");
  const unit = workflow.indexOf("name: Run unit tests");
  const assemble = workflow.indexOf("name: Assemble deployment");
  assert(build >= 0 && build < check && check < unit && unit < assemble);
  assert.match(workflow, /name: Assemble deployment\n\s+run: npm run build:site/);
});

test("npm offers deterministic equity generation and retains the separate market refresh workflow", async () => {
  const pkg = JSON.parse(await readFile(projectFile("package.json"), "utf8"));
  assert.equal(pkg.scripts["refresh:equities"], undefined);
  assert.equal(pkg.scripts["generate:equities"], "node scripts/generate-equities-demo.mjs");
  assert.match(pkg.scripts["generate:data"], /npm run generate:equities/);
  assert.equal(pkg.scripts["refresh:data"], "node scripts/refresh-market-data.mjs");
  const refresh = await readFile(projectFile(".github/workflows/refresh-data.yml"), "utf8");
  assert.match(refresh, /workflow_dispatch:/);
  assert.match(refresh, /run: npm run refresh:data/);
  assert.match(refresh, /DESK_SNAPSHOT_TOKEN/);
  assert.match(refresh, /gh workflow run pages.yml --ref main/);
  assert.doesNotMatch(refresh, /EODHD|refresh-equities|EQUITIES_PUBLIC_DISPLAY_RIGHTS/);
});

test("obsolete provider scripts are removed and the equity build path has no requests or environment gate", async () => {
  for (const path of ["scripts/refresh-equities.mjs", "scripts/plan-equities-refresh.mjs"]) {
    await assert.rejects(access(projectFile(path)), { code: "ENOENT" });
  }
  for (const path of ["scripts/build-site.mjs", "scripts/equities-runtime.mjs", "scripts/generate-equities-demo.mjs"]) {
    const source = await readFile(projectFile(path), "utf8");
    assert.doesNotMatch(source, /\bfetch\s*\(|EODHD_API_TOKEN|EQUITIES_PUBLIC_DISPLAY_RIGHTS|\.cache[/\\]|https:\/\/eodhd/i);
  }
});

test("demo-only assembly preserves registered public exports but excludes raw and retired data", async t => {
  const { projectRoot, put, equities } = await fixture(t);
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("No provider request is allowed"); });
  await put("_site/data/v1/equity-prices.json", "stale artifact test sentinel");
  const output = await buildSite({ projectRoot });
  assert.equal(output, join(projectRoot, "_site"));
  assert.equal(fetch.mock.callCount(), 0);
  assert.deepEqual(JSON.parse(await readFile(join(output, "data/equities.json"), "utf8")), equities);
  assert.equal(equities.dataset.kind, "demo");
  assert.deepEqual(CARD_REGISTRY.map(card => card.dataTable?.file).filter(Boolean).sort(), publicTables);
  assert.deepEqual((await readdir(join(output, "data/v1"))).map(file => `data/v1/${file}`).sort(), publicTables);
  for (const path of dataFiles) await access(join(output, path));
  for (const path of ["data/equities-source.json", "data/v1/equity-prices.json", "data/local-note.json", ".cache/ignored.txt"]) {
    await assert.rejects(access(join(output, path)), { code: "ENOENT" });
    assert.equal(await readFile(join(projectRoot, path), "utf8"), "excluded test sentinel", "Build must not modify excluded local inputs");
  }
  for (const path of ["styles", "assets", "cards", "cli"]) await access(join(output, path, "fixture.txt"));
});

test("stale observed equity data fails before an existing site is replaced", async t => {
  const { projectRoot, put, equities } = await fixture(t);
  const stale = structuredClone(equities);
  stale.dataset.kind = "observed";
  stale.dataset.source = { id: "retired-provider", status: "ready", publicDisplayRights: "confirmed" };
  await put("data/equities.json", stale);
  await put("_site/keep.txt", "previous deployment");
  await assert.rejects(buildSite({ projectRoot }));
  assert.equal(await readFile(join(projectRoot, "_site/keep.txt"), "utf8"), "previous deployment");
});

test("an unavailable or malformed equity runtime cannot bypass demo validation", async t => {
  const { projectRoot, put, equities } = await fixture(t);
  await put("_site/keep.txt", "previous deployment");
  for (const runtime of [{}, { ...equities, dataset: { ...equities.dataset, kind: "unavailable", status: "unavailable" } }]) {
    await put("data/equities.json", runtime);
    await assert.rejects(buildSite({ projectRoot }));
    assert.equal(await readFile(join(projectRoot, "_site/keep.txt"), "utf8"), "previous deployment");
  }
});
