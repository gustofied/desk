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

test('Craft drafts survive Monitor, the type picker and reloads', async t => {
  const page = await pageFor(t);
  for (const [card, composition, range] of [
    ['gpu-index', 'gpu=H200&layers=H200,H100&scale=price', 'all'],
    ['equities', 'symbol=CRWV&layers=CRWV,H100,H200&scale=index&style=bars', '90d'],
  ]) {
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
    await page.locator('[data-command-open]').click();
    await page.locator('[data-desk-login]').click();
    await page.locator('[data-command-input]').fill('Resume draft');
    await page.getByRole('option', { name: /Resume draft/ }).click();
    await page.waitForFunction(() => document.documentElement.dataset.deskView === 'craft' && document.querySelector('[data-gpu-benchmark-card]').dataset.craftEmpty === 'false');
    assert.equal(new URL(page.url()).searchParams.get('card'), card);
    assert.equal(new URL(page.url()).searchParams.get('range'), range, 'the authored range returns, not the later Monitor range');
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), draftKey), null, 'resuming consumes the stored draft');
  }
});

test('Craft Data controls keep their own space above the chart', async t => {
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

test('a shared desk opens without importing over personal views', async t => {
  const page = await pageFor(t);
  const desk = createSharedDesk({ name: 'Shared desk', palette: 'sage', theme: 'dark', entries: [
    { cardId: 'gpu-index', name: 'H200', state: { gpu: 'H200', range: '7d' } },
    { cardId: 'sandbox-cost', name: 'Sandbox', state: { range: '7d' } },
  ] });
  await open(page, '/');
  const before = await page.evaluate(() => [localStorage.getItem('desk.catalog.v2'), localStorage.getItem('desk.catalog-collections.v1')]);
  await open(page, `/?view=gallery#desk=${encodeSharedDesk(desk)}`);
  assert.equal(await page.locator('[data-shared-desk-name]').innerText(), 'Shared desk Shared');
  assert.equal(await page.locator('[data-card-gallery-grid] .desk-gallery-card:visible').count(), 2);
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
