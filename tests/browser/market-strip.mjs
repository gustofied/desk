import assert from "node:assert/strict";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import test, { after, before } from "node:test";

// Run against an existing preview. No dependencies or browser binaries are installed.
// Optional: DESK_PLAYWRIGHT_MODULE, DESK_BROWSER_PATH, DESK_BASE_URL,
// DESK_SCREENSHOT_DIR (defaults to the operating system's temporary directory).
const moduleName = process.env.DESK_PLAYWRIGHT_MODULE || "playwright";
const { chromium } = await import(isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const baseUrl = (process.env.DESK_BASE_URL || "http://127.0.0.1:4173").replace(/\/$/, "");
const screenshotDir = process.env.DESK_SCREENSHOT_DIR || tmpdir();
const monitorPath = "/?card=gpu-index&view=monitor&gpu=H200&layers=H200&scale=price&range=7d";
const rootSelector = "[data-market-strip]";
const viewportSelector = "[data-market-strip-viewport]";
const trackSelector = "[data-market-strip-track]";
const pageErrors = [];
let browser;

before(async () => {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.DESK_BROWSER_PATH ? { executablePath: process.env.DESK_BROWSER_PATH } : {}),
  });
});
after(async () => { await browser?.close(); });

async function makePage(t, { width = 1440, height = 900, theme = "dark", motion = "reduce", path = monitorPath, failData = false, touch = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: motion, hasTouch: touch, isMobile: touch });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", error => pageErrors.push(error.message));
  if (failData) await page.route(`${baseUrl}/data/**`, route => route.fulfill({
    status: 503, contentType: "application/json", body: '{"error":"Simulated data failure"}',
  }));
  const url = new URL(path, baseUrl);
  url.searchParams.set("theme", theme);
  url.searchParams.set("palette", "linen");
  await page.goto(url.href, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("[data-market-strip]").dataset.state !== "loading");
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(width - 4, Math.min(height - 4, 400));
  await page.waitForTimeout(120);
  return page;
}

async function stripState(page) {
  return page.evaluate(() => {
    const root = document.querySelector("[data-market-strip]");
    const viewport = root.querySelector("[data-market-strip-viewport]");
    const track = root.querySelector("[data-market-strip-track]");
    const transform = getComputedStyle(track).transform;
    const offset = transform === "none" ? 0 : -new DOMMatrixReadOnly(transform).m41;
    const groups = [...root.querySelectorAll("ul")];
    const rect = root.getBoundingClientRect();
    return {
      ...root.dataset,
      x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      scroll: viewport.scrollLeft, viewportWidth: viewport.clientWidth,
      offset, phase: offset + viewport.scrollLeft, sampledAt: performance.now(),
      animations: track.getAnimations().map(animation => ({
        playState: animation.playState, playbackRate: animation.playbackRate,
        currentTime: animation.currentTime, duration: animation.effect.getTiming().duration,
      })),
      groupWidth: groups[0]?.getBoundingClientRect().width || 0,
      viewportTabIndex: viewport.tabIndex,
      footerControls: root.querySelectorAll("[data-market-strip-toggle], [data-market-strip-pin]").length,
      copyHidden: groups[1]?.hidden, copyAriaHidden: groups[1]?.getAttribute("aria-hidden"), copyButtons: groups[1]?.querySelectorAll("button,a,[tabindex]").length,
      hasSourceLabel: Boolean(root.querySelector("[data-market-strip-source]")),
      stamp: groups[0]?.querySelector(".desk-market-strip__stamp")?.textContent,
      items: [...root.querySelectorAll("[data-market-instrument]")].map(item => ({
        id: item.dataset.marketInstrument, observedAt: item.dataset.observedAt, kind: item.dataset.kind,
        price: item.querySelector("strong").textContent,
        unit: item.querySelector(".desk-market-strip__unit").textContent,
      })),
      text: root.textContent,
    };
  });
}

async function expectMotion(page, moving, label) {
  try {
    await page.waitForFunction(expected => document.querySelector("[data-market-strip]").dataset.moving === String(expected), moving, { timeout: 3000 });
  } catch (error) {
    const state = await stripState(page);
    await page.waitForTimeout(400);
    const environment = await page.evaluate(() => ({
      reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
      hidden: document.hidden,
      focused: document.activeElement?.outerHTML.slice(0, 200),
    }));
    assert.fail(`${label}: motion status did not become ${moving}; actual phase delta over 400ms=${(await stripState(page)).phase - state.phase}; ${JSON.stringify({ state, environment })}; ${error.message}`);
  }
  const before = await stripState(page);
  await page.waitForTimeout(moving ? 650 : 350);
  const after = await stripState(page);
  const delta = phaseDistance(before, after);
  if (moving) {
    const forward = ((after.phase - before.phase) % after.groupWidth + after.groupWidth) % after.groupWidth;
    const speed = forward * 1000 / (after.sampledAt - before.sampledAt);
    assert(speed >= 9 && speed <= 18, `${label}: expected slow transform motion near14px/s (including resume ramp), got ${speed}px/s`);
    assert.equal(after.scroll, before.scroll, `${label}: automatic motion is writing native scrollLeft`);
    assert(after.animations.some(animation => animation.playState === "running"), `${label}: no running compositor animation`);
  } else {
    assert(delta <= 1, `${label}: stationary strip moved ${delta}px`);
    assert(after.animations.every(animation => animation.playState !== "running" || animation.playbackRate === 0), `${label}: paused strip still has a running animation`);
  }
}

function phaseDistance(before, after) {
  const distance = after.groupWidth || before.groupWidth;
  const delta = after.phase - before.phase;
  return distance ? Math.min(Math.abs(delta), Math.abs(delta + distance), Math.abs(delta - distance)) : Math.abs(delta);
}

async function resumeWithoutJump(page, action, label) {
  const before = await stripState(page);
  await action();
  const after = await stripState(page);
  assert(phaseDistance(before, after) <= 3, `${label}: resume jumped from phase${before.phase} to${after.phase}`);
  await expectMotion(page, true, label);
}

async function openMenu(page) {
  await page.keyboard.press("Meta+g");
  await page.waitForFunction(() => document.querySelector("[data-command-palette]").matches(":modal"));
  if (await page.locator("[data-desk-login]").isVisible()) {
    await page.locator("[data-desk-login]").focus();
    await page.keyboard.press("Enter");
  }
  await page.locator("[data-command-input]").waitFor({ state: "visible" });
}

async function command(page, query, id) {
  await page.locator("[data-command-input]").fill(query);
  const row = page.locator(`#desk-command-${id}`);
  await row.waitFor({ state: "visible" });
  await row.click();
  await page.waitForTimeout(100);
}

async function assertLayout(page, label) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  const result = await page.evaluate(() => {
    const selectors = ["[data-market-strip]", ".desk-market-clock", ".desk-brand", ".desk-top-controls", ".desk-search", ".desk-stage"];
    const boxes = Object.fromEntries(selectors.map(selector => {
      const element = document.querySelector(selector), rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      return [selector, { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom,
        visible: style.visibility === "visible" && style.display !== "none" && rect.width > 0 && rect.height > 0 }];
    }));
    return {
      boxes, width: innerWidth, height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      safeArea: parseFloat(getComputedStyle(document.querySelector("[data-market-strip]")).paddingBottom) || 0,
    };
  });
  const strip = result.boxes[rootSelector], stage = result.boxes[".desk-stage"];
  assert(Math.abs(strip.x) < 1 && Math.abs(strip.bottom - result.height) < 1 && Math.abs(strip.width - result.width) < 1 && Math.abs(strip.height - 32 - result.safeArea) < 1, `${label}: strip must occupy one 32px bottom band plus safe area ${JSON.stringify(strip)}`);
  assert(result.scrollWidth <= result.width + 1, `${label}: horizontal page overflow`);
  assert(stage.width > 100 && stage.height > 0 && stage.x >= -1 && stage.right <= result.width + 1, `${label}: invalid workspace bounds ${JSON.stringify(stage)}`);
  const mobile = result.width <= 640;
  const originalTops = { ".desk-market-clock": mobile ? 8 : 16, ".desk-brand": mobile ? 32 : 40, ".desk-search": mobile ? 8 : 12 };
  for (const selector of [".desk-market-clock", ".desk-brand", ".desk-top-controls", ".desk-search"]) {
    const box = result.boxes[selector];
    if (!box.visible) continue;
    assert(box.y >= 0 && box.bottom <= strip.y + 1, `${label}: ${selector} collides with footer ${JSON.stringify(box)}`);
    if (selector in originalTops) assert(Math.abs(box.y - originalTops[selector]) <= 1, `${label}: ${selector} did not return to its original top position ${JSON.stringify(box)}`);
    if (selector === ".desk-top-controls" && mobile) assert(Math.abs(box.y - 84) <= 1, `${label}: mobile navigation did not return to its original top position`);
  }
  const controls = result.boxes[".desk-top-controls"];
  if (controls.visible) assert(controls.bottom <= stage.y + 1, `${label}: navigation overlaps workspace ${JSON.stringify({ controls, stage })}`);

  const clearance = await page.evaluate(async () => {
    window.scrollTo({ top: document.scrollingElement.scrollHeight, behavior: "instant" });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const stageBottom = document.querySelector(".desk-stage").getBoundingClientRect().bottom;
    const footerTop = document.querySelector("[data-market-strip]").getBoundingClientRect().top;
    const scroll = scrollY;
    window.scrollTo({ top: 0, behavior: "instant" });
    return { stageBottom, footerTop, scroll };
  });
  assert(clearance.stageBottom <= clearance.footerTop + 1, `${label}: final workspace content cannot scroll above the footer ${JSON.stringify(clearance)}`);
}

for (const theme of ["dark", "light"]) {
  test(`desktop prices retain source values/provenance and stay static when they fit (${theme})`, async t => {
    const page = await makePage(t, { theme, path: "/", motion: "no-preference" });
    const state = await stripState(page);
    assert.equal(state.state, "ready");
    assert.equal(state.hasSourceLabel, false, "The footer has no source-label column");
    assert.doesNotMatch(state.text, /\b(?:scenario|demo|live)\b/i, "Do not replace the removed label with another badge");
    assert.deepEqual(state.items.map(item => item.id), ["H100", "H200", "B200", "B300", "PJM-WEST-RT"]);
    const gpu = await (await page.request.get(`${baseUrl}/data/gpu-price-index.json`)).json();
    const power = await (await page.request.get(`${baseUrl}/data/power-basis.json`)).json();
    for (const item of state.items) {
      const rows = item.id === "PJM-WEST-RT" ? power.series["PJM-WEST"] : gpu.series[item.id];
      const latest = rows.reduce((a, b) => a[0] > b[0] ? a : b);
      assert.equal(item.price, new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(latest[1]));
      assert.equal(item.unit, item.id === "PJM-WEST-RT" ? "/MWh" : "/GPU-h");
      assert.equal(item.observedAt, new Date(latest[0] * 1000).toISOString());
      assert.equal(item.kind, "scenario");
    }
    assert.match(state.stamp, /(?:As of|Observations).*UTC/);
    assert.equal(state.overflow, "false", "Desktop row should fit without scrolling");
    assert.equal(state.footerControls, 0, "The footer must not contain pin or pause controls");
    assert(state.copyHidden);
    assert.equal(state.copyAriaHidden, "true");
    assert.equal(state.copyButtons, 0);
    await expectMotion(page, false, "Fitting desktop row");
    await assertLayout(page, "Desktop Catalog");
    await page.screenshot({ path: join(screenshotDir, `desk-market-strip-1440-${theme}-gallery-bottom.png`), fullPage: true });
  });
}

test("compositor overflow pauses on hover and keyboard focus, then resumes from the same phase", async t => {
  const page = await makePage(t, { width: 390, height: 844, motion: "no-preference" });
  const state = await stripState(page);
  assert.equal(state.overflow, "true");
  assert.equal(state.motion, "auto");
  assert.equal(state.footerControls, 0);
  assert(!state.copyHidden && state.copyButtons === 0 && state.copyAriaHidden === "true");
  assert.equal(state.items.length, 5, "Cloned marquee content must not duplicate instrument hooks");
  assert.equal(state.viewportTabIndex, 0);
  await expectMotion(page, true, "Initial fine-pointer overflow");
  assert(await page.locator(trackSelector).evaluate(track => track.getAnimations().some(animation =>
    animation.effect.getKeyframes().every(frame => "transform" in frame))), "Automatic ticker motion does not animate transform");
  await page.screenshot({ path: join(screenshotDir, "desk-market-strip-390-normal-bottom.png"), fullPage: true });

  await page.locator(viewportSelector).hover();
  await expectMotion(page, false, "Pointer hover");
  await resumeWithoutJump(page, () => page.mouse.move(380, 400), "Pointer leave");
  await page.locator(viewportSelector).focus();
  await expectMotion(page, false, "Keyboard reading focus");
  const reading = await stripState(page);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(250);
  assert((await stripState(page)).scroll > reading.scroll, "Focused desktop ticker does not support native keyboard scrolling");
  await resumeWithoutJump(page, () => page.locator("[data-command-open]").focus(), "Focus leaving ticker viewport absorbs native scroll position");
});

test("overflow resize preserves reading focus and phase; hidden-document signal stops compositor work", async t => {
  const page = await makePage(t, { width: 390, motion: "no-preference" });
  await expectMotion(page, true, "Before resize");
  await page.locator(viewportSelector).focus();
  await expectMotion(page, false, "Reading before resize");
  const before = await stripState(page);
  await page.setViewportSize({ width: 420, height: 900 });
  await page.waitForTimeout(120);
  assert(await page.locator(viewportSelector).evaluate(el => document.activeElement === el), "Resize discarded keyboard reading focus");
  assert(phaseDistance(before, await stripState(page)) <= 1, "Resize jumped the held reading phase");
  await resumeWithoutJump(page, () => page.locator("[data-command-open]").focus(), "Before hidden-document signal");
  // Inject the browser visibility signal without relying on headless tab scheduling.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expectMotion(page, false, "Hidden document");
  await resumeWithoutJump(page, () => page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  }), "Visible document resumes");
});

test("reduced motion retains native horizontal scrolling without automatic animation or duplicate", async t => {
  const page = await makePage(t, { width: 390, height: 844, motion: "reduce" });
  const state = await stripState(page);
  assert.equal(state.overflow, "true");
  assert.equal(state.motion, "manual");
  assert.equal(state.footerControls, 0);
  assert(state.copyHidden);
  assert.equal(state.viewportTabIndex, 0);
  await expectMotion(page, false, "Reduced motion");
  await page.locator(viewportSelector).focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(180);
  assert((await stripState(page)).scroll > state.scroll, "Keyboard cannot scroll reduced-motion overflow");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator("[data-command-open]").focus();
  await expectMotion(page, true, "Live reduced-motion preference change");
  assert(!(await stripState(page)).copyHidden);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expectMotion(page, false, "Restored reduced-motion preference");
  assert((await stripState(page)).copyHidden);
  assert.equal((await stripState(page)).motion, "manual");
});

test("touch devices use native manual overflow even without reduced motion", async t => {
  const page = await makePage(t, { width: 390, height: 844, motion: "no-preference", touch: true });
  const before = await stripState(page);
  assert.equal(before.motion, "manual");
  assert.equal(before.footerControls, 0);
  assert(before.copyHidden);
  await expectMotion(page, false, "Coarse-pointer device");
  const viewport = page.locator(viewportSelector);
  assert(await viewport.evaluate(element => /auto|scroll/.test(getComputedStyle(element).overflowX)));
  const box = await viewport.boundingBox();
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + box.width - 24, y: box.y + box.height / 2 }] });
  for (let step = 1; step <= 5; step++) {
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x + box.width - 24 - step * 30, y: box.y + box.height / 2 }] });
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(250);
  await session.detach();
  assert((await stripState(page)).scroll > before.scroll, "Touch swipe cannot scroll the manual ticker");
  assert.equal((await stripState(page)).offset, 0, "Touch scrolling introduced an automatic transform");
  assert(await page.locator("[data-market-preview]").isHidden(), "Touch swipe opened a sticky hover preview");
});

test("terminal data failure keeps a stable nonbusy unavailable strip", async t => {
  const page = await makePage(t, { failData: true });
  const state = await stripState(page);
  assert.equal(state.state, "unavailable");
  assert.equal(state.items.length, 0);
  assert.match(state.text, /Prices unavailable/);
  assert(!state.text.includes("$0.00"));
  assert.equal(state.footerControls, 0);
  await expectMotion(page, false, "Unavailable data");
  await assertLayout(page, "Unavailable strip");
});

for (const width of [1440, 1045, 961, 960, 641, 640, 390, 320]) {
  test(`original header and bottom strip stay clear of workspace through modes (${width}px)`, async t => {
    const page = await makePage(t, { width, height: width < 641 ? 844 : 900, path: "/" });
    await assertLayout(page, `${width}px Catalog collapsed`);
    await page.locator('[data-desk-mode="monitor"]').click();
    await page.waitForFunction(() => document.documentElement.dataset.deskView === "monitor");
    await page.waitForTimeout(120);
    await assertLayout(page, `${width}px Monitor collapsed`);
    await page.locator('[data-desk-mode="craft"]').click();
    await page.locator(".gpu-benchmark__craft-empty").waitFor({ state: "visible" });
    await page.waitForTimeout(120);
    await assertLayout(page, `${width}px Craft empty collapsed`);
    await openMenu(page);
    await command(page, "Show display controls", "actions-toggle-display-controls");
    await assertLayout(page, `${width}px Craft empty expanded`);
    await page.locator('[data-craft-type="gpu-index"]').click();
    await page.waitForTimeout(120);
    await assertLayout(page, `${width}px Craft filled expanded`);
    await page.locator('[data-desk-mode="catalog"]').click();
    await page.waitForFunction(() => document.documentElement.dataset.deskView === "catalog");
    await page.waitForTimeout(120);
    await assertLayout(page, `${width}px Catalog expanded`);
  });
}

for (const width of [1440, 390]) {
  test(`strip remains above sidebar and beneath native command modal (${width}px)`, async t => {
    const page = await makePage(t, { width, height: 900 });
    const before = await stripState(page), url = page.url();
    await page.evaluate(() => { window.__stripChart = document.querySelector("[data-gpu-chart]"); });
    await openMenu(page);
    await command(page, "Show sidebar", "workspace-sidebar-presentation");
    await page.waitForFunction(() => document.querySelector("[data-desk-sidecar]").open);
    assert(await page.locator(rootSelector).evaluate(root => root.contains(document.elementFromPoint(20, root.getBoundingClientRect().top + 16))), "Sidebar covers the market strip");
    await page.locator("[data-command-open]").click();
    assert(await page.locator("[data-command-palette]").evaluate(el => el.matches(":modal")));
    assert(await page.locator("[data-desk-sidecar]").evaluate(el => el.open && !el.matches(":modal")));
    assert(!(await page.locator(rootSelector).evaluate(root => root.contains(document.elementFromPoint(20, root.getBoundingClientRect().top + 16)))), "Market strip escapes native modal priority");
    await page.keyboard.press("Escape");
    await page.locator("[data-sidecar-handle]").focus();
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("[data-desk-sidecar]").open);
    assert.equal(page.url(), url);
    assert(await page.evaluate(() => window.__stripChart === document.querySelector("[data-gpu-chart]")));
    assert.deepEqual((await stripState(page)).items, before.items);
    await assertLayout(page, "Sidebar dismissed");
  });
}

test("hover previews match each destination and click through without a page reload", async t => {
  const page = await makePage(t, { path: "/?card=gpu-index&view=craft&draft=new", motion: "no-preference" });
  const preview = page.locator("[data-market-preview]");
  await page.evaluate(() => { window.__marketDocument = document; });
  for (const id of ["H100", "H200", "B200", "B300", "PJM-WEST-RT"]) {
    const before = page.url();
    const trigger = page.locator(`[data-market-instrument="${id}"] button`);
    await trigger.hover();
    await preview.waitFor({ state: "visible" });
    await page.waitForFunction(id => document.querySelector("[data-market-preview]").dataset.instrument === id, id);
    assert.equal(page.url(), before, "Hover must not change the workspace");
    assert(await preview.locator("svg path").count() > 0, `${id} has no chart`);
    assert.equal(await preview.locator("[data-market-preview-open]").getAttribute("aria-label"), `Open ${id === "PJM-WEST-RT" ? "PJM West RT" : id} in Monitor`);
    const box = await preview.boundingBox();
    assert(box.x >= 12 && box.x + box.width <= 1428 && box.y + box.height <= 868);
    await preview.hover();
    await page.waitForTimeout(220);
    assert(await preview.isVisible(), "Preview disappeared while moving onto it");
    if (id === "B200") await page.screenshot({ path: join(screenshotDir, "desk-market-preview-dark.png") });
    await preview.locator("[data-market-preview-open]").click();
    await page.waitForFunction(() => document.documentElement.dataset.deskView === "monitor");
    const expectedCard = id === "PJM-WEST-RT" ? "power-basis" : "gpu-index";
    await page.waitForFunction(({ card, id }) => {
      const params = new URL(location.href).searchParams;
      return params.get("card") === card && params.get("view") === "monitor" &&
        params.get(id === "PJM-WEST-RT" ? "location" : "gpu") === (id === "PJM-WEST-RT" ? "PJM-WEST" : id);
    }, { card: expectedCard, id });
    const url = new URL(page.url());
    assert.equal(url.searchParams.get(id === "PJM-WEST-RT" ? "location" : "gpu"), id === "PJM-WEST-RT" ? "PJM-WEST" : id);
    assert.equal(url.searchParams.get("scale"), "price");
    assert(await preview.isHidden());
    assert(await page.evaluate(() => window.__marketDocument === document), "Ticker navigation reloaded the document");
  }
});

test("keyboard preview is dismissible with Escape and Enter opens the chart", async t => {
  const page = await makePage(t, { theme: "light" });
  const before = page.url();
  const trigger = page.locator('[data-market-instrument="B300"] button');
  const preview = page.locator("[data-market-preview]");
  await trigger.focus();
  await preview.waitFor({ state: "visible" });
  assert.equal(await preview.evaluate(el => el.getAnimations().length), 0, "Reduced motion preview is animated");
  await page.screenshot({ path: join(screenshotDir, "desk-market-preview-light.png") });
  await page.keyboard.press("Escape");
  assert(await preview.isHidden());
  assert.equal(page.url(), before, "Dismissal navigated back to Gallery");
  assert(await trigger.evaluate(el => document.activeElement === el));
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => new URL(location.href).searchParams.get("gpu") === "B300");
});

test("visible repeated ticker prices remain clickable without duplicate tab stops", async t => {
  const page = await makePage(t, { width: 640, motion: "no-preference" });
  const repeated = page.locator('.desk-market-strip__group[aria-hidden="true"] [data-market-target="H100"]');
  await expectMotion(page, true, "Before repeated-content interaction");
  // Advance the public animation clock rather than waiting for a full minute-long lap.
  await page.evaluate(() => {
    const track = document.querySelector("[data-market-strip-track]");
    const first = document.querySelector(".desk-market-strip__group");
    track.getAnimations()[0].currentTime = (first.getBoundingClientRect().width - 24) * 1000 / 14;
  });
  await repeated.hover({ force: true });
  await page.locator("[data-market-preview]").waitFor({ state: "visible" });
  await repeated.click();
  await page.waitForFunction(() => new URL(location.href).searchParams.get("gpu") === "H100");
  assert.equal((await stripState(page)).copyButtons, 0);
  await page.mouse.move(638, 400);
  await expectMotion(page, true, "Pointer click followed by leaving the ticker must not leave a sticky focus pause");
});

test("Tab reaches the original price and retains its preview after the loop advances into the duplicate", async t => {
  const page = await makePage(t, { width: 640, motion: "no-preference" });
  await expectMotion(page, true, "Before keyboard navigation into advanced loop");
  await page.locator(trackSelector).evaluate(track => {
    const distance = track.querySelector("ul").getBoundingClientRect().width;
    track.getAnimations()[0].currentTime = (distance - 24) * 1000 / 14;
  });
  await page.locator(viewportSelector).focus();
  await page.keyboard.press("Tab");
  const original = page.locator('[data-market-instrument="H100"] button');
  assert(await original.evaluate(element => document.activeElement === element), "Tab entered a duplicate or skipped the first original");
  assert(await original.evaluate(element => {
    const rect = element.getBoundingClientRect(), viewport = element.closest("[data-market-strip-viewport]").getBoundingClientRect();
    return rect.left >= viewport.left - 1 && rect.right <= viewport.right + 1;
  }), "Tab left the original price offscreen");
  await page.locator("[data-market-preview]").waitFor({ state: "visible" });
  assert.equal(await page.locator("[data-market-preview]").getAttribute("data-instrument"), "H100");
  await page.mouse.move(638, 400);
  await expectMotion(page, false, "Keyboard preview holds the loop while the pointer is outside");
  assert(await page.locator("[data-market-preview]").isVisible());
});

test("touch opens directly on the first tap without a sticky hover preview", async t => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(`${baseUrl}/?card=gpu-index&view=craft&draft=new`, { waitUntil: "networkidle" });
  await page.locator('[data-market-instrument="H100"] button').tap();
  await page.waitForFunction(() => document.documentElement.dataset.deskView === "monitor");
  assert.equal(new URL(page.url()).searchParams.get("gpu"), "H100");
  assert(await page.locator("[data-market-preview]").isHidden());
});

test("ticker navigation preserves an edited Craft draft", async t => {
  const page = await makePage(t, { path: "/?card=gpu-index&view=craft&draft=new" });
  await page.locator('[data-craft-type="gpu-index"]').click();
  await page.locator('[data-market-instrument="PJM-WEST-RT"] button').click();
  await page.waitForFunction(() => new URL(location.href).searchParams.get("card") === "power-basis");
  const draft = await page.evaluate(() => JSON.parse(sessionStorage.getItem("desk.craft-draft.v1.gpu-index")));
  assert(draft?.cardState, "The Craft draft was lost on ticker navigation");
});

test("moving within a price keeps its pending preview, and keyboard focus keeps it open", async t => {
  const page = await makePage(t);
  const item = page.locator('[data-market-instrument="B200"]');
  await item.locator(".desk-market-strip__name").hover();
  await item.locator(".desk-market-strip__price").hover();
  const preview = page.locator("[data-market-preview]");
  await preview.waitFor({ state: "visible" });
  await preview.locator("[data-market-preview-open]").focus();
  await page.mouse.move(1200, 400);
  await page.waitForTimeout(250);
  assert(await preview.isVisible());
  assert(await preview.locator("[data-market-preview-open]").evaluate(el => document.activeElement === el));
  await page.keyboard.press("Escape");
  assert(await preview.isHidden());
  assert(await item.locator("button").evaluate(el => document.activeElement === el));
});

test("offscreen keyboard focus reveals the original price without leaving a broken preview", async t => {
  const page = await makePage(t, { width: 390, motion: "reduce" });
  await page.evaluate(() => {
    document.querySelector("[data-market-strip-viewport]").scrollLeft = 600;
    document.querySelector('[data-market-instrument="H100"] button').focus({ preventScroll: true });
  });
  const target = page.locator('[data-market-instrument="H100"] button');
  assert(await target.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const viewport = element.closest("[data-market-strip-viewport]").getBoundingClientRect();
    return rect.left >= viewport.left - 1 && rect.right <= viewport.right + 1;
  }), "Focused original price is stranded offscreen");
  await page.locator("[data-market-preview]").waitFor({ state: "visible" });
  assert.equal(await page.locator("[data-market-preview]").getAttribute("data-instrument"), "H100");
  assert(await page.locator("[data-market-preview] svg path").count() > 0);
});

test("market strip interactions do not raise uncaught browser errors", () => {
  assert.deepEqual(pageErrors, []);
});
