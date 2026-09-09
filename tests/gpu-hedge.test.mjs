import assert from 'node:assert/strict';
import test from 'node:test';
import { getCardDefinition, normalizeCardState } from '../src/card-registry.js';
import { CATALOG_COLLECTIONS_STORAGE_KEY, loadCatalogCollections, saveSharedDeskCollection } from '../src/catalog-collections.js';
import { SAVED_CATALOG_STORAGE_KEY, loadSavedCatalog, saveCatalogItem } from '../src/saved-catalog.js';
import { createSharedDesk, decodeSharedDesk, encodeSharedDesk } from '../src/shared-desk.js';
import { createGpuHedgeModel } from '../src/gpu-hedge-model.js';
import { renderGpuHedgeSvg } from '../src/gpu-hedge-presentation.js';
import { renderGpuCoverageSvg } from '../src/gpu-coverage-presentation.js';

function localStorageFor(t) {
  const previous = globalThis.window;
  const values = new Map();
  const localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
  globalThis.window = { localStorage };
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  return localStorage;
}

test('buyer hedge locks GPU cost at full coverage and preserves entry profit', () => {
  const model = createGpuHedgeModel({});
  assert.equal(model.side, 'buyer');
  assert.equal(model.headlineProfit, 250000);
  assert.equal(model.breakEven, 3);
  assert.deepEqual(model.domain, [1.8, 3.4]);
  assert.equal(model.profitAt(1.8).hedged, 250000);
  assert.equal(model.profitAt(3.4).hedged, 250000);
  assert.equal(model.profitAt(3).unhedged, 0);
  assert.equal(model.profitAt(3).hedgePnl, 250000);
  assert.ok(Math.abs(model.margin - 100 / 6) < 1e-12);
  for (const side of ['buyer', 'unknown']) {
    const explicit = createGpuHedgeModel({}, { side, gpu: 'B300', delivery: '2028-02' });
    assert.equal(explicit.side, 'buyer');
    assert.equal(explicit.gpu, 'B300');
    assert.equal(explicit.delivery, '2028-02');
    assert.deepEqual(explicit.domain, model.domain);
    assert.deepEqual(explicit.profitAt(3.4), model.profitAt(3.4));
  }
});

test('seller hedge locks receipts at full coverage without using fixed buyer revenue', () => {
  const state = { side: 'seller', hours: 1120000, rate: 4.4 };
  const model = createGpuHedgeModel({}, state);
  assert.equal(model.side, 'seller');
  assert.equal(model.headlineProfit, 4928000);
  assert.equal(model.margin, null);
  assert.equal(model.breakEven, null);
  assert.ok(model.domain[0] >= 3 && model.domain[0] < model.rate);
  assert.ok(model.domain[1] > model.rate && model.domain[1] <= 6);
  for (const [settlement, physical, hedge] of [[3.8, 4256000, 672000], [4.4, 4928000, 0], [5, 5600000, -672000]]) {
    const result = model.profitAt(settlement);
    assert.equal(result.unhedged, physical);
    assert.ok(Math.abs(result.hedgePnl - hedge) < 1e-8);
    assert.equal(result.hedged, 4928000);
    assert.equal(result.margin, null);
    const changedMetadata = createGpuHedgeModel({}, { ...state, revenue: 0, gpu: 'B300', delivery: '2028-02' });
    assert.equal(changedMetadata.gpu, 'B300');
    assert.equal(changedMetadata.delivery, '2028-02');
    assert.deepEqual(changedMetadata.profitAt(settlement), result);
  }
});

test('partial coverage, basis and operating costs flow through both profits', () => {
  const model = createGpuHedgeModel({}, { coverage: 60, basis: .2, costs: 100000 });
  const result = model.profitAt(3);
  assert.equal(result.unhedged, -200000);
  assert.equal(result.hedgePnl, 150000);
  assert.equal(result.hedged, -50000);
  assert.equal(model.headlineProfit, 50000);
  assert.ok(Math.abs(model.breakEven - 2.6) < 1e-12);
  assert.equal(createGpuHedgeModel({}, { coverage: 0 }).profitAt(3.4).hedged, -200000);
  assert.equal(createGpuHedgeModel({}, { gpu: 'B300', delivery: '2028-02' }).headlineProfit, 250000);
  const seller = createGpuHedgeModel({}, { side: 'seller', coverage: 60, basis: .2, costs: 100000 });
  assert.deepEqual(seller.profitAt(3), { unhedged: 1500000, hedgePnl: -150000, hedged: 1350000, margin: null });
  assert.equal(seller.headlineProfit, 1250000);
  assert.equal(seller.breakEven, null);
  const sellerCosts = createGpuHedgeModel({}, { side: 'seller', basis: -.1, costs: 100000 });
  assert.ok(Math.abs(sellerCosts.breakEven - .3) < 1e-12);
  assert.deepEqual(sellerCosts.domain, createGpuHedgeModel({}, { side: 'seller' }).domain);
  assert.deepEqual(sellerCosts.profitAt(3), { unhedged: 1350000, hedgePnl: -250000, hedged: 1100000, margin: null });
  assert.ok(Math.abs(sellerCosts.profitAt(sellerCosts.breakEven).unhedged) < 1e-8);
  const uncoveredSeller = createGpuHedgeModel({}, { side: 'seller', coverage: 0 }).profitAt(3.4);
  assert.equal(uncoveredSeller.hedged, uncoveredSeller.unhedged);
  assert.ok(uncoveredSeller.hedgePnl === 0);
});

test('coverage exposes exact hedged and exposed hours without changing profit', () => {
  for (const [coverage, hedgedHours, exposedHours] of [[79.9, 399500, 100500], [0, 0, 500000], [100, 500000, 0]]) {
    const model = createGpuHedgeModel({}, { coverage });
    assert.equal(model.hedgedHours, hedgedHours);
    assert.equal(model.exposedHours, exposedHours);
    assert.equal(model.hedgedHours + model.exposedHours, model.hours);
    assert.equal(model.headlineProfit, 250000);
    assert.equal(model.profitAt(3).hedged, hedgedHours * .5);
    for (const gallery of [false, true]) {
      const svg = renderGpuCoverageSvg(model, { gallery });
      const fills = [...svg.matchAll(/data-gpu-coverage-fraction="([^"]+)"/g)].map(match => Number(match[1]));
      assert.equal(fills.length, 100);
      assert.ok(Math.abs(fills.reduce((sum, value) => sum + value, 0) - coverage) < 1e-10);
      assert.doesNotMatch(svg, /NaN|Infinity/);
      assert.match(svg, new RegExp(`${coverage}%`));
    }
  }
});

test('hedge presets, URLs, saved scenarios and shared desks retain side and fractional coverage', async t => {
  localStorageFor(t);
  globalThis.window.location = new URL('http://localhost:4173/');
  const { cardUrl } = await import('../src/card-presentation.js');
  const card = getCardDefinition('gpu-hedge');
  const preset = card.catalogPresets.find(preset => preset.id === 'coverage');
  assert.equal(preset.label, 'GPU coverage');
  assert.deepEqual(preset.state, { gpu: 'H100', scale: 'coverage', coverage: 60 });
  const buyer = normalizeCardState(card.id, card.catalogPresets.find(preset => preset.id === 'buyer').state);
  assert.equal(buyer.side, 'buyer');
  assert.equal(buyer.scale, 'price');
  assert.equal(buyer.coverage, 100);
  const sellerPreset = card.catalogPresets.find(preset => preset.id === 'seller');
  assert.equal(sellerPreset.label, 'Revenue hedge');
  const seller = normalizeCardState(card.id, sellerPreset.state);
  assert.deepEqual([seller.side, seller.hours, seller.rate, seller.coverage], ['seller', 1120000, 4.4, 100]);
  assert.equal(createGpuHedgeModel({}, seller).headlineProfit, 4928000);
  assert.ok(card.layers.every(layer => layer.views.includes('coverage')));
  for (const cardId of ['quote-view', 'deal-view']) {
    assert.ok(getCardDefinition(cardId).layers.every(layer => !layer.views.includes('coverage')));
  }
  for (const side of ['buyer', 'seller']) {
    for (const coverage of [79.9, 0, 100]) {
      const inputUrl = new URL(`http://localhost:4173/?card=gpu-hedge&side=${side}&gpu=H200&scale=coverage&coverage=${coverage}&delivery=2028-02&hours=1120000&rate=4.4&basis=-0.2&costs=25000`);
      const state = normalizeCardState(card.id, Object.fromEntries(inputUrl.searchParams));
      assert.deepEqual([state.side, state.scale, state.coverage], [side, 'coverage', coverage]);
      for (const scale of ['price', 'coverage']) {
        const link = cardUrl(card.id, 'monitor', { ...state, scale });
        assert.equal(link.searchParams.get('side'), side);
        assert.deepEqual(normalizeCardState(card.id, Object.fromEntries(link.searchParams)), { ...state, scale });
      }
      const saved = saveCatalogItem({ cardId: card.id, name: `${side} coverage ${coverage}`, state });
      assert.deepEqual(loadSavedCatalog(card.id).find(item => item.id === saved.id).state, state);
      const desk = createSharedDesk({ name: 'Coverage', entries: [{ cardId: card.id, name: saved.name, state }] });
      assert.deepEqual(decodeSharedDesk(encodeSharedDesk(desk)).entries[0].state, state);
    }
  }
  assert.equal(normalizeCardState(card.id, { side: 'invalid' }).side, 'buyer');
});

test('legacy hedge snapshots become buyers while invalid sides remain rejected', t => {
  const storage = localStorageFor(t);
  t.mock.method(console, 'error', () => {});
  const buyer = normalizeCardState('gpu-hedge', { gpu: 'B300', delivery: '2028-02', coverage: 79.9, basis: -.2, costs: 25000 });
  const saved = saveCatalogItem({ cardId: 'gpu-hedge', name: 'Legacy buyer', state: buyer });
  const documents = JSON.parse(storage.getItem(SAVED_CATALOG_STORAGE_KEY));
  const desk = createSharedDesk({ name: 'Hedge', entries: [{ cardId: 'gpu-hedge', name: saved.name, state: buyer }] });
  saveSharedDeskCollection(desk);
  const catalog = JSON.parse(storage.getItem(CATALOG_COLLECTIONS_STORAGE_KEY));
  const embedded = catalog.collections.find(collection => collection.views?.length);
  assert.deepEqual(embedded.views[0].state, buyer);

  for (const variant of ['legacy', 'invalid-side', 'null-side', 'missing-hours']) {
    const state = { ...buyer };
    if (variant === 'legacy') delete state.side;
    else if (variant === 'missing-hours') delete state.hours;
    else state.side = variant === 'null-side' ? null : 'invalid';
    const stored = structuredClone(documents);
    stored.items[0].visualization = state;
    storage.setItem(SAVED_CATALOG_STORAGE_KEY, JSON.stringify(stored));
    const shared = structuredClone(desk);
    shared.entries[0].state = state;
    const token = Buffer.from(JSON.stringify(shared)).toString('base64url');
    const imported = structuredClone(catalog);
    imported.collections.find(collection => collection.id === embedded.id).views[0].state = state;
    storage.setItem(CATALOG_COLLECTIONS_STORAGE_KEY, JSON.stringify(imported));
    const loadedCatalog = loadCatalogCollections({ readOnly: true });
    const loadedCollection = loadedCatalog.collections.find(collection => collection.id === embedded.id);
    if (variant === 'legacy') {
      assert.deepEqual(loadSavedCatalog('gpu-hedge')[0].state, buyer);
      assert.deepEqual(decodeSharedDesk(token).entries[0].state, buyer);
      assert.deepEqual(loadedCollection.views[0].state, buyer);
    } else {
      assert.deepEqual(loadSavedCatalog('gpu-hedge'), []);
      assert.throws(() => decodeSharedDesk(token));
      assert.equal(loadedCollection, undefined);
      assert.equal(loadedCatalog.unavailable, true);
      assert.equal(storage.getItem(CATALOG_COLLECTIONS_STORAGE_KEY), JSON.stringify(imported));
      if (variant !== 'missing-hours') {
        assert.throws(() => createSharedDesk(shared));
        assert.throws(() => saveCatalogItem({ cardId: 'gpu-hedge', name: 'Invalid side', state }));
      }
    }
  }
  const seller = { ...buyer, side: 'seller' };
  const sellerDesk = createSharedDesk({ name: 'Seller', entries: [{ cardId: 'gpu-hedge', name: 'Seller', state: seller }] });
  storage.setItem(CATALOG_COLLECTIONS_STORAGE_KEY, JSON.stringify(catalog));
  saveSharedDeskCollection(sellerDesk);
  assert.deepEqual(loadCatalogCollections({ readOnly: true }).collections.find(collection => collection.name === 'Seller').views[0].state, seller);
});

test('catalog migration adds hedge presets only to untouched previous starters', t => {
  const storage = localStorageFor(t);
  const fresh = loadCatalogCollections({ readOnly: true });
  assert.equal(fresh.version, 18);
  const hedge = fresh.collections.find(collection => collection.id === 'hedge');
  assert.deepEqual(hedge.keys.slice(0, 3), ['preset-gpu-hedge-buyer', 'preset-gpu-hedge-seller', 'preset-gpu-hedge-coverage']);
  assert.ok(!fresh.collections.find(collection => collection.id === 'overview').keys.includes('preset-gpu-hedge-coverage'));
  const migrate = (version, collections) => {
    storage.setItem(CATALOG_COLLECTIONS_STORAGE_KEY, JSON.stringify({ version, activeId: 'hedge', collections }));
    return loadCatalogCollections({ readOnly: true });
  };
  const withoutLease = state => state.collections.filter(collection => collection.id !== 'lease');
  const assertLeaseAdded = (state, expected = true) => {
    const leases = state.collections.filter(collection => collection.id === 'lease');
    assert.equal(leases.length, expected ? 1 : 0);
    if (!expected) return;
    assert.equal(leases[0].name, 'Lease');
    assert.deepEqual(leases[0].keys, ['preset-gpu-lease-residual']);
  };
  for (const version of [13, 14, 15, 16]) {
    const previous = { ...hedge, keys: hedge.keys.filter(key =>
      key !== 'preset-gpu-hedge-seller' &&
      (version >= 15 || key !== 'preset-gpu-hedge-coverage') &&
      (version >= 14 || key !== 'preset-gpu-hedge-buyer')) };
    const upgraded = migrate(version, [previous]);
    assert.equal(upgraded.version, 18);
    assert.equal(upgraded.collections.length, version < 16 ? 2 : 1);
    assert.deepEqual(withoutLease(upgraded)[0].keys, hedge.keys);
    assertLeaseAdded(upgraded, version < 16);
    for (const customized of [
      { ...previous, name: 'My hedge' },
      { ...previous, keys: [...previous.keys].reverse() },
      { ...previous, keys: previous.keys.slice(1) },
      { ...previous, palette: 'sage' },
    ]) {
      const upgradedCustom = migrate(version, [customized]);
      assert.deepEqual(withoutLease(upgradedCustom), [customized]);
      assertLeaseAdded(upgradedCustom, version < 16);
    }
    const emptied = migrate(version, []);
    assert.deepEqual(withoutLease(emptied), []);
    assertLeaseAdded(emptied, version < 16);
  }
  const removedCoverage = { ...hedge, keys: hedge.keys.filter(key => !['preset-gpu-hedge-coverage', 'preset-gpu-hedge-seller'].includes(key)) };
  const migratedRemoval = migrate(15, [removedCoverage]);
  assert.deepEqual(withoutLease(migratedRemoval), [removedCoverage]);
  assertLeaseAdded(migratedRemoval);
  assert.deepEqual(migrate(16, [removedCoverage]).collections, [removedCoverage]);
  const removedSeller = { ...hedge, keys: hedge.keys.filter(key => key !== 'preset-gpu-hedge-seller') };
  assert.deepEqual(migrate(17, [removedSeller]).collections, [removedSeller]);
});

test('Overview expands untouched starters while preserving authored catalogs and removals', t => {
  const storage = localStorageFor(t);
  const fresh = loadCatalogCollections({ readOnly: true });
  const overview = fresh.collections.find(collection => collection.id === 'overview');
  assert.deepEqual(overview.keys, [
    'preset-gpu-price-snapshot-prices', 'preset-gpu-index-h200',
    'preset-gpu-market-depth-h100-us', 'preset-power-basis-pjm-dominion',
    'preset-equities-nvidia-compute-bars', 'preset-forward-prices-h100-curve',
    'preset-forward-prices-h100', 'preset-gpu-hedge-buyer',
    'preset-gpu-hedge-seller', 'preset-gpu-lease-residual',
    'preset-deal-view-deal-041', 'preset-sandbox-cost-cost',
  ]);
  const previous = { ...overview, keys: [
    'preset-gpu-price-snapshot-prices', 'preset-gpu-index-h200',
    'preset-gpu-market-depth-h100-us', 'preset-power-basis-pjm-dominion',
    'preset-equities-coreweave-compute', 'preset-sandbox-cost-cost',
    'preset-forward-prices-h100-curve', 'preset-forward-prices-h100',
  ] };
  const migrate = (version, collections) => {
    storage.setItem(CATALOG_COLLECTIONS_STORAGE_KEY, JSON.stringify({ version, activeId: 'overview', collections }));
    return loadCatalogCollections({ readOnly: true });
  };
  const findOverview = state => state.collections.find(collection => collection.id === 'overview');
  for (const version of [10, 11, 12, 13, 14, 15, 16, 17]) {
    const upgraded = migrate(version, [previous]);
    assert.equal(upgraded.version, 18);
    assert.equal(upgraded.activeId, 'overview');
    assert.deepEqual(findOverview(upgraded).keys, overview.keys);
    assert.equal(findOverview(upgraded).createdAt, previous.createdAt);
    for (const customized of [
      { ...previous, name: 'My overview' },
      { ...previous, keys: [...previous.keys].reverse() },
      { ...previous, keys: previous.keys.slice(1) },
      { ...previous, keys: [...previous.keys, 'preset-gpu-index-b200'] },
      { ...previous, palette: 'sage' },
      { ...previous, theme: 'dark' },
      { ...previous, views: [] },
      { ...previous, views: [{ key: 'embedded-buyer', cardId: 'gpu-hedge', name: 'My buyer', state: normalizeCardState('gpu-hedge', {}) }] },
    ]) {
      assert.deepEqual(findOverview(migrate(version, [customized])), customized);
    }
    assert.equal(findOverview(migrate(version, [])), undefined);
  }
  const earlierKeys = previous.keys.map(key => key === 'preset-equities-coreweave-compute' ? 'preset-equities-nvda' : key);
  for (const version of [10, 11, 12]) {
    for (const keys of [earlierKeys, earlierKeys.filter(key => !key.startsWith('preset-forward-prices-'))]) {
      assert.deepEqual(findOverview(migrate(version, [{ ...previous, keys }])).keys, overview.keys);
    }
  }
  const originalKeys = [
    'preset-gpu-price-snapshot-prices', 'preset-gpu-index-h200', 'preset-gpu-index-b200',
    'preset-gpu-index-compute-market', 'preset-gpu-market-depth-h100-us',
    'preset-gpu-market-depth-h100-history', 'preset-power-basis-pjm-west',
    'preset-power-basis-pjm-west-spread', 'preset-deal-view-deal-041',
  ];
  assert.deepEqual(findOverview(migrate(9, [{ ...previous, keys: originalKeys }])).keys, overview.keys);
  const reordered = [fresh.collections.find(collection => collection.id === 'sandbox'), previous];
  assert.deepEqual(migrate(17, reordered).collections.map(collection => collection.id), ['sandbox', 'overview']);
  const stored = storage.getItem(CATALOG_COLLECTIONS_STORAGE_KEY);
  assert.equal(JSON.parse(stored).version, 17, 'read-only migration does not persist');
  const upgraded = loadCatalogCollections();
  assert.equal(JSON.parse(storage.getItem(CATALOG_COLLECTIONS_STORAGE_KEY)).version, 18);
  assert.deepEqual(loadCatalogCollections(), upgraded);
  const removed = { ...overview, keys: overview.keys.filter(key => key !== 'preset-gpu-hedge-seller') };
  assert.deepEqual(migrate(18, [removed]).collections, [removed]);
  assert.deepEqual(migrate(17, []).collections, []);
  assert.deepEqual(migrate(18, []).collections, []);
});

test('zero revenue, no hours and loss-making scenarios render finite geometry', () => {
  for (const state of [
    { revenue: 0, coverage: 0 }, { revenue: 0, coverage: 100 },
    { costs: 2000000 }, { hours: 0 }, { rate: 0 },
    { side: 'seller', hours: 0, costs: 100000 }, { side: 'seller', rate: 0 },
  ]) {
    const model = createGpuHedgeModel({}, state);
    assert.ok(model.domain.every(Number.isFinite));
    assert.ok(model.domain[1] > model.domain[0]);
    for (const settlement of model.domain) {
      const { margin, ...profits } = model.profitAt(settlement);
      assert.ok(Object.values(profits).every(Number.isFinite));
      assert.ok(model.side === 'seller' || model.revenue === 0 ? margin === null : Number.isFinite(margin));
    }
    assert.ok(model.side === 'seller' || model.revenue === 0 ? model.margin === null : Number.isFinite(model.margin));
    assert.doesNotMatch(renderGpuHedgeSvg(model), /NaN|Infinity/);
  }
});

test('gallery stays minimal; monitor labels both lines and exports escape inputs', () => {
  const model = createGpuHedgeModel({});
  const seller = createGpuHedgeModel({}, { side: 'seller', hours: 1120000, rate: 4.4 });
  assert.match(renderGpuHedgeSvg(seller, { gallery: true }), /Revenue hedge/);
  assert.match(renderGpuHedgeSvg(seller), /Seller revenue in USD/);
  assert.doesNotMatch(renderGpuHedgeSvg(seller), /data-gpu-hedge-zero/);
  assert.match(renderGpuHedgeSvg(seller, { title: 'Cost' }), />Cost<\/text>/);
  const gallery = renderGpuHedgeSvg(model, { gallery: true, compact: true });
  assert.equal((gallery.match(/data-gpu-hedge-line=/g) || []).length, 2);
  assert.match(gallery, /data-view-artifact-header/);
  assert.doesNotMatch(gallery, /data-gpu-hedge-headline-caption/);
  assert.doesNotMatch(gallery, /<circle|data-gpu-hedge-axes|data-gpu-hedge-readout|data-gpu-hedge-label/);
  assert.match(renderGpuHedgeSvg(model), /Breakeven \$3.00/);
  assert.match(renderGpuHedgeSvg(model), /data-view-artifact-header/);
  assert.match(renderGpuHedgeSvg(model), /Settlement \$2.50 \/GPU-h/);
  assert.doesNotMatch(renderGpuHedgeSvg(model), /Settlement price \(USD|Profit \(USD\)/);
  assert.match(renderGpuHedgeSvg(model), />Hedged<.*?\n.*?>Unhedged</);
  const hostile = renderGpuHedgeSvg(model, { title: '<img onerror="attack()">', colors: { line: 'red" onload="attack()' } });
  assert.doesNotMatch(hostile, /<img|stroke="red" onload=/);
  assert.match(hostile, /&lt;img onerror=&quot;attack\(\)&quot;&gt;/);
  assert.match(hostile, /stroke="red&quot; onload=&quot;attack\(\)"/);
});
