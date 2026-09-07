import assert from "node:assert/strict";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after, before } from "node:test";
import { createCardDocument, normalizeCardVisualization } from "../../src/card-document.js";
import { createSharedDesk, encodeSharedDesk } from "../../src/shared-desk.js";

// Run against a local preview with the existing installed Playwright/browser.
// Every case owns disposable storage; external requests are blocked.
const moduleName = process.env.DESK_PLAYWRIGHT_MODULE || "playwright";
const playwright = await import(isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const engine = process.env.DESK_BROWSER_ENGINE || "chromium";
assert(["chromium", "webkit"].includes(engine));
const baseUrl = process.env.DESK_BASE_URL || "http://127.0.0.1:4173";
const svg = "[data-gpu-chart-svg]";
const tabs = "[data-catalog-entry-key]";
const collectionKey = "desk.catalog-collections.v1";
const savedKey = "desk.catalog.v2";
const fixtureDate = "2026-09-06T12:00:00.000Z";
const providers = ["novita", "daytona-vm", "blaxel", "e2b", "modal-vm", "modal-gvisor"];
const sandboxEntries = ["now", "7d"].map((range, index) => ({
  cardId: "sandbox-cost", name: index ? "Research history" : "Research latest",
  state: normalizeCardVisualization("sandbox-cost", {
    provider: "novita", layers: providers, scale: "price", range, palette: "linen", theme: "dark",
  }),
}));
let browser;

before(async () => {
  browser = await playwright[engine].launch({ headless: true,
    ...(process.env.DESK_BROWSER_PATH ? { executablePath: process.env.DESK_BROWSER_PATH } : {}) });
});
after(async () => { await browser?.close(); });

function monitorUrl(cardId, state, query = {}) {
  const url = new URL("/", baseUrl);
  for (const [key, value] of Object.entries({ card: cardId, view: "monitor", ...state, ...query })) {
    url.searchParams.set(key, Array.isArray(value) ? value.join(",") : value);
  }
  return url;
}

async function makePage(t, { url, width = 1440, storage = {}, collection = "all" }) {
  const context = await browser.newContext({
    viewport: { width, height: width === 390 ? 844 : 900 }, reducedMotion: "reduce",
    isMobile: width === 390, hasTouch: width === 390,
  });
  const errors = [];
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(error.message));
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, [], "Range changes raised uncaught errors");
  });
  await context.addInitScript(({ storage, collection }) => {
    if (sessionStorage.getItem("range-identity-fixture")) return;
    for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
    sessionStorage.setItem("desk.active-catalog.v1", collection);
    sessionStorage.setItem("range-identity-fixture", "ready");
  }, { storage, collection });
  await page.route("**/*", route => new URL(route.request().url()).origin === new URL(baseUrl).origin
    ? route.continue() : route.abort());
  await page.goto(url.href, { waitUntil: "networkidle" });
  const focus = url.searchParams.get("view") === "card";
  await page.waitForFunction(focus => document.querySelector("[data-gpu-benchmark-card]")?.dataset.cardReady === "true" &&
    document.documentElement.dataset.deskView === (focus ? "catalog" : "monitor") &&
    document.documentElement.dataset.deskLayout === "focus", focus);
  await page.locator(focus ? "[data-share-artifact-svg]" : svg).waitFor({ state: "visible" });
  await page.evaluate(selector => {
    window.__rangeIdentityDocument = document.documentElement;
    window.__rangeIdentitySvg = document.querySelector(selector);
  }, svg);
  return page;
}

async function railSnapshot(page) {
  return page.locator(tabs).evaluateAll(buttons => ({
    entries: buttons.map(button => ({ key: button.dataset.catalogEntryKey, label: button.textContent.trim() })),
    selected: buttons.filter(button => button.getAttribute("aria-selected") === "true").map(button => button.dataset.catalogEntryKey),
  }));
}

async function storageSnapshot(page) {
  return page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)])));
}

async function settled(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function assertRange(page, cardId, range) {
  await page.waitForFunction(({ cardId, range }) => {
    const url = new URL(location.href);
    const chart = document.querySelector("[data-gpu-chart-svg]");
    if (url.searchParams.get("card") !== cardId || url.searchParams.get("range") !== range) return false;
    return cardId === "sandbox-cost"
      ? chart?.querySelector("[data-sandbox-chart]")?.getAttribute("data-sandbox-chart") === range
      : chart?.querySelectorAll(".gpu-benchmark__plot-root").length === 1 &&
        chart.querySelector(".gpu-benchmark__line")?.__data__?.length > 1;
  }, { cardId, range });
  await settled(page);
  assert.equal(await page.locator(`[data-gpu-range="${range}"]`).getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator(`${svg} .is-exiting`).count(), 0);
  assert(await page.evaluate(selector => window.__rangeIdentityDocument === document.documentElement &&
    window.__rangeIdentitySvg === document.querySelector(selector), svg), "Range change replaced the document or chart mount");
}

async function exerciseRanges(page, { cardId, key, ranges, siblingKey, siblingRange }) {
  const initial = await railSnapshot(page);
  assert.deepEqual(initial.selected, [key], "The fixture must start on the expected entry, not a temporary current tab");
  const stored = await storageSnapshot(page);
  const hash = new URL(page.url()).hash;
  const item = new URL(page.url()).searchParams.get("item");
  const gpuLengths = {};
  for (const range of ranges) {
    await page.locator(`[data-gpu-range="${range}"]`).click();
    await assertRange(page, cardId, range);
    assert.deepEqual(await railSnapshot(page), initial, `Changing to ${range} retargeted or reordered the rail`);
    assert.deepEqual(await storageSnapshot(page), stored, "A display range change mutated saved data");
    assert.equal(new URL(page.url()).hash, hash, "A display range change rewrote the shared snapshot");
    assert.equal(new URL(page.url()).searchParams.get("item"), item, "A display range change lost the saved-view ID");
    if (cardId === "gpu-index") gpuLengths[range] = await page.locator(`${svg} .gpu-benchmark__line`).first()
      .evaluate(line => line.__data__.length);
  }
  if (cardId === "gpu-index") assert(gpuLengths.all > gpuLengths["1d"], "H100 ranges must change the rendered observations");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("[data-gpu-benchmark-card]")?.dataset.cardReady === "true");
  await page.evaluate(selector => {
    window.__rangeIdentityDocument = document.documentElement;
    window.__rangeIdentitySvg = document.querySelector(selector);
  }, svg);
  await assertRange(page, cardId, ranges.at(-1));
  assert.deepEqual(await railSnapshot(page), initial, "Reload lost the anchored entry or reordered its rail");
  assert.deepEqual(await storageSnapshot(page), stored, "Reload persisted a transient range into the saved view");
  assert.equal(new URL(page.url()).hash, hash);
  if (siblingKey) {
    await page.locator(`[data-catalog-entry-key="${siblingKey}"]`).click();
    await assertRange(page, cardId, siblingRange);
    assert.deepEqual((await railSnapshot(page)).selected, [siblingKey], "Explicit navigation must still select the sibling view");
    assert.deepEqual(await storageSnapshot(page), stored, "Opening a sibling changed its authored state");
    await page.locator(`[data-catalog-entry-key="${key}"]`).click();
    await assertRange(page, cardId, "now");
    assert.deepEqual((await railSnapshot(page)).selected, [key]);
  }
}

for (const width of [1440, 390]) {
  test(`Sandbox preset range edits stay on the chosen tab (${engine}, ${width})`, async t => {
    const page = await makePage(t, { width, collection: "sandbox",
      url: monitorUrl("sandbox-cost", sandboxEntries[0].state) });
    await exerciseRanges(page, { cardId: "sandbox-cost", key: "preset-sandbox-cost-cost", ranges: ["7d", "now", "all"],
      siblingKey: "preset-sandbox-cost-history", siblingRange: "7d" });
  });

  test(`H100 range edits do not insert or select a different tab (${engine}, ${width})`, async t => {
    const state = normalizeCardVisualization("gpu-index", { gpu: "H100", layers: ["H100"], scale: "price", range: "7d" });
    const page = await makePage(t, { width, url: monitorUrl("gpu-index", state) });
    await exerciseRanges(page, { cardId: "gpu-index", key: "preset-gpu-index-h100", ranges: ["all", "7d", "1d"] });
  });

  test(`Shared entries differing only by range retain their selected identity (${engine}, ${width})`, async t => {
    const url = monitorUrl("sandbox-cost", sandboxEntries[0].state);
    const duplicates = sandboxEntries.map(entry => ({ ...entry, name: "Research Sandbox" }));
    url.hash = `desk=${encodeSharedDesk(createSharedDesk({ name: "Range identity", entries: duplicates }))}`;
    const page = await makePage(t, { width, url });
    const rail = await railSnapshot(page);
    assert.deepEqual(rail.entries.map(entry => entry.label), duplicates.map(entry => entry.name));
    await exerciseRanges(page, { cardId: "sandbox-cost", key: rail.entries[0].key, ranges: ["7d", "now", "all"],
      siblingKey: rail.entries[1].key, siblingRange: "7d" });
  });
}

for (const kind of ["embedded", "saved"]) {
  test(`${kind} views keep their identity and stored ranges unchanged (${engine})`, async t => {
    const collection = { id: "range-research", name: "Range research", keys: [], createdAt: fixtureDate, updatedAt: fixtureDate };
    const storage = {};
    const query = {};
    if (kind === "embedded") {
      collection.views = sandboxEntries.map((entry, index) => ({ key: `embedded-range-${index}`, ...entry }));
      collection.keys = collection.views.map(entry => entry.key);
      query.entry = collection.keys[0];
    } else {
      const documents = sandboxEntries.map((entry, index) => createCardDocument({
        ...entry, id: `range-view-${index}`, createdAt: fixtureDate, updatedAt: fixtureDate,
      }));
      collection.keys = documents.map(document => `saved-${document.cardId}-${document.id}`);
      storage[savedKey] = JSON.stringify({ version: 2, items: documents, documentSchema: "desk.card", documentVersion: 1 });
      query.item = documents[0].id;
    }
    storage[collectionKey] = JSON.stringify({ version: 9, activeId: collection.id, collections: [collection] });
    const page = await makePage(t, { url: monitorUrl("sandbox-cost", sandboxEntries[0].state, query), storage, collection: collection.id });
    await exerciseRanges(page, { cardId: "sandbox-cost", key: collection.keys[0], ranges: ["7d", "now", "all"],
      siblingKey: collection.keys[1], siblingRange: "7d" });
  });
}

test(`Focus and Monitor preserve identity without enabling disabled Focus range commands (${engine})`, async t => {
  const url = monitorUrl("sandbox-cost", sandboxEntries[0].state, { view: "card" });
  const page = await makePage(t, { url, collection: "sandbox" });
  const initial = await railSnapshot(page);
  assert.deepEqual(initial.selected, ["preset-sandbox-cost-cost"]);
  const stored = await storageSnapshot(page);
  await page.keyboard.press("Meta+g");
  await page.locator("[data-command-palette]").waitFor({ state: "visible" });
  if (await page.locator("[data-desk-login]").isVisible()) {
    await page.locator("[data-desk-login]").focus();
    await page.keyboard.press("Enter");
  }
  await page.locator("[data-command-input]").fill("seven");
  assert(await page.locator("#desk-command-range-7d").isDisabled(), "Focus range controls must retain their existing availability");
  await page.keyboard.press("Escape");
  await page.locator('[data-desk-mode="monitor"]').click();
  await assertRange(page, "sandbox-cost", "now");
  for (const range of ["7d", "all"]) {
    await page.locator(`[data-gpu-range="${range}"]`).click();
    await assertRange(page, "sandbox-cost", range);
    assert.deepEqual(await railSnapshot(page), initial);
  }
  await page.keyboard.press("Meta+g");
  await page.locator("[data-command-input]").fill("one view");
  await page.locator("#desk-command-catalog-focused-view").click();
  await page.waitForFunction(() => new URL(location.href).searchParams.get("view") === "card" &&
    document.querySelector("[data-share-artifact-svg] [data-sandbox-chart]")?.getAttribute("data-sandbox-chart") === "all");
  await page.locator("[data-share-artifact-svg]").waitFor({ state: "visible" });
  await settled(page);
  assert.deepEqual(await railSnapshot(page), initial, "Entering Monitor lost the focused view identity");
  assert.deepEqual(await storageSnapshot(page), stored);
});

test(`An explicit current view is not reassigned to a matching shared entry on reload (${engine})`, async t => {
  const url = monitorUrl("sandbox-cost", sandboxEntries[1].state, { entry: "current-sandbox-cost" });
  url.hash = `desk=${encodeSharedDesk(createSharedDesk({ name: "Current range", entries: sandboxEntries }))}`;
  const page = await makePage(t, { url });
  await exerciseRanges(page, { cardId: "sandbox-cost", key: "current-sandbox-cost", ranges: ["all", "now", "7d"] });
});
