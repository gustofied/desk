import assert from "node:assert/strict";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after, before } from "node:test";
import { createCardDocument, normalizeCardVisualization } from "../../src/card-document.js";
import { createSharedDesk, encodeSharedDesk, readSharedDeskUrl } from "../../src/shared-desk.js";

// Run against an already-running Desk preview; installs no packages or browsers.
// node --test tests/browser/shared-desk.test.mjs
// Optional: DESK_PLAYWRIGHT_MODULE, DESK_BROWSER_ENGINE (chromium/webkit),
// DESK_BROWSER_PATH, DESK_BASE_URL, DESK_SCREENSHOT_DIR.
const moduleName = process.env.DESK_PLAYWRIGHT_MODULE || "playwright";
const playwright = await import(isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const engineName = process.env.DESK_BROWSER_ENGINE || "chromium";
assert(["chromium", "webkit"].includes(engineName), "Use chromium or webkit for DESK_BROWSER_ENGINE");
const baseUrl = process.env.DESK_BASE_URL || "http://127.0.0.1:4173";
const savedKey = "desk.catalog.v2";
const collectionsKey = "desk.catalog-collections.v1";
const date = "2026-09-06T12:00:00.000Z";
const gallerySelector = "[data-card-gallery-grid] .desk-gallery-card";
const pageErrors = [];
const entries = [
  { cardId: "power-basis", name: "PJM basis week", state: { location: "PJM-WEST", scale: "basis", range: "7d" } },
  { cardId: "deal-view", name: "B300 October capacity", state: { gpu: "B300", quantity: 1024, quote: 6.45, rfs: "2027-10" } },
  { cardId: "gpu-index", name: "H100 and B200 spread", state: { gpu: "H100", layers: ["H100", "B200"], scale: "spread", range: "all" } },
  { cardId: "gpu-market-depth", name: "H100 historic depth", state: { gpu: "H100", layers: ["H100"], scale: "history", range: "now", target: "256" } },
  { cardId: "gpu-price-snapshot", name: "H200 and B300 prices", state: { gpu: "B300", layers: ["H200", "B300"], scale: "price", range: "1d" } },
].map(entry => ({ ...entry, state: normalizeCardVisualization(entry.cardId, { ...entry.state, palette: "sage", theme: "light" }) }));
const quote = {
  cardId: "quote-view", name: "Private H200 quote",
  state: normalizeCardVisualization("quote-view", { gpu: "H200", quantity: 512, quote: 4.25, rfs: "2027-04", palette: "sage", theme: "light" }),
};
let browser;

before(async () => {
  browser = await playwright[engineName].launch({
    headless: true,
    ...(process.env.DESK_BROWSER_PATH ? { executablePath: process.env.DESK_BROWSER_PATH } : {}),
  });
});
after(async () => { await browser?.close(); });

function localFixture({ name = "Source research", id = "source-research", views = entries } = {}) {
  const documents = views.map((entry, index) => createCardDocument({
    ...entry, id: `${id}-view-${index}`, createdAt: date, updatedAt: date,
  }));
  const collection = {
    id, name, keys: documents.map(document => `saved-${document.cardId}-${document.id}`),
    createdAt: date, updatedAt: date,
  };
  return {
    [savedKey]: JSON.stringify({ version: 2, items: documents, documentSchema: "desk.card", documentVersion: 1 }),
    [collectionsKey]: JSON.stringify({ version: 8, activeId: id, collections: [collection] }),
  };
}

function recipientFixture() {
  return localFixture({
    name: "My existing local desk", id: "existing-local",
    views: [{ cardId: "gpu-index", name: "My own B300 chart", state: { gpu: "B300", layers: ["B300"], scale: "price", range: "1d" } }],
  });
}

function galleryUrl() {
  return new URL("/?view=gallery&palette=sage&theme=light", baseUrl).href;
}

function sharedUrl(snapshot) {
  const url = new URL("/?view=gallery", baseUrl);
  url.hash = `desk=${encodeSharedDesk(createSharedDesk(snapshot, { includePrivate: true }))}`;
  return url.href;
}

function decodeLink(url) {
  const parsed = readSharedDeskUrl(url);
  assert(parsed && !parsed.error, "The generated link must decode without an error");
  return parsed.snapshot;
}

async function makePage(t, { url = galleryUrl(), storage = localFixture(), width = 1440, clipboardFailure = false } = {}) {
  const context = await browser.newContext({
    viewport: { width, height: width <= 390 ? 844 : 1000 },
    reducedMotion: "reduce", hasTouch: width <= 390, isMobile: width <= 390,
  });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", error => pageErrors.push(`${engineName}/${width}: ${error.message}`));
  await page.addInitScript(({ storage, clipboardFailure }) => {
    // Seed once: reloads must observe actual writes, not reset the fixture.
    if (!sessionStorage.getItem("shared-desk-browser-fixture")) {
      for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
      sessionStorage.setItem("shared-desk-browser-fixture", "ready");
    }
    if (clipboardFailure) Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => { throw new DOMException("Clipboard denied", "NotAllowedError"); } },
    });
  }, { storage, clipboardFailure });
  await page.goto(url, { waitUntil: "networkidle" });
  await ready(page);
  return page;
}

async function ready(page) {
  await page.waitForFunction(() => document.querySelector('[data-card-ready="true"]'));
}

async function catalogStorage(page) {
  return page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), [savedKey, collectionsKey]);
}

async function openCommand(page, id, query) {
  await page.keyboard.press("Meta+g");
  await page.locator("[data-command-palette]").waitFor({ state: "visible" });
  if (await page.locator("[data-desk-login]").isVisible()) {
    await page.locator("[data-desk-login]").focus();
    await page.keyboard.press("Enter");
  }
  await page.locator("[data-command-input]").fill(query);
  const command = page.locator(`#desk-command-${id.replaceAll(".", "-")}`);
  await command.waitFor({ state: "visible" });
  assert(await command.isEnabled(), `${query} command is disabled`);
  await command.click();
}

async function openShare(page) {
  await openCommand(page, "actions.share-desk", "Share desk");
  await page.locator("[data-desk-share-dialog]").waitFor({ state: "visible" });
  assert(await page.locator("[data-desk-share-dialog]").evaluate(dialog => dialog.open && dialog.matches(":modal")), "Share desk is not a modal dialog");
}

async function createLink(page, { name = "Five view research desk", includePrivate = false, screenshot = false } = {}) {
  await openShare(page);
  await page.locator("[data-desk-share-name]").fill(name);
  await page.locator("[data-desk-share-private]").setChecked(includePrivate);
  if (screenshot && process.env.DESK_SCREENSHOT_DIR) {
    await page.screenshot({ path: join(process.env.DESK_SCREENSHOT_DIR, `desk-share-modal-${engineName}-${page.viewportSize().width}.png`) });
  }
  await page.locator("[data-desk-share-submit]").click();
  await page.waitForFunction(() => document.querySelector("[data-desk-share-link]")?.value.includes("#desk="));
  const input = page.locator("[data-desk-share-link]");
  assert(await input.isVisible(), "The generated link must be available even if the clipboard is unavailable");
  assert(await input.evaluate(element => element.readOnly));
  const url = await input.inputValue();
  assert.equal(new URL(url).searchParams.get("view"), "gallery");
  assert.match(new URL(url).hash, /^#desk=[a-zA-Z0-9_-]+$/);
  return url;
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

async function assertGallery(page, snapshot) {
  await showGallery(page);
  await page.waitForFunction(count => document.querySelectorAll("[data-card-gallery-grid] .desk-gallery-card").length === count, snapshot.entries.length);
  const labels = await page.locator(gallerySelector).evaluateAll(cards => cards.map(card => card.getAttribute("aria-label")));
  for (const [index, entry] of snapshot.entries.entries()) {
    assert(labels[index].startsWith(`Monitor ${entry.name}`), `View ${index + 1} lost its name or collection order: ${labels[index]}`);
  }
  await page.waitForFunction(() => [...document.querySelectorAll("[data-card-gallery-grid] .desk-gallery-card")].every(card => {
    const svg = card.querySelector("[data-gallery-artifact]");
    return svg ? svg.querySelectorAll("path, rect, line, text").length > 0 : Boolean(card.querySelector(".deal-view"));
  }));
  assert.deepEqual(await page.evaluate(() => ({ palette: document.documentElement.dataset.palette, theme: document.documentElement.dataset.theme })), { palette: snapshot.palette, theme: snapshot.theme });
}

async function selectCollection(page, id) {
  await showGallery(page);
  await page.locator("[data-catalog-switcher]").focus();
  await page.keyboard.press("ArrowDown");
  await page.locator(`[data-catalog-collection="${id}"]`).click();
}

async function assertMonitor(page, entry, hash) {
  await page.waitForFunction(({ cardId, state }) => {
    const url = new URL(location.href);
    return document.documentElement.dataset.deskView === "monitor" &&
      document.querySelector("[data-gpu-benchmark-card]")?.dataset.cardId === cardId &&
      url.searchParams.get("card") === cardId && Object.entries(state).every(([key, value]) =>
        url.searchParams.get(key) === (Array.isArray(value) ? value.join(",") : String(value)));
  }, entry);
  assert.equal(new URL(page.url()).hash, hash, "Navigating a shared view lost its desk snapshot");
}

for (const width of [1440, 390]) {
  test(`five mixed views share, render, navigate, reload and save without overwriting local work (${engineName}, ${width}px)`, async t => {
    const source = await makePage(t, { width });
    const originalSource = await catalogStorage(source);
    const link = await createLink(source, { includePrivate: true, screenshot: true });
    const snapshot = decodeLink(link);
    assert.deepEqual(snapshot.entries, entries, "Sharing changed collection order, labels or settings");
    assert.equal(snapshot.name, "Five view research desk");
    assert.equal(snapshot.palette, "sage");
    assert.equal(snapshot.theme, "light");
    assert.deepEqual(await catalogStorage(source), originalSource, "Creating a link changed the author's Catalog");

    const existing = recipientFixture();
    const page = await makePage(t, { url: link, storage: existing, width });
    await page.locator("[data-shared-desk-banner]").waitFor({ state: "visible" });
    assert((await page.locator("[data-shared-desk-name]").innerText()).trim().startsWith(snapshot.name));
    await assertGallery(page, snapshot);
    assert.deepEqual(await catalogStorage(page), existing, "Opening a shared desk imported it automatically");
    if (process.env.DESK_SCREENSHOT_DIR) {
      await page.screenshot({ path: join(process.env.DESK_SCREENSHOT_DIR, `desk-shared-${engineName}-${width}.png`) });
    }
    const hash = new URL(link).hash;
    for (const [index, entry] of snapshot.entries.entries()) {
      await page.locator(gallerySelector).nth(index).click();
      await assertMonitor(page, entry, hash);
      if (index === 0 && process.env.DESK_SCREENSHOT_DIR) {
        await page.screenshot({ path: join(process.env.DESK_SCREENSHOT_DIR, `desk-shared-monitor-${engineName}-${width}.png`) });
      }
      await page.reload({ waitUntil: "networkidle" });
      await ready(page);
      await assertMonitor(page, entry, hash);
      await assertGallery(page, snapshot);
      assert.equal(new URL(page.url()).hash, hash);
      assert.deepEqual(await catalogStorage(page), existing, "Browsing/reloading a shared desk changed existing local data");
    }

    if (width === 1440) await page.locator("[data-shared-desk-save]").click();
    else await openCommand(page, "actions.save-desk-copy", "Save a copy");
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).collections.length === 2, collectionsKey);
    const stored = await catalogStorage(page);
    assert.equal(stored[savedKey], existing[savedKey], "Save a copy overwrote the existing saved views");
    const envelope = JSON.parse(stored[collectionsKey]);
    const previous = JSON.parse(existing[collectionsKey]);
    assert.equal(envelope.version, 8);
    assert.deepEqual(envelope.collections[0], previous.collections[0], "Save a copy changed an existing collection");
    const saved = envelope.collections[1];
    assert.notEqual(saved.id, previous.collections[0].id);
    assert.equal(saved.name, snapshot.name);
    assert.equal(saved.palette, snapshot.palette);
    assert.equal(saved.theme, snapshot.theme);
    assert.equal(new Set(saved.keys).size, snapshot.entries.length);
    assert(saved.keys.every(key => !previous.collections[0].keys.includes(key)), "Saved copy reused local view keys");
    assert.deepEqual(saved.keys, saved.views.map(view => view.key));
    assert.deepEqual(saved.views.map(({ cardId, name, state }) => ({ cardId, name, state })), snapshot.entries);

    // Reopen through the ordinary Catalog, with no shared payload in the URL.
    await page.goto(galleryUrl(), { waitUntil: "networkidle" });
    await ready(page);
    await selectCollection(page, saved.id);
    await assertGallery(page, snapshot);
    await page.reload({ waitUntil: "networkidle" });
    await ready(page);
    await assertGallery(page, snapshot);
    assert(!new URL(page.url()).hash.startsWith("#desk="));
    assert.deepEqual(await catalogStorage(page), stored, "Reload changed the persisted copy");
  });
}

test(`opening a shared desk in a fresh browser leaves Catalog and personal appearance untouched until saving (${engineName})`, async t => {
  const snapshot = { name: "Fresh browser shared desk", entries, palette: "sage", theme: "light" };
  const personalAppearance = { "desk-theme": "dark", "desk-palette": "azure" };
  const page = await makePage(t, { url: sharedUrl(snapshot), storage: personalAppearance });
  const emptyCatalog = { [savedKey]: null, [collectionsKey]: null };
  await assertGallery(page, snapshot);
  assert.deepEqual(await catalogStorage(page), emptyCatalog, "Opening a shared desk seeded a fresh local Catalog");
  await page.reload({ waitUntil: "networkidle" });
  await ready(page);
  await assertGallery(page, snapshot);
  assert.deepEqual(await catalogStorage(page), emptyCatalog);
  const readAppearance = () => page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), Object.keys(personalAppearance));
  assert.deepEqual(await readAppearance(), personalAppearance, "Shared appearance overwrote personal preferences");
  await page.locator("[data-shared-desk-save]").click();
  await page.waitForFunction(key => localStorage.getItem(key) !== null, collectionsKey);
  const stored = await catalogStorage(page);
  assert.equal(stored[savedKey], null);
  const saved = JSON.parse(stored[collectionsKey]).collections.find(collection => collection.name === snapshot.name);
  assert(saved, "Explicit Save a copy did not persist the new shared collection");
  assert.deepEqual(saved.views.map(({ cardId, name, state }) => ({ cardId, name, state })), entries);
  assert.deepEqual(await readAppearance(), personalAppearance);
});

test(`private Quotes and Deals are omitted by default and require a fresh opt-in (${engineName})`, async t => {
  const privateEntries = [entries[2], quote, entries[1]];
  const page = await makePage(t, { storage: localFixture({ views: privateEntries }) });
  const original = await catalogStorage(page);
  await openShare(page);
  assert(!(await page.locator("[data-desk-share-private]").isChecked()));
  assert.match(await page.locator("[data-desk-share-count]").innerText(), /\b1\b/);
  await page.locator("[data-desk-share-submit]").click();
  await page.waitForFunction(() => document.querySelector("[data-desk-share-link]")?.value.includes("#desk="));
  assert.deepEqual(decodeLink(await page.locator("[data-desk-share-link]").inputValue()).entries, [entries[2]]);
  await page.locator("[data-desk-share-cancel]").click();

  const optedInLink = await createLink(page, { includePrivate: true });
  assert.deepEqual(decodeLink(optedInLink).entries, privateEntries);
  await page.locator("[data-desk-share-cancel]").click();
  await openShare(page);
  assert(!(await page.locator("[data-desk-share-private]").isChecked()), "Previous private-sharing consent leaked into a new share");
  assert.deepEqual(await catalogStorage(page), original);
});

test(`clipboard denial leaves a usable generated URL (${engineName})`, async t => {
  const page = await makePage(t, { clipboardFailure: true });
  const link = await createLink(page);
  assert.equal(decodeLink(link).entries.length, 4);
  const receiver = await makePage(t, { url: link, storage: recipientFixture() });
  await assertGallery(receiver, decodeLink(link));
});

test(`invalid shared links show feedback and never import or enable a copy (${engineName})`, async t => {
  const storage = recipientFixture();
  const invalidPayloads = [
    "!invalid-base64!",
    Buffer.from("{broken json").toString("base64url"),
    Buffer.from(JSON.stringify({ version: 999, name: "Future desk", entries, palette: "sage", theme: "light" })).toString("base64url"),
    Buffer.from(JSON.stringify({ version: 1, name: "Unknown view", entries: [{ cardId: "unknown-view", name: "Bad view", state: {} }], palette: "sage", theme: "light" })).toString("base64url"),
  ];
  const page = await makePage(t, { storage });
  for (const payload of invalidPayloads) {
    await page.goto(new URL(`/?view=gallery#desk=${payload}`, baseUrl).href, { waitUntil: "networkidle" });
    await ready(page);
    const error = page.locator("[data-shared-desk-error]");
    await error.waitFor({ state: "visible" });
    assert((await error.innerText()).trim().length > 0, "Invalid shared URL has no explanation");
    const save = page.locator("[data-shared-desk-save]");
    assert(!(await save.isVisible()) || await save.isDisabled(), "Invalid shared data can be saved");
    assert.deepEqual(await catalogStorage(page), storage, "Invalid shared data changed local storage");
  }
});

test(`shared desk and view names render as text, including after saving (${engineName})`, async t => {
  const snapshot = {
    name: "<svg onload=window.__sharedXss=1>", palette: "sand", theme: "dark",
    entries: [{ ...entries[2], name: "<img src=x onerror=window.__sharedXss=2>" }],
  };
  const page = await makePage(t, { url: sharedUrl(snapshot), storage: recipientFixture() });
  await assertGallery(page, snapshot);
  assert((await page.locator("[data-shared-desk-name]").textContent()).startsWith(snapshot.name));
  assert.equal(await page.locator("[data-shared-desk-name] svg, [data-shared-desk-name] img").count(), 0);
  assert.equal(await page.locator("[data-card-gallery-grid] img[onerror], [data-card-gallery-grid] svg[onload]").count(), 0);
  assert.equal(await page.evaluate(() => window.__sharedXss), undefined, "A shared name executed as markup");
  await page.locator("[data-shared-desk-save]").click();
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).collections.length === 2, collectionsKey);
  const saved = JSON.parse((await catalogStorage(page))[collectionsKey]).collections.at(-1);
  assert.equal(saved.name, snapshot.name);
  assert.equal(saved.views[0].name, snapshot.entries[0].name);
  await page.goto(galleryUrl(), { waitUntil: "networkidle" });
  await ready(page);
  await showGallery(page);
  await page.locator("[data-catalog-switcher]").focus();
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.locator(`[data-catalog-collection="${saved.id}"] svg[onload]`).count(), 0);
  await page.locator(`[data-catalog-collection="${saved.id}"]`).click();
  assert.equal(await page.evaluate(() => window.__sharedXss), undefined);
});

test(`ordinary single-view links still open their exact settings without a shared desk (${engineName})`, async t => {
  const entry = { ...entries[2], state: { ...entries[2].state, palette: "linen", theme: "dark" } };
  const url = new URL("/", baseUrl);
  for (const [key, value] of Object.entries({ card: entry.cardId, view: "monitor", ...entry.state, palette: "linen", theme: "dark" })) {
    url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  const storage = recipientFixture();
  const page = await makePage(t, { url: url.href, storage });
  await assertMonitor(page, entry, "#gpu-benchmark-card");
  assert(!(await page.locator("[data-shared-desk-banner]").isVisible()));
  assert(!(await page.locator("[data-shared-desk-error]").isVisible()));
  assert.deepEqual(await catalogStorage(page), storage);
});

test(`shared desk workflows raise no uncaught browser errors (${engineName})`, () => {
  assert.deepEqual(pageErrors, []);
});
