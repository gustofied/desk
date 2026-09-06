import assert from "node:assert/strict";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after, before } from "node:test";

// Requires an existing local preview and installed browser; installs nothing.
// Optional: DESK_PLAYWRIGHT_MODULE, DESK_BROWSER_ENGINE (chromium/webkit),
// DESK_BROWSER_PATH, DESK_BASE_URL.
const moduleName = process.env.DESK_PLAYWRIGHT_MODULE || "playwright";
const playwright = await import(isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const engineName = process.env.DESK_BROWSER_ENGINE || "chromium";
assert(["chromium", "webkit"].includes(engineName));
const baseUrl = process.env.DESK_BASE_URL || "http://127.0.0.1:4173";
const ids = ["desk-chart-draw", "desk-chart-support"];
const families = [
  { id: "quote-view", native: "quote", tab: "current-quote-view" },
  { id: "gpu-index", tab: "preset-gpu-index-h200" },
  { id: "gpu-price-snapshot", marker: "[data-price-bar-row]", tab: "preset-gpu-price-snapshot-prices" },
  { id: "gpu-market-depth", marker: "[data-depth-current-profile], [data-depth-history-heatmap]", tab: "preset-gpu-market-depth-h100-us" },
  { id: "power-basis", marker: "[data-power-basis-line]", tab: "preset-power-basis-pjm-west" },
  { id: "deal-view", native: "deal", tab: "preset-deal-view-deal-041" },
];
const errors = [];
let browser;

before(async () => {
  browser = await playwright[engineName].launch({
    headless: true,
    ...(process.env.DESK_BROWSER_PATH ? { executablePath: process.env.DESK_BROWSER_PATH } : {}),
  });
});
after(async () => { await browser?.close(); });

async function makePage(t, { cardId = "gpu-index", view = "monitor", reducedMotion = "no-preference" } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(`${engineName}/${view}/${cardId}: ${error.message}`));
  // Retain the real animations, including those cancelled before Playwright can
  // sample a frame. IDs are read later because the app assigns them after animate.
  await page.addInitScript(() => {
    window.__chartMotion = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = animate.apply(this, args);
      const surfaces = [
        ["gallery", "[data-gallery-artifact], [data-gallery-deal]"],
        ["strip", ".desk-market-preview__artifact"],
        ["card", "[data-share-artifact-svg], [data-deal-preview]"],
        ["monitor", "[data-gpu-chart-svg], [data-deal-workspace]"],
      ];
      const surface = surfaces.find(([, selector]) => this.closest(selector));
      if (surface) {
        const record = {
          animation, target: this, surface: surface[0],
          cardId: document.querySelector("[data-gpu-benchmark-card]")?.dataset.cardId,
          outcome: "pending",
        };
        window.__chartMotion.push(record);
        animation.finished.then(() => { record.outcome = "finished"; }, () => { record.outcome = "cancelled"; });
      }
      return animation;
    };
  });
  const url = new URL("/", baseUrl);
  for (const [key, value] of Object.entries({ card: cardId, view, palette: "linen", theme: "dark" })) url.searchParams.set(key, value);
  if (cardId === "gpu-index") {
    url.searchParams.set("gpu", "H200");
    url.searchParams.set("layers", "H200");
  }
  // networkidle would consume most of the entrance; inspect as soon as data is ready.
  await page.goto(url.href, { waitUntil: "domcontentloaded" });
  await ready(page, cardId, view);
  await page.evaluate(() => { window.__chartMotionDocument = document.documentElement; });
  return page;
}

async function ready(page, cardId, view) {
  await page.waitForFunction(({ cardId, view }) => {
    const root = document.querySelector("[data-gpu-benchmark-card]");
    return root?.dataset.cardId === cardId && root.dataset.cardReady === "true" &&
      document.documentElement.dataset.deskView === (view === "monitor" ? "monitor" : "catalog") &&
      document.documentElement.dataset.deskLayout === (view === "gallery" ? "all" : "focus");
  }, { cardId, view });
}

async function mark(page) { return page.evaluate(() => window.__chartMotion.length); }

async function motionRecords(page, from = 0) {
  return page.evaluate(from => window.__chartMotion.slice(from).map(record => ({
    id: record.animation.id, surface: record.surface, cardId: record.cardId,
    outcome: record.outcome, playState: record.animation.playState,
    duration: record.animation.effect.getTiming().duration,
    fill: record.animation.effect.getTiming().fill,
    connected: record.target.isConnected,
  })), from);
}

async function assertSettled(page) {
  await page.waitForFunction(ids => {
    const root = document.querySelector("[data-gpu-benchmark-card]");
    const running = root.getAnimations({ subtree: true }).some(animation => ids.includes(animation.id) &&
      ["running", "paused"].includes(animation.playState));
    return !running && ![...root.querySelectorAll("[data-gpu-chart-svg] *, [data-share-artifact-svg] *, [data-deal-workspace] *, [data-deal-preview] *")]
      .some(element => element.__transition && Object.keys(element.__transition).length);
  }, ids, { timeout: 8000 });
}

async function assertEntrance(page, family, view, from = 0) {
  await ready(page, family.id, view);
  await page.waitForFunction(({ from, cardId, view }) => window.__chartMotion.slice(from).some(record =>
    record.animation.id === "desk-chart-draw" && record.surface === view && record.cardId === cardId),
  { from, cardId: family.id, view }, { timeout: 5000 });
  const first = (await motionRecords(page, from)).find(record => record.id === "desk-chart-draw" && record.surface === view && record.cardId === family.id);
  assert.notEqual(first.outcome, "cancelled", "The entrance was cancelled before its first visible sample");
  assert.equal(first.duration, 680, "Chart families must share the 680ms drawing duration");
  await assertSettled(page);
  const records = (await motionRecords(page, from)).filter(record => ids.includes(record.id) && record.surface === view && record.cardId === family.id);
  const draws = records.filter(record => record.id === "desk-chart-draw");
  assert(draws.length > 0);
  assert.equal(draws[0].outcome, "finished", "The initial dimension observer cancelled the chart entrance");
  assert(draws.some(record => record.outcome === "finished" && record.connected), "The final chart never completed a visible draw");
  for (const record of records) {
    assert.equal(record.fill, "backwards", "Entrance must not retain an animation overlay after settling");
    if (record.id === "desk-chart-support") assert(record.duration > 0 && record.duration <= 420);
  }
  await assertSurface(page, family, view);
}

async function assertSurface(page, family, view) {
  const svg = page.locator(view === "card" ? "[data-share-artifact-svg]" : "[data-gpu-chart-svg]");
  const native = page.locator(view === "card" ? "[data-deal-preview]" : "[data-deal-workspace]");
  if (family.native) {
    assert(await native.isVisible());
    assert.equal(await svg.isVisible(), false, "Native chart retained a visible SVG artifact");
    assert.equal(await native.locator("[data-deal-view-mount]").count(), 1, "Native chart retained a stale mount");
    assert.equal(await native.locator("[data-deal-view-mount]").getAttribute("data-kind"), family.native);
  } else {
    assert(await svg.isVisible());
    assert.equal(await native.isVisible(), false, "SVG chart retained the previous native artifact");
    assert(await svg.locator("path, rect, text").count() > 0, "Current SVG is empty");
    if (family.marker) assert(await svg.locator(family.marker).count() > 0, `${family.id} retained the previous renderer`);
    assert.equal(await svg.locator(".is-exiting").count(), 0, "An obsolete SVG plot survived its transition");
    if (family.id === "gpu-index" && view === "monitor") {
      assert.equal(await svg.locator(".gpu-benchmark__plot-root").count(), 1);
      const gpu = new URL(page.url()).searchParams.get("gpu");
      assert.deepEqual(await svg.locator(".gpu-benchmark__line.is-selected").evaluateAll(nodes => nodes.map(node => node.dataset.layer)), [gpu]);
    }
  }
  assert(await page.evaluate(() => window.__chartMotionDocument === document.documentElement), "Chart navigation reloaded the document");
}

async function clickTab(page, key) { await page.locator(`[data-catalog-entry-key="${key}"]`).click(); }

for (const view of ["card", "monitor"]) {
  for (const family of families) {
    test(`initial ${view} ${family.id} draws and settles (${engineName})`, async t => {
      const page = await makePage(t, { cardId: family.id, view });
      await assertEntrance(page, family, view);
      if (view === "card") {
        const from = await mark(page);
        await page.locator("[data-focus-card-monitor]").click();
        await assertEntrance(page, family, "monitor", from);
      }
    });

    test(`reduced motion leaves ${view} ${family.id} static (${engineName})`, async t => {
      const page = await makePage(t, { cardId: family.id, view, reducedMotion: "reduce" });
      await page.evaluate(() => document.fonts.ready);
      await assertSettled(page);
      await assertSurface(page, family, view);
      assert.deepEqual((await motionRecords(page)).filter(record => ids.includes(record.id)), []);
    });
  }

  test(`same-family clicks and single A/D presses redraw ${view} (${engineName})`, async t => {
    const family = families[1];
    const page = await makePage(t, { view });
    await assertEntrance(page, family, view);
    for (const gpu of ["B200", "H200"]) {
      const from = await mark(page);
      await clickTab(page, `preset-gpu-index-${gpu.toLowerCase()}`);
      await assertEntrance(page, family, view, from);
      assert.equal(new URL(page.url()).searchParams.get("gpu"), gpu);
    }
    for (const [key, gpu] of [["d", "B200"], ["a", "H200"]]) {
      const from = await mark(page);
      await page.locator(`[data-catalog-entry-key="preset-gpu-index-${gpu === "B200" ? "h200" : "b200"}"]`).focus();
      await page.keyboard.press(key);
      await assertEntrance(page, family, view, from);
      assert.equal(new URL(page.url()).searchParams.get("gpu"), gpu, "A/D single press skipped or repeated a view");
    }
  });

  test(`cross-family ${view} clicks share the draw lifecycle (${engineName})`, async t => {
    const page = await makePage(t, { cardId: "quote-view", view });
    await assertEntrance(page, families[0], view);
    for (const family of families.slice(1)) {
      const from = await mark(page);
      await clickTab(page, family.tab);
      await assertEntrance(page, family, view, from);
    }
  });

  test(`rapid ${view} switching does not leave stale chart content (${engineName})`, async t => {
    const page = await makePage(t, { view });
    await assertEntrance(page, families[1], view);
    const from = await mark(page);
    await page.evaluate(async keys => {
      for (const key of keys) {
        document.querySelector(`[data-catalog-entry-key="${key}"]`).click();
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
    }, [families[5].tab, families[3].tab, "preset-gpu-index-b200", families[4].tab, families[2].tab, families[1].tab]);
    await ready(page, "gpu-index", view);
    await page.waitForFunction(from => window.__chartMotion.slice(from).some(record =>
      record.cardId === "gpu-index" && record.animation.id === "desk-chart-draw" && record.outcome === "finished"), from);
    await assertSettled(page);
    await assertSurface(page, families[1], view);
    assert.equal(new URL(page.url()).searchParams.get("gpu"), "H200");
    assert((await motionRecords(page, from)).filter(record => ids.includes(record.id)).every(record =>
      !["running", "paused"].includes(record.playState)), "An obsolete chart animation is still alive");
  });
}

test(`gallery and strip chart previews remain static (${engineName})`, async t => {
  const page = await makePage(t, { view: "gallery" });
  await page.locator("[data-gallery-artifact]").first().waitFor({ state: "visible" });
  await page.locator('[data-market-instrument="H100"] [data-market-target]').focus();
  await page.locator("[data-market-preview]").waitFor({ state: "visible" });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert(await page.locator("[data-market-preview] .desk-market-preview__artifact svg").count() > 0);
  assert.deepEqual((await motionRecords(page)).filter(record => ["gallery", "strip"].includes(record.surface)), [],
    "A decorative chart preview inherited an entrance animation");
  assert(await page.locator("[data-gallery-artifact], [data-gallery-deal], .desk-market-preview__artifact").evaluateAll(roots =>
    roots.every(root => root.getAnimations({ subtree: true }).length === 0 &&
      ![...root.querySelectorAll("*")].some(element => element.__transition && Object.keys(element.__transition).length))));
});

for (const family of [families[1], families[5]]) {
  test(`live reduced motion and viewport resize leave ${family.id} static (${engineName})`, async t => {
    const page = await makePage(t, { cardId: family.id });
    const runningDraw = () => page.waitForFunction(() => document.querySelector("[data-gpu-benchmark-card]")
      .getAnimations({ subtree: true }).some(animation => animation.id === "desk-chart-draw" &&
        ["running", "paused"].includes(animation.playState)));
    await runningDraw();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await assertSettled(page);
    await assertSurface(page, family, "monitor");
    const reducedFrom = await mark(page);
    const other = family.native ? families[1] : families[5];
    await clickTab(page, other.tab);
    await ready(page, other.id, "monitor");
    await assertSettled(page);
    await assertSurface(page, other, "monitor");
    assert.deepEqual((await motionRecords(page, reducedFrom)).filter(record => ids.includes(record.id)), [],
      "Navigation ignored the live reduced-motion preference");

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await clickTab(page, family.tab);
    await ready(page, family.id, "monitor");
    await runningDraw();
    const from = await mark(page);
    await page.setViewportSize({ width: 1024, height: 640 });
    // The normal resize observer is deliberately debounced by 90ms. A real
    // resize should settle statically, not replay or leave the entrance paused.
    await page.waitForTimeout(220);
    await assertSettled(page);
    await assertSurface(page, family, "monitor");
    assert.deepEqual((await motionRecords(page, from)).filter(record => ids.includes(record.id)), [],
      "Resizing replayed a chart entrance");
    assert((await motionRecords(page)).filter(record => ids.includes(record.id)).every(record =>
      !["running", "paused"].includes(record.playState)), "Resize left an obsolete chart animation alive");
    assert(await page.locator("[data-gpu-chart]").evaluate(element => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.left >= -1 && rect.right <= innerWidth + 1;
    }), "Resized chart has stale or overflowing dimensions");
  });
}

test(`leaving Monitor cancels its draw even while the old SVG stays mounted (${engineName})`, async t => {
  const page = await makePage(t);
  await page.evaluate(() => {
    const root = document.querySelector("[data-gpu-benchmark-card]");
    for (const animation of root.getAnimations({ subtree: true })) {
      if (animation.id.startsWith("desk-chart-")) { animation.pause(); animation.currentTime = 100; }
    }
    document.querySelector('[data-desk-mode="catalog"]').click();
  });
  await page.waitForFunction(() => document.documentElement.dataset.deskView === "catalog");
  const oldDraws = (await motionRecords(page)).filter(record => record.surface === "monitor" && ids.includes(record.id));
  assert(oldDraws.length > 0);
  assert(oldDraws.every(record => record.outcome === "cancelled"), "The hidden Monitor resumed an obsolete entrance");
  assert(await page.evaluate(ids => document.querySelector("[data-gpu-benchmark-card]")
    .getAnimations({ subtree: true }).filter(animation => ids.includes(animation.id))
    .every(animation => !animation.effect.target.closest("[hidden], [inert]")), ids));
});

test("chart motion interactions have no uncaught browser errors", () => {
  assert.deepEqual(errors, []);
});
