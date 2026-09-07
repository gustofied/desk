import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after, before } from "node:test";
import { CARD_REGISTRY } from "../../src/card-registry.js";

// Existing local preview and installed browsers only. Every test starts with
// empty disposable storage and blocks requests outside the local preview.
const moduleName = process.env.DESK_PLAYWRIGHT_MODULE || "playwright";
const playwright = await import(isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const engine = process.env.DESK_BROWSER_ENGINE || "chromium";
assert(["chromium", "webkit"].includes(engine));
const baseUrl = process.env.DESK_BASE_URL || "http://127.0.0.1:4173";
const screenshotDir = process.env.DESK_SCREENSHOT_DIR || "/private/tmp/desk-showcase-qa";
const collectionsKey = "desk.catalog-collections.v1";
const gallerySelector = "[data-card-gallery-grid] .desk-gallery-card";
const catalogs = [
  ["overview", "Overview", 6], ["compute", "Compute", 6], ["hedge", "Hedge", 5],
  ["power", "Power", 3], ["equities", "Equities", 5], ["deals", "Deals", 3],
  ["sandbox", "Sandbox", 2], ["private", "Private", 3], ["team", "Team", 5],
];
let browser;

before(async () => {
  await mkdir(screenshotDir, { recursive: true });
  browser = await playwright[engine].launch({ headless: true, timeout: 15000,
    ...(process.env.DESK_BROWSER_PATH ? { executablePath: process.env.DESK_BROWSER_PATH } : {}) });
});
after(async () => { await browser?.close(); });

async function makePage(t, width) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 },
    reducedMotion: "reduce", isMobile: width === 390, hasTouch: width === 390 });
  const page = await context.newPage();
  const errors = [];
  page.setDefaultTimeout(12000);
  page.on("pageerror", error => errors.push(error.message));
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, [], "Starter catalogs raised an uncaught page error");
  });
  await context.route("**/*", route => new URL(route.request().url()).origin === new URL(baseUrl).origin
    ? route.continue() : route.abort());
  // No storage fixture: verify the real first-visit catalog initialization.
  await page.goto(new URL("/", baseUrl).href, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("[data-gpu-benchmark-card]")?.dataset.cardReady === "true");
  await page.evaluate(() => { window.__showcaseDocument = document.documentElement; });
  return page;
}

async function storageSnapshot(page) {
  return page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)])));
}

async function showGallery(page) {
  if (await page.evaluate(() => document.documentElement.dataset.deskView !== "catalog")) {
    await page.locator('[data-desk-mode="catalog"]').click();
  }
  if (await page.evaluate(() => document.documentElement.dataset.deskLayout !== "all")) {
    await page.locator("[data-index-gallery-toggle]").click();
  }
  await page.waitForFunction(() => document.documentElement.dataset.deskView === "catalog" && document.documentElement.dataset.deskLayout === "all");
}

async function openCatalogMenu(page) {
  await showGallery(page);
  await page.locator("[data-catalog-switcher]").focus();
  await page.keyboard.press("ArrowDown");
  await page.locator("[data-catalog-menu]").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.activeElement?.matches("[data-catalog-collection]") &&
    document.querySelector("[data-catalog-list]")?.contains(document.activeElement));
}

async function selectCatalog(page, id) {
  await openCatalogMenu(page);
  await page.locator(`[data-catalog-collection="${id}"]`).click();
  await page.locator("[data-catalog-menu]").waitFor({ state: "hidden" });
  await page.waitForFunction(id => sessionStorage.getItem("desk.active-catalog.v1") === id, id);
}

async function assertGallery(page, [id, name, count], collections) {
  assert.equal(await page.locator("[data-catalog-switcher-name]").textContent(), name);
  const expectedKeys = collections.find(collection => collection.id === id).keys;
  const cards = page.locator(gallerySelector);
  assert.equal(await cards.count(), count, `${name} card count`);
  const keys = await cards.evaluateAll(nodes => nodes.map(node => node.dataset.catalogId));
  assert.equal(new Set(keys).size, count, `${name} must not repeat a view key`);
  assert.deepEqual(keys, expectedKeys, `${name} renders its complete authored order`);
  for (let index = 0; index < count; index++) {
    const card = cards.nth(index);
    await card.waitFor({ state: "visible" });
    assert.match(await card.getAttribute("aria-label"), /^Monitor \S/);
    const geometry = await card.evaluate(node => {
      const deal = node.querySelector("[data-deal-view]");
      const svg = node.querySelector("[data-gallery-artifact]");
      const marks = svg ? [...svg.querySelectorAll("path, [data-price-bar-marker], [data-sandbox-whisker]")]
        .filter(mark => !mark.closest("defs") && (mark.tagName.toLowerCase() !== "path" || (mark.getAttribute("d") || "").length > 8)) : [];
      const rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height, label: deal?.querySelector(".deal-view__label")?.textContent,
        quote: deal?.querySelector(".deal-view__quote")?.textContent, marks: marks.length,
        invalidPaths: marks.filter(mark => /NaN|Infinity/.test(mark.getAttribute("d") || "")).length,
        text: svg?.textContent || deal?.textContent || "" };
    });
    assert(geometry.width > 0 && geometry.height > 0, `${keys[index]} has no layout box`);
    assert(geometry.marks > 0 || (geometry.label?.trim() && geometry.quote?.trim()), `${keys[index]} is blank`);
    assert.equal(geometry.invalidPaths, 0, `${keys[index]} contains invalid chart geometry`);
    assert.doesNotMatch(geometry.text, /not connected|could not load|temporarily unavailable|no shared trading sessions/i);
  }
}

async function capture(page, name) {
  await page.screenshot({ path: join(screenshotDir, `${engine}-${page.viewportSize().width}-${name}.png`) });
}

for (const width of [1440, 390]) {
  test(`Fresh composed catalogs render and open without mutating saved state (${engine}, ${width})`, { timeout: 120000 }, async t => {
    const page = await makePage(t, width);
    const initial = await storageSnapshot(page);
    const stored = JSON.parse(initial[collectionsKey]);
    assert.equal(stored.version, 10);
    assert.deepEqual(stored.collections.map(({ id, name, keys }) => [id, name, keys.length]), catalogs);
    await assertGallery(page, catalogs[0], stored.collections);
    await capture(page, "overview");

    await openCatalogMenu(page);
    const options = await page.locator("[data-catalog-collection]").evaluateAll(nodes => nodes.map(node => ({
      id: node.dataset.catalogCollection, label: node.getAttribute("aria-label"),
    })));
    assert.equal(new Set(options.map(option => option.id)).size, options.length);
    assert.deepEqual(options.map(option => option.id), [...catalogs.map(([id]) => id), "all"], "All views follows the curated catalogs");
    for (const [id, name, count] of catalogs) {
      assert.deepEqual(options.find(option => option.id === id), { id, label: `${name}, ${count} views` });
    }
    if (width === 390) {
      const menu = await page.locator("[data-catalog-menu]").boundingBox();
      assert(menu.x >= -1 && menu.y >= -1 && menu.x + menu.width <= width + 1 && menu.y + menu.height <= 845,
        `Mobile menu must fit the viewport: ${JSON.stringify(menu)}`);
    }
    await capture(page, "catalog-menu");
    for (const [key, id] of [["End", "all"], ["Home", "overview"]]) {
      await page.keyboard.press(key);
      const position = await page.locator(`[data-catalog-collection="${id}"]`).evaluate(node => {
        const rect = node.getBoundingClientRect();
        const list = node.closest("[data-catalog-list]").getBoundingClientRect();
        return { focused: node === document.activeElement, top: rect.top, bottom: rect.bottom,
          listTop: list.top, listBottom: list.bottom, viewportHeight: innerHeight };
      });
      assert(position.focused, `${key} focuses ${id}`);
      assert(position.top >= Math.max(0, position.listTop) - 1 &&
        position.bottom <= Math.min(position.viewportHeight, position.listBottom) + 1,
      `${key} must reveal its menu option: ${JSON.stringify(position)}`);
    }
    await page.keyboard.press("Escape");
    await page.locator("[data-catalog-menu]").waitFor({ state: "hidden" });

    for (const catalog of catalogs) {
      await selectCatalog(page, catalog[0]);
      await assertGallery(page, catalog, stored.collections);
    }

    const equityCard = CARD_REGISTRY.find(card => card.id === "equities");
    const mixed = equityCard.catalogPresets.find(preset => preset.id === "nvidia-compute");
    assert(mixed, "The showcase must include a composed equity and GPU comparison");
    const mixedKey = `preset-equities-${mixed.id.toLowerCase()}`;
    const mixedCatalog = stored.collections.find(collection => collection.keys.includes(mixedKey));
    assert(mixedCatalog, "A starter catalog must expose the mixed comparison");
    await selectCatalog(page, mixedCatalog.id);
    await page.locator(`${gallerySelector}[data-catalog-id="${mixedKey}"]`).click();
    await page.waitForFunction(() => document.documentElement.dataset.deskView === "monitor" && new URL(location.href).searchParams.get("card") === "equities");
    const lines = page.locator("[data-gpu-chart-svg] .gpu-benchmark__line");
    await lines.first().waitFor({ state: "visible" });
    const plotted = await lines.evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.layer,
      first: node.__data__?.[0]?.plotValue, count: node.__data__?.length,
      finite: node.__data__?.every(row => Number.isFinite(row.plotValue)), d: node.getAttribute("d"),
    })));
    assert.deepEqual(plotted.map(series => series.id).sort(), [...mixed.state.layers].sort());
    assert.equal(new URL(page.url()).searchParams.get("scale"), "index");
    assert(plotted.some(series => ["H100", "H200"].includes(series.id)) && plotted.some(series => !["H100", "H200"].includes(series.id)));
    assert(plotted.every(series => series.first === 100 && series.count > 1 && series.finite && !/NaN|Infinity/.test(series.d)));
    assert.equal(await page.locator("[data-gpu-state]").isVisible(), false);
    await capture(page, "mixed-equity-monitor");

    await selectCatalog(page, "deals");
    const quote = page.locator(gallerySelector).filter({ has: page.locator('[data-deal-view] .deal-view__label', { hasText: /^Quote B200$/ }) });
    assert.equal(await quote.count(), 1, "Deals exposes Quote B200 exactly once");
    await quote.click();
    await page.waitForFunction(() => document.documentElement.dataset.deskView === "monitor" && new URL(location.href).searchParams.get("card") === "quote-view");
    const label = page.locator("[data-deal-workspace] .deal-view__label");
    await label.waitFor({ state: "visible" });
    assert.equal(await label.textContent(), "Quote B200");
    assert.equal(new URL(page.url()).searchParams.get("gpu"), "B200");
    assert.match(await page.locator("[data-deal-workspace] .deal-view__quote").textContent(), /\$/);
    await capture(page, "quote-b200-monitor");
    assert(await page.evaluate(() => window.__showcaseDocument === document.documentElement), "Catalog and chart navigation must stay in the same document");
    assert.deepEqual(await storageSnapshot(page), initial, "Browsing catalog presets must not rewrite local collections, saved views, or pins");
  });
}
