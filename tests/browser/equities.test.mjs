import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after, before } from "node:test";
import { CARD_REGISTRY } from "../../src/card-registry.js";
import { normalizeCardVisualization } from "../../src/card-document.js";
import { readSharedDeskUrl } from "../../src/shared-desk.js";

// Requires an existing local preview and installed browser; installs nothing.
// DESK_PLAYWRIGHT_MODULE, DESK_BROWSER_ENGINE, DESK_BROWSER_PATH, DESK_BASE_URL,
// and DESK_SCREENSHOT_DIR are optional. The suite loads the bundled demo runtime
// without provider calls or price interception, using only disposable storage.
const moduleName = process.env.DESK_PLAYWRIGHT_MODULE || "playwright";
const playwright = await import(isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const engine = process.env.DESK_BROWSER_ENGINE || "chromium";
assert(["chromium", "webkit"].includes(engine));
const baseUrl = process.env.DESK_BASE_URL || "http://127.0.0.1:4173";
const screenshotDir = process.env.DESK_SCREENSHOT_DIR || "/private/tmp/desk-equities-qa";
const symbols = ["MSFT", "AMZN", "GOOGL", "ORCL", "CRWV", "NBIS", "NVDA", "AMD", "TSM"];
const savedKey = "desk.catalog.v2";
const pinKey = "desk.market-watchlist.v1";
const galleryCards = "[data-card-gallery-grid] .desk-gallery-card";
const line = "[data-gpu-chart-svg] .gpu-benchmark__line";
const slider = "[data-gpu-chart-svg] .gpu-benchmark__hit";
const errors = [];
const day = 86400;
let browser;
let equityPayload;

before(async () => {
  await mkdir(screenshotDir, { recursive: true });
  browser = await playwright[engine].launch({ headless: true,
    ...(process.env.DESK_BROWSER_PATH ? { executablePath: process.env.DESK_BROWSER_PATH } : {}) });
  const request = await playwright.request.newContext();
  try {
    const response = await request.get(new URL("/data/equities.json", baseUrl).href);
    assert(response.ok(), "Bundled equity runtime is served locally");
    equityPayload = await response.json();
  } finally { await request.dispose(); }
});
after(async () => { await browser?.close(); });

function urlFor({ card = "equities", view = "monitor", scale = "price", range = "1y", symbol = "NVDA" } = {}) {
  const url = new URL("/", baseUrl);
  for (const [key, value] of Object.entries({ card, view, symbol, layers: symbol, scale, range, palette: "linen", theme: "dark" })) url.searchParams.set(key, value);
  return url.href;
}

async function makePage(t, { width, url = urlFor() } = {}) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 },
    reducedMotion: "reduce", hasTouch: width === 390, isMobile: width === 390 });
  const page = await context.newPage();
  t.after(async () => {
    await page.unrouteAll({ behavior: "wait" });
    await context.close();
  });
  page.setDefaultTimeout(12000);
  page.on("pageerror", error => errors.push(`${engine}/${width}: ${error.message}`));
  await page.route("**/*", route => new URL(route.request().url()).origin === new URL(baseUrl).origin
    ? route.continue() : route.abort());
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector('[data-card-ready="true"]'));
  await page.evaluate(() => { window.__equityDocument = document.documentElement; });
  return page;
}

async function capture(page, name) {
  await page.screenshot({ path: join(screenshotDir, `${engine}-${page.viewportSize().width}-${name}.png`) });
}

async function showGallery(page) {
  if (await page.evaluate(() => document.documentElement.dataset.deskView !== "catalog")) await page.locator('[data-desk-mode="catalog"]').click();
  if (await page.evaluate(() => document.documentElement.dataset.deskLayout !== "all")) await page.locator("[data-index-gallery-toggle]").click();
  await page.waitForFunction(() => document.documentElement.dataset.deskView === "catalog" && document.documentElement.dataset.deskLayout === "all");
}

async function selectCollection(page, id) {
  await showGallery(page);
  await page.locator("[data-catalog-switcher]").focus();
  await page.keyboard.press("ArrowDown");
  await page.locator(`[data-catalog-collection="${id}"]`).click();
  await page.locator("[data-catalog-menu]").waitFor({ state: "hidden" });
}

async function monitorReady(page, cardId = "equities", symbol = "NVDA") {
  await page.waitForFunction(({ cardId, symbol }) => {
    const root = document.querySelector("[data-gpu-benchmark-card]");
    const url = new URL(location.href);
    return root?.dataset.cardId === cardId && root.dataset.cardReady === "true" &&
      document.documentElement.dataset.deskView === "monitor" &&
      url.searchParams.get(cardId === "equities" ? "symbol" : "gpu") === symbol;
  }, { cardId, symbol });
}

async function assertSingleSurface(page, symbols = ["NVDA"]) {
  assert.deepEqual(await page.locator(line).evaluateAll(nodes => nodes.map(node => node.dataset.layer)), symbols);
  assert.equal(await page.locator("[data-gpu-chart-svg] .gpu-benchmark__plot-root").count(), 1);
  assert.equal(await page.locator("[data-gpu-chart-svg] .is-exiting").count(), 0);
  assert.equal(await page.locator("[data-deal-workspace]").isVisible(), false);
  assert(await page.evaluate(() => window.__equityDocument === document.documentElement), "Navigation reloaded the document");
}

async function inspectObservation(page, key = "End") {
  await page.locator(slider).focus();
  await page.keyboard.press(key);
  await page.locator("[data-gpu-tooltip]").waitFor({ state: "visible" });
  return {
    time: await page.locator("[data-gpu-tooltip] time").innerText(),
    value: await page.locator('[data-gpu-tooltip] [data-selected="true"] strong').innerText(),
    detail: await page.locator('[data-gpu-tooltip] [data-selected="true"] small').innerText(),
  };
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

async function expandDataRail(page) {
  const rail = page.locator("[data-monitor-data]");
  assert(await rail.isVisible());
  const toggle = page.locator("[data-monitor-data-toggle]");
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  await page.locator("[data-monitor-data-body]").waitFor({ state: "visible" });
  assert.equal(await page.locator("[data-monitor-data-body]").evaluate(node => node.inert), false);
  return rail;
}

async function assertSourceRail(page, source) {
  const rail = await expandDataRail(page);
  assert.equal(await rail.getAttribute("data-access-kind"), "source");
  assert.equal(await rail.getAttribute("aria-label"), "Market data source");
  assert.equal(await page.locator("[data-monitor-data-label]").textContent(), "Source");
  assert.equal(await page.locator("[data-monitor-data-dataset]").innerText(), "Equities");
  assert.equal(await page.locator("[data-monitor-data-source-description]").textContent(), "",
    "The equity source note is blank without removing source access");
  assert.equal(await page.locator("[data-monitor-data-api]").count(), 3);
  assert(await page.locator("[data-monitor-data-api]").evaluateAll(nodes => nodes.every(node =>
    node.hidden && getComputedStyle(node).display === "none")));
  for (const selector of ["[data-monitor-data-command-shell]", "[data-monitor-data-mode]",
    "[data-monitor-data-copy]", '[aria-label="Desk CLI resources"]']) {
    assert.equal(await page.locator(selector).isVisible(), false, `${selector} leaked into the source rail`);
  }
  assert.equal(await page.locator("[data-monitor-data-command]").textContent(), "");
  assert.doesNotMatch(await rail.innerText(), /Desk API|View SQL|Copy command|Download CLI/);
  assert.doesNotMatch(await rail.innerText(), /EODHD|not connected|connect equity data/i);
  assert.doesNotMatch(await rail.innerText(), /\b(?:demo|estimate|estimated)\b/i, "Source notes are not displayed");
  const docs = page.locator("[data-monitor-data-source-link]");
  assert(await docs.isVisible());
  assert.equal(await docs.innerText(), "Source docs");
  assert.equal(await docs.getAttribute("href"), source.url);
  assert.notEqual(new URL(await docs.getAttribute("href")).origin, new URL(baseUrl).origin);
  assert.equal(await docs.getAttribute("target"), "_blank");
  assert.match(await docs.getAttribute("rel"), /(?:^|\s)noopener(?:\s|$)/);
  await docs.scrollIntoViewIfNeeded();
  await docs.focus();
  assert(await docs.evaluate(node => document.activeElement === node));
}

async function assertGpuApiRail(page) {
  const rail = await expandDataRail(page);
  assert.equal(await rail.getAttribute("data-access-kind"), "cli");
  assert.equal(await rail.getAttribute("aria-label"), "Desk API");
  assert.equal(await page.locator("[data-monitor-data-label]").textContent(), "Desk API");
  assert.equal(await page.locator("[data-monitor-data-source]").isVisible(), false);
  // The existing mobile layout intentionally hides dataset breadcrumbs only.
  assert(await page.locator("[data-monitor-data-api]").evaluateAll(nodes => nodes.every(node => !node.hidden)));
  assert(await page.locator("[data-monitor-data-command-shell]").isVisible());
  assert(await page.locator("[data-monitor-data-copy]").isVisible());
  assert(await page.locator('[aria-label="Desk CLI resources"]').isVisible());
  assert(await page.locator('[data-monitor-data] a[download="desk"]').isVisible());
  assert.equal(await page.locator("[data-monitor-data-command-shell]").getAttribute("aria-label"), "Desk CLI command");
  assert.match(await page.locator("[data-monitor-data-command]").innerText(), /desk/);
  assert.equal(await page.locator("[data-monitor-data-mode]").innerText(), "View SQL");
  await page.locator("[data-monitor-data-mode]").click();
  assert.equal(await page.locator("[data-monitor-data-mode]").innerText(), "View CLI");
  assert.match(await page.locator("[data-monitor-data-command]").innerText(), /SELECT/);
}

for (const width of [1440, 390]) {
  test(`bundled demo equities load all nine ticker cards on first catalog selection (${engine}, ${width})`, async t => {
    const page = await makePage(t, { width, url: new URL("/?view=gallery", baseUrl).href });
    assert.equal(equityPayload.dataset.kind, "demo");
    assert.equal(equityPayload.dataset.status, "ready");
    assert.equal(equityPayload.dataset.source.name, "Demo data");
    assert.equal(equityPayload.dataset.priceBasis, "demo-close");
    assert.deepEqual(Object.keys(equityPayload.series), symbols);
    for (const points of Object.values(equityPayload.series)) {
      assert(points.length >= 260, "Every ticker has a complete bundled year");
      assert(points.every(([timestamp, value], index) => Number.isFinite(value) && value > 0
        && [1, 2, 3, 4, 5].includes(new Date(timestamp * 1000).getUTCDay())
        && (index === 0 || timestamp > points[index - 1][0])), "Synthetic closes use an ordered weekday grid");
      assert.equal(points.at(-1)[0], equityPayload.asOf);
    }
    await selectCollection(page, "equities");
    await page.waitForFunction(() => document.querySelectorAll("[data-card-gallery-grid] .desk-gallery-card").length === 9);
    const labels = await page.locator(galleryCards).evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label")));
    for (const [index, symbol] of symbols.entries()) assert(labels[index].startsWith(`Monitor ${symbol}`), labels[index]);
    const galleryLines = page.locator(`${galleryCards} path[data-chart-draw]`);
    await page.waitForFunction(selector => document.querySelectorAll(selector).length === 9,
      `${galleryCards} path[data-chart-draw]`);
    assert.equal(await galleryLines.count(), 9, "Every equity Gallery card has a loaded chart");
    for (const [index, symbol] of symbols.entries()) {
      assert.deepEqual(await galleryLines.nth(index).evaluate(node => {
        const last = node.__data__.at(-1);
        return [+last.date / 1000, last.value];
      }), equityPayload.series[symbol].at(-1), `${symbol} Gallery endpoint comes from its bundled history`);
    }
    assert.doesNotMatch(await page.locator("[data-card-gallery-grid]").innerText(), /EODHD|not connected|connect equity data/i);
    await capture(page, "bundled-demo-catalog");
    await page.locator(galleryCards).nth(6).click();
    await monitorReady(page);
    await assertSingleSurface(page);
    assert.equal(await page.locator("[data-gpu-state]").isVisible(), false);
    assert.notEqual((await page.locator("[data-gpu-range-end]").innerText()).trim(), "—");
    await assertSourceRail(page, equityPayload.dataset.source);
    await capture(page, "bundled-demo-source-rail");
  });

  test(`bundled demo equity history has correct ranges, source label and independent GPU clock (${engine}, ${width})`, async t => {
    const page = await makePage(t, { width });
    const runtime = equityPayload;
    assert.equal(runtime.dataset.status, "ready");
    assert.equal(runtime.dataset.source.name, "Demo data");
    assert.deepEqual(Object.keys(runtime.series), symbols);
    assert(Object.values(runtime.series).every(points => points.length > 1));
    await monitorReady(page);
    assert.equal(new URL(page.url()).searchParams.get("range"), "1y");
    const points = runtime.series.NVDA;
    const renderedPoints = () => page.locator(`${line}.is-selected`).evaluate(node =>
      node.__data__.map(point => [+point.date / 1000, point.value]));
    const expectRange = async (range, seconds) => {
      await page.locator(`[data-gpu-range="${range}"]`).click();
      const expected = seconds === null ? points : points.filter(point => point[0] >= runtime.asOf - seconds);
      await page.waitForFunction(count => Number(document.querySelector("[data-gpu-chart-svg] .gpu-benchmark__hit")
        ?.getAttribute("aria-valuemax")) === count - 1, expected.length);
      assert.equal(new URL(page.url()).searchParams.get("range"), range);
      assert.deepEqual(await renderedPoints(), expected);
      await assertSingleSurface(page);
      assert.equal(await page.locator("[data-gpu-state]").isVisible(), false);
      assert.equal(await page.locator("[data-gpu-chart-svg] .gpu-benchmark__band").count(), 0);
      const observation = await inspectObservation(page);
      assert.equal(observation.value, `$${points.at(-1)[1].toFixed(2)}`);
      assert.equal(observation.detail, "USD / share");
      assert.match(observation.time, /close/);
    };
    for (const [range, seconds] of [["7d", 7 * day], ["90d", 90 * day], ["1y", 365 * day]]) {
      await expectRange(range, seconds);
    }
    await expectRange("1y", 365 * day);
    const equityObservation = await inspectObservation(page);
    const svgBounds = await page.locator("[data-gpu-chart-svg]").boundingBox();
    assert(svgBounds.width > 0 && svgBounds.height > 0 && svgBounds.x >= 0 && svgBounds.x + svgBounds.width <= width + 1);
    await assertSourceRail(page, runtime.dataset.source);
    await capture(page, "bundled-demo-NVDA-1y-source");

    await selectCollection(page, "overview");
    await page.locator(`${galleryCards}[data-catalog-id="preset-gpu-index-h200"]`).click();
    await monitorReady(page, "gpu-index", "H200");
    await assertSingleSurface(page, ["H200"]);
    const gpuResponse = await page.request.get(new URL("/data/gpu-price-index.json", baseUrl).href);
    assert(gpuResponse.ok());
    const gpuRuntime = await gpuResponse.json();
    assert.deepEqual((await renderedPoints()).at(-1), gpuRuntime.series.H200.at(-1).slice(0, 2));
    assert.equal(await page.locator("[data-gpu-chart-svg] .gpu-benchmark__band").count(), 1);
    await command(page, "equity.nvda", "Open NVDA");
    await monitorReady(page);
    await assertSingleSurface(page);
    assert.deepEqual((await renderedPoints()).at(-1), points.at(-1));
    assert.deepEqual(await inspectObservation(page), equityObservation);
    assert.equal(await page.locator("[data-gpu-state]").isVisible(), false);
    assert.equal(await page.locator("[data-gpu-chart-svg] .gpu-benchmark__band").count(), 0);
    await assertSourceRail(page, runtime.dataset.source);
    await capture(page, "bundled-demo-NVDA-after-GPU-source");
    assert.deepEqual(errors, []);
  });

  test(`neutral Craft offers all registered view types including Equities (${engine}, ${width})`, async t => {
    const page = await makePage(t, { width, url: new URL("/?view=craft", baseUrl).href });
    await page.locator('[data-desk-mode="craft"]').click();
    await page.locator(".gpu-benchmark__craft-empty").waitFor({ state: "visible" });
    assert.deepEqual(await page.locator("[data-craft-type]").evaluateAll(nodes => nodes.map(node => node.dataset.craftType)),
      CARD_REGISTRY.filter(card => card.craftable !== false).map(card => card.id));
    assert(await page.locator("[data-craft-type]").evaluateAll(buttons => buttons.every(button => {
      const bounds = button.getBoundingClientRect();
      const target = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return bounds.width > 0 && bounds.height > 0 && bounds.left >= 0 && bounds.right <= innerWidth &&
        bounds.top >= 0 && bounds.bottom <= innerHeight && button.contains(target) && !button.disabled;
    })), "Craft view types are clipped or covered");
    await capture(page, "bundled-demo-neutral-Craft-picker");
    const equities = page.locator('[data-craft-type="equities"]');
    if (width === 390) await equities.tap();
    else await equities.click();
    await page.waitForFunction(() => document.querySelector("[data-gpu-benchmark-card]")?.dataset.cardId === "equities" &&
      document.querySelector("[data-gpu-benchmark-card]").dataset.craftEmpty === "false");
    assert.equal(new URL(page.url()).searchParams.get("symbol"), "NVDA");
    await page.waitForLoadState("networkidle");
  });

  for (const scale of ["price", "index"]) {
    test(`bundled demo equity ${scale} respects all three ranges and clean per-share tooltips (${engine}, ${width})`, async t => {
      const page = await makePage(t, { width, url: urlFor({ scale }) });
      await monitorReady(page);
      const points = equityPayload.series.NVDA;
      for (const [range, seconds] of [["7d", 7 * day], ["90d", 90 * day], ["1y", 365 * day]]) {
        await page.locator(`[data-gpu-range="${range}"]`).click();
        await page.waitForFunction(range => new URL(location.href).searchParams.get("range") === range, range);
        const expected = seconds === null ? points : points.filter(point => point[0] >= equityPayload.asOf - seconds);
        await page.waitForFunction(count => Number(document.querySelector("[data-gpu-chart-svg] .gpu-benchmark__hit")?.getAttribute("aria-valuemax")) === count - 1, expected.length);
        await assertSingleSurface(page);
        assert.equal(await page.locator("[data-gpu-chart-svg] .gpu-benchmark__band").count(), 0, "Equity prices inherited GPU quote bands");
        const last = await inspectObservation(page);
        const asOf = new Date(equityPayload.asOf * 1000);
        const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][asOf.getUTCMonth()];
        const date = `${String(asOf.getUTCDate()).padStart(2, "0")} ${month} ${asOf.getUTCFullYear()}`;
        assert(last.time.includes(date), `Tooltip date comes from the bundled equity clock: ${last.time} vs ${date}`);
        assert.match(last.time, /close/);
        if (scale === "price") {
          assert.match(last.value, /^\$\d+(?:,\d{3})*\.\d{2}$/);
          assert.equal(last.detail, "USD / share");
          assert.equal(Number(last.value.replace(/[$,]/g, "")), points.at(-1)[1]);
        } else {
          assert.match(last.detail, /^\$\d+(?:,\d{3})*\.\d{2}$/);
          const first = await inspectObservation(page, "Home");
          assert.match(first.value, /^(?:[+−-])?0(?:\.0+)?%$/);
        }
      }
      await capture(page, `bundled-demo-${scale}-1y`);
    });
  }

  test(`bundled demo Craft comparison saves, pins and shares canonical equity symbols (${engine}, ${width})`, async t => {
    const page = await makePage(t, { width, url: urlFor({ view: "craft" }) });
    await page.locator("[data-card-compare-toggle]").click();
    await page.locator('[data-card-layer="AMD"]').click();
    await page.locator('[data-card-scale="index"]').click();
    await page.locator("[data-card-compare-toggle]").click();
    await page.locator('[data-gpu-range="90d"]').click();
    const expected = normalizeCardVisualization("equities", { symbol: "NVDA", layers: ["NVDA", "AMD"], scale: "index", range: "90d" });
    assert.equal(new URL(page.url()).searchParams.get("symbol"), "NVDA");
    assert.equal(new URL(page.url()).searchParams.has("gpu"), false);
    await capture(page, "bundled-demo-Craft-comparison");
    await page.locator("[data-card-save]").click();
    await page.locator("[data-card-market-pin]").click();
    const pin = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).items.find(item => item.cardId === "equities"), pinKey);
    assert.deepEqual(pin.state, expected);
    await page.locator("[data-save-name]").fill("TEST equity comparison");
    await page.locator("[data-save-submit]").click();
    await page.locator("[data-save-dialog]").waitFor({ state: "hidden" });
    await page.waitForFunction(id => [...document.querySelectorAll("[data-market-instrument]")]
      .some(item => item.dataset.marketInstrument === id), pin.id);
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).items.find(item => item.name === "TEST equity comparison"), savedKey);
    assert.equal(saved.cardId, "equities");
    assert.deepEqual(saved.visualization, expected);
    await command(page, "actions.share-desk", "Share desk");
    await page.locator("[data-desk-share-name]").fill("TEST equity collection");
    await page.locator("[data-desk-share-submit]").click();
    await page.waitForFunction(() => document.querySelector("[data-desk-share-link]")?.value.includes("#desk="));
    const link = await page.locator("[data-desk-share-link]").inputValue();
    const shared = readSharedDeskUrl(link);
    assert.equal(shared.error, null);
    assert.deepEqual(shared.snapshot.entries.find(entry => entry.name === saved.name)?.state, expected);
    await page.locator("[data-desk-share-cancel]").click();
    await capture(page, "bundled-demo-saved-comparison");
    await page.reload({ waitUntil: "networkidle" });
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).items.find(item => item.cardId === "equities").state, pinKey), expected);
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).items.find(item => item.name === "TEST equity comparison").visualization, savedKey), expected);
  });

  test(`bundled demo NVDA to GPU and back keeps independent clocks and no obsolete SVG (${engine}, ${width})`, async t => {
    const page = await makePage(t, { width });
    await monitorReady(page);
    const equityBefore = await inspectObservation(page);
    await assertSourceRail(page, equityPayload.dataset.source);
    await capture(page, "bundled-demo-ready-source-rail");
    await selectCollection(page, "overview");
    await page.locator(`${galleryCards}[data-catalog-id="preset-gpu-index-h200"]`).click();
    await monitorReady(page, "gpu-index", "H200");
    await assertSingleSurface(page, ["H200"]);
    const gpuPayload = await (await page.request.get(new URL("/data/gpu-price-index.json", baseUrl).href)).json();
    const gpuLast = await page.locator(`${line}.is-selected`).evaluate(node => ({
      timestamp: +node.__data__.at(-1).date / 1000, value: node.__data__.at(-1).value,
    }));
    assert.deepEqual(gpuLast, { timestamp: gpuPayload.series.H200.at(-1)[0], value: gpuPayload.series.H200.at(-1)[1] });
    const gpu = await inspectObservation(page);
    assert.notEqual(gpuLast.timestamp, equityPayload.asOf, "Distinct source clocks exercise the family switch");
    assert.match(gpu.value, /^\$\d+\.\d{1,3}$/);
    assert.match(gpu.detail, /^\$.* to \$/);
    assert.equal(await page.locator("[data-gpu-chart-svg] .gpu-benchmark__band").count(), 1);
    await assertGpuApiRail(page);
    await command(page, "equity.nvda", "Open NVDA");
    await monitorReady(page);
    await assertSingleSurface(page);
    const equityAfter = await inspectObservation(page);
    assert.deepEqual(equityAfter, equityBefore);
    assert.equal(await page.locator("[data-gpu-chart-svg] .gpu-benchmark__band").count(), 0);
    await assertSourceRail(page, equityPayload.dataset.source);
    await capture(page, "bundled-demo-source-after-GPU-API");
    await command(page, "equity.amd", "Open AMD");
    await monitorReady(page, "equities", "AMD");
    await assertSingleSurface(page, ["AMD"]);
    await command(page, "equity.nvda", "Open NVDA");
    await monitorReady(page);
    await assertSingleSurface(page);
    await capture(page, "bundled-demo-equity-after-GPU");
  });
}

test(`equity browser workflows have no uncaught errors (${engine})`, () => { assert.deepEqual(errors, []); });
