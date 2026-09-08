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
          const band = await page.locator('[data-gpu-chart-svg]').evaluate(svg => {
            const p = new DOMPoint(svg.viewBox.baseVal.width * .5, svg.viewBox.baseVal.height * .65);
            const region = [...svg.querySelectorAll('[data-forward-region]')].reverse().find(node => node.isPointInFill(p));
            const screen = p.matrixTransform(svg.getScreenCTM());
            return { x: screen.x, y: screen.y, key: region.dataset.forwardRegion, fill: region.getAttribute('fill') };
          });
          const region = page.locator(`[data-gpu-chart-svg] [data-forward-region="${band.key}"]`);
          await page.mouse.move(band.x, band.y);
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
