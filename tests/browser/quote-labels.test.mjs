import assert from "node:assert/strict";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after, before } from "node:test";
import { createCardDocument, normalizeCardVisualization } from "../../src/card-document.js";
import { createSharedDesk, encodeSharedDesk } from "../../src/shared-desk.js";

// Existing local preview and installed browsers only. All storage is disposable;
// no provider requests or user browser sessions are used.
const moduleName = process.env.DESK_PLAYWRIGHT_MODULE || "playwright";
const playwright = await import(isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const engine = process.env.DESK_BROWSER_ENGINE || "chromium";
assert(["chromium", "webkit"].includes(engine));
const baseUrl = process.env.DESK_BASE_URL || "http://127.0.0.1:4173";
const savedKey = "desk.catalog.v2";
const collectionsKey = "desk.catalog-collections.v1";
const pinsKey = "desk.market-watchlist.v1";
const date = "2026-09-07T09:00:00.000Z";
const entries = [
  { name: 'North <b>lane</b> & "A"', quote: 3.65 },
  { name: "South training allocation", quote: 4.25 },
].map(({ name, quote }) => ({ cardId: "quote-view", name,
  state: normalizeCardVisualization("quote-view", { gpu: "B200", quantity: 256, quote,
    rfs: "2026-10", palette: "linen", theme: "dark" }),
}));
const pins = entries.map((entry, index) => ({ id: `quote-label-${index}`, cardId: entry.cardId,
  label: entry.name, state: entry.state }));
let browser;

before(async () => {
  browser = await playwright[engine].launch({ headless: true, timeout: 15000,
    ...(process.env.DESK_BROWSER_PATH ? { executablePath: process.env.DESK_BROWSER_PATH } : {}) });
});
after(async () => { await browser?.close(); });

function fixture(kind) {
  const url = new URL("/?card=quote-view&view=gallery&palette=linen&theme=dark", baseUrl);
  const storage = { [pinsKey]: JSON.stringify({ version: 1, items: pins }) };
  const collection = { id: "quote-labels", name: "Quote research", keys: [], createdAt: date, updatedAt: date };
  if (kind === "shared") {
    url.hash = `desk=${encodeSharedDesk(createSharedDesk({ name: collection.name, entries,
      palette: "linen", theme: "dark" }, { includePrivate: true }))}`;
  } else if (kind === "embedded") {
    collection.views = entries.map((entry, index) => ({ key: `quote-label-embedded-${index}`, ...entry }));
    collection.keys = collection.views.map(entry => entry.key);
  } else {
    const documents = entries.map((entry, index) => createCardDocument({ ...entry,
      id: `quote-label-saved-${index}`, createdAt: date, updatedAt: date }));
    storage[savedKey] = JSON.stringify({ version: 2, items: documents, documentSchema: "desk.card", documentVersion: 1 });
    collection.keys = documents.map(document => `saved-${document.cardId}-${document.id}`);
  }
  if (kind !== "shared") storage[collectionsKey] = JSON.stringify({ version: 10, activeId: collection.id, collections: [collection] });
  return { url, storage, collection: collection.id };
}

async function makePage(t, { url, storage = {}, collection = "all", width = 1440 }) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 },
    reducedMotion: "reduce", isMobile: width === 390, hasTouch: width === 390 });
  const page = await context.newPage();
  const errors = [];
  page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(error.message));
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, [], "Rendering names raised an uncaught error");
  });
  await context.addInitScript(({ storage, collection }) => {
    if (sessionStorage.getItem("quote-labels-fixture")) return;
    for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
    sessionStorage.setItem("desk.active-catalog.v1", collection);
    sessionStorage.setItem("quote-labels-fixture", "ready");
  }, { storage, collection });
  await page.route("**/*", route => new URL(route.request().url()).origin === new URL(baseUrl).origin
    ? route.continue() : route.abort());
  await page.goto(url.href, { waitUntil: "networkidle" });
  await ready(page);
  await page.evaluate(() => { window.__quoteLabelsDocument = document.documentElement; });
  return page;
}

async function ready(page) {
  await page.waitForFunction(() => document.querySelector("[data-gpu-benchmark-card]")?.dataset.cardReady === "true");
}

async function storedState(page) {
  return page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), [savedKey, collectionsKey, pinsKey]);
}

async function assertLabel(host, name) {
  await host.waitFor({ state: "visible" });
  const label = host.locator(".deal-view__label");
  await label.waitFor({ state: "visible" });
  assert.equal(await label.textContent(), name);
  assert.equal(await label.locator("*").count(), 0, "User name must be text, never interpreted as HTML");
  assert.doesNotMatch(await host.locator("[data-deal-view]").getAttribute("aria-label"), /Quote 041/);
}

async function focusedView(page) {
  await page.keyboard.press("Meta+g");
  await page.locator("[data-command-palette]").waitFor({ state: "visible" });
  if (await page.locator("[data-desk-login]").isVisible()) {
    await page.locator("[data-desk-login]").focus();
    await page.keyboard.press("Enter");
  }
  await page.locator("[data-command-input]").fill("one view");
  await page.locator("#desk-command-catalog-focused-view").click();
  await page.waitForFunction(() => new URL(location.href).searchParams.get("view") === "card");
}

for (const [kind, width] of [["saved", 1440], ["saved", 390], ["shared", 1440], ["embedded", 1440]]) {
  test(`${kind} Quote names remain distinct and escaped across chart surfaces (${engine}, ${width})`, { timeout: 60000 }, async t => {
    const page = await makePage(t, { ...fixture(kind), width });
    const stored = await storedState(page);
    const hash = new URL(page.url()).hash;
    const gallery = page.locator("[data-card-gallery-grid] .desk-gallery-card");
    assert.equal(await gallery.count(), 2);
    const keys = await gallery.evaluateAll(buttons => buttons.map(button => button.dataset.catalogId));
    for (let index = 0; index < entries.length; index++) await assertLabel(gallery.nth(index), entries[index].name);
    await gallery.first().click();
    await page.waitForFunction(() => document.documentElement.dataset.deskView === "monitor");
    for (let index = 0; index < entries.length; index++) {
      await page.locator(`[data-catalog-entry-key="${keys[index]}"]`).click();
      await assertLabel(page.locator("[data-deal-workspace]"), entries[index].name);
      assert.equal(new URL(page.url()).searchParams.get("quote"), String(entries[index].state.quote));
    }
    if (width > 640) {
      await focusedView(page);
      for (let index = 0; index < entries.length; index++) {
        await page.locator(`[data-catalog-entry-key="${keys[index]}"]`).click();
        await assertLabel(page.locator("[data-deal-preview]"), entries[index].name);
      }
    }
    for (let index = 0; index < pins.length; index++) {
      await page.locator("[data-command-open]").focus();
      const trigger = page.locator(`[data-market-instrument="${pins[index].id}"] button`);
      await trigger.scrollIntoViewIfNeeded();
      await trigger.focus();
      const preview = page.locator(`[data-market-preview][data-instrument="${pins[index].id}"]`);
      await assertLabel(preview, entries[index].name);
    }
    assert.deepEqual(await storedState(page), stored, "Viewing quotes must not rename or rewrite saved/embedded/pinned data");
    assert.equal(new URL(page.url()).hash, hash);
    assert(await page.evaluate(() => window.__quoteLabelsDocument === document.documentElement), "Chart navigation must not reload");
  });
}

for (const width of [1440, 390]) {
  test(`Anonymous Quote uses its GPU while built-in Deal retains its example ID (${engine}, ${width})`, { timeout: 30000 }, async t => {
    const page = await makePage(t, { width,
      url: new URL("/?card=quote-view&view=monitor&gpu=B200&quote=3.65&quantity=256&rfs=2026-10", baseUrl) });
    await assertLabel(page.locator("[data-deal-workspace]"), "Quote B200");
    const stored = await storedState(page);
    await page.goto(new URL("/?card=deal-view&view=monitor", baseUrl).href, { waitUntil: "networkidle" });
    await ready(page);
    await assertLabel(page.locator("[data-deal-workspace]"), "Deal 041");
    assert.deepEqual(await storedState(page), stored);
  });
}

test(`Renaming a saved Quote updates its chart and an open Monitor without reloading (${engine})`, { timeout: 60000 }, async t => {
  const page = await makePage(t, fixture("saved"));
  await page.locator("[data-card-gallery-grid] .desk-gallery-card").first().click();
  await assertLabel(page.locator("[data-deal-workspace]"), entries[0].name);
  const before = await storedState(page);
  const originalUrl = page.url();
  const originalPrice = await page.locator("[data-deal-workspace] .deal-view__quote").textContent();

  // Rename remains a Craft action. A second tab edits the same saved document,
  // exercising real same-origin storage events in the already-open Monitor.
  const editor = await page.context().newPage();
  const errors = [];
  editor.on("pageerror", error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], "Rename raised an uncaught editor error"));
  editor.setDefaultTimeout(10000);
  await editor.route("**/*", route => new URL(route.request().url()).origin === new URL(baseUrl).origin
    ? route.continue() : route.abort());
  const editUrl = new URL(originalUrl);
  editUrl.searchParams.set("view", "craft");
  await editor.goto(editUrl.href, { waitUntil: "networkidle" });
  await ready(editor);
  await editor.waitForFunction(() => document.documentElement.dataset.deskView === "craft");
  await editor.evaluate(() => { window.__quoteRenameDocument = document.documentElement; });
  await assertLabel(editor.locator("[data-deal-workspace]"), entries[0].name);
  await editor.keyboard.press("Meta+g");
  await editor.locator("[data-command-palette]").waitFor({ state: "visible" });
  if (await editor.locator("[data-desk-login]").isVisible()) {
    await editor.locator("[data-desk-login]").focus();
    await editor.keyboard.press("Enter");
  }
  await editor.locator("[data-command-input]").fill("rename view");
  await editor.locator("#desk-command-actions-rename-catalog-card").click();
  await editor.locator("[data-save-dialog]").waitFor({ state: "visible" });
  const renamed = "Renamed <i>quote</i> & 'B'";
  await editor.locator("[data-save-name]").fill(renamed);
  await editor.locator("[data-save-submit]").click();
  await editor.locator("[data-save-dialog]").waitFor({ state: "hidden" });
  await assertLabel(editor.locator("[data-deal-workspace]"), renamed);
  await page.waitForFunction(name => document.querySelector("[data-deal-workspace] .deal-view__label")?.textContent === name, renamed);
  await assertLabel(page.locator("[data-deal-workspace]"), renamed);
  assert.equal(page.url(), originalUrl, "External rename must not navigate the Monitor");
  assert.equal(new URL(editor.url()).searchParams.get("item"), new URL(originalUrl).searchParams.get("item"));
  assert.equal(await page.locator("[data-deal-workspace] .deal-view__quote").textContent(), originalPrice);
  assert.equal(await editor.locator("[data-deal-workspace] .deal-view__quote").textContent(), originalPrice);
  assert(await page.evaluate(() => window.__quoteLabelsDocument === document.documentElement));
  assert(await editor.evaluate(() => window.__quoteRenameDocument === document.documentElement));
  const afterState = await storedState(page);
  const priorItems = JSON.parse(before[savedKey]).items;
  const nextItems = JSON.parse(afterState[savedKey]).items;
  assert.equal(nextItems[0].name, renamed);
  assert.equal(nextItems[0].id, priorItems[0].id);
  assert.equal(nextItems[0].createdAt, priorItems[0].createdAt);
  assert.deepEqual(nextItems[0].visualization, priorItems[0].visualization);
  assert.deepEqual(nextItems[1], priorItems[1], "Renaming one Quote must not rename its sibling");
  assert.equal(afterState[collectionsKey], before[collectionsKey]);
  assert.equal(afterState[pinsKey], before[pinsKey], "Pins are independently saved snapshots");
});
