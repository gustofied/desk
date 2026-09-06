import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after, before } from "node:test";
import { createSharedDesk, encodeSharedDesk } from "../../src/shared-desk.js";

// Generated local Power data only; disposable storage, no provider requests.
const moduleName = process.env.DESK_PLAYWRIGHT_MODULE || "playwright";
const playwright = await import(isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const engine = process.env.DESK_BROWSER_ENGINE || "chromium";
const baseUrl = process.env.DESK_BASE_URL || "http://127.0.0.1:4173";
const screenshotDir = process.env.DESK_SCREENSHOT_DIR || "/private/tmp/desk-power-qa";
const gallery = "[data-card-gallery-grid] .desk-gallery-card";
const monitorSvg = "[data-gpu-chart-svg]";
const focusSvg = "[data-focus-card-monitor] svg";
const pinKey = "desk.market-watchlist.v1";
const presets = [
  { id: "pjm-dominion", location: "PJM-DOMINION", label: "PJM Dominion", scale: "price" },
  { id: "ercot-north", location: "ERCOT-NORTH", label: "ERCOT North", scale: "price" },
  { id: "gpu-energy", location: "PJM-DOMINION", label: "GPU energy", scale: "energy" },
];
let browser;
let payload;
before(async () => {
  assert(["chromium", "webkit"].includes(engine));
  await mkdir(screenshotDir, { recursive: true });
  browser = await playwright[engine].launch({ headless: true,
    ...(process.env.DESK_BROWSER_PATH ? { executablePath: process.env.DESK_BROWSER_PATH } : {}) });
  const request = await playwright.request.newContext();
  try {
    const response = await request.get(new URL("/data/power-basis.json", baseUrl).href);
    assert(response.ok());
    payload = await response.json();
    assert(["showcase", "scenario"].includes(payload.dataset.kind), "Requires the generated Power demo runtime");
    assert.equal(payload.series["PJM-DOMINION"].length, 8761);
  } finally { await request.dispose(); }
});
after(async () => { await browser?.close(); });

function urlFor({ view = "monitor", scale = "energy", location = "PJM-DOMINION", range = "1d" } = {}) {
  const url = new URL("/", baseUrl);
  for (const [key, value] of Object.entries({ card: "power-basis", view, location, layers: location, scale, range,
    palette: "linen", theme: "dark" })) url.searchParams.set(key, value);
  return url.href;
}

async function makePage(t, width = 1440, url = urlFor()) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 },
    reducedMotion: "reduce", isMobile: width === 390, hasTouch: width === 390 });
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
  await page.goto(url, { waitUntil: "networkidle" });
  await ready(page);
  await page.evaluate(async () => { await document.fonts.ready; window.__powerDocument = document.documentElement; });
  return page;
}

async function ready(page) {
  await page.waitForFunction(() => document.querySelector("[data-gpu-benchmark-card]")?.dataset.cardReady === "true");
}
async function capture(page, name) {
  await page.screenshot({ path: join(screenshotDir, `${engine}-${page.viewportSize().width}-${name}.png`),
    animations: "disabled", timeout: 30000 });
}
async function command(page, id, query) {
  await page.keyboard.press("Meta+g");
  await page.locator("[data-command-palette]").waitFor({ state: "visible" });
  if (await page.locator("[data-desk-login]").isVisible()) {
    await page.locator("[data-desk-login]").focus();
    await page.keyboard.press("Enter");
  }
  await page.locator("[data-command-input]").fill(query);
  await page.locator(`#desk-command-${id.replaceAll(".", "-")}`).click();
}
async function showGallery(page) {
  if (await page.evaluate(() => document.documentElement.dataset.deskView !== "catalog")) {
    await page.locator('[data-desk-mode="catalog"]').click();
  }
  if (await page.evaluate(() => document.documentElement.dataset.deskLayout !== "all")) {
    await page.locator("[data-index-gallery-toggle]").click();
  }
  await page.locator("[data-card-gallery-grid]").waitFor({ state: "visible" });
}
async function selectPower(page) {
  await showGallery(page);
  await page.locator("[data-catalog-switcher]").focus();
  await page.keyboard.press("ArrowDown");
  await page.locator('[data-catalog-collection="power"]').click();
  await page.locator("[data-catalog-menu]").waitFor({ state: "hidden" });
  await page.waitForFunction(selector => document.querySelectorAll(selector).length === 3, gallery);
}
async function assertSurface(page, selector, energy) {
  const svg = page.locator(selector);
  await svg.waitFor({ state: "visible" });
  assert.equal(await svg.locator('[data-power-basis-line="real-time"]').count(), 1);
  assert.equal(await svg.locator('[data-power-basis-line="day-ahead"]').count(), 1);
  assert.equal(await svg.locator("[data-power-basis-area]").count(), 1);
  assert.equal(await svg.locator(".gpu-benchmark__plot-root, .gpu-benchmark__line, .is-exiting").count(), 0);
  const text = await svg.textContent();
  assert.match(text, energy ? /ESTIMATE|Estimate/ : /DEMO|Demo/);
  assert(text.includes(energy ? "/GPU-h" : "/MWh"), "Visible unit is correct");
  assert(await page.evaluate(() => window.__powerDocument === document.documentElement), "Navigation reloaded document");
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Page overflows horizontally");
}
async function assertPreset(page, preset, view = "monitor") {
  await page.waitForFunction(({ preset, view }) => {
    const url = new URL(location.href);
    const selected = url.searchParams.get("location") || url.searchParams.get("gpu");
    return document.documentElement.dataset.deskView === view && selected === preset.location &&
      url.searchParams.get("scale") === preset.scale;
  }, { preset, view });
  await assertSurface(page, view === "monitor" ? monitorSvg : focusSvg, preset.scale === "energy");
}

test("fresh Power catalog has three cards that open Monitor and switch as focused tabs", async t => {
  const page = await makePage(t, 1440, urlFor({ view: "gallery" }));
  await selectPower(page);
  const labels = await page.locator(gallery).evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label")));
  assert.equal(labels.length, presets.length);
  presets.forEach((preset, index) => assert(labels[index].startsWith(`Monitor ${preset.label}.`)));
  await capture(page, "power-gallery-demo");
  for (const [index, preset] of presets.entries()) {
    await page.locator(gallery).nth(index).click();
    await assertPreset(page, preset);
    await showGallery(page);
  }
  await command(page, "catalog.focused-view", "focused");
  for (const preset of presets) {
    await page.locator(`[data-catalog-entry-key="preset-power-basis-${preset.id}"]`).click();
    await assertPreset(page, preset, "catalog");
    const svg = page.locator(focusSvg);
    const frame = await page.locator("[data-focus-card-monitor]").boundingBox();
    const box = await svg.boundingBox();
    assert(Math.abs(frame.width / frame.height - 16 / 9) < 0.01);
    assert(box.width <= frame.width + 1 && box.height <= frame.height + 1);
  }
  await capture(page, "energy-focus-estimate");
});

for (const width of [1440, 390]) {
  test(`Energy ranges, source assumptions and persisted pin are honest at ${width}px`, async t => {
    const page = await makePage(t, width);
    const raw = payload.series["PJM-DOMINION"].at(-1);
    const expected = (raw[1] * 0.00153).toFixed(4);
    for (const range of ["1d", "7d", "90d", "1y"]) {
      await page.locator(`[data-gpu-range="${range}"]`).click();
      assert.equal(await page.locator(`[data-gpu-range="${range}"]`).getAttribute("aria-pressed"), "true");
      await assertSurface(page, monitorSvg, true);
      if (width === 1440) assert((await page.locator(`${monitorSvg} [data-power-basis-real-time]`).textContent()).includes(`$${expected}/GPU-h`));
    }
    await page.locator("[data-monitor-data-toggle]").click();
    await page.locator("[data-monitor-data-body]").waitFor({ state: "visible" });
    const description = await page.locator("[data-monitor-data-source-description]").innerText();
    for (const term of ["10.2 kW", "8 GPUs", "PUE 1.2", "Demo", "Energy only"]) assert(description.includes(term), term);
    assert.match(await page.locator("[data-monitor-data-source-link]").getAttribute("href"), /^https:\/\/docs\.nvidia\.com\/dgx\//);
    await capture(page, "energy-monitor-estimate");
    await command(page, "actions.pin-to-strip", "pin");
    const items = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).items, pinKey);
    const pinned = items.find(item => item.cardId === "power-basis" && item.state.scale === "energy");
    assert(pinned, "Energy pin persisted");
    assert.equal(pinned.state.location, "PJM-DOMINION");
    assert.equal(pinned.state.range, "1y");
    await page.reload({ waitUntil: "networkidle" });
    await ready(page);
    assert.deepEqual(await page.evaluate(({ key, id }) => JSON.parse(localStorage.getItem(key)).items.find(item => item.id === id),
      { key: pinKey, id: pinned.id }), pinned);
    if (width === 1440) {
      const snapshot = createSharedDesk({ name: "Energy estimate", entries: [{ cardId: pinned.cardId, name: pinned.label, state: pinned.state }],
        palette: "linen", theme: "dark" });
      const url = new URL("/?view=gallery", baseUrl);
      url.hash = `desk=${encodeSharedDesk(snapshot)}`;
      await page.goto(url.href, { waitUntil: "networkidle" });
      await ready(page);
      await page.evaluate(() => { window.__powerDocument = document.documentElement; });
      assert.equal(await page.locator(gallery).count(), 1);
      assert.match(await page.locator(gallery).textContent(), /ESTIMATE/);
      await page.locator(gallery).click();
      await assertPreset(page, presets[2]);
      assert.equal(new URL(page.url()).searchParams.get("range"), "1y");
    }
  });
}
