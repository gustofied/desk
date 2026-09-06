import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after, before } from "node:test";

// Existing local preview and installed browser only. No provider requests,
// credentials, dependency installs, or persistent user-context changes.
const moduleName = process.env.DESK_PLAYWRIGHT_MODULE || "playwright";
const playwright = await import(isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const engine = process.env.DESK_BROWSER_ENGINE || "chromium";
assert(["chromium", "webkit"].includes(engine));
const baseUrl = process.env.DESK_BASE_URL || "http://127.0.0.1:4173";
const screenshotDir = process.env.DESK_SCREENSHOT_DIR || "/private/tmp/desk-equity-ranges-qa";
const day = 86400;
const svg = "[data-gpu-chart-svg]";
const lines = `${svg} .gpu-benchmark__line`;
let browser;
let equities;
let gpu;

before(async () => {
  await mkdir(screenshotDir, { recursive: true });
  const request = await playwright.request.newContext();
  try {
    [equities, gpu] = await Promise.all(["/data/equities.json", "/data/gpu-price-index.json"].map(async path => {
      const response = await request.get(new URL(path, baseUrl).href);
      assert(response.ok());
      return response.json();
    }));
  } finally {
    await request.dispose();
  }
  assert.equal(equities.dataset.status, "ready");
  browser = await playwright[engine].launch({ headless: true,
    ...(process.env.DESK_BROWSER_PATH ? { executablePath: process.env.DESK_BROWSER_PATH } : {}) });
});
after(async () => { await browser?.close(); });

function equityUrl({ kind = "pure", range } = {}) {
  const url = new URL("/", baseUrl);
  const layers = kind === "mixed" ? "NVDA,H100,H200" : kind === "two-stock" ? "NVDA,MSFT" : "NVDA";
  for (const [key, value] of Object.entries({ card: "equities", view: "monitor", symbol: "NVDA",
    layers, scale: kind === "pure" ? "price" : "index", palette: "azure", theme: "dark" })) {
    url.searchParams.set(key, value);
  }
  if (range !== undefined) url.searchParams.set("range", range);
  return url.href;
}

async function makePage(t, { width = 1440, kind = "pure", range } = {}) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 },
    reducedMotion: "reduce", hasTouch: width === 390, isMobile: width === 390 });
  const page = await context.newPage();
  const errors = [];
  page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(error.message));
  t.after(async () => {
    await page.unrouteAll({ behavior: "wait" });
    await context.close();
    assert.deepEqual(errors, [], "Uncaught page errors");
  });
  await page.route("**/*", route => new URL(route.request().url()).origin === new URL(baseUrl).origin
    ? route.continue() : route.abort());
  await page.goto(equityUrl({ kind, range }), { waitUntil: "networkidle" });
  await ready(page);
  return page;
}

async function ready(page, card = "equities") {
  await page.waitForFunction(card => {
    const root = document.querySelector("[data-gpu-benchmark-card]");
    return root?.dataset.cardId === card && root.dataset.cardReady === "true" &&
      document.documentElement.dataset.deskView === "monitor";
  }, card);
}

async function chartRows(page) {
  return page.locator(lines).evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.layer,
    rows: node.__data__.map(row => [row.date.getTime() / 1000, row.value, row.plotValue]),
  })).sort((a, b) => a.id.localeCompare(b.id)));
}

async function assertRangeControls(page) {
  assert.deepEqual(await page.locator("[data-gpu-range]").evaluateAll(buttons => buttons.filter(button =>
    button.getClientRects().length && getComputedStyle(button).visibility !== "hidden").map(button => button.dataset.gpuRange)),
  ["7d", "90d", "1y"]);
  assert.equal(await page.locator('[data-gpu-range="1y"]').getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator('[data-gpu-range="all"]').isVisible(), false);
}

async function assertHealthyChart(page, count) {
  assert.equal(await page.locator(lines).count(), count);
  assert.equal(await page.locator(`${svg} .gpu-benchmark__plot-root`).count(), 1);
  assert.equal(await page.locator(`${svg} .is-exiting`).count(), 0);
  assert.equal(await page.locator("[data-gpu-state]").isVisible(), false);
  assert((await chartRows(page)).every(series => series.rows.length > 1));
}

function expectedMixedDates() {
  const daily = [equities.series.NVDA, gpu.series.H100, gpu.series.H200].map(points =>
    new Set(points.map(point => Math.floor(point[0] / day) * day)));
  const common = [...daily[0]].filter(date => daily.every(dates => dates.has(date))).sort((a, b) => a - b);
  return common.filter(date => date >= common.at(-1) - 365 * day);
}

for (const width of [1440, 390]) {
  for (const kind of ["pure", "mixed"]) {
    test(`${kind} equities default to 1Y, normalize old ALL, and retain GPU ALL (${engine}, ${width})`, async t => {
      const page = await makePage(t, { width, kind });
      await assertRangeControls(page);
      await assertHealthyChart(page, kind === "mixed" ? 3 : 1);
      const original = await chartRows(page);
      if (kind === "pure") {
        assert.deepEqual(original[0].rows.map(row => row.slice(0, 2)),
          equities.series.NVDA.filter(point => point[0] >= equities.asOf - 365 * day));
      } else {
        const expected = expectedMixedDates();
        assert(expected.length > 1 && expected.length < equities.series.NVDA.length);
        for (const series of original) assert.deepEqual(series.rows.map(row => row[0]), expected);
        assert(expected.at(-1) - expected[0] <= 90 * day, "Current GPU history must not expand into a fabricated year");
      }
      await page.goto(equityUrl({ kind, range: "all" }), { waitUntil: "networkidle" });
      await ready(page);
      await assertRangeControls(page);
      assert.deepEqual(await chartRows(page), original, "Legacy ALL must normalize to the same 1Y data");
      const bounds = await page.locator(svg).boundingBox();
      assert(bounds.width > 0 && bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
      await page.locator('[data-catalog-entry-key="preset-gpu-index-h200"]').click();
      await ready(page, "gpu-index");
      assert(await page.locator('[data-gpu-range="all"]').isVisible());
      await page.locator('[data-gpu-range="all"]').click();
      assert.equal(new URL(page.url()).searchParams.get("range"), "all");
      assert.equal(await page.locator('[data-gpu-range="all"]').getAttribute("aria-pressed"), "true");
      await page.waitForFunction(count => Number(document.querySelector("[data-gpu-chart-svg] .gpu-benchmark__hit")
        ?.getAttribute("aria-valuemax")) === count - 1, gpu.series.H200.length);
      assert.deepEqual((await chartRows(page))[0].rows.map(row => row.slice(0, 2)), gpu.series.H200.map(row => row.slice(0, 2)));
    });
  }
}

for (const kind of ["pure", "mixed", "two-stock"]) {
  test(`desktop ${kind} 1Y drag zoom and reset preserve original values and return baseline (${engine})`, async t => {
    const page = await makePage(t, { kind, range: "1y" });
    const count = kind === "pure" ? 1 : kind === "mixed" ? 3 : 2;
    await assertRangeControls(page);
    await assertHealthyChart(page, count);
    assert(await page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches));
    const original = await chartRows(page);
    const hitBounds = await page.locator(`${svg} .gpu-benchmark__hit-zones`).boundingBox();
    const y = hitBounds.y + hitBounds.height * 0.5;
    await page.mouse.move(hitBounds.x + hitBounds.width * 0.2, y);
    await page.mouse.down();
    await page.mouse.move(hitBounds.x + hitBounds.width * 0.7, y, { steps: 8 });
    await page.mouse.up();
    await page.locator("[data-gpu-zoom-reset]").waitFor({ state: "visible" });
    await assertHealthyChart(page, count);
    const zoomed = await chartRows(page);
    for (const series of zoomed) {
      const full = original.find(candidate => candidate.id === series.id).rows;
      assert(series.rows.length > 1 && series.rows.length < full.length, `${series.id} zoom did not narrow the window`);
      const byDate = new Map(full.map(row => [row[0], row]));
      for (const row of series.rows) assert.deepEqual(row, byDate.get(row[0]), `${series.id} zoom changed its return baseline`);
    }
    assert.equal(new URL(page.url()).searchParams.get("range"), "1y");
    await page.mouse.move(0, 0);
    await page.screenshot({ path: join(screenshotDir, `${engine}-1440-${kind}-1y-zoom.png`) });
    await page.locator("[data-gpu-zoom-reset]").click();
    await page.locator("[data-gpu-zoom-reset]").waitFor({ state: "hidden" });
    await assertHealthyChart(page, count);
    assert.deepEqual(await chartRows(page), original);
    await assertRangeControls(page);
  });
}
