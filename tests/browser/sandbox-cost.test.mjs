import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after, before } from "node:test";
import { normalizeCardVisualization } from "../../src/card-document.js";
import { ALL_CARDS_CATALOG_ID } from "../../src/catalog-collections.js";
import { createSharedDesk, encodeSharedDesk } from "../../src/shared-desk.js";

// Archived public benchmark snapshot only. No provider requests or user storage.
const moduleName = process.env.DESK_PLAYWRIGHT_MODULE || "playwright";
const playwright = await import(isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const engine = process.env.DESK_BROWSER_ENGINE || "chromium";
const baseUrl = process.env.DESK_BASE_URL || "http://127.0.0.1:4173";
const screenshotDir = process.env.DESK_SCREENSHOT_DIR || "/private/tmp/desk-sandbox-qa";
const monitorSvg = "[data-gpu-chart-svg]";
const focusSvg = "[data-focus-card-monitor] svg";
const gallery = "[data-card-gallery-grid] .desk-gallery-card";
const sandboxSnapshot = JSON.parse(await readFile(new URL("../../data/sandbox-cost.json", import.meta.url), "utf8"));
let browser;
before(async () => {
  await mkdir(screenshotDir, { recursive: true });
  browser = await playwright[engine].launch({ headless: true,
    ...(process.env.DESK_BROWSER_PATH ? { executablePath: process.env.DESK_BROWSER_PATH } : {}) });
});
after(async () => { await browser?.close(); });

function urlFor(view = "monitor", range = "now", { palette = "linen", theme = "dark" } = {}) {
  const url = new URL("/", baseUrl);
  for (const [key, value] of Object.entries({ card: "sandbox-cost", view, range, palette, theme })) {
    url.searchParams.set(key, value);
  }
  return url.href;
}
async function ready(page) {
  await page.waitForFunction(() => document.querySelector("[data-gpu-benchmark-card]")?.dataset.cardReady === "true");
}
async function makePage(t, width = 1440, url = urlFor(), pins = [], contextOptions = {}) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 },
    reducedMotion: "reduce", isMobile: width === 390, hasTouch: width === 390, ...contextOptions });
  if (pins.length) await context.addInitScript(items => {
    localStorage.setItem("desk.market-watchlist.v1", JSON.stringify({ version: 1, items }));
  }, pins);
  const page = await context.newPage();
  const errors = [];
  page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    // WebKit logs an unsupported, optional Chromium viewport hint as an error.
    const ignoredViewportHint = message.text() === 'Viewport argument key "interactive-widget" not recognized and ignored.';
    if (message.type() === "error" && !ignoredViewportHint && !message.text().includes("Failed to load resource")) errors.push(message.text());
  });
  t.after(async () => {
    await page.unrouteAll({ behavior: "wait" });
    await context.close();
    assert.deepEqual(errors, [], "Unexpected page errors");
  });
  await page.route("**/*", route => new URL(route.request().url()).origin === new URL(baseUrl).origin
    ? route.continue() : route.abort());
  await page.goto(url, { waitUntil: "networkidle" });
  await ready(page);
  await page.evaluate(async () => { await document.fonts.ready; window.__sandboxDocument = document.documentElement; });
  return page;
}
async function capture(page, name) {
  await page.screenshot({ path: join(screenshotDir, `${engine}-${page.viewportSize().width}-${name}.png`),
    animations: "disabled", fullPage: true });
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
async function assertSurface(page, selector) {
  const svg = typeof selector === "string" ? page.locator(selector) : selector;
  await svg.waitFor({ state: "visible" });
  assert.equal(await svg.locator("[data-sandbox-provider]").count(), 6);
  assert.equal(await svg.locator("[data-sandbox-summary], [data-sandbox-summary-tile]").count(), 0);
  assert.equal(await svg.locator("[data-sandbox-average]").count(), 0, "Average headline is Gallery-only");
  assert.equal(await svg.locator(".gpu-benchmark__plot-root, [data-power-basis-line], [data-bar-value]").count(), 0);
  const text = await svg.textContent();
  for (const name of ["Novita", "Daytona", "Blaxel", "E2B", "Modal"]) assert(text.includes(name), name);
  assert(text.includes("¢"), "Cents, not GPU-hour prices");
  const geometry = await svg.evaluate(svg => {
    const box = node => {
      const { left, top, right, bottom } = node.getBoundingClientRect();
      return { left, top, right, bottom };
    };
    const canvas = svg.querySelector("[data-sandbox-canvas]");
    const labels = [...svg.querySelectorAll("[data-sandbox-label], [data-sandbox-latest-value]")];
    return { svg: box(svg), canvas: canvas ? box(canvas) : null, labels: labels.map(node => ({
      text: node.textContent, size: parseFloat(getComputedStyle(node).fontSize) * Math.abs(node.getScreenCTM().a),
      box: box(node),
    })) };
  });
  assert(geometry.canvas, "Chart has a measurable canvas");
  for (const edge of ["left", "top", "right", "bottom"]) {
    assert(Math.abs(geometry.svg[edge] - geometry.canvas[edge]) <= 2,
      `Canvas fills SVG without letterboxing at ${edge}: ${JSON.stringify(geometry)}`);
  }
  assert.equal(geometry.labels.length, 12, "Every provider has a label and value");
  for (const label of geometry.labels) {
    assert(label.size >= 11.8, `${label.text} renders at ${label.size.toFixed(2)}px, below 11.8px`);
    for (const edge of ["left", "top"]) assert(label.box[edge] >= geometry.canvas[edge] - 1, `${label.text} clips at ${edge}`);
    for (const edge of ["right", "bottom"]) assert(label.box[edge] <= geometry.canvas[edge] + 1, `${label.text} clips at ${edge}`);
  }
  assert(await page.evaluate(() => window.__sandboxDocument === document.documentElement), "In-place navigation");
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "No page overflow");
}

async function assertGallerySurface(page, svg, { title = "Sandbox cost" } = {}) {
  await svg.waitFor({ state: "visible" });
  assert.equal(await svg.getAttribute("viewBox"), "0 0 1200 675");
  assert.equal(await svg.locator("[data-sandbox-provider]").count(), 6);
  assert.equal(await svg.locator("[data-sandbox-summary], [data-sandbox-summary-tile]").count(), 0);
  assert.equal(await svg.locator("[data-sandbox-label], [data-sandbox-latest-value], [data-sandbox-provider] text").count(), 0,
    "Gallery removes provider names and individual cost labels, not their series");
  assert.equal(await svg.locator(".gpu-benchmark__plot-root, [data-power-basis-line], [data-bar-value]").count(), 0);
  assert.equal(await svg.locator("[data-view-artifact-header]").count(), 1, "Gallery reuses the shared artifact header");
  assert.equal(await svg.locator("[data-sandbox-average]").count(), 1, "Gallery has one average headline");
  assert.equal(await svg.locator("[data-sandbox-average-label]").count(), 0, "The visible AVG tag is removed");
  const result = await svg.evaluate(svg => {
    const box = node => {
      const { left, top, right, bottom, width } = node.getBoundingClientRect();
      return { left, top, right, bottom, width };
    };
    const paintedBox = node => {
      const result = box(node);
      const style = getComputedStyle(node);
      // SVG text rectangles include the font's unused ascent/descent space.
      // Use actual glyph ink vertically before testing the shared headline.
      if (node.tagName === "text") {
        const context = document.createElement("canvas").getContext("2d");
        context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const metrics = context.measureText(node.textContent);
        const origin = svg.createSVGPoint();
        origin.x = node.x.baseVal[0].value;
        origin.y = node.y.baseVal[0].value;
        const matrix = node.getScreenCTM();
        const baseline = origin.matrixTransform(matrix);
        result.top = baseline.y - metrics.actualBoundingBoxAscent * Math.abs(matrix.d);
        result.bottom = baseline.y + metrics.actualBoundingBoxDescent * Math.abs(matrix.d);
      }
      const radius = style.stroke === "none" ? 0 : parseFloat(style.strokeWidth) / 2
        * (style.vectorEffect === "non-scaling-stroke" ? 1 : Math.abs(node.getScreenCTM().a));
      return { left: result.left - radius, top: result.top - radius, right: result.right + radius, bottom: result.bottom + radius };
    };
    const root = svg.querySelector("[data-sandbox-chart]");
    return { range: root.dataset.sandboxChart, layout: root.dataset.sandboxLayout,
      svg: box(svg), width: svg.clientWidth,
      canvas: box(root.querySelector("[data-sandbox-canvas]")),
      texts: [...root.querySelectorAll("text")].filter(node => !node.closest("[data-sandbox-readout]"))
        .map(node => ({ text: node.textContent, box: paintedBox(node),
          inHeader: !!node.closest("[data-view-artifact-header], [data-sandbox-average]") })),
      providers: [...root.querySelectorAll("[data-sandbox-provider]")].map(provider => {
        const paths = [...provider.querySelectorAll("[data-sandbox-history]")];
        const line = marker => {
          const node = provider.querySelector(`[data-sandbox-${marker}]`);
          return node && Object.fromEntries(["x1", "x2", "y1", "y2", "stroke-width"].map(name => [name, Number(node.getAttribute(name))]));
        };
        return { id: provider.dataset.sandboxProvider, paths: paths.map(box),
          graphics: [...provider.querySelectorAll("line, path, circle")].map(paintedBox),
          guide: provider.querySelector(":scope > line") && box(provider.querySelector(":scope > line")),
          whisker: line("whisker"), iqr: line("iqr"), median: line("median"),
          observations: paths.reduce((sum, path) => sum + Number(path.dataset.sandboxHistoryObservations), 0) };
      }) };
  });
  assert.equal(result.layout, "gallery");
  for (const edge of ["left", "top", "right", "bottom"]) {
    assert(Math.abs(result.svg[edge] - result.canvas[edge]) <= 2, `Gallery canvas fills SVG at ${edge}`);
  }
  assert.deepEqual(result.providers.map(provider => provider.id).sort(), sandboxSnapshot.providers.map(provider => provider.id).sort());
  const end = Math.max(...sandboxSnapshot.providers.flatMap(provider => provider.history.map(point => point.time)));
  const cutoff = result.range === "7d" ? end - 6 * 86400000 : -Infinity;
  const start = Math.min(...sandboxSnapshot.providers.flatMap(provider => provider.history.filter(point => point.time >= cutoff).map(point => point.time)));
  const average = sandboxSnapshot.providers.reduce((sum, provider) => sum
    + (result.range === "now" ? provider.median : provider.history.filter(point => point.time >= cutoff).at(-1).value), 0)
    / sandboxSnapshot.providers.length;
  const headline = `${(average * 100).toFixed(2)}¢`;
  assert.equal(headline, result.range === "now" ? "3.42¢" : "3.48¢");
  assert(Math.abs(Number(await svg.locator("[data-sandbox-average]").getAttribute("data-value")) - average) < 1e-12,
    "Headline retains the unrounded mean of all six displayed providers");
  assert.equal(await svg.locator("[data-sandbox-average]").getAttribute("data-provider-count"), "6");
  const summary = await svg.locator("[data-sandbox-average]").getAttribute("data-summary");
  assert(summary?.includes(headline) && /average|mean/i.test(summary), "Accessible summary explains the displayed average");
  assert((await svg.evaluate(svg => svg.closest("button")?.getAttribute("aria-label")))?.includes(summary),
    "Gallery card accessible name includes its average summary");
  assert.deepEqual(result.texts.map(item => item.text).sort(), [title, result.range === "now" ? "LATEST" : result.range.toUpperCase(), headline].sort(),
    "Only the shared title, range and average headline remain visible; no AVG or bottom axis text");
  assert(result.texts.every(item => item.inHeader), "All visible text belongs to the shared header or average group");
  for (const [index, item] of result.texts.entries()) {
    assert(item.box.left >= result.canvas.left - 1 && item.box.right <= result.canvas.right + 1
      && item.box.top >= result.canvas.top - 1 && item.box.bottom <= result.canvas.bottom + 1, `${item.text} fits within the Gallery card`);
    for (const other of result.texts.slice(index + 1)) {
      assert(item.box.right <= other.box.left + 0.5 || item.box.left >= other.box.right - 0.5
        || item.box.bottom <= other.box.top + 0.5 || item.box.top >= other.box.bottom - 0.5,
      `${item.text} does not overlap ${other.text}: ${JSON.stringify([item.box, other.box])}`);
    }
  }
  const headerBottom = Math.max(...result.texts.map(item => item.box.bottom));
  const lowest = sandboxSnapshot.providers.reduce((a, b) => a.minimum < b.minimum ? a : b);
  const highest = sandboxSnapshot.providers.reduce((a, b) => a.maximum > b.maximum ? a : b);
  const lowX = result.providers.find(provider => provider.id === lowest.id).whisker?.x1;
  const highX = result.providers.find(provider => provider.id === highest.id).whisker?.x2;
  const latestScale = value => lowX + (value - lowest.minimum) / (highest.maximum - lowest.minimum) * (highX - lowX);
  if (result.range === "now") {
    assert(Math.abs(lowX) <= 0.01 && Math.abs(highX - 1200) <= 0.01,
      "The common observed minimum and maximum touch opposite Gallery edges");
    assert.equal(await svg.locator("[data-sandbox-chart] > line").count(), 0,
      "Gallery Latest removes the vertical grid, retaining only provider row guides");
  }
  for (const provider of result.providers) {
    const source = sandboxSnapshot.providers.find(item => item.id === provider.id);
    const history = source.history.filter(point => point.time >= cutoff);
    assert(provider.graphics.length > 0, `${source.label} keeps its graphics`);
    for (const graphic of provider.graphics) assert(graphic.top >= headerBottom - 0.5,
      `${source.label} graphics do not overlap the shared headline`);
    if (result.range === "now") {
      assert(provider.whisker && provider.iqr && provider.median, `${source.label} retains its full distribution`);
      assert(Math.abs(provider.guide.left - result.canvas.left) <= 0.5
        && Math.abs(provider.guide.right - result.canvas.right) <= 0.5, "Every distribution row guide is full-bleed");
      for (const [mark, key, value] of [["whisker", "x1", source.minimum], ["whisker", "x2", source.maximum],
        ["iqr", "x1", source.p25], ["iqr", "x2", source.p75], ["median", "x1", source.median]]) {
        assert(Math.abs(provider[mark][key] - latestScale(value)) <= 0.15, `${source.label} ${mark} retains the recorded cost on the shared scale`);
      }
      for (const [mark, width] of [["median", 1.5], ["iqr", 3], ["whisker", 1.25]]) {
        assert.equal(provider[mark]["stroke-width"], width, `${mark} stays legible at every Gallery size`);
      }
      continue;
    }
    assert.equal(provider.observations, history.length, `${source.label} retains every recorded history point`);
    const left = Math.min(...provider.paths.map(path => path.left));
    const right = Math.max(...provider.paths.map(path => path.right));
    const expectedX = time => result.canvas.left + (time - start) / (end - start) * result.canvas.width;
    assert(Math.abs(left - expectedX(history[0].time)) <= 2, `${source.label} history begins at its full-width date position`);
    assert(Math.abs(right - expectedX(history.at(-1).time)) <= 2, `${source.label} history ends at its full-width date position`);
  }
  assert(await page.evaluate(() => window.__sandboxDocument === document.documentElement), "In-place navigation");
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "No page overflow");
}

async function inspectArtifactSurfaces(page, pins, appearance) {
  const suffix = `${appearance.palette}-${appearance.theme}`;
  for (const pin of pins) {
    await page.locator("[data-command-open]").focus();
    // Touch activates a pin directly; its focus preview belongs to keyboard mode.
    await page.keyboard.press("Tab");
    const button = page.locator(`[data-market-instrument="${pin.id}"] button`);
    await button.scrollIntoViewIfNeeded();
    await button.focus();
    await page.locator(`[data-market-preview][data-instrument="${pin.id}"]`).waitFor({ state: "visible" });
    await assertSurface(page, "[data-market-preview] svg");
    assert.equal(await page.locator("[data-market-preview] svg").getAttribute("viewBox"), "0 0 1200 675", "Pinned preview keeps its existing aspect ratio");
    if (pin.state.range !== "now") assert.equal(await page.locator("[data-market-preview] [data-sandbox-chart]").getAttribute("data-sandbox-layout"), "inline",
      "Gallery-only changes leave the compact pinned layout unchanged");
    await capture(page, `pin-${pin.state.range}-${suffix}`);
    if (page.viewportSize().width > 390) {
      await page.goto(urlFor("card", pin.state.range, appearance), { waitUntil: "networkidle" });
      await ready(page);
      await page.evaluate(() => { window.__sandboxDocument = document.documentElement; });
      await assertSurface(page, focusSvg);
      assert.equal(await page.locator(focusSvg).getAttribute("viewBox"), "0 0 1200 675", "Focus keeps its existing aspect ratio");
      assert.equal(await page.locator(`${focusSvg} [data-sandbox-chart]`).getAttribute("data-sandbox-layout"), "full", "Focus keeps its full-width chart layout");
      await capture(page, `focus-${pin.state.range}-${suffix}`);
    }
  }
  const snapshot = createSharedDesk({ name: "Sandbox", entries: pins.map(pin => ({
    cardId: pin.cardId, name: pin.label, state: pin.state,
  })), ...appearance });
  const url = new URL("/?view=gallery", baseUrl);
  url.hash = `desk=${encodeSharedDesk(snapshot)}`;
  await page.goto(url.href, { waitUntil: "networkidle" });
  await ready(page);
  await page.evaluate(() => { window.__sandboxDocument = document.documentElement; });
  await page.waitForFunction(selector => document.querySelectorAll(`${selector} [data-sandbox-chart]`).length === 2, gallery);
  for (const [index, svg] of (await page.locator(`${gallery} svg`).all()).entries()) {
    await assertGallerySurface(page, svg, { title: pins[index].label });
  }
  await capture(page, `gallery-${suffix}`);
}

async function inspectTooltip(page, provider, point, { latest = false, edge = "right" } = {}) {
  const hit = page.locator(`${monitorSvg} [data-sandbox-hit="${provider.id}"]`);
  const box = await hit.boundingBox();
  assert(box, `${provider.label} has a pointer target`);
  const position = { x: edge === "left" ? 2 : box.width - 2, y: box.height / 2 };
  if (page.viewportSize().width === 390) await hit.tap({ position });
  else await hit.hover({ position });
  const readout = page.locator(`${monitorSvg} [data-sandbox-readout]`);
  await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute("visibility") === "visible",
    `${monitorSvg} [data-sandbox-readout]`);
  const date = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
    .format(point.time).toUpperCase();
  assert.equal(await readout.locator("[data-sandbox-tooltip-title]").textContent(), provider.label);
  assert.equal(await readout.locator("[data-sandbox-readout-date]").textContent(), date);
  assert.equal(await readout.locator("[data-sandbox-readout-value]").textContent(),
    `${(point.value * 100).toFixed(2)}¢${latest ? " median" : ""}`);
  if (latest) {
    const detail = await readout.locator("[data-sandbox-tooltip-detail]").textContent();
    const costRange = `${(provider.p25 * 100).toFixed(2)}¢ – ${(provider.p75 * 100).toFixed(2)}¢`;
    assert.equal(detail, `${costRange}\u2003${Math.round(provider.runtime.median)}s`,
      `${provider.label} separates the recorded P25–P75 cost range and runtime with an em space`);
    assert.doesNotMatch(detail, /[·•]/, "Latest tooltip details contain no middle-dot or bullet separator");
  }
  const bounds = await page.locator(`${monitorSvg} [data-sandbox-tooltip]`).evaluate(tooltip => {
    const rect = element => {
      const { left, top, right, bottom } = element.getBoundingClientRect();
      return { left, top, right, bottom };
    };
    return { box: rect(tooltip.querySelector("rect")), svg: rect(tooltip.ownerSVGElement),
      text: Array.from(tooltip.querySelectorAll("text")).filter(node => node.textContent).map(rect),
      title: rect(tooltip.querySelector("[data-sandbox-tooltip-title]")),
      date: rect(tooltip.querySelector("[data-sandbox-readout-date]")), viewport: innerWidth };
  });
  const inside = (inner, outer) => inner.left >= outer.left - 1 && inner.top >= outer.top - 1
    && inner.right <= outer.right + 1 && inner.bottom <= outer.bottom + 1;
  assert(inside(bounds.box, bounds.svg), `${provider.label} tooltip stays inside the chart`);
  assert(bounds.box.left >= 0 && bounds.box.right <= bounds.viewport, "Tooltip stays within the viewport");
  for (const text of bounds.text) assert(inside(text, bounds.box), `${provider.label} tooltip text stays inside its box`);
  assert(bounds.title.right + 3 <= bounds.date.left, `${provider.label} title and date do not overlap`);
}

for (const width of [1440, 390]) {
  test(`Latest distribution and history work at ${width}px`, async t => {
    const page = await makePage(t, width);
    await assertSurface(page, monitorSvg);
    const values = await page.locator(`${monitorSvg} [data-sandbox-latest-value]`).allTextContents();
    for (const price of ["1.33", "1.48", "1.51", "2.78", "4.35", "9.04"]) assert(values.join(" ").includes(price), price);
    assert.equal(await page.locator('[data-gpu-range="now"]').innerText(), "LATEST");
    await capture(page, "latest");
    for (const range of ["7d", "all", "now", "7d"]) {
      await page.locator(`[data-gpu-range="${range}"]`).click();
      await assertSurface(page, monitorSvg);
      assert.equal(new URL(page.url()).searchParams.get("range"), range);
    }
    await capture(page, "history");
    await page.locator("[data-monitor-data-toggle]").click();
    const source = page.locator("[data-monitor-data-body]");
    await source.waitFor({ state: "visible" });
    assert.match(await source.innerText(), /batch|methodolog/i);
    assert.match(await page.locator("[data-monitor-data-source-link]").getAttribute("href"), /starslingdev\/hpc-sandbox-benchmarks/);
    assert.equal(await source.locator('[data-monitor-data-cli]:visible').count(), 0);
    await capture(page, "history-source");
  });
}

for (const width of [1440, 390]) {
  for (const appearance of [{ palette: "azure", theme: "dark" }, { palette: "sage", theme: "light" }]) {
    test(`Sandbox ${width === 390 ? "tap" : "hover"} tooltips show recorded values within bounds at ${width}px in ${appearance.theme} ${appearance.palette}`, async t => {
      const pins = ["now", "7d"].map(range => ({ id: `sandbox-${range}`, cardId: "sandbox-cost",
        label: range === "now" ? "Sandbox cost" : "Sandbox history",
        state: normalizeCardVisualization("sandbox-cost", { provider: "novita",
          layers: sandboxSnapshot.providers.map(provider => provider.id), range, ...appearance }) }));
      const page = await makePage(t, width, urlFor("monitor", "now", appearance), pins);
      await assertSurface(page, monitorSvg);
      assert.deepEqual(await page.evaluate(() => ({ palette: document.documentElement.dataset.palette,
        theme: document.documentElement.dataset.theme })), appearance);
      const suffix = `${appearance.palette}-${appearance.theme}`;
      await capture(page, `latest-${suffix}`);
      for (const provider of sandboxSnapshot.providers) {
        await inspectTooltip(page, provider, { time: sandboxSnapshot.asOf, value: provider.median }, { latest: true });
      }
      await capture(page, `latest-tooltip-${suffix}`);
      await page.locator('[data-gpu-range="7d"]').click();
      await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute("data-sandbox-chart") === "7d",
        `${monitorSvg} [data-sandbox-chart]`);
      await assertSurface(page, monitorSvg);
      await capture(page, `history-${suffix}`);
      const end = Math.max(...sandboxSnapshot.providers.flatMap(provider => provider.history.map(point => point.time)));
      for (const provider of sandboxSnapshot.providers) {
        const history = provider.history.filter(point => point.time >= end - 6 * 86400000);
        await inspectTooltip(page, provider, history[0], { edge: "left" });
        await inspectTooltip(page, provider, history.at(-1));
      }
      await capture(page, `history-tooltip-${suffix}`);
      await inspectArtifactSurfaces(page, pins, appearance);
    });
  }
}

test("Dense All views Gallery shows one average and six enlarged charts at Retina scale through container resizing", async t => {
  const page = await makePage(t, 1440, urlFor("gallery", "now", { palette: "azure", theme: "dark" }), [],
    { deviceScaleFactor: 2, reducedMotion: "no-preference" });
  await page.locator("[data-catalog-switcher]").focus();
  await page.keyboard.press("ArrowDown");
  await page.locator(`[data-catalog-collection="${ALL_CARDS_CATALOG_ID}"]`).click();
  const latest = page.locator(`${gallery} svg`).filter({ has: page.locator('[data-sandbox-chart="now"]') }).first();
  const history = page.locator(`${gallery} svg`).filter({ has: page.locator('[data-sandbox-chart="7d"]') }).first();
  await latest.waitFor({ state: "visible" });
  assert(await page.locator(gallery).count() >= 5, "Exercise the dense All views grid, not the two-card Sandbox collection");
  const initial = await latest.boundingBox();
  assert(initial.width >= 208 && initial.width <= 240, `Dense fixture is ${initial.width}px wide`);
  await latest.screenshot({ path: join(screenshotDir, `${engine}-dense-latest-current-dpr2.png`), animations: "disabled" });
  await assertGallerySurface(page, latest);
  await assertGallerySurface(page, history);
  await latest.screenshot({ path: join(screenshotDir, `${engine}-dense-latest-native-dpr2.png`), animations: "disabled" });
  await history.screenshot({ path: join(screenshotDir, `${engine}-dense-history-native-dpr2.png`), animations: "disabled" });
  await mkdir("/private/tmp/desk-sandbox-dense-gallery", { recursive: true });
  await latest.screenshot({ path: `/private/tmp/desk-sandbox-dense-gallery/${engine}-dpr2-all-latest-fixed.png`, animations: "disabled" });
  // Resize only the Gallery container, as a sidebar/layout change would. The
  // viewport and card data stay unchanged, so only resize observation can repaint.
  for (const width of [208, 225, 240, 286, 450, 208]) {
    await latest.evaluate(svg => { window.__sandboxPreResize = svg.querySelector("[data-sandbox-chart]"); });
    await page.locator("[data-card-gallery-grid]").evaluate((grid, width) => {
      grid.style.width = `${2 * (width + 2) + 12}px`;
      grid.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
    }, width);
    await page.waitForFunction(({ selector, width }) => {
      const svg = [...document.querySelectorAll(selector)].find(svg => svg.querySelector('[data-sandbox-chart="now"]'));
      return svg && Math.abs(svg.getBoundingClientRect().width - width) < 1
        && svg.querySelector("[data-sandbox-chart]") !== window.__sandboxPreResize;
    }, { selector: `${gallery} svg`, width });
    await assertGallerySurface(page, latest);
    await assertGallerySurface(page, history);
    if (width === 225) {
      await latest.screenshot({ path: join(screenshotDir, `${engine}-dense-latest-225-dpr2.png`), animations: "disabled" });
      await history.screenshot({ path: join(screenshotDir, `${engine}-dense-history-225-dpr2.png`), animations: "disabled" });
    }
  }
});

test("Sandbox catalog, focus, Craft, pins and shared desk preserve the native renderer", async t => {
  const page = await makePage(t, 1440, urlFor("gallery"));
  await page.locator("[data-catalog-switcher]").focus();
  await page.keyboard.press("ArrowDown");
  await page.locator('[data-catalog-collection="sandbox"]').click();
  await page.waitForFunction(selector => document.querySelectorAll(selector).length === 2, gallery);
  for (const svg of await page.locator(`${gallery} svg`).all()) await assertGallerySurface(page, svg);
  await capture(page, "gallery");
  await page.locator(gallery).first().click();
  await assertSurface(page, monitorSvg);
  await command(page, "catalog.focused-view", "focused");
  await assertSurface(page, focusSvg);
  await capture(page, "focus");
  await page.locator('[data-desk-mode="craft"]').click();
  await page.locator('[data-craft-type="sandbox-cost"]').click();
  await page.waitForFunction(() => document.querySelector('[data-gpu-chart-svg] [data-sandbox-provider]'));
  await page.evaluate(() => { window.__sandboxDocument = document.documentElement; });
  await assertSurface(page, monitorSvg);
  await command(page, "actions.pin-to-strip", "pin");
  const pins = await page.evaluate(() => JSON.parse(localStorage.getItem("desk.market-watchlist.v1")).items);
  const pin = pins.find(item => item.cardId === "sandbox-cost");
  assert(pin, "Sandbox pin saved");
  assert.equal(pin.state.range, "now");
  const snapshot = createSharedDesk({ name: "Sandbox", entries: [{ cardId: pin.cardId, name: pin.label, state: pin.state }],
    palette: "linen", theme: "dark" });
  const url = new URL("/?view=gallery", baseUrl);
  url.hash = `desk=${encodeSharedDesk(snapshot)}`;
  await page.goto(url.href, { waitUntil: "networkidle" });
  await ready(page);
  await page.evaluate(() => { window.__sandboxDocument = document.documentElement; });
  assert.equal(await page.locator(gallery).count(), 1);
  await page.locator(gallery).click();
  await assertSurface(page, monitorSvg);
});
