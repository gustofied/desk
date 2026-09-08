import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CARD_REGISTRY } from '../../src/card-registry.js';
import { createSharedDesk, encodeSharedDesk } from '../../src/shared-desk.js';

const moduleName = process.env.DESK_PLAYWRIGHT_MODULE || 'playwright';
const playwright = await import(isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const origin = process.env.DESK_BASE_URL || 'http://127.0.0.1:4173';
let browser;
before(async () => {
  browser = await playwright[process.env.DESK_BROWSER_ENGINE || 'chromium'].launch({
    headless: true, ...(process.env.DESK_BROWSER_PATH ? { executablePath: process.env.DESK_BROWSER_PATH } : {}),
    ignoreDefaultArgs: ['--hide-scrollbars'],
  });
});
after(async () => { await browser?.close(); });

async function pageFor(t) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(origin).origin ? route.continue() : route.abort());
  t.after(async () => { await context.close(); assert.deepEqual(errors, [], 'uncaught browser errors'); });
  return page;
}
async function open(page, path) {
  await page.goto(origin + path, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('[data-card-ready="true"]'));
}

test('gallery defaults and every chart family render', async t => {
  const page = await pageFor(t);
  await open(page, '/');
  assert.deepEqual(await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, palette: document.documentElement.dataset.palette })), { theme: 'light', palette: 'linen' });
  assert.ok(await page.locator('[data-card-gallery-grid] .desk-gallery-card:visible').count());
  for (const card of CARD_REGISTRY) {
    await open(page, `/?card=${card.id}&view=monitor`);
    const chart = page.locator(card.id === 'quote-view' || card.id === 'deal-view' ? '[data-deal-workspace] svg' : '[data-gpu-chart-svg]').first();
    await chart.waitFor({ state: 'visible' });
    assert.ok(await chart.locator('path, line, rect, circle').count(), card.id);
    assert.doesNotMatch(await chart.innerHTML(), /NaN|Infinity/, card.id);
  }
});

test('Craft type picker stays readable and reachable at every width', async t => {
  const page = await pageFor(t);
  const cardIds = CARD_REGISTRY.filter(card => card.craftable !== false).map(card => card.id);
  await open(page, '/?card=gpu-index&view=craft&draft=new');
  const picker = page.locator('[data-craft-type-list]');
  const buttons = picker.locator('button');
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await picker.scrollIntoViewIfNeeded();
    assert.deepEqual(await buttons.evaluateAll(nodes => nodes.map(node => node.dataset.craftType)), cardIds);
    const layout = await buttons.evaluateAll(nodes => nodes.map(node => {
      const box = node.getBoundingClientRect();
      return {
        id: node.dataset.craftType, left: box.left, right: box.right,
        top: box.top, bottom: box.bottom, width: box.width, height: box.height,
        visible: node.checkVisibility(), enabled: !node.disabled,
        clipped: node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight,
      };
    }));
    for (const button of layout) {
      assert.ok(button.visible && button.enabled, `${button.id} reachable at ${width}px`);
      assert.ok(button.width > 0 && button.height > 0 && !button.clipped, `${button.id} label fits at ${width}px`);
      assert.ok(button.left >= -1 && button.right <= width + 1, `${button.id} fits viewport at ${width}px`);
    }
    for (let i = 0; i < layout.length; i++) {
      for (const other of layout.slice(i + 1)) {
        const button = layout[i];
        const overlapWidth = Math.min(button.right, other.right) - Math.max(button.left, other.left);
        const overlapHeight = Math.min(button.bottom, other.bottom) - Math.max(button.top, other.top);
        assert.ok(overlapWidth <= 1 || overlapHeight <= 1, `${button.id} and ${other.id} do not overlap at ${width}px`);
      }
    }
  }
  await buttons.first().focus();
  await page.keyboard.press('Tab');
  assert.equal(await buttons.nth(1).evaluate(node => node === document.activeElement), true);
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !new URL(location.href).searchParams.has('draft'));
  assert.equal(new URL(page.url()).searchParams.get('card'), cardIds[0]);
  await page.locator('[data-card-compare-toggle]').waitFor({ state: 'visible' });
  await page.locator('[data-craft-home]').focus();
  await page.keyboard.press('Enter');
  await picker.waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('[data-craft-type]') === document.activeElement);
  await buttons.last().focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(url => url.searchParams.get('card') === cardIds.at(-1) && !url.searchParams.has('draft'));
  await page.waitForFunction(() => document.querySelector('[data-card-compare-toggle]') === document.activeElement);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('[data-card-ready="true"]'));
  assert.equal(await page.evaluate(() => document.activeElement === document.body), true, 'editor focus request is consumed once');
  await page.locator('[data-craft-home]').click();
  await picker.waitFor({ state: 'visible' });
  assert.equal(await buttons.count(), cardIds.length);
  assert.equal(await picker.locator('button:disabled').count(), 0);
});

test('Desk commands keep keyboard control and preserve Craft drafts', async t => {
  const page = await pageFor(t);
  for (const [card, composition, range] of [
    ['gpu-index', 'gpu=H200&layers=H200,H100&scale=price', 'all'],
    ['equities', 'symbol=CRWV&layers=CRWV,H100,H200&scale=index&style=bars', '90d'],
  ]) {
    await page.emulateMedia({ reducedMotion: card === 'gpu-index' ? 'no-preference' : 'reduce' });
    await open(page, `/?card=${card}&view=craft&${composition}&range=${range}`);
    await page.locator('[data-desk-mode="monitor"]').click();
    await page.waitForFunction(() => document.documentElement.dataset.deskView === 'monitor');
    const draftKey = `desk.craft-draft.v1.${card}`;
    const storedDraft = await page.evaluate(key => sessionStorage.getItem(key), draftKey);
    assert.ok(storedDraft, 'leaving Craft preserves the unfinished view');
    assert.equal(JSON.parse(storedDraft).cardState.range, range);
    await page.locator('[data-gpu-range="7d"]').click();
    if (card === 'gpu-index') {
      await page.locator('[data-desk-mode="catalog"]').click();
      await page.waitForFunction(() => document.documentElement.dataset.deskView === 'catalog');
      assert.equal(await page.evaluate(key => sessionStorage.getItem(key), draftKey), storedDraft, 'Monitor changes do not replace the Craft draft');
      await page.locator('[data-desk-mode="craft"]').click();
      await page.locator('[data-craft-type-list]').waitFor({ state: 'visible' });
    }
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('[data-card-ready="true"]'));
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), draftKey), storedDraft, 'reload preserves the draft');
    assert.equal(await page.locator('.desk-brand, .desk-corners a, [data-desk-clock]').count(), 0, 'the page corner has no label, article link or clock');
    await page.locator('[data-command-open]').click();
    const entry = page.locator('[data-desk-entry]');
    assert.equal(await entry.locator('.desk-command-menu__byline').count(), 0, 'login has no byline');
    await page.waitForFunction(() => document.querySelector('[data-desk-login]') === document.activeElement);
    if (card === 'gpu-index') {
      await page.locator('[data-desk-login]').click();
      assert.equal(await page.locator('[data-command-content]').evaluate(node => !node.hidden && !node.inert), true, 'pointer login reveals commands without an artificial wait');
    } else await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-command-input]') === document.activeElement);
    await entry.waitFor({ state: 'hidden' });
    assert.equal(await entry.evaluate(node => node.hidden && node.inert), true, 'keyboard login hides and disables the entry');
    if (card === 'gpu-index') {
      const search = page.locator('[data-command-input]');
      const rows = page.locator('[data-command-results] [role="option"]');
      assert.equal(await page.locator('.desk-command-menu__shortcut').count(), 0);
      assert.doesNotMatch(await page.locator('.desk-command-menu__footer').textContent(), /Resource index/);
      await search.fill('prices');
      await page.waitForFunction(() => document.querySelector('[data-command-results] [role="option"] strong')?.textContent === 'Open Latest prices');
      assert.equal(await rows.first().getAttribute('aria-selected'), 'true', 'new query selects its most relevant match');
      assert.equal(await page.locator('[data-command-results] .desk-command-menu__group').count(), 0, 'search does not repeat group headings');
      assert.equal(await rows.evaluateAll(nodes => nodes.every(node => node.tabIndex === -1)), true);
      await search.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.matches('[data-command-content] [data-command-close]')), true);
      await page.keyboard.press('Shift+Tab');
      assert.equal(await search.evaluate(node => node === document.activeElement), true);
      await rows.first().focus();
      assert.equal(await search.evaluate(node => node === document.activeElement), true, 'option focus returns to search');
      const active = await search.getAttribute('aria-activedescendant');
      await search.press('ArrowDown');
      assert.notEqual(await search.getAttribute('aria-activedescendant'), active);
      await search.fill('Copy view link');
      await page.getByRole('option', { name: 'Copy view link', exact: true }).waitFor();
      assert.equal(await rows.first().getAttribute('aria-selected'), 'true');
      assert.equal(await rows.first().locator('small, .desk-command-menu__meta').count(), 0, 'simple actions have no path or repeated hint');
    }
    await page.locator('[data-command-input]').fill('Resume draft');
    await page.getByRole('option', { name: /Resume draft/ }).click();
    await page.waitForFunction(() => document.documentElement.dataset.deskView === 'craft' && document.querySelector('[data-gpu-benchmark-card]').dataset.craftEmpty === 'false');
    await page.waitForURL(url => url.searchParams.get('view') === 'craft' && url.searchParams.get('range') === range);
    assert.equal(new URL(page.url()).searchParams.get('card'), card);
    assert.equal(new URL(page.url()).searchParams.get('range'), range, 'the authored range returns, not the later Monitor range');
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), draftKey), null, 'resuming consumes the stored draft');
  }
});

test('Data controls and source disclosures keep the chart in place', async t => {
  const page = await pageFor(t);
  await open(page, '/?card=equities&symbol=CRWV&view=craft&scale=index&layers=CRWV,H100,H200&range=90d&style=bars');
  const toggle = page.locator('[data-card-compare-toggle]');
  const panel = page.locator('[data-card-compare-panel]');
  const chart = page.locator('[data-gpu-chart]');
  for (const [width, height] of [[1440, 1000], [390, 844]]) {
    await page.setViewportSize({ width, height });
    const closed = await chart.boundingBox();
    await toggle.click();
    const controls = await panel.boundingBox();
    const expanded = await chart.boundingBox();
    assert.ok(controls.y + controls.height <= expanded.y + 1, `Data controls do not cover the chart at ${width}px`);
    assert.ok(Math.abs(expanded.height - closed.height) <= 1, `opening Data keeps the chart height at ${width}px`);
    await toggle.click();
    assert.ok(Math.abs((await chart.boundingBox()).height - closed.height) <= 1, `closing Data restores the chart height at ${width}px`);
  }

  const geometry = () => page.evaluate(() => ({
    scrolls: document.documentElement.scrollHeight > innerHeight,
    overflows: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    boxes: ['.desk-stage', '.gpu-index-detail', '.desk-top-controls'].map(selector => {
      const { x, y, width } = document.querySelector(selector).getBoundingClientRect();
      return { x, y: y + (selector === '.desk-top-controls' ? 0 : scrollY), width };
    }),
  }));
  for (const [card, width] of [['gpu-index', 1440], ['equities', 1440], ['gpu-index', 320]]) {
    await page.setViewportSize({ width, height: 850 });
    await open(page, `/?card=${card}&view=monitor`);
    // Exercise classic scrollbars even on hosts that use overlay scrollbars.
    await page.addStyleTag({ content: 'html::-webkit-scrollbar { width: 16px; }' });
    const disclosure = page.locator('[data-monitor-data-toggle]');
    const before = await geometry();
    assert.equal(before.scrolls, false, 'collapsed source fits without scrolling');
    await disclosure.focus();
    await page.keyboard.press('Enter');
    const expanded = await geometry();
    assert.equal(expanded.scrolls, true, 'expanded source introduces vertical scrolling');
    assert.deepEqual(expanded.boxes, before.boxes, `${card} chart and navigation stay fixed on open at ${width}px`);
    assert.equal(expanded.overflows, false, 'no horizontal overflow with a scrollbar');
    await page.keyboard.press('Escape');
    const closed = await geometry();
    assert.deepEqual(closed.boxes, before.boxes, `${card} chart and navigation stay fixed on close at ${width}px`);
    assert.equal(closed.overflows, false);
    assert.equal(await disclosure.getAttribute('aria-expanded'), 'false');
    assert.equal(await disclosure.evaluate(node => node === document.activeElement), true);
  }
});

test('range switching keeps the same view and document', async t => {
  const page = await pageFor(t);
  for (const [card, ranges] of [['gpu-index', ['7d', 'all', '1d']], ['sandbox-cost', ['now', '7d', 'all']], ['forward-prices', ['now', 'all']]]) {
    await open(page, `/?card=${card}&view=monitor`);
    await page.evaluate(() => { window.__smokeDocument = document.documentElement; });
    const selected = await page.locator('[data-catalog-entry-key][aria-selected="true"]').getAttribute('data-catalog-entry-key');
    for (const range of ranges) {
      await page.locator(`[data-gpu-range="${range}"]`).click();
      await page.waitForFunction(range => document.querySelector(`[data-gpu-range="${range}"]`)?.getAttribute('aria-pressed') === 'true', range);
      assert.equal(new URL(page.url()).searchParams.get('card'), card);
      assert.equal(await page.evaluate(() => window.__smokeDocument === document.documentElement), true);
      assert.equal(await page.locator('[data-catalog-entry-key][aria-selected="true"]').getAttribute('data-catalog-entry-key'), selected);
      if (card === 'forward-prices') {
        assert.equal(await page.locator('[data-gpu-chart-svg] [data-forward-delivery]').count(), 5);
        assert.match(await page.locator('[data-gpu-chart-svg]').textContent(), /Apr 2027/);
        const target = await page.locator('[data-gpu-chart-svg] path[data-forward-series]').first().evaluate(path => {
          const p = path.getPointAtLength(path.getTotalLength() * .55);
          const screen = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM());
          return { x: screen.x, y: screen.y };
        });
        await page.mouse.move(target.x, target.y);
        const cursor = page.locator('[data-gpu-chart-svg] [data-forward-cursor]');
        assert.equal(await cursor.getAttribute('visibility'), null);
        assert.equal(await cursor.locator('line').count(), 0);
        const position = await cursor.locator('circle').evaluate(circle => {
          const p = new DOMPoint(+circle.getAttribute('cx'), +circle.getAttribute('cy')).matrixTransform(circle.getScreenCTM());
          return {x:p.x, y:p.y};
        });
        assert.ok(Math.hypot(position.x-target.x, position.y-target.y) < 1, 'marker follows rendered path');
        await page.mouse.move(0, 0);
        assert.equal(await cursor.getAttribute('visibility'), 'hidden');
        if (range === 'all') {
          assert.match(await page.locator('[data-gpu-chart-svg]').textContent(), /Quoted/);
          const band = await page.locator('[data-gpu-chart-svg]').evaluate(svg => {
            const p = new DOMPoint(svg.viewBox.baseVal.width * .5, svg.viewBox.baseVal.height * .65);
            const region = [...svg.querySelectorAll('[data-forward-region]')].reverse().find(node => node.isPointInFill(p));
            const screen = p.matrixTransform(svg.getScreenCTM());
            return { x: screen.x, y: screen.y, key: region.dataset.forwardRegion, fill: region.getAttribute('fill') };
          });
          const region = page.locator(`[data-gpu-chart-svg] [data-forward-region="${band.key}"]`);
          await page.mouse.move(band.x, band.y);
          assert.match(await page.locator('[data-gpu-chart-svg] [data-forward-readout]').textContent(), /Quoted .*→.*202[67]/);
          assert.notEqual(await region.evaluate(node => node.style.fill), band.fill);
          await page.mouse.move(0, 0);
          assert.equal(await region.evaluate(node => node.style.fill), band.fill);
        }
      }
    }
  }
});

test('a shared desk preserves personal views and stable mode navigation', async t => {
  const page = await pageFor(t);
  await open(page, '/');
  const before = await page.evaluate(() => [localStorage.getItem('desk.catalog.v2'), localStorage.getItem('desk.catalog-collections.v1')]);
  const navigationLayout = () => page.evaluate(() => {
    const toolbar = document.querySelector('.desk-top-controls').getBoundingClientRect();
    const desk = document.querySelector('.desk-search').getBoundingClientRect();
    const modes = document.querySelector('.desk-view-actions__group').getBoundingClientRect();
    const buttons = [...document.querySelectorAll('[data-desk-mode]')].map(node => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    });
    return {
      top: toolbar.top, bottom: toolbar.bottom, center: toolbar.x + toolbar.width / 2, buttons,
      deskCenterY: desk.y + desk.height / 2, modesCenterY: modes.y + modes.height / 2,
      stageTop: document.querySelector('.desk-stage').getBoundingClientRect().top + window.scrollY,
    };
  });
  const referenceByWidth = new Map();
  for (const name of ['Shared desk', 'Worldwide compute and energy market observations']) {
    const desk = createSharedDesk({ name, palette: 'sage', theme: 'dark', entries: [
      { cardId: 'gpu-index', name: 'H200', state: { gpu: 'H200', range: '7d' } },
      { cardId: 'sandbox-cost', name: 'Sandbox', state: { range: '7d' } },
    ] });
    for (const width of [320, 390, 641, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await open(page, `/?view=gallery#desk=${encodeSharedDesk(desk)}`);
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.locator('[data-shared-desk-name]').innerText(), `${name} Shared`);
      assert.equal(await page.locator('[data-catalog-switcher-name]').textContent(), name);
      assert.equal(await page.locator('[data-card-gallery-grid] .desk-gallery-card:visible').count(), 2);
      if (!referenceByWidth.has(width)) referenceByWidth.set(width, await navigationLayout());
      const reference = referenceByWidth.get(width);
      const assertStableNavigation = async mode => {
        const current = await navigationLayout();
        const label = `${mode}, ${name}, ${width}px`;
        assert.ok(Math.abs(current.top - reference.top) <= 1, `toolbar top stays fixed: ${label}`);
        assert.ok(Math.abs(current.center - reference.center) <= 1, `toolbar center stays fixed: ${label}`);
        if (width > 960) assert.ok(Math.abs(current.deskCenterY - current.modesCenterY) <= 1, `Desk is vertically centered with navigation: ${label}`);
        assert.ok(current.bottom <= current.stageTop + 1, `toolbar clears workspace content: ${label}`);
        for (const [index, box] of current.buttons.entries()) {
          for (const key of ['x', 'y', 'width', 'height']) {
            assert.ok(Math.abs(box[key] - reference.buttons[index][key]) <= 1, `mode button ${index} ${key} stays fixed: ${label}`);
          }
          assert.ok(box.x >= 0 && box.x + box.width <= width, `mode button ${index} fits viewport: ${label}`);
        }
      };
      for (const mode of ['catalog', 'monitor', 'craft']) {
        if (mode !== 'catalog') await page.locator(`[data-desk-mode="${mode}"]`).click();
        await page.waitForFunction(mode => document.documentElement.dataset.deskView === mode, mode);
        if (mode === 'craft') await page.locator('[data-craft-type-list]').waitFor({ state: 'visible' });
        await assertStableNavigation(`${mode}, collapsed`);
        await page.locator('[data-command-open]').click();
        if (await page.locator('[data-desk-login]').isVisible()) await page.locator('[data-desk-login]').click();
        await page.locator('[data-command-input]').fill('Show display controls');
        await page.getByRole('option', { name: /^Show display controls/ }).click();
        await page.waitForFunction(() => document.documentElement.dataset.displayToolbar === 'expanded');
        await assertStableNavigation(`${mode}, expanded`);
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => document.documentElement.dataset.displayToolbar === 'collapsed');
        await assertStableNavigation(`${mode}, collapsed again`);
      }
    }
  }
  assert.deepEqual(await page.evaluate(() => [localStorage.getItem('desk.catalog.v2'), localStorage.getItem('desk.catalog-collections.v1')]), before);
});

test('mixed comparison styles keep data, inspection and saved rendering intact', async t => {
  const page = await pageFor(t);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const state = { symbol: 'CRWV', layers: ['CRWV', 'H100', 'H200'], scale: 'index', range: '90d', style: 'bars' };
  await open(page, '/?card=equities&view=craft&symbol=CRWV&layers=CRWV,H100,H200&scale=index&range=90d');
  const chart = page.locator('[data-gpu-chart-svg]');
  const labels = await chart.locator('.gpu-benchmark__line-label').allTextContents();
  await page.locator('[data-card-compare-toggle]').click();
  const barsStyle = page.locator('[data-card-option="style"][data-card-option-value="bars"]');
  await barsStyle.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => new URL(location.href).searchParams.get('style') === 'bars');
  await page.waitForFunction(() => !document.querySelector('[data-gpu-chart-svg]').getAnimations({ subtree: true }).some(animation => animation.id.startsWith('desk-chart-')));
  assert.equal(await chart.locator('[data-comparison-bars]').count(), 2);
  assert.equal(await chart.locator('.gpu-benchmark__line').count(), 1);
  assert.deepEqual(await chart.locator('.gpu-benchmark__line-label').allTextContents(), labels);
  const slider = chart.locator('[role="slider"]');
  await slider.focus();
  await slider.press('End');
  assert.match(await slider.getAttribute('aria-valuetext'), /CRWV .*H100 .*H200/s);
  assert.equal(await chart.locator('[data-bar-focus]:not([visibility="hidden"])').count(), 2);
  await page.locator('[data-desk-mode="monitor"]').click();
  assert.equal(await chart.locator('[data-comparison-label-backing]').count(), 2);
  await chart.scrollIntoViewIfNeeded();
  const tooltip = page.locator('[data-gpu-tooltip]');
  // Check actual column centers on both sides of a weekend, not just the
  // synthetic target centers: those date cells have asymmetric widths.
  for (const weekday of [1, 5]) for (const layer of ['H100', 'H200']) {
    const target = await chart.locator(`[data-bar-hit="${layer}"]`).evaluateAll((nodes, weekday) => {
      const node = nodes.find(node => {
        const bar = node.__data__;
        return bar.index > 30 && bar.height > 8 && new Date(bar.date).getUTCDay() === weekday;
      });
      const bar = node.__data__;
      const p = new DOMPoint(bar.x + bar.width / 2, bar.y + bar.height / 2).matrixTransform(node.getScreenCTM());
      const date = new Date(bar.date);
      return { x: p.x, y: p.y, index: bar.index, value: bar.value - 100,
        date: `${String(date.getUTCDate()).padStart(2, '0')} ${date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${date.getUTCFullYear()}` };
    }, weekday);
    await page.mouse.move(target.x, target.y);
    assert.equal(await tooltip.locator('[data-active="true"]').getAttribute('data-layer'), layer, 'visible bar selects its GPU');
    assert.equal(await tooltip.locator('time').textContent(), target.date);
    assert.equal(Number((await tooltip.locator(`[data-layer="${layer}"] strong`).textContent()).replace('−', '-').replace('%', '')), Number(target.value.toFixed(1)));
    assert.equal(Number(await slider.getAttribute('aria-valuenow')), target.index);
    const box = await tooltip.boundingBox();
    assert.ok(Math.abs(box.y + box.height / 2 - target.y) < box.height / 2, 'tooltip stays near the bar region');
    const stock = await chart.locator('.gpu-benchmark__point').evaluate(node => {
      const p = new DOMPoint(+node.getAttribute('cx'), +node.getAttribute('cy')).matrixTransform(node.getScreenCTM());
      return { x: p.x, y: p.y };
    });
    await page.mouse.move(stock.x, stock.y);
    assert.equal(await tooltip.locator('[data-active="true"]').count(), 0, 'stock inspection clears the active GPU row');
  }
  await page.locator('[data-gpu-range="7d"]').click();
  assert.equal(new URL(page.url()).searchParams.get('style'), 'bars');
  assert.doesNotMatch(await chart.innerHTML(), /NaN|Infinity/);
  const desk = createSharedDesk({ name: 'Comparison', entries: [{ cardId: 'equities', name: 'CoreWeave + compute', state }] });
  await open(page, `/?view=gallery#desk=${encodeSharedDesk(desk)}`);
  assert.equal(await page.locator('[data-card-gallery-grid] [data-comparison-bars]').count(), 2);
  assert.equal(await page.locator('[data-card-gallery-grid] [data-comparison-label-backing]').count(), 0);
  await open(page, '/?card=equities&view=craft&symbol=NVDA&scale=index&style=bars');
  await page.locator('[data-card-compare-toggle]').click();
  assert.equal(await page.locator('[data-card-option="style"]').first().isVisible(), false);
  assert.equal(await chart.locator('[data-comparison-bars]').count(), 0);
});
