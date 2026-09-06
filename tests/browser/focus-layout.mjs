import assert from "node:assert/strict";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after, before } from "node:test";

// Uses an already-running Desk preview and installed browser; installs nothing.
// node --test tests/browser/focus-layout.mjs
// Optional: DESK_PLAYWRIGHT_MODULE, DESK_BROWSER_ENGINE (chromium/webkit),
// DESK_BROWSER_PATH, DESK_BASE_URL, DESK_SCREENSHOT_DIR.
const moduleName = process.env.DESK_PLAYWRIGHT_MODULE || "playwright";
const playwright = await import(isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const engineName = process.env.DESK_BROWSER_ENGINE || "chromium";
assert(["chromium", "webkit"].includes(engineName), "Use chromium or webkit for DESK_BROWSER_ENGINE");
const baseUrl = process.env.DESK_BASE_URL || "http://127.0.0.1:4173";
const screenshotDir = process.env.DESK_SCREENSHOT_DIR || "/private/tmp";
const frameSelector = "[data-focus-card-monitor]";
const rootSelector = "[data-gpu-benchmark-card]";
const families = [
  { id: "quote-view", native: true, tab: "current-quote-view" },
  { id: "gpu-index", tab: "preset-gpu-index-h200" },
  { id: "gpu-price-snapshot", tab: "preset-gpu-price-snapshot-prices" },
  { id: "gpu-market-depth", tab: "preset-gpu-market-depth-h100-us" },
  { id: "power-basis", tab: "preset-power-basis-pjm-west" },
  { id: "deal-view", native: true, tab: "preset-deal-view-deal-041" },
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

function urlFor(cardId, view = "card", { theme = "dark", palette = "linen" } = {}) {
  const url = new URL("/", baseUrl);
  for (const [key, value] of Object.entries({ card: cardId, view, theme, palette })) {
    url.searchParams.set(key, value);
  }
  return url.href;
}

async function makePage(t, { width, cardId, view = "card", reducedMotion = "reduce", theme = "dark", palette = "linen" }) {
  const context = await browser.newContext({
    viewport: { width, height: width === 860 ? 576 : width <= 390 ? 844 : 1000 },
    deviceScaleFactor: width === 860 ? 2 : 1,
    reducedMotion,
    hasTouch: width <= 390,
    isMobile: width <= 390,
  });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(`${engineName}/${width}/${cardId}: ${error.message}`));
  await page.goto(urlFor(cardId, view, { theme, palette }), { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector('[data-card-ready="true"]'));
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.__focusLayoutDocument = document.documentElement;
  });
  return page;
}

async function waitForMode(page, mode, cardId) {
  await page.waitForFunction(({ mode, cardId }) => {
    const html = document.documentElement;
    const root = document.querySelector("[data-gpu-benchmark-card]");
    return html.dataset.deskView === mode && root.dataset.cardId === cardId &&
      root.dataset.cardReady === "true" &&
      (mode !== "catalog" || html.dataset.deskLayout === "focus");
  }, { mode, cardId });
}

async function settled(page) {
  await page.waitForFunction(() => {
    const root = document.querySelector("[data-gpu-benchmark-card]");
    return root.getAnimations({ subtree: true }).every(animation => animation.playState !== "running");
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function screenshot(page, width, cardId, suffix) {
  await page.screenshot({ path: join(screenshotDir, `desk-focus-${engineName}-${width}-${cardId}-${suffix}.png`) });
}

function contained(child, parent, label, tolerance = 2) {
  assert(child && child.width > 0 && child.height > 0, `${label} has no visible dimensions`);
  for (const edge of ["left", "top"]) {
    assert(child[edge] >= parent[edge] - tolerance, `${label} exceeds ${edge}: ${JSON.stringify({ child, parent })}`);
  }
  for (const edge of ["right", "bottom"]) {
    assert(child[edge] <= parent[edge] + tolerance, `${label} exceeds ${edge}: ${JSON.stringify({ child, parent })}`);
  }
}

async function assertFocusLayout(page, family) {
  await waitForMode(page, "catalog", family.id);
  assert(await page.locator(frameSelector).isVisible(), "The test is not exercising an actual focused card");
  const layout = await page.evaluate(() => {
    const frame = document.querySelector("[data-focus-card-monitor]");
    const rect = element => element?.getBoundingClientRect().toJSON();
    const visible = element => element && getComputedStyle(element).display !== "none" && element.getBoundingClientRect().height > 0;
    const svg = frame.querySelector("[data-share-artifact-svg]");
    const host = frame.querySelector("[data-deal-preview]");
    const clipping = [];
    for (let parent = frame.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if ([style.overflowX, style.overflowY].some(value => value === "hidden" || value === "clip")) {
        clipping.push({ name: parent.className, rect: rect(parent) });
      }
    }
    return {
      frame: rect(frame), rail: rect(document.querySelector(".desk-card-rail")),
      svg: visible(svg) ? rect(svg) : null,
      svgDrawn: visible(svg) && svg.querySelectorAll("path, rect, line, text").length > 0,
      host: visible(host) ? rect(host) : null,
      shell: visible(host) ? rect(host.querySelector(".deal-view__shell")) : null,
      surface: visible(host) ? rect(host.querySelector(".deal-view__surface")) : null,
      clipping, width: innerWidth,
      interactive: !frame.disabled && !frame.closest("[inert], [hidden]"),
    };
  });
  assert(layout.interactive, "Focused card is disabled or covered by a hidden/inert ancestor");
  assert(Math.abs(layout.frame.height - layout.frame.width * 9 / 16) <= 1.5,
    `Focus frame is not 16:9: ${JSON.stringify(layout.frame)}`);
  assert(layout.frame.left >= -1 && layout.frame.right <= layout.width + 1, "Focus frame exceeds viewport width");
  assert(Math.abs(layout.rail.left - layout.frame.left) <= 2 && Math.abs(layout.rail.width - layout.frame.width) <= 2,
    `Tabs and focused card widths are not aligned: ${JSON.stringify({ rail: layout.rail, frame: layout.frame })}`);
  if (family.native) {
    assert.equal(layout.svg, null, "Native Deal/Quote should not expose the hidden SVG fallback");
    for (const name of ["host", "shell", "surface"]) {
      contained(layout[name], layout.frame, `${family.id} ${name}`);
      assert(Math.abs(layout[name].width - layout.frame.width) <= 2 && Math.abs(layout[name].height - layout.frame.height) <= 2,
        `${family.id} ${name} does not fill its 16:9 frame: ${JSON.stringify(layout[name])}`);
    }
  } else {
    assert.equal(layout.host, null, "A chart retained the prior native Deal/Quote host");
    assert(layout.svgDrawn, "SVG focus artifact is empty");
    contained(layout.svg, layout.frame, `${family.id} SVG`);
    assert(Math.abs(layout.svg.width - layout.frame.width) <= 2 && Math.abs(layout.svg.height - layout.frame.height) <= 2,
      `${family.id} SVG does not fill its frame`);
  }
  for (const ancestor of layout.clipping) contained(layout.frame, ancestor.rect, `Focused frame within ${ancestor.name}`);
}

async function assertMonitorActivation(page, family) {
  await page.locator(frameSelector).click();
  await waitForMode(page, "monitor", family.id);
  await page.locator("#gpu-index-detail").waitFor({ state: "visible" });
  assert(await page.evaluate(() => window.__focusLayoutDocument === document.documentElement), "Opening Monitor reloaded the page");
}

for (const width of [1440, 860, 642]) {
  for (const family of families) {
    test(`focused ${family.id} fits its frame and opens Monitor (${engineName}, ${width}px)`, async t => {
      const page = await makePage(t, { width, cardId: family.id });
      await settled(page);
      await screenshot(page, width, family.id, "static");
      await assertFocusLayout(page, family);
      await assertMonitorActivation(page, family);
    });
  }

  test(`animated Monitor to focused Catalog and cross-family tabs retain layout (${engineName}, ${width}px)`, async t => {
    const page = await makePage(t, { width, cardId: "quote-view", view: "monitor", reducedMotion: "no-preference" });
    await page.locator('[data-desk-mode="catalog"]').click();
    await page.waitForFunction(() => document.documentElement.dataset.deskView === "catalog");
    await settled(page);
    // Select the real Focused view action if Catalog opens its Gallery layout.
    if (await page.evaluate(() => document.documentElement.dataset.deskLayout !== "focus")) {
      await page.keyboard.press("Meta+g");
      if (await page.locator("[data-desk-login]").isVisible()) {
        await page.locator("[data-desk-login]").focus();
        await page.keyboard.press("Enter");
      }
      await page.locator("[data-command-input]").fill("focused");
      await page.locator("#desk-command-catalog-focused-view").click();
    }
    await waitForMode(page, "catalog", "quote-view");
    await settled(page);
    await assertFocusLayout(page, families[0]);
    for (const family of families.slice(1)) {
      await page.locator(`[data-catalog-entry-key="${family.tab}"]`).click();
      await waitForMode(page, "catalog", family.id);
      await settled(page);
      await screenshot(page, width, family.id, "tab");
      await assertFocusLayout(page, family);
      assert(await page.evaluate(() => window.__focusLayoutDocument === document.documentElement), "Tab switching reloaded the document");
    }
    await assertMonitorActivation(page, families.at(-1));
  });
}

for (const width of [390, 320]) {
  for (const family of families) {
    test(`mobile ${family.id} card URL keeps the supported Monitor fallback (${engineName}, ${width}px)`, async t => {
      const page = await makePage(t, { width, cardId: family.id });
      await waitForMode(page, "monitor", family.id);
      await settled(page);
      assert.equal(new URL(page.url()).searchParams.get("view"), "monitor");
      assert.equal(await page.locator(frameSelector).isVisible(), false, "Mobile unexpectedly enabled focused Catalog");
      assert(await page.locator("#gpu-index-detail").isVisible());
      assert(await page.locator('[data-desk-mode="catalog"]').isEnabled());
      await screenshot(page, width, family.id, "monitor-fallback");
      await page.locator('[data-desk-mode="catalog"]').tap();
      await page.waitForFunction(() => document.documentElement.dataset.deskView === "catalog" && document.documentElement.dataset.deskLayout === "all");
      assert(await page.locator("[data-card-gallery-grid]").isVisible(), "Mobile cannot return to Catalog");
    });
  }
}

for (const theme of ["dark", "light"]) {
  for (const palette of ["azure", "linen"]) {
    test(`GPU, PJM, Quote and Deal focused frame parity (${engineName}, ${theme}, ${palette})`, async t => {
      let reference;
      for (const cardId of ["gpu-index", "power-basis", "quote-view", "deal-view"]) {
        const family = families.find(candidate => candidate.id === cardId);
        const page = await makePage(t, { width: 860, cardId, theme, palette });
        await settled(page);
        await assertFocusLayout(page, family);
        const styles = await page.evaluate(() => {
          const frame = document.querySelector(".desk-card-preview .gpu-index-share__window");
          const borderProperties = ["top", "right", "bottom", "left"].flatMap(side =>
            ["width", "style", "color"].map(part => `border-${side}-${part}`));
          const corners = ["top-left", "top-right", "bottom-right", "bottom-left"];
          const properties = [...borderProperties, ...corners.map(corner => `border-${corner}-radius`), "background-color", "box-shadow"];
          const computed = getComputedStyle(frame);
          return {
            outer: Object.fromEntries(properties.map(property => [property, computed.getPropertyValue(property)])),
            inner: [...frame.querySelectorAll("[data-deal-preview] :is(.deal-view__shell, .deal-view__surface)")].map(element => {
              const style = getComputedStyle(element);
              return {
                name: element.className,
                borders: ["top", "right", "bottom", "left"].map(side => style.getPropertyValue(`border-${side}-width`)),
                radii: corners.map(corner => style.getPropertyValue(`border-${corner}-radius`)),
              };
            }),
          };
        });
        if (!reference) {
          reference = styles.outer;
          assert.notEqual(reference["border-top-style"], "none", "GPU reference lost its established outer frame");
          assert(parseFloat(reference["border-top-width"]) > 0, "GPU reference frame has no border");
        } else {
          assert.deepEqual(styles.outer, reference, `${cardId} outer frame differs from GPU (${theme}, ${palette})`);
        }
        if (family.native) {
          assert.equal(styles.inner.length, 2, "Native focus shell and surface must both be present");
          for (const inner of styles.inner) {
            assert.deepEqual(inner.borders, ["0px", "0px", "0px", "0px"], `${cardId} ${inner.name} adds a second frame`);
            assert.deepEqual(inner.radii, ["0px", "0px", "0px", "0px"], `${cardId} ${inner.name} adds a second corner radius`);
          }
        }
        await screenshot(page, 860, cardId, `frame-${theme}-${palette}`);
      }
    });
  }
}

test("focus layout interactions do not raise uncaught browser errors", () => {
  assert.deepEqual(errors, []);
});
