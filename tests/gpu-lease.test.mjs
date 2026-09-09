import assert from 'node:assert/strict';
import test from 'node:test';
import { createGpuLeaseModel } from '../src/gpu-lease-model.js';
import { getCardDefinition, normalizeCardState } from '../src/card-registry.js';
import { CATALOG_COLLECTIONS_STORAGE_KEY, loadCatalogCollections } from '../src/catalog-collections.js';
import { loadSavedCatalog, saveCatalogItem } from '../src/saved-catalog.js';
import { createSharedDesk, sharedDeskUrl, readSharedDeskUrl } from '../src/shared-desk.js';

function near(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
}

test('lease follows the reference inputs without rounding its cash flows', () => {
  const model = createGpuLeaseModel({});
  near(model.monthlyPayment, 2508703.103568624);
  near(model.totalPayments, 90313311.72847046);
  near(model.totalReceipts, 120313311.72847046);
  near(model.residualShare, 24.934896703455067);
  assert.equal(model.residualPercent, 30);
  near(model.financingCost, 20313311.72847046);
  near(model.monthlySaving, model.paymentWithoutResidual - model.monthlyPayment);
  assert.ok(Object.isFrozen(model));
});

test('zero interest divides the unrecovered cost evenly, including both residual endpoints', () => {
  for (const residual of [0, 30000000, 100000000]) {
    const model = createGpuLeaseModel({}, { apr: 0, residual });
    near(model.monthlyPayment, (model.cost - residual) / model.term);
    near(model.totalReceipts, model.cost);
    near(model.residualShare, model.residualPercent);
    near(model.financingCost, 0);
    near(model.monthlySaving, residual / model.term);
  }
});

test('payments and terminal residual conserve present value across rates and terms', () => {
  for (const apr of [1e-12, 5, 10, 100]) {
    for (const term of [1, 36, 120]) {
      for (const residual of [0, 30000000, 100000000]) {
        const model = createGpuLeaseModel({}, { apr, term, residual });
        const rate = apr / 1200;
        const discount = Math.exp(-term * Math.log1p(rate));
        const annuity = -Math.expm1(-term * Math.log1p(rate)) / rate;
        near(model.monthlyPayment * annuity + residual * discount, model.cost);
        near(model.totalPayments + residual, model.totalReceipts);
        assert.ok(model.monthlyPayment >= 0);
        assert.ok(model.residualShare >= 0 && model.residualShare <= 100);
        near(model.paymentWithoutResidual - model.monthlyPayment, residual * discount / annuity);
      }
    }
  }
});

test('lease inputs accept numeric URLs and clamp invalid or extreme scenarios', () => {
  const model = createGpuLeaseModel({}, { cost: '200000', term: '24.6', apr: '8.5', residual: '60000' });
  assert.deepEqual([model.cost, model.term, model.apr, model.residual], [200000, 25, 8.5, 60000]);
  for (const state of [
    { cost: -1, term: -10, apr: -5, residual: -100 },
    { cost: 1e20, term: 1e5, apr: 1e5, residual: 1e20 },
    { cost: 1, term: 1, apr: 100, residual: 1 },
    { cost: NaN, term: Infinity, apr: '', residual: null },
    { cost: 100, residual: Infinity },
  ]) {
    const output = createGpuLeaseModel({}, state);
    assert.ok(Object.values(output).every(Number.isFinite));
    assert.ok(output.cost >= 1 && output.cost <= 1e12);
    assert.ok(Number.isInteger(output.term) && output.term >= 1 && output.term <= 120);
    assert.ok(output.apr >= 0 && output.apr <= 100);
    assert.ok(output.residual >= 0 && output.residual <= output.cost);
  }
  assert.deepEqual(createGpuLeaseModel({}, { cost: NaN, term: Infinity, apr: '', residual: null }), createGpuLeaseModel({}));
});

test('custom lease inputs survive URL, save and share; the starter migrates only once', async t => {
  const previous = globalThis.window;
  const values = new Map();
  const localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
  globalThis.window = { localStorage, location: new URL('http://localhost:4173/') };
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  const { cardUrl } = await import('../src/card-presentation.js');
  const card = getCardDefinition('gpu-lease');
  assert.equal(card.title, 'Residual value');
  assert.equal(card.catalogPresets[0].id, 'residual');
  const inputUrl = new URL('http://localhost:4173/?card=gpu-lease&asset=system&cost=24000000&term=48&apr=7.25&residual=8400000&palette=sage&theme=dark');
  const state = normalizeCardState(card.id, Object.fromEntries(inputUrl.searchParams));
  assert.deepEqual([state.cost, state.term, state.apr, state.residual], [24000000, 48, 7.25, 8400000]);
  const link = cardUrl(card.id, 'monitor', state);
  assert.deepEqual(normalizeCardState(card.id, Object.fromEntries(link.searchParams)), state);
  const saved = saveCatalogItem({ cardId: card.id, name: 'My lease', state });
  const loaded = loadSavedCatalog(card.id).find(item => item.id === saved.id);
  assert.deepEqual(normalizeCardState(card.id, loaded.state), state);
  const desk = createSharedDesk({ name: 'Lease', entries: [{ cardId: card.id, name: loaded.name, state: loaded.state }] });
  const shared = readSharedDeskUrl(sharedDeskUrl(desk, inputUrl.href));
  assert.equal(shared.error, null);
  assert.deepEqual(shared.snapshot.entries[0].state, loaded.state);
  assert.deepEqual(normalizeCardState(card.id, shared.snapshot.entries[0].state), state);

  const fresh = loadCatalogCollections({ readOnly: true });
  const lease = fresh.collections.find(collection => collection.id === 'lease');
  assert.deepEqual({ name: lease.name, keys: lease.keys }, { name: 'Lease', keys: ['preset-gpu-lease-residual'] });
  const oldCollections = fresh.collections.filter(collection => collection.id !== 'lease');
  localStorage.setItem(CATALOG_COLLECTIONS_STORAGE_KEY, JSON.stringify({ version: 15, activeId: 'overview', collections: oldCollections }));
  const upgraded = loadCatalogCollections();
  assert.equal(upgraded.version, 17);
  assert.deepEqual(upgraded.collections.filter(collection => collection.id !== 'lease'), oldCollections);
  assert.equal(upgraded.collections.filter(collection => collection.id === 'lease').length, 1);
  assert.deepEqual(loadCatalogCollections(), upgraded);
  localStorage.setItem(CATALOG_COLLECTIONS_STORAGE_KEY, JSON.stringify({ ...upgraded, collections: oldCollections }));
  assert.deepEqual(loadCatalogCollections().collections, oldCollections, 'a Lease catalog deleted after migration stays deleted');
});
