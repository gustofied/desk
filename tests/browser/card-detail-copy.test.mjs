import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after, before } from "node:test";

// Local preview and installed browsers only; all contexts/storage are disposable.
const moduleName = process.env.DESK_PLAYWRIGHT_MODULE || "playwright";
const playwright = await import(isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const engine = process.env.DESK_BROWSER_ENGINE || "chromium";
assert(["chromium", "webkit"].includes(engine));
const baseUrl = process.env.DESK_BASE_URL || "http://127.0.0.1:4173";
const screenshotDir = process.env.DESK_SCREENSHOT_DIR || "/private/tmp/desk-detail-copy-qa";
const cards = "[data-card-gallery-grid] .desk-gallery-card";
const descriptions = {
  gpu: "GPU rental rates in USD per GPU-hour, with the median and middle 50% price band.",
  snapshot: "The latest available rental rate for each selected GPU, in USD per GPU-hour.",
  depth: "US H100 capacity for 30-day rentals, in eight-GPU InfiniBand nodes. The target marks the lowest rate covering the requested capacity.",
  depthHistory: "Daily US H100 rental rates in USD per GPU-hour for the selected capacity target. Each InfiniBand node has eight GPUs on 30-day terms.",
  sandboxLatest: "Estimated CPU and memory cost per benchmark job, calculated from measured runtime and provider rates.",
  sandboxHistory: "Daily medians of CPU and memory cost estimates across benchmark batches. Each provider uses its own price scale.",
  deal: "Reserved-capacity negotiations, including quote revisions, capacity, contract terms and service dates.",
};
const chartCases = [
  ["gpu-index", "preset-gpu-index-h200", descriptions.gpu],
  ["gpu-price-snapshot", "preset-gpu-price-snapshot-prices", descriptions.snapshot],
  ["gpu-market-depth", "preset-gpu-market-depth-h100-us", descriptions.depth],
  ["power-basis", "preset-power-basis-pjm-dominion", "Hourly day-ahead and real-time wholesale electricity prices at PJM Dominion, in USD per MWh."],
  ["equities", "preset-equities-nvda", "Daily share-price series for NVIDIA, in USD per share."],
  ["sandbox-cost", "preset-sandbox-cost-cost", descriptions.sandboxLatest],
  ["deal-view", "preset-deal-view-deal-041", descriptions.deal],
  ["quote-view", "preset-quote-view-b200", null],
];
let browser;

before(async () => {
  await mkdir(screenshotDir, { recursive: true });
  browser = await playwright[engine].launch({ headless: true, timeout: 15000,
    ...(process.env.DESK_BROWSER_PATH ? { executablePath: process.env.DESK_BROWSER_PATH } : {}) });
});
after(async () => { await browser?.close(); });

async function makePage(t, { width = 1440, theme = "dark", motion = "reduce", touch = width <= 390 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: width <= 390 ? 844 : 900 },
    reducedMotion: motion, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  const errors = [];
  page.setDefaultTimeout(12000);
  page.on("pageerror", error => errors.push(error.message));
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, [], "Details or hover raised an uncaught error");
  });
  await context.route("**/*", route => new URL(route.request().url()).origin === new URL(baseUrl).origin
    ? route.continue() : route.abort());
  const url = new URL("/?card=gpu-index&view=gallery", baseUrl);
  url.searchParams.set("theme", theme);
  url.searchParams.set("palette", theme === "light" ? "sage" : "azure");
  await page.goto(url.href, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("[data-gpu-benchmark-card]")?.dataset.cardReady === "true");
  await page.evaluate(async () => { await document.fonts.ready; window.__detailCopyDocument = document.documentElement; });
  return page;
}

async function frames(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function allViews(page) {
  await page.locator("[data-catalog-switcher]").focus();
  await page.keyboard.press("ArrowDown");
  await page.locator("[data-catalog-menu]").waitFor({ state: "visible" });
  await page.locator('[data-catalog-collection="all"]').click();
  await page.locator("[data-catalog-menu]").waitFor({ state: "hidden" });
}

async function openChart(page, cardId, key) {
  const gallery = await page.evaluate(() => document.documentElement.dataset.deskLayout === "all");
  const target = page.locator(gallery ? `${cards}[data-catalog-id="${key}"]` : `[data-catalog-entry-key="${key}"]`);
  await target.click();
  await page.waitForFunction(cardId => document.querySelector("[data-gpu-benchmark-card]")?.dataset.cardId === cardId &&
    document.documentElement.dataset.deskView === "monitor", cardId);
  await frames(page);
  assert(await page.evaluate(() => window.__detailCopyDocument === document.documentElement), "Chart navigation should not reload");
}

function railName(cardId) { return cardId === "deal-view" ? "deal-journey" : "monitor-data"; }

async function assertIntro(page, cardId, text, expanded = false) {
  if (text === null) {
    for (const name of ["monitor-data", "deal-journey"]) {
      assert.equal(await page.locator(`[data-${name}]`).isVisible(), false, "Quote retains its no-rail layout");
      assert.equal(await page.locator(`[data-${name}-description]`).isVisible(), false, "No stale intro leaks onto Quote");
    }
    return;
  }
  const name = railName(cardId);
  const rail = page.locator(`[data-${name}]`);
  const intro = page.locator(`[data-${name}-description]`);
  const toggle = page.locator(`[data-${name}-toggle]`);
  const body = page.locator(`[data-${name}-body]`);
  await intro.waitFor({ state: expanded ? "visible" : "hidden" });
  assert.equal(await intro.textContent(), text);
  const placement = await intro.evaluate(node => ({ id: node.id, tag: node.tagName,
    parentInert: Boolean(node.closest("[inert]")), parentId: node.parentElement.id,
    firstChild: node.parentElement.firstElementChild === node, classes: [...node.classList] }));
  assert.equal(placement.tag, "P");
  assert.equal(placement.firstChild, true, "Description leads the expanded body");
  assert(placement.classes.includes("desk-data-rail__description"));
  assert.equal(placement.parentId, await toggle.getAttribute("aria-controls"));
  assert.equal(await body.getAttribute("role"), "region");
  assert.equal(await body.getAttribute("aria-labelledby"), await toggle.getAttribute("id"));
  assert((await body.getAttribute("aria-describedby") || "").split(/\s+/).includes(placement.id));
  assert.equal(await toggle.getAttribute("aria-describedby"), null, "Collapsed toggle must not announce hidden description text");
  assert.equal(await toggle.getAttribute("aria-expanded"), String(expanded));
  assert.equal(placement.parentInert, !expanded);
  if (expanded) {
    const alignment = await intro.evaluate(node => ({
      introLeft: node.getBoundingClientRect().left + parseFloat(getComputedStyle(node).paddingLeft),
      headingLeft: node.parentElement.previousElementSibling.querySelector("strong").getBoundingClientRect().left,
    }));
    assert(Math.abs(alignment.introLeft - alignment.headingLeft) <= 1, `Intro aligns with its detail heading: ${JSON.stringify(alignment)}`);
    const wrapping = await intro.evaluate(node => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      const range = document.createRange();
      range.selectNodeContents(node);
      return { scrollWidth: node.scrollWidth, clientWidth: node.clientWidth,
        scrollHeight: node.scrollHeight, clientHeight: node.clientHeight,
        left: rect.left + parseFloat(style.paddingLeft), right: rect.right - parseFloat(style.paddingRight),
        top: rect.top, bottom: rect.bottom, width: innerWidth,
        lines: [...range.getClientRects()].map(({ left, right, top, bottom }) => ({ left, right, top, bottom })) };
    });
    assert(wrapping.scrollWidth <= wrapping.clientWidth + 1 && wrapping.scrollHeight <= wrapping.clientHeight + 1,
      "Expanded description must not clip or overflow");
    assert(wrapping.lines.every(line => line.left >= wrapping.left - 1 && line.right <= wrapping.right + 1 &&
      line.top >= wrapping.top - 1 && line.bottom <= wrapping.bottom + 1), "Every line stays within the description box");
    if (wrapping.width === 390 && text.length > 75) assert(wrapping.lines.length >= 2, "Long descriptions wrap on mobile");
  } else {
    const toggleHeight = (await toggle.boundingBox()).height;
    const railHeight = (await rail.boundingBox()).height;
    assert.equal(toggleHeight, 48, "Collapsed header retains its 48px height");
    assert.equal(railHeight, toggleHeight + 2, "Collapsed rail reserves only the header and border");
  }
  const other = name === "monitor-data" ? "deal-journey" : "monitor-data";
  assert.equal(await page.locator(`[data-${other}]`).isVisible(), false);
  assert(await rail.isVisible());
}

async function expand(page, cardId, open) {
  const name = railName(cardId);
  const toggle = page.locator(`[data-${name}-toggle]`);
  if (await toggle.getAttribute("aria-expanded") !== String(open)) await toggle.click();
  const body = page.locator(`[data-${name}-body]`);
  await body.waitFor({ state: open ? "visible" : "hidden" });
  assert.equal(await body.evaluate(node => node.inert), !open);
}

async function clearance(page, cardId) {
  await page.evaluate(() => window.scrollTo({ top: document.scrollingElement.scrollHeight, behavior: "instant" }));
  await frames(page);
  const metrics = await page.evaluate(name => {
    const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
    return { rail: rect(`[data-${name}]`), strip: rect("[data-market-strip]"),
      chart: rect("#gpu-index-detail"), width: innerWidth, scrollWidth: document.documentElement.scrollWidth };
  }, railName(cardId));
  assert(metrics.strip.top - metrics.rail.bottom >= (metrics.width <= 640 ? 16 : 24) - 1,
    `Details must scroll clear of the fixed strip: ${JSON.stringify(metrics)}`);
  assert(metrics.rail.top - metrics.chart.bottom >= (metrics.width <= 640 ? 12 : 16) - 1);
  assert(metrics.scrollWidth <= metrics.width + 1, "Details must not introduce horizontal page overflow");
}

async function capture(page, name) {
  await page.screenshot({ path: join(screenshotDir, `${engine}-${page.viewportSize().width}-${name}.png`) });
}

for (const width of [1440, 390]) {
  test(`Chart descriptions appear only inside expanded details and navigate cleanly (${engine}, ${width})`, { timeout: 90000 }, async t => {
    const page = await makePage(t, { width });
    await allViews(page);
    for (const [cardId, key, text] of chartCases) {
      await openChart(page, cardId, key);
      await assertIntro(page, cardId, text);
      if (text === null) continue;
      await expand(page, cardId, false);
      await assertIntro(page, cardId, text);
      await clearance(page, cardId);
      if (["gpu-index", "gpu-market-depth", "sandbox-cost", "deal-view"].includes(cardId)) await capture(page, `${cardId}-collapsed`);
      if (cardId === "gpu-index") await page.locator("[data-monitor-data]").screenshot({
        path: join(screenshotDir, `${engine}-${width}-gpu-detail-rail.png`),
      });
      await expand(page, cardId, true);
      await assertIntro(page, cardId, text, true);
      await clearance(page, cardId);
      if (["gpu-index", "gpu-market-depth"].includes(cardId)) await page.locator("[data-monitor-data]").screenshot({
        path: join(screenshotDir, `${engine}-${width}-${cardId}-detail-rail-expanded.png`),
      });
      if (cardId === "gpu-index") {
        assert(await page.locator("[data-monitor-data-command-shell]").isVisible());
        assert.match(await page.locator("[data-monitor-data-command]").textContent(), /desk/);
      }
      if (cardId === "sandbox-cost") {
        const method = page.locator("[data-monitor-data-source-description]");
        assert(await method.isVisible());
        assert.equal(await method.textContent(), "Median and range across 12 runs.");
      }
      if (["gpu-index", "gpu-market-depth", "equities", "sandbox-cost", "deal-view"].includes(cardId)) await capture(page, `${cardId}-expanded`);
      await expand(page, cardId, false);
      await assertIntro(page, cardId, text);
    }
    await openChart(page, "deal-view", "preset-deal-view-deal-041");
    await assertIntro(page, "deal-view", descriptions.deal);
    if (width > 640) {
      await page.goto(new URL("/?card=gpu-index&view=card", baseUrl).href, { waitUntil: "networkidle" });
      await page.waitForFunction(() => document.documentElement.dataset.deskView === "catalog" &&
        document.documentElement.dataset.deskLayout === "focus");
      for (const name of ["monitor-data", "deal-journey"]) {
        assert.equal(await page.locator(`[data-${name}-description]`).isVisible(), false, "Focus keeps detail descriptions hidden");
      }
    }
  });

  test(`Range and chart-mode changes refresh hidden and expanded descriptions (${engine}, ${width})`, { timeout: 60000 }, async t => {
    const page = await makePage(t, { width });
    await allViews(page);
    await openChart(page, "sandbox-cost", "preset-sandbox-cost-cost");
    for (const [range, text] of [["7d", descriptions.sandboxHistory], ["now", descriptions.sandboxLatest], ["all", descriptions.sandboxHistory]]) {
      await page.locator(`[data-gpu-range="${range}"]`).click();
      await page.waitForFunction(range => new URL(location.href).searchParams.get("range") === range, range);
      await assertIntro(page, "sandbox-cost", text);
    }
    await expand(page, "sandbox-cost", true);
    await assertIntro(page, "sandbox-cost", descriptions.sandboxHistory, true);
    assert.equal(await page.locator("[data-monitor-data-source-description]").textContent(), "Methodology varies across runs.");
    await clearance(page, "sandbox-cost");
    await capture(page, "sandbox-history-expanded");
    await page.locator('[data-gpu-range="now"]').click();
    await page.waitForFunction(() => new URL(location.href).searchParams.get("range") === "now");
    await assertIntro(page, "sandbox-cost", descriptions.sandboxLatest, true);
    assert.equal(await page.locator("[data-monitor-data-source-description]").textContent(), "Median and range across 12 runs.");
    await clearance(page, "sandbox-cost");
    await capture(page, "sandbox-latest-expanded");
    await openChart(page, "gpu-market-depth", "preset-gpu-market-depth-h100-us");
    for (const [scale, text] of [["history", descriptions.depthHistory], ["depth", descriptions.depth]]) {
      await page.locator(`[data-depth-scale="${scale}"]`).click();
      await page.waitForFunction(scale => new URL(location.href).searchParams.get("scale") === scale, scale);
      await assertIntro(page, "gpu-market-depth", text);
      await expand(page, "gpu-market-depth", true);
      await assertIntro(page, "gpu-market-depth", text, true);
      await expand(page, "gpu-market-depth", false);
    }
    for (const [cardId, key, text] of [
      ["gpu-index", "preset-gpu-index-compute-market", "GPU rental rates and the token-price benchmark, compared from a shared starting date."],
      ["gpu-index", "preset-gpu-index-h100-b200-spread", "The difference between two GPUs’ rental-rate changes, in percentage points."],
      ["power-basis", "preset-power-basis-pjm-dominion", "Hourly day-ahead and real-time wholesale electricity prices at PJM Dominion, in USD per MWh."],
      ["power-basis", "preset-power-basis-ercot-north", "Hourly day-ahead and real-time wholesale electricity prices at ERCOT North, in USD per MWh."],
      ["power-basis", "preset-power-basis-pjm-west-spread", "Real-time minus day-ahead wholesale electricity prices at PJM West, in USD per MWh."],
      ["power-basis", "preset-power-basis-gpu-energy", "Estimated electricity cost per H100-hour, assuming a 10.2 kW eight-GPU system and 20% facility overhead."],
      ["equities", "preset-equities-msft", "Daily share-price series for Microsoft, in USD per share."],
      ["equities", "preset-equities-tsm", "Daily share-price series for Taiwan Semiconductor Manufacturing Company, in USD per share."],
      ["equities", "preset-equities-nvda", "Daily share-price series for NVIDIA, in USD per share."],
      ["equities", "preset-equities-chips", "Percentage changes in the selected share prices from a shared starting date."],
      ["equities", "preset-equities-nvidia-compute", "Share prices and GPU rental rates compared as percentage changes over shared dates."],
    ]) {
      await openChart(page, cardId, key);
      await assertIntro(page, cardId, text);
      await expand(page, cardId, true);
      await assertIntro(page, cardId, text, true);
      await clearance(page, cardId);
      await expand(page, cardId, false);
    }
  });
}

async function hoverStyle(card) {
  return card.evaluate(node => {
    const style = getComputedStyle(node);
    const overlay = getComputedStyle(node, "::after");
    return { rect: node.getBoundingClientRect().toJSON(), transform: style.transform, border: style.borderColor,
      shadow: style.boxShadow, cursor: style.cursor, opacity: Number(overlay.opacity),
      transition: overlay.transitionDuration, overlayBorder: overlay.borderWidth,
      pointerEvents: overlay.pointerEvents, background: overlay.backgroundColor,
      themeInk: getComputedStyle(document.documentElement).getPropertyValue("--desk-accent-deep").trim() };
  });
}

for (const settings of [
  { theme: "dark", motion: "no-preference", width: 1440 },
  { theme: "light", motion: "no-preference", width: 1440 },
  { theme: "dark", motion: "reduce", width: 1440 },
  { theme: "light", motion: "reduce", width: 390 },
]) {
  test(`Gallery hover is a stable tint and remains clickable (${engine}, ${settings.theme}, ${settings.motion}, ${settings.width})`, { timeout: 45000 }, async t => {
    const page = await makePage(t, settings);
    const card = page.locator(cards).first();
    await card.waitFor({ state: "visible" });
    await page.mouse.move(1, 1);
    await frames(page);
    const before = await hoverStyle(card);
    assert.equal(before.opacity, 0);
    await card.hover();
    const finePointer = await page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches);
    await page.waitForFunction(({ selector, value }) => Number(getComputedStyle(document.querySelector(selector), "::after").opacity) === value,
      { selector: cards, value: finePointer ? 0.03 : 0 });
    const hovered = await hoverStyle(card);
    assert.deepEqual(hovered.rect, before.rect, "Hover must not move or resize a card");
    assert.equal(hovered.transform, before.transform);
    assert.equal(hovered.border, before.border);
    assert.equal(hovered.shadow, before.shadow);
    assert.equal(hovered.cursor, "pointer");
    assert.equal(hovered.pointerEvents, "none", "Tint must not intercept clicks");
    assert.equal(hovered.overlayBorder, "0px");
    // The global reduced-motion safeguard uses 0.01ms !important.
    if (settings.motion === "reduce") assert(parseFloat(hovered.transition) <= 0.00001, "Reduced-motion tint is effectively instant");
    else assert.equal(hovered.transition, "0.2s");
    await capture(page, `gallery-hover-${settings.theme}-${settings.motion}`);
    if (finePointer) {
      // Exercise real drag state without changing slots or committing an order.
      const x = hovered.rect.x + hovered.rect.width / 2;
      const y = hovered.rect.y + hovered.rect.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 12, y + 12);
      await page.waitForFunction(() => document.documentElement.dataset.catalogReordering === "true");
      assert.equal((await hoverStyle(card)).opacity, 0, "Dragging suppresses hover tint immediately");
      await page.mouse.up();
      await page.waitForFunction(() => !document.documentElement.hasAttribute("data-catalog-reordering"));
    }
    await page.mouse.move(1, 1);
    await page.waitForFunction(selector => Number(getComputedStyle(document.querySelector(selector), "::after").opacity) === 0, cards);
    if (settings.width === 390) await card.tap();
    else await card.click();
    await page.waitForFunction(() => document.documentElement.dataset.deskView === "monitor");
    await assertIntro(page, "gpu-price-snapshot", descriptions.snapshot);
  });
}
