import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after, before } from "node:test";

// Existing local preview and installed browsers only. No provider requests,
// credentials, dependency installs, or application data writes. Positive paths
// load bundled demo histories; only fail-closed gap cases intercept those files.
const moduleName = process.env.DESK_PLAYWRIGHT_MODULE || "playwright";
const playwright = await import(isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const engine = process.env.DESK_BROWSER_ENGINE || "chromium";
assert(["chromium", "webkit"].includes(engine));
const baseUrl = process.env.DESK_BASE_URL || "http://127.0.0.1:4173";
const screenshotDir = process.env.DESK_SCREENSHOT_DIR || "/private/tmp/desk-cross-market-qa";
const ids = ["NVDA", "H100", "H200"];
const day = 86400;
const svg = "[data-gpu-chart-svg]";
const lines = `${svg} .gpu-benchmark__line`;
const slider = `${svg} .gpu-benchmark__hit`;
let browser;
let equityPayload;
let gpuPayload;
let manifest;

before(async () => {
  await mkdir(screenshotDir, { recursive: true });
  const request = await playwright.request.newContext();
  try {
    [equityPayload, gpuPayload, manifest] = await Promise.all([
      "/data/equities.json", "/data/gpu-price-index.json", "/data/manifest.json",
    ].map(async path => {
      const response = await request.get(new URL(path, baseUrl).href);
      assert(response.ok(), `${path} is unavailable on the local preview`);
      return response.json();
    }));
  } finally {
    await request.dispose();
  }
  browser = await playwright[engine].launch({ headless: true,
    ...(process.env.DESK_BROWSER_PATH ? { executablePath: process.env.DESK_BROWSER_PATH } : {}) });
});
after(async () => { await browser?.close(); });

function mixedUrl() {
  const url = new URL("/", baseUrl);
  for (const [key, value] of Object.entries({ card: "equities", view: "monitor", symbol: "NVDA",
    layers: ids.join(","), scale: "index", range: "90d", palette: "azure", theme: "dark" })) {
    url.searchParams.set(key, value);
  }
  return url.href;
}

// Independent raw-data oracle: sort observations, then keep the last per UTC
// date. The range ends at the latest common date, not either source's asOf.
function expectedComparison(equities = equityPayload, gpu = gpuPayload, rangeDays = 90) {
  const daily = ids.map(id => {
    const points = (id === "NVDA" ? equities : gpu).series[id] || [];
    const days = new Map();
    for (const point of [...points].sort((a, b) => a[0] - b[0])) {
      days.set(Math.floor(point[0] / day) * day, point);
    }
    return days;
  });
  const common = [...daily[0].keys()].filter(date => daily.every(rows => rows.has(date))).sort((a, b) => a - b);
  if (!common.length) return [];
  const dates = common.filter(date => date >= common.at(-1) - rangeDays * day);
  return ids.map((id, index) => {
    const base = daily[index].get(dates[0])[1];
    return { id, rows: dates.map(timestamp => ({ timestamp,
      observedAt: daily[index].get(timestamp)[0], value: daily[index].get(timestamp)[1],
      plotValue: daily[index].get(timestamp)[1] / base * 100,
    })) };
  });
}

function gapFixture(kind) {
  const equities = structuredClone(equityPayload);
  const gpu = structuredClone(gpuPayload);
  if (kind === "missing-equity") {
    equities.series = Object.fromEntries(Object.keys(equities.series).map(id => [id, []]));
    equities.asOf = null;
    Object.assign(equities.dataset, { kind: "unavailable", status: "unavailable", start: null, end: null, observationCount: 0 });
    equities.dataset.source = { ...equities.dataset.source, name: "TEST FIXTURE — unavailable equities", status: "unavailable" };
  } else if (kind === "missing-H200") {
    // H100 and NVDA still have data: dropping only H200 must not silently show
    // a different two-line comparison than the three requested in the URL.
    gpu.series.H200 = [];
  } else if (kind === "no-common-dates") {
    for (const id of ["H100", "H200"]) {
      gpu.series[id] = gpu.series[id].map(([timestamp, ...values]) => [timestamp + 1461 * day, ...values]);
    }
    gpu.asOf = Math.max(...Object.values(gpu.series).flatMap(points => points.map(point => point[0])));
    gpu.dataset.end = gpu.asOf;
  } else {
    throw new Error(`Unknown fixture: ${kind}`);
  }
  equities.revision = `test-cross-market-equities-${kind}`;
  gpu.revision = `test-cross-market-gpu-${kind}`;
  gpu.dataset.testFixture = `TEST FIXTURE — ${kind}`;
  const fixtureManifest = structuredClone(manifest);
  fixtureManifest.cards.equities = { ...fixtureManifest.cards.equities,
    revision: equities.revision, asOf: equities.asOf, status: equities.dataset.status };
  fixtureManifest.cards["gpu-index"] = { ...fixtureManifest.cards["gpu-index"], revision: gpu.revision, asOf: gpu.asOf };
  return { equities, gpu, manifest: fixtureManifest };
}

async function makePage(t, { width, gap = null } = {}) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 },
    reducedMotion: "reduce", hasTouch: width === 390, isMobile: width === 390 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(10000);
  t.after(async () => {
    await page.unrouteAll({ behavior: "wait" });
    await context.close();
    assert.deepEqual(errors, [], "Uncaught page errors");
  });
  // Block every non-local request, including source documentation URLs.
  await page.route("**/*", route => new URL(route.request().url()).origin === new URL(baseUrl).origin
    ? route.continue() : route.abort());
  if (gap) {
    const fixture = gapFixture(gap);
    await page.route("**/data/equities.json*", route => route.fulfill({ json: fixture.equities }));
    await page.route("**/data/gpu-price-index.json*", route => route.fulfill({ json: fixture.gpu }));
    await page.route("**/data/manifest.json*", route => route.fulfill({ json: fixture.manifest }));
  }
  await page.goto(mixedUrl(), { waitUntil: "networkidle" });
  await ready(page);
  await page.evaluate(() => { window.__crossMarketDocument = document.documentElement; });
  return page;
}

async function ready(page, cardId = "equities") {
  await page.waitForFunction(cardId => {
    const root = document.querySelector("[data-gpu-benchmark-card]");
    return root?.dataset.cardId === cardId && root.dataset.cardReady === "true" &&
      document.documentElement.dataset.deskView === "monitor";
  }, cardId);
}

async function capture(page, name) {
  await page.screenshot({ path: join(screenshotDir, `${engine}-${page.viewportSize().width}-${name}.png`) });
}

async function assertMixedChart(page, expected) {
  const url = new URL(page.url());
  assert.equal(url.searchParams.get("symbol"), "NVDA");
  assert.deepEqual(url.searchParams.get("layers").split(","), ids);
  assert.equal(url.searchParams.get("scale"), "index");
  assert.equal(await page.locator(`${lines}.is-selected`).getAttribute("data-layer"), "NVDA");
  assert.deepEqual(await page.locator(`${lines}.is-layer`).evaluateAll(nodes => nodes.map(node => node.dataset.layer).sort()), ["H100", "H200"]);
  assert.equal(await page.locator(`${svg} .gpu-benchmark__plot-root`).count(), 1);
  assert.equal(await page.locator(`${svg} .gpu-benchmark__band`).count(), 0);
  assert.equal(await page.locator(`${svg} .is-exiting`).count(), 0);
  assert.equal(await page.locator("[data-gpu-state]").isVisible(), false);
  assert(await page.evaluate(() => window.__crossMarketDocument === document.documentElement), "Chart switching reloaded the document");
  const actual = await page.locator(lines).evaluateAll(nodes => nodes.map(node => ({
    id: node.dataset.layer, rows: node.__data__.map(row => ({ timestamp: +row.date / 1000, value: row.value, plotValue: row.plotValue })),
  })));
  assert.equal(actual.length, 3);
  for (const candidate of expected) {
    const rendered = actual.find(series => series.id === candidate.id);
    assert(rendered, `${candidate.id} is missing`);
    assert.deepEqual(rendered.rows.map(row => [row.timestamp, row.value]), candidate.rows.map(row => [row.timestamp, row.value]));
    rendered.rows.forEach((row, index) => assert(Math.abs(row.plotValue - candidate.rows[index].plotValue) < 1e-8));
    assert.equal(rendered.rows[0].plotValue, 100);
  }
  const labels = await page.locator(`${svg} .gpu-benchmark__line-label`).allTextContents();
  assert.equal(labels.length, 3);
  for (const id of ids) assert(labels.some(label => label.startsWith(id) && label.endsWith("%")), `${id} endpoint must include its return`);
}

async function assertTooltip(page, expected, key) {
  await page.locator(slider).focus();
  await page.keyboard.press(key);
  await page.locator("[data-gpu-tooltip]").waitFor({ state: "visible" });
  const date = await page.locator("[data-gpu-tooltip] time").innerText();
  assert.doesNotMatch(date, /close|\d{2}:\d{2}/i, "Mixed observations must not imply an equity close or one intraday timestamp");
  const rows = await page.locator("[data-gpu-tooltip] .gpu-benchmark__tooltip-row").evaluateAll(nodes => nodes.map(node => ({
    id: node.querySelector("b").textContent, change: node.querySelector("strong").textContent,
    detail: node.querySelector("small").textContent, primary: node.dataset.selected === "true",
  })));
  assert.equal(rows.length, 3);
  for (const candidate of expected) {
    const actual = rows.find(row => row.id === candidate.id);
    assert(actual, `Missing ${candidate.id} tooltip row`);
    assert.equal(actual.primary, candidate.id === "NVDA");
    const point = key === "Home" ? candidate.rows[0] : candidate.rows.at(-1);
    if (key === "Home") assert.equal(actual.change, "0.0%");
    else assert(Math.abs(Number(actual.change.replace("−", "-").replace("%", "")) - (point.plotValue - 100)) <= 0.051);
    const unit = candidate.id === "NVDA" ? "share" : "GPU-h";
    const price = actual.detail.match(new RegExp(`^\\$([\\d,]+\\.(\\d+)) /${unit}$`));
    assert(price, `${candidate.id}: expected actual dollar price and /${unit}, got ${actual.detail}`);
    if (candidate.id === "NVDA") assert.equal(price[2].length, 2);
    assert.equal(Number(price[1].replaceAll(",", "")), Number(point.value.toFixed(price[2].length)));
  }
}

async function compareCommand(page) {
  await page.keyboard.press("Meta+g");
  await page.locator("[data-command-palette]").waitFor({ state: "visible" });
  if (await page.locator("[data-desk-login]").isVisible()) {
    await page.locator("[data-desk-login]").focus();
    await page.keyboard.press("Enter");
  }
  await page.locator("[data-command-input]").fill("Compare with compute");
  await page.locator("#desk-command-equity-compare-compute").click();
  await ready(page);
}

for (const width of [1440, 390]) {
  test(`bundled equity + GPU demo comparison shares dates, base and tooltip units in every range (${engine}, ${width})`, async t => {
    assert.equal(equityPayload.dataset.status, "ready");
    assert.equal(equityPayload.dataset.kind, "demo");
    assert.equal(equityPayload.dataset.source.name, "Demo data");
    const expected = expectedComparison();
    assert.equal(expected.length, 3);
    assert(expected[0].rows.length > 1);
    assert(expected[1].rows.some(row => row.observedAt !== row.timestamp), "The bundled GPU input exercises intraday-to-daily alignment");
    const page = await makePage(t, { width });
    for (const [range, rangeDays] of [["7d", 7], ["90d", 90], ["1y", 365]]) {
      await page.locator(`[data-gpu-range="${range}"]`).click();
      await page.waitForFunction(range => new URL(location.href).searchParams.get("range") === range, range);
      await assertMixedChart(page, expectedComparison(equityPayload, gpuPayload, rangeDays));
    }
    await page.locator('[data-gpu-range="90d"]').click();
    await assertMixedChart(page, expected);
    await assertTooltip(page, expected, "Home");
    await assertTooltip(page, expected, "End");
    await capture(page, "bundled-equity-GPU-demo-tooltip");
    const bounds = await page.locator(svg).boundingBox();
    assert(bounds.width > 0 && bounds.height > 0 && bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    await page.locator("[data-monitor-data-toggle]").click();
    assert.equal(await page.locator("[data-monitor-data-source-description]").textContent(), "",
      "The comparison source note is blank");
    assert.doesNotMatch(await page.locator("[data-monitor-data]").innerText(), /EODHD|not connected/i);
    assert.doesNotMatch(await page.locator("[data-monitor-data]").innerText(), /\b(?:demo|estimate|estimated)\b/i);
    await capture(page, "bundled-equity-GPU-demo-source");

    // Repeat same-document family changes, including a command issued directly
    // after a GPU tab click. No wait for a visual transition is required.
    for (let iteration = 0; iteration < 2; iteration += 1) {
      await page.locator('[data-catalog-entry-key="preset-gpu-index-h200"]').click();
      await ready(page, "gpu-index");
      const lastGpu = await page.locator(`${lines}.is-selected`).evaluate(node => {
        const point = node.__data__.at(-1);
        return [+point.date / 1000, point.value];
      });
      assert.deepEqual(lastGpu, gpuPayload.series.H200.at(-1).slice(0, 2));
      await compareCommand(page);
      await assertMixedChart(page, expected);
    }
    // The top-level Craft action intentionally opens a neutral new draft. Use
    // an explicitly authored URL for this separate controls/layout screenshot.
    const craftUrl = new URL(mixedUrl());
    craftUrl.searchParams.set("view", "craft");
    await page.goto(craftUrl.href, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.documentElement.dataset.deskView === "craft" &&
      document.querySelector("[data-gpu-benchmark-card]")?.dataset.craftEmpty === "false");
    await page.locator("[data-card-compare-toggle]").click();
    for (const id of ["H100", "H200"]) {
      const control = page.locator(`[data-card-layer="${id}"]`);
      assert(await control.isVisible());
      assert.equal(await control.getAttribute("aria-pressed"), "true");
      const bounds = await control.boundingBox();
      assert(bounds.width > 0 && bounds.height > 0 && bounds.x >= 0 && bounds.x + bounds.width <= width + 1,
        `${id} comparison control is clipped`);
    }
    assert.equal(new URL(page.url()).searchParams.get("symbol"), "NVDA");
    await capture(page, "bundled-equity-GPU-demo-Craft-Data");
  });
}

for (const [gap, width] of [["missing-equity", 1440], ["missing-H200", 1440],
  ["no-common-dates", 1440], ["missing-H200", 390]]) {
  test(`TEST FIXTURE ${gap} clears the complete comparison, not just one line (${engine}, ${width})`, async t => {
    const page = await makePage(t, { width, gap });
    await page.locator("[data-gpu-state]").waitFor({ state: "visible" });
    assert((await page.locator("[data-gpu-state]").innerText()).trim().length > 0);
    assert.deepEqual(new URL(page.url()).searchParams.get("layers").split(","), ids);
    assert.equal(await page.locator(lines).count(), 0);
    assert.equal(await page.locator(`${svg} .gpu-benchmark__plot-root`).count(), 0);
    assert.equal(await page.locator(`${svg} .gpu-benchmark__band`).count(), 0);
    assert.equal(await page.locator(slider).count(), 0);
    assert.equal(await page.locator("[data-gpu-tooltip]").isVisible(), false);
    assert.equal((await page.locator("[data-gpu-range-start]").innerText()).trim(), "—");
    assert.equal((await page.locator("[data-gpu-range-end]").innerText()).trim(), "—");
    await capture(page, `TEST-FIXTURE-${gap}`);
  });
}
