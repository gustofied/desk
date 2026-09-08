import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { CARD_REGISTRY, normalizeCardState } from '../src/card-registry.js';
import { loadSavedCatalog, saveCatalogItem, deleteCatalogItem } from '../src/saved-catalog.js';
import { createMarketWatchlist } from '../src/market-watchlist.js';
import { createSharedDesk, encodeSharedDesk, decodeSharedDesk } from '../src/shared-desk.js';
import { normalizePricePoints, alignIndexedPriceSeries } from '../src/price-series.js';
import { createForwardPricesModel } from '../src/forward-prices-model.js';
import { forwardContours, nearestContour } from '../src/forward-contours.js';
import { renderCatalogShareArtifact } from '../scripts/catalog-share-artifacts.mjs';
import sharp from 'sharp';

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}

test('every chart has bundled data and stable Light/Linen defaults', () => {
  for (const card of CARD_REGISTRY) {
    const state = normalizeCardState(card.id);
    assert.equal(state.theme, 'light', card.id);
    assert.equal(state.palette, 'linen', card.id);
    assert.deepEqual(normalizeCardState(card.id, state), state);
    assert.equal(normalizeCardState(card.id, { theme: 'dark' }).theme, 'dark');
    const source = CARD_REGISTRY.find(candidate => candidate.id === card.sourceCardId) ?? card;
    assert.ok(Object.keys(JSON.parse(readFileSync(new URL('../' + source.dataFile, import.meta.url)))).length, card.id);
  }
});

test('compute comparisons retain their layers and use percentage change', () => {
  const state = normalizeCardState('equities', { symbol: 'NVDA', layers: ['NVDA', 'H100', 'H200'], scale: 'price', range: '90d' });
  assert.deepEqual(state.layers, ['NVDA', 'H100', 'H200']);
  assert.equal(state.scale, 'index');
  assert.equal(state.range, '90d');
  assert.equal(normalizeCardState('sandbox-cost', { range: '7d' }).range, '7d');
  assert.equal(normalizeCardState('sandbox-cost', { range: 'now' }).range, 'now');
});

test('saved views persist, update in place and delete', t => {
  const previous = globalThis.window;
  globalThis.window = { localStorage: storage() };
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  const saved = saveCatalogItem({ cardId: 'gpu-index', name: 'My H200', state: { gpu: 'H200', range: '7d' } });
  assert.equal(loadSavedCatalog('gpu-index')[0].id, saved.id);
  saveCatalogItem({ cardId: 'gpu-index', itemId: saved.id, name: 'Renamed', state: { gpu: 'H200', range: 'all' } });
  const items = loadSavedCatalog('gpu-index');
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'Renamed');
  assert.equal(items[0].state.range, 'all');
  assert.equal(deleteCatalogItem({ cardId: 'gpu-index', itemId: saved.id }), true);
  assert.deepEqual(loadSavedCatalog('gpu-index'), []);
});

test('pins persist without duplicates and can be removed', () => {
  const local = storage();
  const list = createMarketWatchlist({ storage: local });
  const input = { cardId: 'gpu-index', state: { gpu: 'B200', range: 'all' }, label: 'B200 history' };
  const pinned = list.pin(input);
  assert.equal(list.pin(input).id, pinned.id);
  const reloaded = createMarketWatchlist({ storage: local });
  assert.equal(reloaded.list().filter(item => item.id === pinned.id).length, 1);
  reloaded.remove(pinned.id);
  assert.ok(!createMarketWatchlist({ storage: local }).list().some(item => item.id === pinned.id));
});

test('shared desks preserve chart order, names, settings and appearance', () => {
  const entries = CARD_REGISTRY.map(card => ({ cardId: card.id, name: card.title, state: normalizeCardState(card.id) }));
  const desk = createSharedDesk({ name: 'My desk', entries, palette: 'sage', theme: 'dark' }, { includePrivate: true });
  assert.deepEqual(decodeSharedDesk(encodeSharedDesk(desk)), desk);
  assert.deepEqual(desk.entries.map(entry => entry.cardId), entries.map(entry => entry.cardId));
});

test('sharing excludes private deal views by default and rejects broken links', () => {
  const desk = createSharedDesk({ name: 'Public', entries: ['gpu-index', 'quote-view', 'deal-view'].map(cardId => ({ cardId, name: cardId, state: {} })) });
  assert.deepEqual(desk.entries.map(entry => entry.cardId), ['gpu-index']);
  assert.throws(() => decodeSharedDesk('not-a-desk'));
});

test('comparison lines start on the same date and baseline', () => {
  const first = { rows: normalizePricePoints([[100, 10], [200, 20], [300, 40]], 'A') };
  const second = { rows: normalizePricePoints([[200, 100], [300, 150]], 'B') };
  const aligned = alignIndexedPriceSeries([first, second]);
  assert.deepEqual(aligned.map(series => series.rows.map(row => [+row.date, row.plotValue])), [
    [[200000, 100], [300000, 200]], [[200000, 100], [300000, 150]],
  ]);
  assert.equal(first.rows.length, 3);
});

test('the homepage has no default social preview image', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/i);
});

test('forward curves and contours share valid quotes and render both modes', async () => {
  const islands = forwardContours([[0,0,0,0,0], [0,2,0,2,0], [0,0,0,0,0]], [1], p => p, [0,0,5,3])[0];
  assert.equal(islands.paths.length, 2, 'separate peaks retain separate closed contours');
  for (const path of islands.paths) {
    assert.deepEqual(path.points[0], path.points.at(-1));
    for (const point of path.points) assert.ok(islands.coordinates.flat(2).includes(point));
  }
  assert.deepEqual(nearestContour([{ key: 1, points: [[0,0],[10,0]] }], { x: 5, y: 2 }), { key: 1, distance: 2, position: { x: 5, y: 0 } });
  const payload = JSON.parse(readFileSync(new URL('../data/forward-prices.json', import.meta.url)));
  for (const gpu of Object.keys(payload.surfaces)) {
    const model = createForwardPricesModel(payload, { gpu });
    assert.equal(model.structure, 'Contango');
    assert.ok(model.deliveries[0] > model.asOf);
    for (const range of ['now', 'all']) {
      const artifact = renderCatalogShareArtifact('forward-prices', { gpu, range }, new Map([['forward-prices', payload]]));
      assert.match(artifact.svg, /data-forward-line/);
      if (range === 'now') assert.equal((artifact.svg.match(/data-forward-date=/g) || []).length, 3);
      else assert.match(artifact.svg, /data-forward-series=/);
      assert.doesNotMatch(artifact.svg, /NaN|Infinity/);
      assert.ok((await sharp(Buffer.from(artifact.svg)).png().toBuffer()).length > 0);
    }
  }
  assert.throws(() => createForwardPricesModel({ ...payload, surfaces: { H100: [[null]] } }));
});
