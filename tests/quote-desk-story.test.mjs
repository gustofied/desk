import assert from 'node:assert/strict';
import test from 'node:test';
import { QUOTE_REQUEST, rankedQuotes } from '../src/quote-story-model.js';
import { QUOTE_DESK_STORY, modeledBuyerCost } from '../src/quote-desk-story-model.js';

test('the tailored desk preserves every term of the selected alternate quote', () => {
  assert.deepEqual(QUOTE_DESK_STORY.quote, rankedQuotes(QUOTE_REQUEST.alternateStart)[0]);
  assert.deepEqual({
    gpu: QUOTE_DESK_STORY.quote.gpu,
    gpuCount: QUOTE_DESK_STORY.quote.gpuCount,
    gpuHours: QUOTE_DESK_STORY.quote.gpuHours,
    start: QUOTE_DESK_STORY.quote.startDate,
    end: QUOTE_DESK_STORY.quote.endDate,
    rateCents: QUOTE_DESK_STORY.quote.rateCents,
    totalCents: QUOTE_DESK_STORY.quote.totalCents,
  }, {
    gpu: 'H100',
    gpuCount: 256,
    gpuHours: 86_016,
    start: '2026-10-08',
    end: '2026-10-22',
    rateCents: 246,
    totalCents: 21_159_936,
  });
  assert.equal(QUOTE_DESK_STORY.quote.endExclusive, true);
  assert.equal(QUOTE_DESK_STORY.status, 'Nothing booked');
});

test('history and forward references are explicitly illustrative and distinct from rental terms', () => {
  assert.equal(QUOTE_DESK_STORY.kind, 'illustrative');
  for (const series of [QUOTE_DESK_STORY.history, QUOTE_DESK_STORY.forwards]) {
    assert.equal(series.kind, 'illustrative');
    assert.match(series.label, /illustrative/i);
    assert.equal(series.rateUnit, 'USD/GPU-hour');
    assert.ok(series.points.every(point => Number.isSafeInteger(point.rateCents)));
  }
  assert.match(QUOTE_DESK_STORY.history.description, /not live market data/);
  assert.equal(QUOTE_DESK_STORY.history.points.length, 8);
  assert.deepEqual(QUOTE_DESK_STORY.history.points.map(point => point.rateCents), [292, 285, 289, 278, 273, 281, 267, 260]);
  assert.deepEqual(QUOTE_DESK_STORY.forwards.points, [
    { month: '2026-10', label: 'Oct', rateCents: 260 },
    { month: '2026-11', label: 'Nov', rateCents: 268 },
    { month: '2026-12', label: 'Dec', rateCents: 276 },
  ]);
  assert.match(QUOTE_DESK_STORY.forwards.description, /separate from the selected rental quote/);
  assert.equal(QUOTE_DESK_STORY.hedge.hedgeRateCents, QUOTE_DESK_STORY.forwards.points[0].rateCents);
  assert.notEqual(QUOTE_DESK_STORY.hedge.hedgeRateCents, QUOTE_DESK_STORY.quote.rateCents);
});

test('all coverage and settlement scenarios produce the exact modeled buyer cost in cents', () => {
  const expected = [
    [0, [17_203_200, 22_364_160, 27_525_120]],
    [0.5, [19_783_680, 22_364_160, 24_944_640]],
    [1, [22_364_160, 22_364_160, 22_364_160]],
  ];
  const settlementsCents = [200, 260, 320];
  assert.deepEqual(QUOTE_DESK_STORY.hedge.coverageLevels, [0, 0.5, 1]);
  assert.deepEqual(QUOTE_DESK_STORY.hedge.settlementsCents, settlementsCents);
  assert.equal(QUOTE_DESK_STORY.scenarios.length, expected.length);
  for (const [index, [coverage, costs]] of expected.entries()) {
    const scenario = QUOTE_DESK_STORY.scenarios[index];
    assert.equal(scenario.coverage, coverage);
    assert.equal(scenario.coverageLabel, `${coverage * 100}% coverage`);
    assert.equal(scenario.outcomes.length, settlementsCents.length);
    for (const [settlementIndex, settlementCents] of settlementsCents.entries()) {
      const result = modeledBuyerCost({ coverage, settlementCents });
      assert.deepEqual(result, {
        coverage,
        settlementCents,
        hedgeRateCents: 260,
        gpuHours: 86_016,
        costCents: costs[settlementIndex],
        costUsd: costs[settlementIndex] / 100,
      });
      assert.deepEqual(scenario.outcomes[settlementIndex], result);
      assert.ok(Number.isSafeInteger(result.costCents));
    }
  }
});

test('modeled cost assumptions state utilization, index matching, and exclusions without a trade default', () => {
  const { hedge } = QUOTE_DESK_STORY;
  assert.equal(hedge.label, 'Modeled buyer net compute cost');
  assert.equal(hedge.gpuHours, QUOTE_DESK_STORY.quote.gpuHours);
  assert.equal(hedge.referenceMonth, '2026-10');
  const assumptions = hedge.assumptions.join(' ');
  assert.match(assumptions, /matched index/);
  assert.match(assumptions, /all 86,016 GPU-hours are fully used/);
  assert.match(assumptions, /Excludes basis differences, fees, and collateral/);
  assert.match(assumptions, /separately from the selected fixed rental quote/);
  assert.match(assumptions, /nothing booked and no recommendation/);
  assert.equal(Object.hasOwn(hedge, 'selectedCoverage'), false);
  assert.equal(Object.hasOwn(hedge, 'revenue'), false);
  assert.equal(Object.hasOwn(hedge, 'profit'), false);
});

test('unsupported coverage and nonintegral, negative, or overflowing prices cannot produce costs', () => {
  for (const coverage of [undefined, null, '', '0.5', -0.5, 0.25, 50, 100, NaN, Infinity]) {
    assert.throws(() => modeledBuyerCost({ coverage, settlementCents: 260 }), RangeError);
  }
  for (const settlementCents of [undefined, null, '', '260', -1, 2.6, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => modeledBuyerCost({ coverage: 0.5, settlementCents }), RangeError);
  }
  assert.throws(() => modeledBuyerCost(), RangeError);
  assert.equal(modeledBuyerCost({ coverage: 0, settlementCents: 0 }).costCents, 0);
});

test('playback cannot mutate the illustrative desk or any nested scenario or price', () => {
  function assertDeeplyFrozen(value) {
    if (value === null || typeof value !== 'object') return;
    assert.ok(Object.isFrozen(value));
    for (const child of Object.values(value)) assertDeeplyFrozen(child);
  }
  assertDeeplyFrozen(QUOTE_DESK_STORY);
  assertDeeplyFrozen(modeledBuyerCost({ coverage: 0.5, settlementCents: 260 }));
  assert.throws(() => { QUOTE_DESK_STORY.history.points[0].rateCents = 1; }, TypeError);
  assert.throws(() => { QUOTE_DESK_STORY.scenarios[0].outcomes[0].costCents = 1; }, TypeError);
});
