import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after, before } from "node:test";

// Local preview and existing browser installations only. Contexts are fresh and
// disposable; no user storage, remote requests, or source fixtures are used.
const moduleName = process.env.DESK_PLAYWRIGHT_MODULE || "playwright";
const playwright = await import(isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const engine = process.env.DESK_BROWSER_ENGINE || "chromium";
assert(["chromium", "webkit"].includes(engine));
const baseUrl = process.env.DESK_BASE_URL || "http://127.0.0.1:4173";
const screenshotDir = process.env.DESK_SCREENSHOT_DIR || "/private/tmp/desk-craft-picker-qa";
const picker = "[data-craft-type-list]";
const buttons = `${picker} [data-craft-type]`;
const types = [
  ["gpu-index", "Price history"], ["gpu-price-snapshot", "Latest prices"],
  ["gpu-market-depth", "Market depth"], ["power-basis", "Power prices"],
  ["quote-view", "Quote"], ["deal-view", "Deal"],
  ["equities", "Equities"], ["sandbox-cost", "Sandbox cost"],
];
const startUrl = new URL("/?card=gpu-index&view=craft&draft=new", baseUrl).href;
let browser;

before(async () => {
  await mkdir(screenshotDir, { recursive: true });
  browser = await playwright[engine].launch({ headless: true, timeout: 15000,
    ...(process.env.DESK_BROWSER_PATH ? { executablePath: process.env.DESK_BROWSER_PATH } : {}) });
});
after(async () => { await browser?.close(); });

async function makePage(t, width) {
  const context = await browser.newContext({ viewport: { width, height: width <= 390 ? 844 : 900 },
    reducedMotion: "reduce", hasTouch: width <= 390, isMobile: width <= 390 });
  const page = await context.newPage();
  const errors = [];
  page.setDefaultTimeout(12000);
  page.on("pageerror", error => errors.push(error.message));
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, [], "Craft type selection raised an uncaught error");
  });
  await context.route("**/*", route => new URL(route.request().url()).origin === new URL(baseUrl).origin
    ? route.continue() : route.abort());
  await openStart(page);
  return page;
}

async function openStart(page) {
  await page.goto(startUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => {
    const root = document.querySelector("[data-gpu-benchmark-card]");
    return root?.dataset.cardReady === "true" && root.dataset.craftEmpty === "true" &&
      document.documentElement.dataset.deskView === "craft";
  });
  await page.locator(picker).waitFor({ state: "visible" });
  await page.evaluate(() => document.fonts.ready);
}

async function settled(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function assertEnabledPicker(page) {
  assert.deepEqual(await page.locator(buttons).evaluateAll(nodes => nodes.map(node => [node.dataset.craftType, node.textContent])), types);
  assert(await page.locator(buttons).evaluateAll(nodes => nodes.every(node => !node.disabled && node.tabIndex === 0)));
}

async function assertStarted(page, cardId) {
  await page.waitForFunction(cardId => {
    const root = document.querySelector("[data-gpu-benchmark-card]");
    const url = new URL(location.href);
    return root?.dataset.cardId === cardId && root.dataset.cardReady === "true" &&
      root.dataset.craftEmpty === "false" && document.documentElement.dataset.deskView === "craft" &&
      url.searchParams.get("card") === cardId && url.searchParams.get("view") === "craft" && !url.searchParams.has("draft");
  }, cardId);
  assert.equal(await page.locator(".gpu-benchmark__craft-empty").isVisible(), false);
  assert.equal(await page.locator('[data-desk-mode="monitor"]').isEnabled(), true);
  assert.equal(await page.locator("[data-gpu-state]").isVisible(), false);
  const surface = page.locator(["quote-view", "deal-view"].includes(cardId) ? "[data-deal-workspace]" : "[data-gpu-chart-svg]");
  await surface.waitFor({ state: "visible" });
  assert(await surface.evaluate(node => node.querySelectorAll("path, circle, [data-sandbox-provider], [data-deal-view]").length > 0), `${cardId} must render its chosen view`);
}

for (const width of [1440, 768, 390, 320]) {
  test(`Craft chooser stacks with complete labels and internal dividers (${engine}, ${width})`, { timeout: 30000 }, async t => {
    const page = await makePage(t, width);
    await assertEnabledPicker(page);
    const columns = width > 800 ? 4 : 2;
    const geometry = await page.locator(picker).evaluate(node => {
      const rect = element => {
        const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
        return { x, y, width, height, right, bottom };
      };
      return { grid: rect(node), chart: rect(node.closest("[data-gpu-chart]")),
        viewportWidth: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        buttons: [...node.querySelectorAll("[data-craft-type]")].map(button => {
          const style = getComputedStyle(button);
          const range = document.createRange();
          range.selectNodeContents(button);
          return { ...rect(button), label: button.textContent, scrollWidth: button.scrollWidth,
            clientWidth: button.clientWidth, scrollHeight: button.scrollHeight, clientHeight: button.clientHeight,
            borderLeft: parseFloat(style.borderLeftWidth), borderTop: parseFloat(style.borderTopWidth),
            whiteSpace: style.whiteSpace, textOverflow: style.textOverflow,
            text: [...range.getClientRects()].map(({ x, y, right, bottom }) => ({ x, y, right, bottom })) };
        }) };
    });
    const { grid, chart } = geometry;
    assert(grid.x >= chart.x - 1 && grid.y >= chart.y - 1 && grid.right <= chart.right + 1 && grid.bottom <= chart.bottom + 1,
      `Picker must stay inside the chart: ${JSON.stringify({ grid, chart })}`);
    assert(Math.abs(grid.x + grid.width / 2 - chart.x - chart.width / 2) <= 1, "Picker stays horizontally centered");
    assert(Math.abs(grid.y + grid.height / 2 - chart.y - chart.height / 2) <= 1, "Picker stays vertically centered");
    assert(grid.x >= -1 && grid.right <= width + 1 && geometry.scrollWidth <= geometry.viewportWidth + 1, "No horizontal page or picker overflow");
    const first = geometry.buttons[0];
    for (const [index, button] of geometry.buttons.entries()) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      assert(Math.abs(button.x - first.x - column * first.width) <= 1, `${button.label} column`);
      assert(Math.abs(button.y - first.y - row * first.height) <= 1, `${button.label} row`);
      assert(button.height >= 48, `${button.label} retains its button height`);
      assert.equal(button.borderLeft, column === 0 ? 0 : 1, `${button.label} column divider`);
      assert.equal(button.borderTop, row === 0 ? 0 : 1, `${button.label} row divider`);
      assert.notEqual(button.whiteSpace, "nowrap");
      assert.notEqual(button.textOverflow, "ellipsis");
      assert(button.scrollWidth <= button.clientWidth + 1 && button.scrollHeight <= button.clientHeight + 1, `${button.label} must not clip`);
      assert(button.text.length > 0 && button.text.every(rect => rect.x >= button.x - 1 && rect.right <= button.right + 1 &&
        rect.y >= button.y - 1 && rect.bottom <= button.bottom + 1), `${button.label} text must fit its button`);
    }
    assert(Math.abs(grid.height - first.height * (8 / columns) - (width <= 390 ? 0 : 2)) <= 2, "The picker has the expected number of rows");
    await page.screenshot({ path: join(screenshotDir, `${engine}-${width}-craft-picker.png`) });
  });
}

for (const width of [1440, 390]) {
  test(`All eight Craft types remain usable by pointer and keyboard (${engine}, ${width})`, { timeout: 90000 }, async t => {
    const page = await makePage(t, width);
    await assertEnabledPicker(page);
    const monitor = page.locator('[data-desk-mode="monitor"]');
    assert.equal(await monitor.isDisabled(), true, "An empty Craft view cannot open Monitor");
    const monitorBox = await monitor.boundingBox();
    await page.mouse.move(monitorBox.x + monitorBox.width / 2, monitorBox.y + monitorBox.height / 2);
    await page.mouse.move(1, 1);
    await settled(page);
    await assertEnabledPicker(page);
    assert.equal(new URL(page.url()).searchParams.get("draft"), "new", "Hovering Monitor must not leave the empty chooser");

    await page.locator(buttons).first().focus();
    for (let index = 0; index < types.length; index++) {
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.craftType), types[index][0]);
      if (index < types.length - 1) await page.keyboard.press("Tab");
    }
    await page.keyboard.press("Enter");
    await assertStarted(page, "sandbox-cost");

    for (const [cardId] of types) {
      await openStart(page);
      await page.locator(`[data-craft-type="${cardId}"]`).click();
      await assertStarted(page, cardId);
    }
  });
}
