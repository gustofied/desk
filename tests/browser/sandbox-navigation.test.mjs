import assert from "node:assert/strict";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after, before } from "node:test";
import { createSharedDesk, encodeSharedDesk } from "../../src/shared-desk.js";

// Local archived/generated data only, with disposable browser storage.
const moduleName = process.env.DESK_PLAYWRIGHT_MODULE || "playwright";
const playwright = await import(isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const engine = process.env.DESK_BROWSER_ENGINE || "chromium";
const baseUrl = process.env.DESK_BASE_URL || "http://127.0.0.1:4173";
const svg = "[data-gpu-chart-svg]";
const gallery = "[data-card-gallery-grid] .desk-gallery-card";
const providers = ["novita", "daytona-vm", "blaxel", "e2b", "modal-vm", "modal-gvisor"];
const entries = [
  { cardId: "sandbox-cost", name: "Sandbox latest", state: { provider: "novita", layers: providers, range: "now", scale: "price" } },
  { cardId: "sandbox-cost", name: "Sandbox history", state: { provider: "novita", layers: providers, range: "7d", scale: "price" } },
  { cardId: "gpu-index", name: "GPU comparison", state: { gpu: "H200", layers: ["H100", "H200"], range: "7d", scale: "price" } },
  { cardId: "power-basis", name: "Dominion power", state: { location: "PJM-DOMINION", range: "7d", scale: "price" } },
];
let browser;
before(async () => {
  assert(["chromium", "webkit"].includes(engine));
  browser = await playwright[engine].launch({ headless: true,
    ...(process.env.DESK_BROWSER_PATH ? { executablePath: process.env.DESK_BROWSER_PATH } : {}) });
});
after(async () => { await browser?.close(); });

async function makePage(t, url, width = 1440) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 },
    reducedMotion: "reduce", hasTouch: width === 390, isMobile: width === 390 });
  const page = await context.newPage();
  const errors = [];
  page.setDefaultTimeout(12000);
  page.on("pageerror", error => errors.push(error.message));
  t.after(async () => {
    await page.unrouteAll({ behavior: "wait" });
    await context.close();
    assert.deepEqual(errors, [], "Cross-renderer actions raised uncaught errors");
  });
  await page.route("**/*", route => new URL(route.request().url()).origin === new URL(baseUrl).origin
    ? route.continue() : route.abort());
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("[data-gpu-benchmark-card]")?.dataset.cardReady === "true");
  await page.evaluate(() => { window.__navigationDocument = document.documentElement; });
  return page;
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

async function assertRenderer(page, entry, count = 6) {
  await page.waitForFunction(({ cardId, range, svg, count }) => {
    const root = document.querySelector(svg);
    if (!root || new URL(location.href).searchParams.get("card") !== cardId ||
        new URL(location.href).searchParams.get("range") !== range) return false;
    return cardId === "sandbox-cost"
      ? root.querySelectorAll("[data-sandbox-provider]").length === count && root.querySelector("[data-sandbox-chart]")?.getAttribute("data-sandbox-chart") === range
      : cardId === "gpu-index" ? root.querySelectorAll(".gpu-benchmark__line").length === 2
        : root.querySelectorAll("[data-power-basis-line]").length === 2;
  }, { cardId: entry.cardId, range: entry.state.range, svg, count });
  assert(await page.locator(svg).isVisible());
  assert(await page.evaluate(() => window.__navigationDocument === document.documentElement), "Navigation unexpectedly reloaded the document");
  assert.equal(await page.locator(`${svg} .is-exiting`).count(), 0);
  if (entry.cardId === "sandbox-cost") {
    assert.equal(await page.locator(`${svg} .gpu-benchmark__plot-root, ${svg} [data-power-basis-line]`).count(), 0);
    assert.equal(await page.locator(`${svg} [data-sandbox-chart][tabindex="0"]`).count(), 1);
    assert.equal(await page.locator(svg).getAttribute("tabindex"), null, "Sandbox must not leave a second tab stop on the shared SVG");
  } else {
    assert.equal(await page.locator(`${svg} [data-sandbox-chart], ${svg} [data-sandbox-hit], ${svg} [data-sandbox-readout]`).count(), 0);
    assert.doesNotMatch(await page.locator(svg).getAttribute("aria-label") || "", /Sandbox|change provider|cents per job/);
  }
}

async function inspectSandbox(page, range) {
  const target = page.locator(`${svg} [data-sandbox-chart]`);
  await target.focus();
  await page.keyboard.press("Home");
  const first = await target.getAttribute("aria-label");
  await page.keyboard.press("ArrowRight");
  const second = await target.getAttribute("aria-label");
  if (range === "now") assert.equal(second, first, "Latest batch has one distribution summary per provider");
  else assert.notEqual(second, first, "Right arrow must inspect the next Sandbox observation");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await target.getAttribute("aria-label"), first, "One Left arrow must undo one Right arrow, without duplicate listeners");
  await page.keyboard.press("ArrowDown");
  assert.notEqual(await target.getAttribute("aria-label"), first, "Down arrow must inspect another provider");
  await page.keyboard.press("ArrowUp");
  assert.equal(await target.getAttribute("aria-label"), first, "Provider navigation must not accumulate duplicate listeners");
  assert.equal(await page.locator(`${svg} [data-sandbox-readout]`).getAttribute("visibility"), "visible");
  assert.equal(await page.locator("[data-catalog-entry-key][aria-selected='true']").count(), 1);
}

for (const width of [1440, 390]) {
  test(`Sandbox and legacy renderers can repeatedly share the same monitor and keyboard navigation at ${width}px`, async t => {
    const snapshot = createSharedDesk({ name: "Renderer regression", entries, palette: "linen", theme: "dark" });
    const url = new URL("/?view=gallery", baseUrl);
    url.hash = `desk=${encodeSharedDesk(snapshot)}`;
    const page = await makePage(t, url.href, width);
    await page.locator(gallery).first().click();
    await assertRenderer(page, entries[0]);
    await page.evaluate(selector => { window.__navigationSvg = document.querySelector(selector); }, svg);
    for (const index of [0, 1, 2, 3, 0, 1, 3, 2, 0]) {
      const entry = entries[index];
      await page.getByRole("tab", { name: entry.name, exact: true }).click();
      await assertRenderer(page, entry);
      assert.equal(new URL(page.url()).hash, url.hash, "A renderer transition lost the shared desk");
      assert(await page.evaluate(selector => window.__navigationSvg === document.querySelector(selector), svg), "Expected the existing monitor SVG to be reused");
      if (entry.cardId === "sandbox-cost") await inspectSandbox(page, entry.state.range);
      if (entry.cardId === "gpu-index") {
        const slider = page.locator(`${svg} .gpu-benchmark__hit[role="slider"]`);
        await slider.focus();
        await page.keyboard.press("Home");
        assert.equal(await slider.getAttribute("aria-valuenow"), "0");
        await page.keyboard.press("ArrowRight");
        assert.equal(await slider.getAttribute("aria-valuenow"), "1", "GPU keyboard handling must survive Sandbox navigation without extra listeners");
      }
    }
  });
}

test("Deferred rail updates preserve explicit chart and input focus", async t => {
  const snapshot = createSharedDesk({ name: "Focus regression", entries: [entries[2], entries[0], entries[1], entries[3]],
    palette: "linen", theme: "dark" });
  const url = new URL("/?view=gallery", baseUrl);
  url.hash = `desk=${encodeSharedDesk(snapshot)}`;
  const page = await makePage(t, url.href, 390);
  await page.locator(gallery).first().click();
  await assertRenderer(page, entries[2]);
  for (const mode of ["tab", "chart", "input"]) {
    await page.getByRole("tab", { name: entries[2].name, exact: true }).click();
    await assertRenderer(page, entries[2]);
    const result = await page.getByRole("tab", { name: entries[0].name, exact: true }).evaluate(async (button, mode) => {
      // Focus moves in the same task, before any queued rail-restoration frame.
      button.focus();
      button.click();
      const chart = document.querySelector("[data-gpu-chart-svg] [data-sandbox-chart]");
      let target = button;
      if (mode === "chart") target = chart;
      if (mode === "input") {
        target = document.createElement("input");
        target.id = "sandbox-focus-regression-input";
        target.setAttribute("aria-label", "Temporary focus regression input");
        document.body.append(target);
      }
      if (mode !== "tab") target.focus();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { retained: document.activeElement === target,
        actual: document.activeElement?.outerHTML.slice(0, 300),
        range: chart?.getAttribute("data-sandbox-chart"), selected: button.getAttribute("aria-selected") };
    }, mode);
    assert.equal(result.range, "now", "The cross-renderer activation completed");
    assert.equal(result.selected, "true", "The requested tab stays selected");
    assert(result.retained, `Deferred rail restoration stole ${mode} focus: ${result.actual}`);
    if (mode === "chart") {
      await page.keyboard.press("ArrowDown");
      assert.match(await page.locator(`${svg} [data-sandbox-chart]`).getAttribute("aria-label"), /^Daytona VM:/);
    } else if (mode === "input") {
      await page.keyboard.type("cost");
      assert.equal(await page.locator("#sandbox-focus-regression-input").inputValue(), "cost");
    }
  }
});

test("Craft can change the Sandbox primary, remove providers and persist the exact pin", async t => {
  const url = new URL("/?card=sandbox-cost&view=monitor&range=now", baseUrl);
  const page = await makePage(t, url.href);
  await page.locator('[data-desk-mode="craft"]').click();
  await page.locator('[data-craft-type="sandbox-cost"]').click();
  await page.waitForFunction(selector => document.querySelectorAll(`${selector} [data-sandbox-provider]`).length === 6, svg);
  if (!await page.locator('[data-card-primary="daytona-vm"]').isVisible()) await page.locator("[data-card-compare-toggle]").click();
  await page.locator('[data-card-primary="daytona-vm"]').click();
  await page.locator('[data-card-layer="e2b"]').click();
  await page.waitForFunction(() => {
    const url = new URL(location.href);
    return url.searchParams.get("provider") === "daytona-vm" && !url.searchParams.get("layers")?.split(",").includes("e2b");
  });
  assert.equal(await page.locator(`${svg} [data-sandbox-provider]`).count(), 5);
  assert.equal(await page.locator(`${svg} [data-sandbox-provider="e2b"]`).count(), 0);
  await page.locator('[data-gpu-range="7d"]').click();
  await page.waitForFunction(selector => document.querySelector(`${selector} [data-sandbox-chart]`)?.getAttribute("data-sandbox-chart") === "7d", svg);
  await command(page, "actions.pin-to-strip", "pin");
  const pin = await page.evaluate(() => JSON.parse(localStorage.getItem("desk.market-watchlist.v1")).items.find(item => item.cardId === "sandbox-cost"));
  assert(pin, "Craft Sandbox was not pinned");
  assert.equal(pin.state.provider, "daytona-vm");
  assert.deepEqual(pin.state.layers, providers.filter(id => id !== "e2b"));
  assert.equal(pin.state.range, "7d");
  await page.reload({ waitUntil: "networkidle" });
  const reloaded = await page.evaluate(id => JSON.parse(localStorage.getItem("desk.market-watchlist.v1")).items.find(item => item.id === id), pin.id);
  assert.deepEqual(reloaded, pin);
});
