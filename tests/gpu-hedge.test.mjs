import assert from 'node:assert/strict';
import test from 'node:test';
import { getCardDefinition, normalizeCardState } from '../src/card-registry.js';
import { CATALOG_COLLECTIONS_STORAGE_KEY, loadCatalogCollections } from '../src/catalog-collections.js';
import { loadSavedCatalog, saveCatalogItem } from '../src/saved-catalog.js';
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
  assert.equal(model.headlineProfit, 250000);
  assert.equal(model.breakEven, 3);
  assert.deepEqual(model.domain, [1.8, 3.4]);
  assert.equal(model.profitAt(1.8).hedged, 250000);
  assert.equal(model.profitAt(3.4).hedged, 250000);
  assert.equal(model.profitAt(3).unhedged, 0);
  assert.equal(model.profitAt(3).hedgePnl, 250000);
  assert.ok(Math.abs(model.margin - 100 / 6) < 1e-12);
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

test('coverage presets, saved scenarios and shared desks retain scale and fractional coverage', t => {
  localStorageFor(t);
  const card = getCardDefinition('gpu-hedge');
  const preset = card.catalogPresets.find(preset => preset.id === 'coverage');
  assert.equal(preset.label, 'GPU coverage');
  assert.deepEqual(preset.state, { gpu: 'H100', scale: 'coverage', coverage: 60 });
  const buyer = normalizeCardState(card.id, card.catalogPresets.find(preset => preset.id === 'buyer').state);
  assert.equal(buyer.scale, 'price');
  assert.equal(buyer.coverage, 100);
  assert.ok(card.layers.every(layer => layer.views.includes('coverage')));
  for (const cardId of ['quote-view', 'deal-view']) {
    assert.ok(getCardDefinition(cardId).layers.every(layer => !layer.views.includes('coverage')));
  }
  for (const coverage of [79.9, 0, 100]) {
    const state = normalizeCardState(card.id, { gpu: 'H200', scale: 'coverage', coverage });
    assert.equal(state.scale, 'coverage');
    assert.equal(state.coverage, coverage);
    const saved = saveCatalogItem({ cardId: card.id, name: `Coverage ${coverage}`, state });
    assert.deepEqual(loadSavedCatalog(card.id).find(item => item.id === saved.id).state, state);
    const desk = createSharedDesk({ name: 'Coverage', entries: [{ cardId: card.id, name: saved.name, state }] });
    assert.deepEqual(decodeSharedDesk(encodeSharedDesk(desk)).entries[0].state, state);
  }
});

test('catalog migration adds coverage only to untouched previous Hedge starters', t => {
  const storage = localStorageFor(t);
  const fresh = loadCatalogCollections({ readOnly: true });
  assert.equal(fresh.version, 16);
  const hedge = fresh.collections.find(collection => collection.id === 'hedge');
  assert.deepEqual(hedge.keys.slice(0, 2), ['preset-gpu-hedge-buyer', 'preset-gpu-hedge-coverage']);
  assert.ok(!fresh.collections.find(collection => collection.id === 'overview').keys.includes('preset-gpu-hedge-coverage'));
  const migrate = (version, collections) => {
    storage.setItem(CATALOG_COLLECTIONS_STORAGE_KEY, JSON.stringify({ version, activeId: 'hedge', collections }));
    return loadCatalogCollections({ readOnly: true });
  };
  const withoutLease = state => state.collections.filter(collection => collection.id !== 'lease');
  const assertLeaseAdded = state => {
    const leases = state.collections.filter(collection => collection.id === 'lease');
    assert.equal(leases.length, 1);
    assert.equal(leases[0].name, 'Lease');
    assert.deepEqual(leases[0].keys, ['preset-gpu-lease-residual']);
  };
  for (const version of [13, 14]) {
    const previous = { ...hedge, keys: hedge.keys.filter(key =>
      key !== 'preset-gpu-hedge-coverage' && (version === 14 || key !== 'preset-gpu-hedge-buyer')) };
    const upgraded = migrate(version, [previous]);
    assert.equal(upgraded.version, 16);
    assert.equal(upgraded.collections.length, 2);
    assert.deepEqual(withoutLease(upgraded)[0].keys, hedge.keys);
    assertLeaseAdded(upgraded);
    for (const customized of [
      { ...previous, name: 'My hedge' },
      { ...previous, keys: [...previous.keys].reverse() },
      { ...previous, keys: previous.keys.slice(1) },
      { ...previous, palette: 'sage' },
    ]) {
      const upgradedCustom = migrate(version, [customized]);
      assert.deepEqual(withoutLease(upgradedCustom), [customized]);
      assertLeaseAdded(upgradedCustom);
    }
    const emptied = migrate(version, []);
    assert.deepEqual(withoutLease(emptied), []);
    assertLeaseAdded(emptied);
  }
  const removedCoverage = { ...hedge, keys: hedge.keys.filter(key => key !== 'preset-gpu-hedge-coverage') };
  const migratedRemoval = migrate(15, [removedCoverage]);
  assert.deepEqual(withoutLease(migratedRemoval), [removedCoverage]);
  assertLeaseAdded(migratedRemoval);
  assert.deepEqual(migrate(16, [removedCoverage]).collections, [removedCoverage]);
});

test('zero revenue, no hours and loss-making scenarios render finite geometry', () => {
  for (const state of [
    { revenue: 0, coverage: 0 }, { revenue: 0, coverage: 100 },
    { costs: 2000000 }, { hours: 0 }, { rate: 0 },
  ]) {
    const model = createGpuHedgeModel({}, state);
    assert.ok(model.domain.every(Number.isFinite));
    assert.ok(model.domain[1] > model.domain[0]);
    for (const settlement of model.domain) {
      const { margin, ...profits } = model.profitAt(settlement);
      assert.ok(Object.values(profits).every(Number.isFinite));
      assert.ok(model.revenue === 0 ? margin === null : Number.isFinite(margin));
    }
    assert.ok(model.revenue === 0 ? model.margin === null : Number.isFinite(model.margin));
    assert.doesNotMatch(renderGpuHedgeSvg(model), /NaN|Infinity/);
  }
});

test('gallery stays minimal; monitor labels both lines and exports escape inputs', () => {
  const model = createGpuHedgeModel({});
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
