import assert from "node:assert/strict";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after, before } from "node:test";

// Run against an already-running Desk preview; this script installs nothing.
// node --test tests/browser/workspace-navigation.mjs
// Optional: DESK_PLAYWRIGHT_MODULE, DESK_BROWSER_PATH, DESK_BASE_URL.
const moduleName = process.env.DESK_PLAYWRIGHT_MODULE || "playwright";
const { chromium } = await import(isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const baseUrl = (process.env.DESK_BASE_URL || "http://127.0.0.1:4173").replace(/\/$/, "");
const viewPath = "/?card=gpu-index&view=monitor&gpu=H200&layers=H200&scale=price&range=7d&palette=linen&theme=dark";
const modeButton = mode => `[data-desk-mode="${mode}"]`;
const pickerSelector = ".gpu-benchmark__craft-empty";
const railSelector = ".desk-card-rail :is(.desk-card-tabs button, .desk-card-gallery-tab):disabled";
const pageErrors = [];
let browser;

before(async () => {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.DESK_BROWSER_PATH ? { executablePath: process.env.DESK_BROWSER_PATH } : {}),
  });
});
after(async () => { await browser?.close(); });

async function makePage(t, { width, theme = "dark", failData = false, reducedMotion = "reduce" }) {
  const context = await browser.newContext({
    viewport: { width, height: width === 390 ? 844 : 1000 },
    reducedMotion,
  });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", error => pageErrors.push(error.message));
  if (failData) {
    await page.route(`${baseUrl}/data/**`, route => route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"error":"Simulated unavailable market data"}',
    }));
  }
  await page.goto(baseUrl + viewPath.replace("theme=dark", `theme=${theme}`), { waitUntil: "networkidle" });
  // cardReady means the request settled, including its terminal failure path.
  await page.waitForFunction(() => document.querySelector('[data-card-ready="true"]'));
  return page;
}

async function modeState(page) {
  return page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll("[data-desk-mode]")].map(button => [button.dataset.deskMode, {
      disabled: button.disabled,
      cursor: getComputedStyle(button).cursor,
      busy: button.getAttribute("aria-busy"),
      label: button.getAttribute("aria-label"),
      title: button.title,
    }]),
  ));
}

function assertNotBusy(action, label) {
  assert.notEqual(action.busy, "true", `${label} is not loading`);
  assert.equal(action.cursor, "default", `${label} must not show a wait/progress or interactive cursor`);
}

async function openEmptyCraft(page) {
  await page.locator(modeButton("craft")).click();
  await page.locator(pickerSelector).waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector('[data-desk-mode="monitor"]').disabled);
}

async function disabledFeedback(page, selector) {
  const button = page.locator(selector);
  assert(await button.isDisabled());
  const appearance = () => button.evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, transform: style.transform, cursor: style.cursor };
  });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(280);
  const resting = await appearance();
  await button.hover();
  await page.waitForTimeout(280);
  assert.deepEqual(await appearance(), resting, "Disabled control gained hover feedback");
  await page.mouse.down();
  try {
    await page.waitForTimeout(100);
    assert.deepEqual(await appearance(), resting, "Disabled control gained pressed feedback");
  } finally {
    await page.mouse.up();
  }
}

async function assertEmptyMonitorHint(page) {
  const modes = await modeState(page);
  assert(modes.monitor.disabled);
  assertNotBusy(modes.monitor, "Empty Craft Monitor");
  assert.equal(modes.monitor.title, "Choose a view type first");
  assert.match(modes.monitor.label, /choose a view type first/i);
  assert(!modes.catalog.disabled, "Catalog must remain an escape from empty Craft");
  assert(!modes.craft.disabled);
}

async function choosePriceHistory(page) {
  await page.locator('[data-craft-type="gpu-index"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-desk-mode="monitor"]').disabled);
  await page.locator(pickerSelector).waitFor({ state: "hidden" });
  const { monitor } = await modeState(page);
  assert.equal(monitor.cursor, "pointer");
  assert.equal(monitor.title, "", "Empty-state hint was not removed after choosing a type");
  assert.doesNotMatch(monitor.label, /choose a view type first/i);
}

for (const width of [1440, 390]) {
  for (const theme of ["dark", "light"]) {
    test(`empty Craft communicates unavailable Monitor and preserves recovery paths (${width}px, ${theme})`, async t => {
      const page = await makePage(t, { width, theme });
      assert(await page.locator(modeButton("monitor")).isEnabled());
      await openEmptyCraft(page);
      await assertEmptyMonitorHint(page);
      const emptyUrl = page.url();
      await disabledFeedback(page, modeButton("monitor"));
      assert.equal(page.url(), emptyUrl, "Disabled Monitor navigated away");
      assert(await page.locator(pickerSelector).isVisible());

      const types = page.locator("[data-craft-type]");
      assert.equal(await types.count(), 6);
      for (const button of await types.all()) {
        assert(await button.isEnabled());
        await button.click({ trial: true });
      }
      await page.locator(modeButton("catalog")).click();
      await page.waitForFunction(() => document.documentElement.dataset.deskView === "catalog");
      await openEmptyCraft(page);

      // The command menu must explain the same unavailable state as the button.
      await page.keyboard.press("Meta+g");
      await page.locator("[data-desk-login]").focus();
      await page.keyboard.press("Enter");
      await page.locator("[data-command-input]").waitFor({ state: "visible" });
      await page.locator("[data-command-input]").fill("Open Monitor");
      const command = page.locator("#desk-command-workspace-monitor");
      await command.waitFor({ state: "visible" });
      assert(await command.isDisabled());
      assert.match(await command.textContent(), /Choose a view type first/);
      await page.keyboard.press("Escape");

      await choosePriceHistory(page);
      await page.keyboard.press("Meta+g");
      await page.locator("[data-command-input]").waitFor({ state: "visible" });
      await command.waitFor({ state: "visible" });
      assert(await command.isEnabled());
      assert.doesNotMatch(await command.textContent(), /Choose a view type first/);
      await page.keyboard.press("Escape");
      await page.locator(modeButton("monitor")).click();
      await page.waitForFunction(() => document.documentElement.dataset.deskView === "monitor");
      assert(await page.locator(modeButton("monitor")).isEnabled());
    });
  }

  test(`terminal data failure has nonbusy disabled mode and rail controls (${width}px)`, async t => {
    const page = await makePage(t, { width, failData: true });
    const modes = await modeState(page);
    assert(modes.monitor.disabled && modes.catalog.disabled);
    assert(!modes.craft.disabled);
    assertNotBusy(modes.monitor, "Failed-data Monitor");
    assertNotBusy(modes.catalog, "Failed-data Catalog");
    await disabledFeedback(page, modeButton("monitor"));
    await disabledFeedback(page, modeButton("catalog"));
    const rail = await page.locator(railSelector).evaluateAll(buttons => buttons.map(button => ({
      cursor: getComputedStyle(button).cursor,
      busy: button.getAttribute("aria-busy"),
      label: button.textContent.trim(),
    })));
    assert(rail.length > 0, "The failure fixture did not exercise a disabled rail control");
    rail.forEach(button => assertNotBusy(button, `Failed-data rail ${button.label}`));
  });

  test(`rapid navigation still settles to a usable Craft picker (${width}px)`, async t => {
    const page = await makePage(t, { width, reducedMotion: "no-preference" });
    // Do not wait for the workspace animation between user navigation intents.
    for (const mode of ["craft", "catalog", "craft", "catalog", "craft"]) {
      await page.locator(modeButton(mode)).click();
    }
    await page.locator(pickerSelector).waitFor({ state: "visible" });
    await assertEmptyMonitorHint(page);
    await choosePriceHistory(page);
    await page.locator(modeButton("monitor")).click();
    await page.waitForFunction(() => document.documentElement.dataset.deskView === "monitor");
    assert(await page.locator(modeButton("monitor")).isEnabled());
  });
}

test("workspace navigation does not raise uncaught browser errors", () => {
  assert.deepEqual(pageErrors, []);
});
