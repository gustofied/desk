import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after, before } from "node:test";
import { normalizeCardVisualization } from "../../src/card-document.js";

// Local runtime only, with canonical pins in a disposable browser context.
const moduleName = process.env.DESK_PLAYWRIGHT_MODULE || "playwright";
const playwright = await import(isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const engine = process.env.DESK_BROWSER_ENGINE || "chromium";
const baseUrl = process.env.DESK_BASE_URL || "http://127.0.0.1:4173";
const screenshots = process.env.DESK_SCREENSHOT_DIR || "/private/tmp/desk-quote-pin-preview";
const storageKey = "desk.market-watchlist.v1";
const items = [
  { id: "preview-gpu", cardId: "gpu-index", label: "H200", state: normalizeCardVisualization("gpu-index",
    { gpu: "H200", layers: ["H200"], range: "7d", scale: "price", palette: "linen", theme: "dark" }) },
  { id: "preview-quote", cardId: "quote-view", label: "Quote 041", state: normalizeCardVisualization("quote-view",
    { gpu: "B200", quote: 3.65, quantity: 256, rfs: "2026-10", palette: "linen", theme: "dark" }) },
];
let browser;
before(async () => {
  assert(["chromium", "webkit"].includes(engine));
  await mkdir(screenshots, { recursive: true });
  browser = await playwright[engine].launch({ headless: true,
    ...(process.env.DESK_BROWSER_PATH ? { executablePath: process.env.DESK_BROWSER_PATH } : {}) });
});
after(async () => { await browser?.close(); });

async function showPreview(page, id) {
  await page.locator("[data-command-open]").focus();
  const button = page.locator(`[data-market-instrument="${id}"] button`);
  await button.scrollIntoViewIfNeeded();
  await button.focus();
  await page.locator(`[data-market-preview][data-instrument="${id}"]`).waitFor({ state: "visible" });
}

async function bounds(page) {
  return page.locator("[data-market-preview]").evaluate(root => {
    const box = node => { const r = node.getBoundingClientRect(); return {
      width: r.width, height: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right,
    }; };
    const get = selector => root.querySelector(selector);
    const remove = get("[data-market-preview-remove]");
    const r = remove.getBoundingClientRect();
    return {
      outer: box(root), chart: box(get("[data-market-preview-open]")),
      artifact: box(get(".desk-market-preview__artifact")),
      actions: box(get(".desk-market-preview__actions")), svg: box(get("svg")),
      innerBottom: root.getBoundingClientRect().bottom - parseFloat(getComputedStyle(root).borderBottomWidth),
      signalBottom: Math.max(...[...root.querySelectorAll(".quote-view__flow-signal line")].map(node => box(node).bottom)),
      headerBottom: get(".deal-view__head") ? box(get(".deal-view__head")).bottom : null,
      pathTop: Math.min(...[...root.querySelectorAll(".deal-view__negotiation-line")].map(node => box(node).top)),
      actionZ: getComputedStyle(get(".desk-market-preview__actions")).zIndex,
      removeHit: remove.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)),
    };
  });
}

const near = (actual, expected, message) => assert(Math.abs(actual - expected) < 1, `${message}: ${actual} vs ${expected}`);
for (const width of [1440, 390]) {
  test(`Quote preview retains full card height and Open/Unpin work at ${width}px`, async t => {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 },
      reducedMotion: "reduce", isMobile: width === 390, hasTouch: width === 390 });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    t.after(async () => {
      await page.unrouteAll({ behavior: "wait" });
      await context.close();
      assert.deepEqual(errors, [], "Uncaught page errors");
    });
    await page.route("**/*", route => new URL(route.request().url()).origin === new URL(baseUrl).origin
      ? route.continue() : route.abort());
    await context.addInitScript(({ key, items }) => localStorage.setItem(key, JSON.stringify({ version: 1, items })),
      { key: storageKey, items });
    await page.goto(new URL("/?card=gpu-index&view=monitor&gpu=H200&layers=H200&range=7d&scale=price&palette=linen&theme=dark", baseUrl).href,
      { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelector("[data-gpu-benchmark-card]")?.dataset.cardReady === "true");
    await page.evaluate(() => { window.__quotePreviewDocument = document.documentElement; });
    await showPreview(page, "preview-gpu");
    const regular = await bounds(page);
    await showPreview(page, "preview-quote");
    const quote = await bounds(page);
    near(regular.actions.height, 32, "Original footer height");
    near(quote.outer.height, regular.outer.height, "Retained outer card height");
    near(quote.chart.height, regular.chart.height + regular.actions.height, "Chart occupies former footer");
    near(quote.artifact.height, quote.chart.height, "Artifact fills chart");
    near(quote.svg.bottom, quote.innerBottom, "SVG reaches inner bottom");
    near(quote.signalBottom, quote.innerBottom, "Signal stems reach inner bottom");
    assert(quote.headerBottom <= quote.pathTop + 1, "Header clears chart paths");
    assert(quote.outer.left >= 0 && quote.outer.right <= width, "Preview fits viewport");
    assert(quote.removeHit && Number(quote.actionZ) >= 2, "Unpin is above the chart and clickable");
    await page.locator("[data-market-preview]").screenshot({ path: join(screenshots, `RESTORED-${engine}-${width}-tight.png`) });
    console.log(JSON.stringify({ engine, width, outerHeight: quote.outer.height,
      originalFooter: regular.actions.height, chartHeight: quote.chart.height, svgBottom: quote.svg.bottom,
      signalBottom: quote.signalBottom, innerBottom: quote.innerBottom }));
    await page.locator("[data-market-preview-open]").click();
    await page.waitForFunction(() => document.querySelector("[data-gpu-benchmark-card]")?.dataset.cardId === "quote-view"
      && document.documentElement.dataset.deskView === "monitor");
    assert.equal(new URL(page.url()).searchParams.get("quote"), "3.65");
    assert(await page.evaluate(() => window.__quotePreviewDocument === document.documentElement), "Open does not reload");
    const openedUrl = page.url();
    await showPreview(page, "preview-quote");
    await page.locator("[data-market-preview-remove]").click();
    await page.locator("[data-market-preview]").waitFor({ state: "hidden" });
    const remaining = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).items, storageKey);
    assert.deepEqual(remaining.map(item => item.id), ["preview-gpu"]);
    assert.deepEqual(remaining[0].state, items[0].state);
    assert.equal(page.url(), openedUrl, "Unpin preserves chart and URL");
  });
}
