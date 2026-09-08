import assert from 'node:assert/strict';
import test from 'node:test';
import { createGpuHedgeModel } from '../src/gpu-hedge-model.js';
import { renderGpuHedgeSvg } from '../src/gpu-hedge-presentation.js';

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
