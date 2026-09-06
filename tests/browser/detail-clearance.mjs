import assert from "node:assert/strict";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after, before } from "node:test";

// Run against an existing preview; no dependencies or browsers are installed.
// Optional: DESK_PLAYWRIGHT_MODULE, DESK_BROWSER_ENGINE (chromium/webkit),
// DESK_BROWSER_PATH, DESK_BASE_URL, DESK_SCREENSHOT_DIR.
const moduleName = process.env.DESK_PLAYWRIGHT_MODULE || "playwright";
const playwright = await import(isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const engineName = process.env.DESK_BROWSER_ENGINE || "chromium";
assert(["chromium", "webkit"].includes(engineName));
const baseUrl = process.env.DESK_BASE_URL || "http://127.0.0.1:4173";
const screenshotDir = process.env.DESK_SCREENSHOT_DIR || "/private/tmp";
const viewports = [
  { width: 1440, height: 900 }, { width: 1024, height: 640 },
  { width: 860, height: 576 }, { width: 390, height: 844 }, { width: 320, height: 640 },
];
const families = [
  { id: "gpu-index", tab: "preset-gpu-index-h200", rail: "monitor-data" },
  { id: "power-basis", tab: "preset-power-basis-pjm-west", rail: "monitor-data" },
  { id: "gpu-market-depth", tab: "preset-gpu-market-depth-h100-us", rail: "monitor-data" },
  { id: "deal-view", tab: "preset-deal-view-deal-041", rail: "deal-journey" },
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

async function makePage(t, viewport, cardId) {
  const context = await browser.newContext({
    viewport, reducedMotion: "reduce", hasTouch: viewport.width <= 390, isMobile: viewport.width <= 390,
  });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(`${engineName}/${viewport.width}/${cardId}: ${error.message}`));
  const url = new URL("/", baseUrl);
  for (const [key, value] of Object.entries({ card: cardId, view: "monitor", theme: "dark", palette: "linen" })) {
    url.searchParams.set(key, value);
  }
  await page.goto(url.href, { waitUntil: "networkidle" });
  await ready(page, cardId);
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.__detailClearanceDocument = document.documentElement;
  });
  return page;
}

async function ready(page, cardId) {
  await page.waitForFunction(cardId => {
    const root = document.querySelector("[data-gpu-benchmark-card]");
    return root.dataset.cardId === cardId && root.dataset.cardReady === "true" &&
      document.documentElement.dataset.deskView === "monitor";
  }, cardId);
}

async function frames(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function scrollEnd(page) {
  await page.evaluate(() => window.scrollTo({ top: document.scrollingElement.scrollHeight, behavior: "instant" }));
  await frames(page);
}

async function screenshot(page, viewport, cardId, suffix) {
  await page.screenshot({ path: join(screenshotDir, `desk-detail-${engineName}-${viewport.width}x${viewport.height}-${cardId}-${suffix}.png`) });
}

async function assertRailVisibility(page, expected) {
  const rails = await page.locator("[data-monitor-data], [data-deal-journey]").evaluateAll(elements => elements.map(element => ({
    name: element.hasAttribute("data-monitor-data") ? "monitor-data" : "deal-journey",
    visible: getComputedStyle(element).display !== "none" && element.getBoundingClientRect().height > 0,
    hidden: element.hidden, inert: element.inert,
  })));
  assert.deepEqual(rails.filter(rail => rail.visible).map(rail => rail.name), expected ? [expected] : []);
  for (const rail of rails.filter(rail => rail.name !== expected)) {
    assert(rail.hidden && rail.inert, `${rail.name} leaked a hidden or focusable detail panel`);
  }
}

async function setExpanded(page, family, open) {
  const toggle = page.locator(`[data-${family.rail}-toggle]`);
  assert(await toggle.isEnabled());
  if (await toggle.getAttribute("aria-expanded") !== String(open)) await toggle.click();
  const body = page.locator(`[data-${family.rail}-body]`);
  await body.waitFor({ state: open ? "visible" : "hidden" });
  assert.equal(await toggle.getAttribute("aria-expanded"), String(open));
  assert.equal(await body.evaluate(element => element.inert), !open);
  await frames(page);
}

async function assertClearance(page, viewport, family) {
  await scrollEnd(page);
  const metrics = await page.evaluate(railName => {
    const rail = document.querySelector(`[data-${railName}]`);
    const rect = element => element.getBoundingClientRect().toJSON();
    return {
      rail: rect(rail), chart: rect(document.querySelector("#gpu-index-detail")),
      chartDocumentTop: document.querySelector("#gpu-index-detail").getBoundingClientRect().top + scrollY,
      strip: rect(document.querySelector("[data-market-strip]")),
      scrollBottom: scrollY + innerHeight, scrollHeight: document.scrollingElement.scrollHeight,
    };
  }, family.rail);
  const mobile = viewport.width <= 640;
  assert(metrics.scrollBottom >= metrics.scrollHeight - 2, "Fixture has not reached the document scroll end");
  assert(metrics.strip.top - metrics.rail.bottom >= (mobile ? 16 : 24) - 1,
    `Expanded ${family.id} overlaps ticker clearance: ${JSON.stringify(metrics)}`);
  assert(metrics.rail.top - metrics.chart.bottom >= (mobile ? 12 : 16) - 1,
    `Detail panel has insufficient chart spacing: ${JSON.stringify(metrics)}`);
  return metrics;
}

async function assertFooterReachable(page, family) {
  const controls = family.rail === "monitor-data"
    ? page.locator("[data-monitor-data] footer :is(button, a)")
    : page.locator('[data-deal-journey] [aria-current="step"]');
  assert(await controls.count() > 0, "Fixture did not expose footer or Activity controls");
  if (family.rail === "deal-journey") await controls.scrollIntoViewIfNeeded();
  for (const control of await controls.all()) {
    assert(await control.isEnabled());
    assert(await control.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      return x >= 0 && x < innerWidth && y >= 0 && y < innerHeight && element.contains(hit);
    }), `Footer control is covered or unreachable: ${await control.textContent()}`);
  }
}

for (const viewport of viewports) {
  for (const family of families) {
    test(`expanded ${family.id} clears ticker and survives collapse/SQL (${engineName}, ${viewport.width}x${viewport.height})`, async t => {
      const page = await makePage(t, viewport, family.id);
      await assertRailVisibility(page, family.rail);
      const chartTop = await page.locator("#gpu-index-detail").evaluate(element => element.getBoundingClientRect().top + scrollY);
      await setExpanded(page, family, true);
      await screenshot(page, viewport, family.id, "expanded");
      const expanded = await assertClearance(page, viewport, family);
      assert(Math.abs(expanded.chartDocumentTop - chartTop) <= 1, "Expanding detail panel moves the chart in document space");
      await assertFooterReachable(page, family);
      if (family.rail === "monitor-data") {
        const mode = page.locator("[data-monitor-data-mode]");
        const initialHeight = await page.locator("[data-monitor-data] pre").evaluate(element => element.getBoundingClientRect().height);
        await mode.click();
        assert.equal(await page.locator("[data-monitor-data]").getAttribute("data-access-mode"), "sql");
        assert.equal((await mode.textContent()).trim(), "View CLI");
        const sql = await assertClearance(page, viewport, family);
        const sqlHeight = await page.locator("[data-monitor-data] pre").evaluate(element => element.getBoundingClientRect().height);
        if (viewport.width > 640) {
          assert(Math.abs(sql.rail.height - expanded.rail.height) <= 1, "SQL changes the desktop panel height");
          assert.equal(sqlHeight, initialHeight);
        } else {
          // Mobile intentionally fits short commands instead of reserving the
          // desktop code height; both modes must keep the bounded scroll box.
          assert(initialHeight > 0 && initialHeight <= 192, "Mobile CLI code box exceeds its height cap");
          assert(sqlHeight > 0 && sqlHeight <= 192, "Mobile SQL code box exceeds its height cap");
        }
        await assertFooterReachable(page, family);
        await mode.click();
        assert.equal(await page.locator("[data-monitor-data]").getAttribute("data-access-mode"), "command");
      }
      await setExpanded(page, family, false);
      const collapsed = await assertClearance(page, viewport, family);
      assert(Math.abs(collapsed.chartDocumentTop - chartTop) <= 1, "Collapsing detail panel moves the chart in document space");
      assert(collapsed.rail.height < expanded.rail.height, "Collapsed panel still reserves the expanded body height");
      await setExpanded(page, family, true);
      const reopened = await assertClearance(page, viewport, family);
      assert(Math.abs(reopened.chartDocumentTop - chartTop) <= 1, "Reopening detail panel moves the chart in document space");
      await assertFooterReachable(page, family);
      await screenshot(page, viewport, family.id, "scroll-end");
    });
  }

  test(`Quote has no leaked detail rails (${engineName}, ${viewport.width}x${viewport.height})`, async t => {
    const page = await makePage(t, viewport, "quote-view");
    await assertRailVisibility(page, null);
    assert(await page.locator("#gpu-index-detail").isVisible());
  });
}

for (const viewport of [viewports[2], viewports[3]]) {
  test(`switching expanded detail families hides the previous rail (${engineName}, ${viewport.width}x${viewport.height})`, async t => {
    const page = await makePage(t, viewport, "quote-view");
    await assertRailVisibility(page, null);
    for (const family of [families[0], families[3], families[1], families[2], families[3]]) {
      await page.locator(`[data-catalog-entry-key="${family.tab}"]`).click();
      await ready(page, family.id);
      await assertRailVisibility(page, family.rail);
      await setExpanded(page, family, true);
      await assertClearance(page, viewport, family);
      assert(await page.evaluate(() => window.__detailClearanceDocument === document.documentElement), "Family switching reloaded the document");
    }
    await page.keyboard.press("Meta+g");
    if (await page.locator("[data-desk-login]").isVisible()) {
      await page.locator("[data-desk-login]").focus();
      await page.keyboard.press("Enter");
    }
    await page.locator("[data-command-input]").fill("quote");
    await page.locator("#desk-command-catalog-quote-041").click();
    await page.waitForFunction(() => document.querySelector("[data-gpu-benchmark-card]").dataset.cardId === "quote-view");
    if (await page.evaluate(() => document.documentElement.dataset.deskView !== "monitor")) {
      await page.locator('[data-desk-mode="monitor"]').click();
    }
    await ready(page, "quote-view");
    await assertRailVisibility(page, null);
  });
}

test(`vertical wheel over Activity can still reveal the page bottom (${engineName}, 860x576)`, async t => {
  const viewport = viewports[2];
  const family = families[3];
  const page = await makePage(t, viewport, family.id);
  await setExpanded(page, family, true);
  await scrollEnd(page);
  await page.evaluate(() => {
    window.scrollBy({ top: -24, behavior: "instant" });
  });
  await frames(page);
  const before = await page.evaluate(() => scrollY);
  assert(await page.evaluate(before => document.scrollingElement.scrollHeight - innerHeight > before + 1, before),
    "Wheel fixture has no remaining page scroll range");
  const point = await page.locator("[data-deal-journey-events-list]").evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: Math.min(rect.bottom - 2, innerHeight - 40) };
  });
  await page.mouse.move(point.x, point.y);
  assert(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest("[data-deal-journey-events-list]")), point),
    "Wheel fixture is not over the visible Activity list");
  await page.mouse.wheel(0, 200);
  await page.waitForFunction(before => scrollY > before + 1, before, { timeout: 2000 });
  await assertClearance(page, viewport, family);
});

test("detail clearance interactions have no uncaught browser errors", () => {
  assert.deepEqual(errors, []);
});
