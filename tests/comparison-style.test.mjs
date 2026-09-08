import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { normalizeCardState, publishedCardSharePath, publishedCardPreviewPath } from '../src/card-registry.js';
import { catalogShareStates, supportsCatalogShareState } from '../src/catalog-share-previews.js';
import { loadSavedCatalog, saveCatalogItem } from '../src/saved-catalog.js';
import { createSharedDesk, encodeSharedDesk, decodeSharedDesk } from '../src/shared-desk.js';
import { renderCatalogShareArtifact } from '../scripts/catalog-share-artifacts.mjs';
import { comparisonBarOpacity, comparisonBarSeries } from '../src/comparison-bars.js';
import { MARKET_WATCHLIST_STORAGE_KEY, createMarketWatchlist } from '../src/market-watchlist.js';
import { CATALOG_COLLECTIONS_STORAGE_KEY, saveSharedDeskCollection, loadCatalogCollections } from '../src/catalog-collections.js';

const comparison = { symbol: 'CRWV', layers: ['CRWV', 'H100', 'H200'], scale: 'index', range: '90d', palette: 'sage', theme: 'dark' };
const rawToken = value => Buffer.from(JSON.stringify(value)).toString('base64url');

test('comparison style preserves existing line URLs and only publishes mixed bars variants', () => {
  const base = '/cards/equities/published/crwv/index/crwv~h100~h200/90d/sage/dark/';
  assert.equal(publishedCardSharePath('equities', comparison), base);
  assert.equal(publishedCardSharePath('equities', { ...comparison, style: 'lines' }), base);
  assert.equal(publishedCardSharePath('equities', { ...comparison, style: 'bars' }), `${base}style-bars/`);
  assert.ok(publishedCardPreviewPath('equities', comparison, 'test').endsWith('/sage-dark.png'));
  assert.ok(publishedCardPreviewPath('equities', { ...comparison, style: 'bars' }, 'test').endsWith('/sage-dark--style-bars.png'));
  assert.ok(supportsCatalogShareState('equities', { ...comparison, style: 'bars' }));
  const bars = catalogShareStates('equities').filter(state => state.style === 'bars');
  assert.ok(bars.length > 0);
  assert.ok(bars.every(state => state.scale === 'index' && state.layers.some(id => id === 'H100' || id === 'H200')));
  assert.equal(normalizeCardState('equities', { symbol: 'CRWV', layers: ['CRWV', 'NBIS'], scale: 'index', style: 'bars' }).style, 'lines');
});

test('bars save and share without changing older line-only desk links', t => {
  const previous = globalThis.window;
  const values = new Map();
  globalThis.window = { localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) } };
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  const state = normalizeCardState('equities', { ...comparison, style: 'bars' });
  const saved = saveCatalogItem({ cardId: 'equities', name: 'CoreWeave + compute', state });
  assert.equal(loadSavedCatalog('equities').find(item => item.id === saved.id).state.style, 'bars');
  const desk = createSharedDesk({ name: 'Compare', entries: [{ cardId: 'equities', name: saved.name, state: saved.state }] });
  assert.deepEqual(decodeSharedDesk(encodeSharedDesk(desk)), desk);
  const legacy = structuredClone(desk);
  delete legacy.entries[0].state.style;
  assert.equal(decodeSharedDesk(rawToken(legacy)).entries[0].state.style, 'lines');
  globalThis.window.localStorage.setItem(MARKET_WATCHLIST_STORAGE_KEY, JSON.stringify({ version: 1, items: [
    { id: 'legacy-equities', cardId: 'equities', label: 'Old comparison', state: legacy.entries[0].state },
  ] }));
  const pins = createMarketWatchlist({ storage: globalThis.window.localStorage });
  assert.equal(pins.list()[0].id, 'legacy-equities');
  assert.equal(pins.list()[0].state.style, 'lines');
  saveSharedDeskCollection(desk);
  const collections = JSON.parse(globalThis.window.localStorage.getItem(CATALOG_COLLECTIONS_STORAGE_KEY));
  for (const collection of collections.collections) {
    for (const view of collection.views || []) delete view.state.style;
  }
  globalThis.window.localStorage.setItem(CATALOG_COLLECTIONS_STORAGE_KEY, JSON.stringify(collections));
  const imported = loadCatalogCollections().collections.find(collection => collection.views?.length);
  assert.equal(imported.views[0].state.style, 'lines');
  legacy.entries[0].state.style = 'invalid';
  assert.throws(() => decodeSharedDesk(rawToken(legacy)));
  legacy.entries[0].state.style = 'bars';
  legacy.entries[0].state.layers = ['CRWV'];
  assert.throws(() => decodeSharedDesk(rawToken(legacy)), /canonical/);
});

test('share images render stock lines and GPU bars against the same starting date', () => {
  const payloads = new Map([
    ['equities', JSON.parse(readFileSync(new URL('../data/equities.json', import.meta.url)))],
    ['gpu-index', JSON.parse(readFileSync(new URL('../data/gpu-price-index.json', import.meta.url)))],
  ]);
  const artifact = renderCatalogShareArtifact('equities', { ...comparison, style: 'bars' }, payloads);
  const paths = [...artifact.svg.matchAll(/<path\b[^>]*data-share-series="([^"]+)"[^>]*>/g)];
  assert.equal(paths.length, 3);
  for (const [path, id] of paths) {
    assert.match(path, /data-first-value="100"/);
    if (id === 'CRWV') {
      assert.match(path, /fill="none"/);
      assert.doesNotMatch(path, /data-comparison-bars/);
    } else {
      assert.match(path, new RegExp(`data-comparison-bars="${id}"`));
      assert.doesNotMatch(path, /fill="none"|stroke=/);
      assert.match(path, new RegExp(`fill-opacity="${comparisonBarOpacity({ layer: { id } }, { theme: comparison.theme })}"`));
    }
  }
  assert.equal(new Set(paths.map(([path]) => path.match(/data-start="([^"]+)"/)[1])).size, 1);
  assert.equal(new URL(artifact.destination).searchParams.get('style'), 'bars');
  assert.match(artifact.description, /same starting date/);
  assert.doesNotMatch(artifact.svg, /NaN|Infinity|50.day/i);
  const lines = renderCatalogShareArtifact('equities', comparison, payloads);
  assert.doesNotMatch(lines.svg, /data-comparison-bars/);
  assert.doesNotMatch(lines.svg, /data-comparison-label/);
  assert.equal([...artifact.svg.matchAll(/data-comparison-label=/g)].length, 3);
  const seriesValues = svg => [...svg.matchAll(/<path\b[^>]*data-share-series="([^"]+)"[^>]*>/g)]
    .map(([path, id]) => [id, [...path.matchAll(/data-(?:first-value|last-value|start|end|observation-count)="[^"]+"/g)].map(([value]) => value)])
    .sort(([a], [b]) => a.localeCompare(b));
  assert.deepEqual(seriesValues(artifact.svg), seriesValues(lines.svg));
});

test('comparison bars use the zero baseline without spanning missing observations', () => {
  const rows = [
    { date: 0, plotValue: 100 }, { date: 1, plotValue: 120 },
    { date: 2, plotValue: null }, { date: 4, plotValue: 80 },
  ];
  const series = [
    { layer: { id: 'CRWV' }, rows },
    { layer: { id: 'H100', sourceCardId: 'gpu-index' }, rows },
    { layer: { id: 'H200', sourceCardId: 'gpu-index' }, rows },
  ];
  const groups = comparisonBarSeries(series, { x: date => date * 100, y: value => 200 - value, maxX: 400 });
  assert.equal(groups.length, 2);
  for (const { candidate } of groups) {
    const isH100 = candidate.layer.id === 'H100';
    assert.equal(comparisonBarOpacity(candidate), isH100 ? 0.9 : 0.48);
    assert.equal(comparisonBarOpacity(candidate, { theme: 'dark' }), isH100 ? 0.84 : 0.42);
    const solo = comparisonBarSeries([candidate], { x: date => date * 100, y: value => 200 - value, maxX: 400 })[0];
    assert.equal(comparisonBarOpacity(solo.candidate), comparisonBarOpacity(candidate));
    for (const theme of ['light', 'dark']) {
      const resting = comparisonBarOpacity(candidate, { theme });
      const active = comparisonBarOpacity(candidate, { theme, active: true });
      assert.ok(active > resting && active <= 1);
      assert.ok(comparisonBarOpacity(candidate, { theme, label: true }) >= resting);
    }
  }
  for (const { path, bars } of groups) {
    assert.deepEqual(bars.map(bar => bar.date), [0, 1, 4]);
    assert.deepEqual(bars.map(bar => [bar.y, bar.height]), [[100, 0], [80, 20], [100, 20]]);
    assert.ok(bars.every(bar => Object.values(bar).every(Number.isFinite) && bar.x >= 0 && bar.x + bar.width <= 400));
    assert.ok(bars[2].x - bars[1].x > bars[1].width * 2);
    assert.doesNotMatch(path, /NaN|Infinity/);
  }
  const dense = comparisonBarSeries(series, { x: date => 12 + date * 10, y: value => 200 - value, minX: 12, maxX: 52 });
  const cells = new Map([[0, [12, 17]], [1, [17, 37]], [4, [37, 52]]]);
  for (const { bars } of dense) for (const bar of bars) {
    const [left, right] = cells.get(bar.date);
    assert.ok(Number.isFinite(bar.x) && Number.isFinite(bar.width) && bar.width > 0);
    assert.ok(bar.x >= left && bar.x + bar.width <= right, 'edge groups stay inside their own observation cell');
  }
  for (let index = 0; index < dense[0].bars.length; index++) {
    assert.ok(dense[0].bars[index].x + dense[0].bars[index].width < dense[1].bars[index].x, 'grouped bars remain separate');
  }
});
