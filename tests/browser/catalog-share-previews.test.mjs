import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after, before } from "node:test";
import { cardStateParamIds, getCardDefinition, publishedCardSharePath, SHARE_COPY_VERSION } from "../../src/card-registry.js";
import { normalizeCardVisualization } from "../../src/card-document.js";

// Local generated pages and disposable browser storage only. Clipboard writes
// are captured in the test page; neither the OS clipboard nor user tabs change.
const moduleName = process.env.DESK_PLAYWRIGHT_MODULE || "playwright";
const playwright = await import(isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const engine = process.env.DESK_BROWSER_ENGINE || "chromium";
assert(["chromium", "webkit"].includes(engine));
const baseUrl = process.env.DESK_BASE_URL || "http://127.0.0.1:4173";
const screenshotDir = process.env.DESK_SCREENSHOT_DIR || "/private/tmp/desk-catalog-share-qa";
const storageKeys = ["desk.catalog.v2", "desk.catalog-collections.v1", "desk.market-watchlist.v1"];
const sandboxLayers = ["novita", "daytona-vm", "blaxel", "e2b", "modal-vm", "modal-gvisor"];
const supported = [
  { name: "equities-nvda", cardId: "equities", state: { symbol: "NVDA", layers: ["NVDA"], scale: "price", range: "1y", palette: "azure", theme: "dark" }, title: /NVDA|NVIDIA/, view: "monitor" },
  { name: "clouds-compute", cardId: "equities", entry: "preset-equities-clouds-compute", state: { symbol: "CRWV", layers: ["CRWV", "NBIS", "H100", "H200"], scale: "index", range: "90d", palette: "sage", theme: "light" }, title: /CRWV|Clouds/i, view: "monitor" },
  ...["now", "7d", "all"].map(range => ({ name: `sandbox-${range}`, cardId: "sandbox-cost", state: { provider: "novita", layers: sandboxLayers, scale: "price", range, palette: range === "7d" ? "sage" : "linen", theme: range === "7d" ? "light" : "dark" }, title: /Sandbox cost/i, view: "monitor" })),
  { name: "quote-b200", cardId: "quote-view", state: { gpu: "B200", quote: 3.65, quantity: 256, rfs: "2026-10", palette: "linen", theme: "dark" }, title: /Quote B200/, view: "monitor" },
  { name: "quote-h200", cardId: "quote-view", entry: "preset-quote-view-h200", state: { gpu: "H200", quote: 2.85, quantity: 256, rfs: "2026-10", palette: "sage", theme: "light" }, title: /Quote H200/, view: "monitor" },
  { name: "deal-default", cardId: "deal-view", state: {}, title: /Deal 041/, view: "monitor" },
  { name: "gpu-h200", cardId: "gpu-index", state: { gpu: "H200", layers: ["H200"], scale: "price", range: "7d", palette: "azure", theme: "dark" }, title: /H200/, view: "card" },
  { name: "gpu-snapshot", cardId: "gpu-price-snapshot", state: {}, title: /H100|GPU/i, view: "card" },
  { name: "depth-history", cardId: "gpu-market-depth", state: { gpu: "H100", layers: ["H100"], scale: "history", range: "now", target: "256", palette: "sage", theme: "light" }, title: /H100/, view: "card" },
  { name: "power-dominion", cardId: "power-basis", state: { location: "PJM-DOMINION", layers: ["PJM-DOMINION"], scale: "energy", range: "90d", palette: "azure", theme: "dark" }, title: /H100|Dominion/, view: "card" },
].map(fixture => ({ ...fixture, state: normalizeCardVisualization(fixture.cardId, fixture.state) }));
let browser;

before(async () => {
  await mkdir(screenshotDir, { recursive: true });
  browser = await playwright[engine].launch({ headless: true, timeout: 15000,
    ...(process.env.DESK_BROWSER_PATH ? { executablePath: process.env.DESK_BROWSER_PATH } : {}) });
});
after(async () => { await browser?.close(); });

async function contextFor(t, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", ...options });
  const errors = [];
  context.on("page", page => {
    page.setDefaultTimeout(12000);
    page.on("pageerror", error => errors.push(error.message));
  });
  await context.route("**/*", route => new URL(route.request().url()).origin === new URL(baseUrl).origin
    ? route.continue() : route.abort());
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, [], "Sharing or redirecting raised an uncaught error");
  });
  return context;
}

function queryUrl(fixture, { entry = null, view = "monitor" } = {}) {
  const url = new URL("/", baseUrl);
  url.searchParams.set("card", fixture.cardId);
  url.searchParams.set("view", view);
  for (const [key, value] of Object.entries(fixture.state)) url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
  if (entry) url.searchParams.set("entry", entry);
  return url.href;
}

async function ready(page, cardId) {
  await page.waitForFunction(cardId => document.querySelector("[data-gpu-benchmark-card]")?.dataset.cardReady === "true"
    && document.querySelector("[data-gpu-benchmark-card]")?.dataset.cardId === cardId, cardId);
}

async function copyLink(page, fixture, entry = null) {
  await page.goto(queryUrl(fixture, { entry }), { waitUntil: "networkidle" });
  await ready(page, fixture.cardId);
  await page.evaluate(() => { window.__shareDocument = document.documentElement; });
  const before = await page.evaluate(keys => ({ url: location.href,
    storage: Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), count: window.__copiedViewLinks.length }), storageKeys);
  await page.keyboard.press("Meta+g");
  await page.locator("[data-command-palette]").waitFor({ state: "visible" });
  if (await page.locator("[data-desk-login]").isVisible()) {
    await page.locator("[data-desk-login]").focus();
    await page.keyboard.press("Enter");
  }
  await page.locator("[data-command-input]").fill("Copy view link");
  const action = page.locator("#desk-command-actions-copy-card-link");
  assert.equal(await action.isDisabled(), false);
  await action.click();
  await page.waitForFunction(count => window.__copiedViewLinks.length === count + 1, before.count);
  const after = await page.evaluate(keys => ({ url: location.href,
    storage: Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])),
    sameDocument: window.__shareDocument === document.documentElement, link: window.__copiedViewLinks.at(-1) }), storageKeys);
  assert.equal(after.url, before.url, "Copy must not navigate or modify the current URL");
  assert(after.sameDocument, "Copy must not reload the app");
  assert.deepEqual(after.storage, before.storage, "Copy must not save or rewrite views, collections, or pins");
  return new URL(after.link);
}

async function clipboardPage(t) {
  const context = await contextFor(t);
  await context.addInitScript(() => {
    window.__copiedViewLinks = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true,
      value: { writeText: async text => { window.__copiedViewLinks.push(text); } } });
  });
  return { context, page: await context.newPage() };
}

function assertState(href, fixture, view) {
  const url = new URL(href, baseUrl);
  assert.equal(url.pathname, "/");
  assert.equal(url.searchParams.get("card"), fixture.cardId);
  assert.equal(url.searchParams.get("view"), view);
  assert.equal(url.searchParams.has("entry"), false, "Published identity must not depend on recipient catalog entries");
  assert.equal(url.searchParams.has("saved"), false);
  for (const key of cardStateParamIds(getCardDefinition(fixture.cardId))) {
    const value = fixture.state[key];
    assert.equal(url.searchParams.get(key), Array.isArray(value) ? value.join(",") : String(value), `${fixture.name}: ${key} survives sharing`);
  }
}

async function assertStaticPreview(t, link, fixture) {
  const context = await contextFor(t, { javaScriptEnabled: false });
  const page = await context.newPage();
  const response = await page.goto(link.href, { waitUntil: "load" });
  assert.equal(response.status(), 200, "Supported share must resolve to generated HTML, never a 404");
  assert.match(response.headers()["content-type"], /text\/html/);
  assert.equal(page.url(), link.href, "JavaScript-disabled readers retain the static share page");
  const meta = await page.locator("head").evaluate(head => ({
    title: document.title,
    canonical: head.querySelector('link[rel="canonical"]')?.href,
    fields: Object.fromEntries([...head.querySelectorAll("meta[property], meta[name]")]
      .map(node => [node.getAttribute("property") || node.getAttribute("name"), node.getAttribute("content")])),
  }));
  assert.match(meta.title, fixture.title);
  assert.match(meta.title, /\| Desk$/);
  assert.equal(meta.fields["og:type"], "website");
  assert.equal(meta.fields["og:site_name"], "Desk");
  assert.equal(meta.fields["og:title"], meta.title.replace(/ \| Desk$/, ""));
  assert(meta.fields["og:description"]?.length > 10);
  assert.equal(meta.fields["og:image:type"], "image/png");
  assert.equal(meta.fields["og:image:width"], "1200");
  assert.equal(meta.fields["og:image:height"], "630");
  assert(meta.fields["og:image:alt"]?.length > 10);
  if (fixture.cardId === "equities") {
    for (const layer of fixture.state.layers) assert(meta.fields["og:image:alt"].includes(layer), `${layer} is represented in the preview metadata`);
    assert(meta.fields["og:image:alt"].includes(fixture.state.range.toUpperCase()));
  }
  if (["quote-view", "deal-view"].includes(fixture.cardId)) {
    assert(meta.fields["og:image:alt"].includes(`${fixture.state.quantity} ${fixture.state.gpu} GPUs`));
    assert(meta.fields["og:image:alt"].includes(fixture.state.rfs));
    assert(meta.fields["og:image:alt"].includes(`$${fixture.state.quote.toFixed(2)}`));
  }
  assert.equal(meta.fields["og:image:secure_url"], meta.fields["og:image"]);
  assert.equal(meta.fields["twitter:card"], "summary_large_image");
  for (const field of ["title", "description", "image", "image:alt"]) assert.equal(meta.fields[`twitter:${field}`], meta.fields[`og:${field}`]);
  assert.equal(new URL(meta.canonical).pathname, link.pathname);
  assert.equal(new URL(meta.fields["og:url"]).pathname, link.pathname);
  const image = new URL(meta.fields["og:image"]);
  assert.equal(image.protocol, "https:", "Social crawlers need an absolute HTTPS image URL");
  assert(image.pathname.startsWith(`/assets/social/${fixture.cardId}/published/`), "Preview image belongs to the selected chart type");
  const localImage = new URL(image.pathname + image.search, baseUrl);
  const imageResponse = await context.request.get(localImage.href);
  assert.equal(imageResponse.status(), 200, "Referenced OG image must exist in the generated site");
  assert.match(imageResponse.headers()["content-type"], /image\/png/);
  const png = await imageResponse.body();
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 1200, "Actual PNG width matches metadata");
  assert.equal(png.readUInt32BE(20), 630, "Actual PNG height matches metadata");
  const open = page.getByRole("link", { name: "Open view", exact: true });
  assert(await open.isVisible(), "Static readers can open the interactive view without JavaScript");
  const destination = await open.getAttribute("href");
  assertState(destination, fixture, fixture.view);
  await open.click();
  assertState(page.url(), fixture, fixture.view);
  return destination;
}

async function assertRendered(page, fixture) {
  await ready(page, fixture.cardId);
  const root = page.locator("[data-gpu-benchmark-card]");
  assert.equal(await root.getAttribute("data-card-id"), fixture.cardId);
  assert.deepEqual(await page.evaluate(() => ({ palette: document.documentElement.dataset.palette,
    theme: document.documentElement.dataset.theme })), { palette: fixture.state.palette, theme: fixture.state.theme });
  const svg = page.locator(fixture.view === "monitor" ? "[data-gpu-chart-svg]" : "[data-share-artifact-svg]");
  if (["quote-view", "deal-view"].includes(fixture.cardId)) {
    const chart = page.locator("[data-deal-workspace] [data-deal-view]");
    await chart.waitFor({ state: "visible" });
    assert.match(await chart.locator(".deal-view__label").textContent(), fixture.title);
  } else {
    await svg.waitFor({ state: "visible" });
    assert(await svg.locator("path, rect").count() > 0, "Redirect paints a real chart");
    if (fixture.cardId === "equities") assert.equal(await svg.locator(".gpu-benchmark__line").count(), fixture.state.layers.length);
    if (fixture.cardId === "sandbox-cost") {
      assert.equal(await svg.locator("[data-sandbox-chart]").getAttribute("data-sandbox-chart"), fixture.state.range);
      assert.equal(await svg.locator("[data-sandbox-provider]").count(), 6);
    }
  }
}

for (const fixture of supported) {
  test(`Copy view link publishes ${fixture.name} with exact metadata and state (${engine})`, { timeout: 45000 }, async t => {
    const { page } = await clipboardPage(t);
    const link = await copyLink(page, fixture);
    assert.equal(link.origin, new URL(baseUrl).origin);
    assert.equal(link.pathname, publishedCardSharePath(fixture.cardId, fixture.state));
    assert.match(link.pathname, /^\/cards\/[^/]+\/published\//);
    assert(link.searchParams.get("v").includes(SHARE_COPY_VERSION), "New copy changes receive a fresh preview cache key");
    assert.equal(link.searchParams.has("entry"), false);
    if (fixture.entry) {
      const withEntry = await copyLink(page, fixture, fixture.entry);
      assert.equal(withEntry.href, link.href, "A matching catalog entry does not alter the public composition URL");
    }
    const destination = await assertStaticPreview(t, link, fixture);
    await page.goto(link.href, { waitUntil: "networkidle" });
    await page.waitForURL(url => url.pathname === "/");
    await ready(page, fixture.cardId);
    assertState(page.url(), fixture, fixture.view);
    assert.equal(new URL(page.url()).hash, new URL(destination, baseUrl).hash);
    await assertRendered(page, fixture);
    if (["clouds-compute", "sandbox-7d", "quote-h200", "power-dominion"].includes(fixture.name)) await page.screenshot({
      path: join(screenshotDir, `${engine}-${fixture.name}-redirect.png`), animations: "disabled" });
  });
}

for (const fixture of [
  { name: "custom-equity-pair", cardId: "equities", state: { symbol: "NVDA", layers: ["NVDA", "AMZN"], scale: "index", range: "90d", palette: "sage", theme: "light" }, title: /NVDA/, view: "monitor" },
  { name: "private-quote", cardId: "quote-view", state: { gpu: "H200", quote: 4.17, quantity: 512, rfs: "2027-03", palette: "azure", theme: "dark" }, title: /Quote H200/, view: "monitor" },
].map(fixture => ({ ...fixture, state: normalizeCardVisualization(fixture.cardId, fixture.state) }))) {
  test(`Unsupported ${fixture.name} keeps a working ordinary query link (${engine})`, { timeout: 30000 }, async t => {
    const { context, page } = await clipboardPage(t);
    const link = await copyLink(page, fixture);
    assertState(link.href, fixture, "monitor");
    assert.equal(link.pathname.includes("/published/"), false);
    const response = await context.request.get(link.href);
    assert.equal(response.status(), 200);
    assert.doesNotMatch(await response.text(), /assets\/social\/(equities|quote-view|deal-view)\/published\//,
      "Unsupported compositions must not advertise a different chart-specific image");
    await page.goto(link.href, { waitUntil: "networkidle" });
    await ready(page, fixture.cardId);
    assertState(page.url(), fixture, "monitor");
    await assertRendered(page, fixture);
  });
}
