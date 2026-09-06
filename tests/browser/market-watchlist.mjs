import assert from "node:assert/strict";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import test, { after, before } from "node:test";

// Run against an existing preview; no packages or browser binaries are installed.
// Optional: DESK_PLAYWRIGHT_MODULE, DESK_BROWSER_PATH, DESK_BASE_URL, DESK_SCREENSHOT_DIR.
const moduleName = process.env.DESK_PLAYWRIGHT_MODULE || "playwright";
const { chromium } = await import(isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const baseUrl = process.env.DESK_BASE_URL || "http://127.0.0.1:4173";
const screenshotDir = process.env.DESK_SCREENSHOT_DIR || tmpdir();
const storageKey = "desk.market-watchlist.v1";
const pinSelector = "[data-card-market-pin]";
const commandPinSelector = "#desk-command-actions-pin-to-strip";
const itemSelector = "[data-market-instrument]";
const defaultIds = ["H100", "H200", "B200", "B300", "PJM-WEST-RT"];
const pageErrors = [];
const families = [
  { cardId: "gpu-index", state: { gpu: "H100", layers: ["H100", "B200"], scale: "spread", range: "all" } },
  { cardId: "gpu-price-snapshot", state: { gpu: "B300", layers: ["H100", "B300"], scale: "price", range: "1d" } },
  { cardId: "gpu-market-depth", state: { gpu: "H100", layers: ["H100"], scale: "history", range: "now", target: "256" } },
  { cardId: "power-basis", state: { location: "PJM-WEST", layers: ["PJM-WEST"], scale: "basis", range: "7d" } },
  { cardId: "quote-view", state: { gpu: "H200", quantity: 512, quote: 4.25, rfs: "2027-04" } },
  { cardId: "deal-view", state: { gpu: "B300", quantity: 1024, quote: 6.45, rfs: "2027-08" } },
];
let browser;

before(async () => {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.DESK_BROWSER_PATH ? { executablePath: process.env.DESK_BROWSER_PATH } : {}),
  });
});
after(async () => { await browser?.close(); });

function urlFor({ cardId = "gpu-index", state = { gpu: "H200", layers: ["H200"], scale: "price", range: "7d" }, view = "monitor" } = {}) {
  const url = new URL("/", baseUrl);
  for (const [key, value] of Object.entries({ card: cardId, view, ...state, palette: "linen", theme: "dark" })) {
    url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  return url.href;
}

async function makePage(t, { family, gallery = false, touch = false, width = touch ? 390 : 1440, corrupt = null } = {}) {
  const context = await browser.newContext({
    viewport: { width, height: touch ? 844 : 900 },
    reducedMotion: "reduce", hasTouch: touch, isMobile: touch,
  });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on("pageerror", error => pageErrors.push(error.message));
  if (corrupt !== null) await page.addInitScript(({ key, text }) => localStorage.setItem(key, text), { key: storageKey, text: corrupt });
  await page.goto(gallery ? new URL("/?theme=dark&palette=linen", baseUrl).href : urlFor(family), { waitUntil: "networkidle" });
  await ready(page);
  await page.mouse.move(380, 400);
  return page;
}

async function ready(page) {
  await page.waitForFunction(() => document.querySelector("[data-market-strip]").dataset.state !== "loading");
  await page.waitForFunction(() => [...document.querySelectorAll("[data-card-market-pin]")].some(button => !button.disabled));
  assert.equal(await page.locator("[data-market-strip-pin], [data-market-strip-toggle]").count(), 0, "Bottom pin/pause controls must be removed");
  assert.equal(await page.locator(pinSelector).count(), 1, "Pin action must exist only once in the Save dialog");
  assert.equal(await page.locator(`[data-save-dialog] ${pinSelector}`).count(), 1);
  assert.equal(await page.locator(`[data-card-compare-panel] ${pinSelector}, [data-depth-view-menu] ${pinSelector}`).count(), 0, "Craft Data/View menus still contain a pin action");
}

async function savePinAction(page, { touch = false } = {}) {
  const trigger = page.locator("[data-card-save]:visible");
  await trigger.waitFor({ state: "visible" });
  if (!(await page.locator("[data-save-dialog]").evaluate(dialog => dialog.open))) {
    if (touch) await trigger.tap();
    else await trigger.click();
  }
  assert(await page.locator("[data-save-dialog]").evaluate(dialog => dialog.matches(":modal")), "Save dialog is not modal");
  const action = page.locator(`[data-save-dialog] ${pinSelector}`);
  await action.waitFor({ state: "visible" });
  assert.equal(await action.getAttribute("type"), "button", "Pinning must not submit the Save form");
  assert(await page.locator("[data-save-dialog]").evaluate(dialog => {
    const rect = dialog.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight &&
      [...dialog.querySelectorAll("footer button")].every(button => {
        const box = button.getBoundingClientRect();
        return box.left >= rect.left && box.right <= rect.right && box.top >= rect.top && box.bottom <= rect.bottom;
      });
  }), "Save dialog or footer actions overflow the viewport");
  return action;
}

async function closeSaveDialog(page, touch = false) {
  const cancel = page.locator("[data-save-cancel]");
  if (touch) await cancel.tap();
  else await cancel.click();
  await page.locator("[data-save-dialog]").waitFor({ state: "hidden" });
}

async function pinFromSaveDialog(page, { touch = false, label = "Pin to strip", succeeds = true, keepOpen = false } = {}) {
  const catalog = await catalogSnapshot(page);
  const action = await savePinAction(page, { touch });
  assert.equal((await action.innerText()).trim(), label);
  assert(await action.isEnabled());
  if (label === "Pin to strip" && new URL(page.url()).searchParams.get("card") === "gpu-index") {
    const device = touch ? page.viewportSize().width === 320 ? "320" : "touch" : "desktop";
    await page.screenshot({ path: join(screenshotDir, `desk-market-pin-save-${device}.png`) });
  }
  // Pinning is independent of Catalog naming/validation and must not submit Save.
  await page.locator("[data-save-name]").fill("");
  const submissions = await page.evaluate(() => {
    window.__watchlistSaveSubmissions ??= 0;
    if (!window.__watchlistSaveObserved) {
      document.querySelector("[data-save-form]").addEventListener("submit", () => { window.__watchlistSaveSubmissions++; });
      window.__watchlistSaveObserved = true;
    }
    return window.__watchlistSaveSubmissions;
  });
  if (touch) await action.tap();
  else await action.click();
  assert(await page.locator("[data-save-dialog]").evaluate(dialog => dialog.open && dialog.matches(":modal")), "Pinning dismissed the Save dialog");
  assert.equal(await page.evaluate(() => window.__watchlistSaveSubmissions), submissions, "Pin action submitted the Save form");
  assert.notEqual(await page.locator("[data-save-name]").getAttribute("aria-invalid"), "true", "Pinning incorrectly validated the blank Catalog name");
  assert.deepEqual(await catalogSnapshot(page), catalog, "Pin action created or changed a Catalog entry");
  if (succeeds) assert.equal((await action.innerText()).trim(), label === "Pin to strip" ? "Unpin" : "Pin to strip");
  if (!keepOpen) await closeSaveDialog(page, touch);
}

async function commandPinAction(page) {
  await page.keyboard.press("Meta+g");
  await page.locator("[data-command-palette]").waitFor({ state: "visible" });
  if (await page.locator("[data-desk-login]").isVisible()) {
    await page.locator("[data-desk-login]").focus();
    await page.keyboard.press("Enter");
  }
  await page.locator("[data-command-input]").fill("actions");
  const copy = page.locator("#desk-command-actions-copy-card-link");
  await copy.waitFor({ state: "visible" });
  await page.locator(commandPinSelector).waitFor({ state: "visible" });
  assert.equal(await copy.isDisabled(), await page.locator(commandPinSelector).isDisabled(), "Pin and Copy view link have different availability");
  await page.locator("[data-command-input]").fill("strip");
  const action = page.locator(commandPinSelector);
  await action.waitFor({ state: "visible" });
  return action;
}

async function assertPinLabel(page, label) {
  assert(await page.locator(pinSelector).evaluateAll((buttons, expected) => buttons.length > 0 && buttons.every(button => button.textContent.trim() === expected), label));
}

async function rawStorage(page) {
  return page.evaluate(key => localStorage.getItem(key), storageKey);
}

async function savedItems(page) {
  const text = await rawStorage(page);
  assert(text !== null, "An explicit edit must persist the watchlist");
  const envelope = JSON.parse(text);
  assert.equal(envelope.version, 1);
  return envelope.items;
}

async function visibleIds(page) {
  return page.locator(itemSelector).evaluateAll(items => items.map(item => item.dataset.marketInstrument));
}

async function catalogSnapshot(page) {
  return page.evaluate(() => ({
    storage: Object.fromEntries(Object.keys(localStorage).filter(key => /^desk\.catalog(?:[.-]|$)/.test(key)).sort().map(key => [key, localStorage.getItem(key)])),
    cards: [...document.querySelectorAll(".desk-gallery-card")].map(card => [card.dataset.catalogId, card.getAttribute("aria-label")]),
  }));
}

async function markDocument(page) {
  return page.evaluate(() => {
    window.__watchlistDocumentToken = crypto.randomUUID();
    window.__watchlistDocumentNode = document.documentElement;
    return window.__watchlistDocumentToken;
  });
}

async function assertSameDocument(page, token) {
  assert(await page.evaluate(expected => window.__watchlistDocumentToken === expected && window.__watchlistDocumentNode === document.documentElement, token), "Watchlist action reloaded the document");
}

async function showPreview(page, id) {
  const target = page.locator(`[data-market-instrument="${id}"] button`);
  await target.scrollIntoViewIfNeeded();
  // Closing the preview deliberately returns focus without reopening it.
  // Re-enter through a real focus transition rather than refocusing the same node.
  if (await target.evaluate(element => document.activeElement === element)) {
    await page.locator("[data-command-open]").focus();
  }
  await target.focus();
  await page.waitForFunction(expected => {
    const preview = document.querySelector("[data-market-preview]");
    return !preview.hidden && preview.dataset.instrument === expected;
  }, id);
  assert.equal((await page.locator("[data-market-preview-remove]").innerText()).trim(), "Unpin");
}

async function waitForCount(page, count) {
  await page.waitForFunction(expected => document.querySelectorAll("[data-market-instrument]").length === expected, count);
}

async function assertMonitorState(page, family) {
  await page.waitForFunction(({ cardId, state }) => {
    const url = new URL(location.href);
    return document.documentElement.dataset.deskView === "monitor" && url.searchParams.get("card") === cardId &&
      Object.entries(state).every(([key, value]) => url.searchParams.get(key) === (Array.isArray(value) ? value.join(",") : String(value)));
  }, family);
  const url = new URL(page.url());
  assert.equal(url.searchParams.get("view"), "monitor");
  for (const [key, value] of Object.entries(family.state)) {
    assert.equal(url.searchParams.get(key), Array.isArray(value) ? value.join(",") : String(value), `Monitor did not restore ${key}`);
  }
}

test("five default pins are available and stable across a fresh reload", async t => {
  const page = await makePage(t);
  assert.deepEqual(await visibleIds(page), defaultIds);
  await assertPinLabel(page, "Unpin");
  await page.reload({ waitUntil: "networkidle" });
  await ready(page);
  assert.deepEqual(await visibleIds(page), defaultIds);
  assert.equal(await page.locator("[data-market-preview]").count(), 1);
});

for (const family of families) {
  test(`${family.cardId}: pin, reload, preview and restore the exact current chart without document navigation`, async t => {
    const page = await makePage(t, { family: { ...family, view: "craft" } });
    const catalog = await catalogSnapshot(page), originalUrl = page.url();
    const token = await markDocument(page);
    await pinFromSaveDialog(page);
    await waitForCount(page, 6);
    const items = await savedItems(page), pinned = items.find(item => !defaultIds.includes(item.id));
    assert(pinned, "The current composition did not receive a new pin");
    assert.equal(pinned.cardId, family.cardId);
    assert.deepEqual(pinned.state, { ...family.state, palette: "linen", theme: "dark" });
    assert(pinned.label.trim().length > 0);
    await assertPinLabel(page, "Unpin");
    assert.equal(page.url(), originalUrl, "Pinning changed the current workspace URL");
    assert.deepEqual(await catalogSnapshot(page), catalog, "Pinning modified Catalog");
    await assertSameDocument(page, token);

    await page.reload({ waitUntil: "networkidle" });
    await ready(page);
    assert.deepEqual(await savedItems(page), items, "Reload changed the authored pin snapshot");
    assert((await visibleIds(page)).includes(pinned.id));
    const reopenedToken = await markDocument(page);
    await page.locator('[data-market-instrument="H200"] button').click();
    await assertMonitorState(page, { cardId: "gpu-index", state: { gpu: "H200", layers: ["H200"], scale: "price", range: "7d" } });
    await showPreview(page, pinned.id);
    assert(await page.locator("[data-market-preview-open] svg, [data-market-preview-open] .deal-view").count() > 0, "The preview has no chart artifact");
    if (["deal-view", "power-basis"].includes(family.cardId)) {
      await page.screenshot({ path: join(screenshotDir, `desk-market-watchlist-${family.cardId}-preview.png`) });
    }
    const previewBounds = await page.locator("[data-market-preview]").evaluate(preview => {
      const box = element => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, height: rect.height };
      };
      return {
        preview: box(preview), chart: box(preview.querySelector("[data-market-preview-open]")),
        remove: box(preview.querySelector("[data-market-preview-remove]")),
        deal: preview.querySelector(".deal-view") ? box(preview.querySelector(".deal-view")) : null,
      };
    });
    assert(previewBounds.remove.top >= previewBounds.chart.bottom - 1 && previewBounds.remove.bottom <= previewBounds.preview.bottom + 1, `Unpin action is clipped or overlaps the chart: ${JSON.stringify(previewBounds)}`);
    if (previewBounds.deal) assert(previewBounds.deal.bottom <= previewBounds.chart.bottom + 1, `Deal/Quote artifact paints beyond its chart slot: ${JSON.stringify(previewBounds)}`);
    await page.locator("[data-market-preview-open]").click();
    await assertMonitorState(page, family);
    await assertSameDocument(page, reopenedToken);
    await assertPinLabel(page, "Unpin");
    assert.deepEqual(await savedItems(page), items);

    await showPreview(page, pinned.id);
    const beforeRemoval = await catalogSnapshot(page), removalUrl = page.url();
    await page.locator("[data-market-preview-remove]").click();
    await waitForCount(page, 5);
    assert(!(await savedItems(page)).some(item => item.id === pinned.id));
    assert.equal(page.url(), removalUrl, "Removing a pin navigated away from its chart");
    assert.deepEqual(await catalogSnapshot(page), beforeRemoval, "Removing a pin modified Catalog");
    await assertSameDocument(page, reopenedToken);
  });
}

test("removing every pin leaves Catalog untouched and an empty list persists after reload", async t => {
  const page = await makePage(t, { gallery: true });
  const catalog = await catalogSnapshot(page), url = page.url(), token = await markDocument(page);
  assert(catalog.cards.length > 0);
  for (const [index, id] of defaultIds.entries()) {
    await showPreview(page, id);
    await page.locator("[data-market-preview-remove]").click();
    await waitForCount(page, defaultIds.length - index - 1);
  }
  assert.deepEqual(await savedItems(page), []);
  assert.equal(await page.locator("[data-market-strip]").getAttribute("data-state"), "empty");
  assert.match(await page.locator("[data-market-strip]").innerText(), /No pinned charts/);
  assert.deepEqual(await catalogSnapshot(page), catalog);
  assert.equal(page.url(), url);
  await assertSameDocument(page, token);
  await page.reload({ waitUntil: "networkidle" });
  await ready(page);
  assert.deepEqual(await visibleIds(page), []);
  assert.deepEqual(await savedItems(page), []);
  assert.deepEqual(await catalogSnapshot(page), catalog);
});

for (const width of [390, 320]) test(`touch Save-dialog Pin/Unpin is independent of Catalog Save and leaves the dialog open (${width}px)`, async t => {
  const page = await makePage(t, { family: { ...families[0], view: "craft" }, touch: true, width });
  const catalog = await catalogSnapshot(page), url = page.url(), token = await markDocument(page);
  await pinFromSaveDialog(page, { touch: true });
  await waitForCount(page, 6);
  const pinned = (await savedItems(page)).find(item => !defaultIds.includes(item.id));
  assert.deepEqual(pinned.state, { ...families[0].state, palette: "linen", theme: "dark" });
  await assertPinLabel(page, "Unpin");
  assert(await page.locator("[data-market-preview]").isHidden());
  await pinFromSaveDialog(page, { touch: true, label: "Unpin" });
  await waitForCount(page, 5);
  await assertPinLabel(page, "Pin to strip");
  assert.deepEqual(await visibleIds(page), defaultIds);
  assert.deepEqual(await catalogSnapshot(page), catalog);
  assert.equal(page.url(), url);
  await assertSameDocument(page, token);
});

test("Save still validates its name and saves to Catalog independently of a typed-label pin", async t => {
  const page = await makePage(t, { family: { ...families[0], view: "craft" } });
  const catalog = await catalogSnapshot(page);
  const pin = await savePinAction(page);
  await page.locator("[data-save-name]").fill("QA watchlist label");
  await pin.click();
  await waitForCount(page, 6);
  const pins = await savedItems(page), pinned = pins.find(item => !defaultIds.includes(item.id));
  assert.equal(pinned.label, "QA watchlist label", "Pinning ignored the typed label");
  assert.deepEqual(await catalogSnapshot(page), catalog);
  assert(await page.locator("[data-save-dialog]").evaluate(dialog => dialog.open));

  await page.locator("[data-save-name]").fill("");
  await page.locator("[data-save-submit]").click();
  assert.match(await page.locator("[data-save-error]").innerText(), /Enter a name/);
  assert(await page.locator("[data-save-dialog]").evaluate(dialog => dialog.open));
  assert.deepEqual(await catalogSnapshot(page), catalog, "Blank-name Save changed Catalog");
  assert.deepEqual(await savedItems(page), pins);

  await page.locator("[data-save-name]").fill("QA Catalog view");
  await page.locator("[data-save-submit]").click();
  await page.locator("[data-save-dialog]").waitFor({ state: "hidden" });
  const documents = await page.evaluate(() => JSON.parse(localStorage.getItem("desk.catalog.v2")).items);
  assert.equal(documents.length, 1);
  assert.equal(documents[0].name, "QA Catalog view");
  assert.deepEqual(await savedItems(page), pins, "Catalog Save added or altered a watchlist pin");
});

test("empty Craft disables pinning without changing saved pins", async t => {
  const page = await makePage(t);
  const storage = await rawStorage(page), ids = await visibleIds(page);
  await page.locator('[data-desk-mode="craft"]').click();
  await page.locator(".gpu-benchmark__craft-empty").waitFor({ state: "visible" });
  assert(await page.locator(pinSelector).evaluateAll(buttons => buttons.length > 0 && buttons.every(button => button.disabled)));
  assert.equal(await page.locator(`${pinSelector}:visible`).count(), 0, "Empty Craft exposes a pin action");
  const command = await commandPinAction(page);
  assert(await command.isDisabled(), "Empty Craft command can pin a nonexistent composition");
  await page.keyboard.press("Enter");
  assert.equal(await rawStorage(page), storage);
  assert.deepEqual(await visibleIds(page), ids);
  await page.keyboard.press("Escape");
});

test("Monitor keeps Pin to strip and Unpin in the existing command menu", async t => {
  const page = await makePage(t, { family: families[0] });
  const catalog = await catalogSnapshot(page), url = page.url(), token = await markDocument(page);
  const pin = await commandPinAction(page);
  assert.match(await pin.innerText(), /Pin to strip/);
  await pin.click();
  await waitForCount(page, 6);
  const unpin = await commandPinAction(page);
  assert.match(await unpin.innerText(), /Unpin/);
  await unpin.click();
  await waitForCount(page, 5);
  assert.deepEqual(await visibleIds(page), defaultIds);
  assert.deepEqual(await catalogSnapshot(page), catalog);
  assert.equal(page.url(), url);
  await assertSameDocument(page, token);
});

for (const failure of ["quota", "corrupt"]) {
  test(`${failure} storage rejects edits atomically and exposes an error without touching Catalog`, async t => {
    const corrupt = failure === "corrupt" ? '{"version":1,"items":broken' : null;
    const page = await makePage(t, { family: { ...families[0], view: "craft" }, corrupt });
    const storage = await rawStorage(page), ids = await visibleIds(page), catalog = await catalogSnapshot(page), url = page.url();
    if (failure === "quota") await page.evaluate(key => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(name, value) {
        if (name === key) throw new DOMException("Watchlist storage quota exceeded", "QuotaExceededError");
        return original.call(this, name, value);
      };
    }, storageKey);
    await pinFromSaveDialog(page, { succeeds: false, keepOpen: true });
    const notice = page.locator("[data-save-dialog] [data-save-error]");
    await notice.waitFor({ state: "visible" });
    assert.match(await notice.innerText(), failure === "quota" ? /quota/i : /invalid/i);
    assert.equal(await rawStorage(page), storage, "Failed pin overwrote the stored envelope");
    assert.deepEqual(await visibleIds(page), ids, "Failed pin changed the visible list");
    await assertPinLabel(page, "Pin to strip");
    assert(await page.locator("[data-save-dialog]").evaluate(dialog => dialog.open), "Storage failure dismissed the Save dialog");
    await closeSaveDialog(page);
    await showPreview(page, "H100");
    await page.locator("[data-market-preview-remove]").click();
    assert.equal(await rawStorage(page), storage, "Failed removal overwrote the stored envelope");
    assert.deepEqual(await visibleIds(page), ids);
    assert.deepEqual(await catalogSnapshot(page), catalog);
    assert.equal(page.url(), url);
  });
}

test("watchlist interactions produce no uncaught browser errors", () => {
  assert.deepEqual(pageErrors, []);
});
