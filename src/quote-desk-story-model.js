import { QUOTE_REQUEST, rankedQuotes } from './quote-story-model.js';

// This chapter continues the selected quote without changing its rental terms.
const quote = rankedQuotes(QUOTE_REQUEST.alternateStart)[0];
const HEDGE_RATE_CENTS = 260;
const COVERAGE_LEVELS = Object.freeze([0, 0.5, 1]);
const SETTLEMENTS_CENTS = Object.freeze([200, 260, 320]);

/**
 * Modeled buyer net compute cost under an assumed matched-index hedge.
 * coverage is a fraction (0, 0.5, or 1); prices and output cost are in cents.
 * The rental quote remains separate from this hypothetical floating-cost model.
 */
export function modeledBuyerCost({ coverage, settlementCents } = {}) {
  if (!COVERAGE_LEVELS.includes(coverage)) {
    throw new RangeError('Choose illustrative coverage of 0%, 50%, or 100%.');
  }
  if (!Number.isSafeInteger(settlementCents) || settlementCents < 0) {
    throw new RangeError('Settlement must be nonnegative integer cents per GPU-hour.');
  }

  const coveredHours = quote.gpuHours * coverage;
  const uncoveredHours = quote.gpuHours - coveredHours;
  // Equivalent to hours × (coverage × hedge rate + (1 − coverage) × settlement).
  // Whole covered/uncovered hours keep every intermediate amount integral.
  const costCents = coveredHours * HEDGE_RATE_CENTS + uncoveredHours * settlementCents;
  if (!Number.isSafeInteger(costCents)) throw new RangeError('Modeled cost is out of range.');

  return Object.freeze({
    coverage,
    settlementCents,
    hedgeRateCents: HEDGE_RATE_CENTS,
    gpuHours: quote.gpuHours,
    costCents,
    costUsd: costCents / 100,
  });
}

export const QUOTE_DESK_STORY = Object.freeze({
  kind: 'illustrative',
  label: 'Illustrative H100 desk',
  status: 'Nothing booked',
  quote,
  history: Object.freeze({
    kind: 'illustrative',
    label: 'Illustrative H100 history',
    description: 'Deterministic example prices; not live market data.',
    rateUnit: QUOTE_REQUEST.rateUnit,
    points: Object.freeze([
      Object.freeze({ date: '2026-08-10', rateCents: 292 }),
      Object.freeze({ date: '2026-08-17', rateCents: 285 }),
      Object.freeze({ date: '2026-08-24', rateCents: 289 }),
      Object.freeze({ date: '2026-08-31', rateCents: 278 }),
      Object.freeze({ date: '2026-09-07', rateCents: 273 }),
      Object.freeze({ date: '2026-09-14', rateCents: 281 }),
      Object.freeze({ date: '2026-09-21', rateCents: 267 }),
      Object.freeze({ date: '2026-09-28', rateCents: 260 }),
    ]),
  }),
  forwards: Object.freeze({
    kind: 'illustrative',
    label: 'Illustrative forward references',
    description: 'Assumed forward prices, separate from the selected rental quote.',
    rateUnit: QUOTE_REQUEST.rateUnit,
    points: Object.freeze([
      Object.freeze({ month: '2026-10', label: 'Oct', rateCents: HEDGE_RATE_CENTS }),
      Object.freeze({ month: '2026-11', label: 'Nov', rateCents: 268 }),
      Object.freeze({ month: '2026-12', label: 'Dec', rateCents: 276 }),
    ]),
  }),
  hedge: Object.freeze({
    kind: 'illustrative',
    label: 'Modeled buyer net compute cost',
    gpuHours: quote.gpuHours,
    hedgeRateCents: HEDGE_RATE_CENTS,
    referenceMonth: '2026-10',
    coverageLevels: COVERAGE_LEVELS,
    settlementsCents: SETTLEMENTS_CENTS,
    formula: 'costCents = gpuHours × (coverage × hedgeRateCents + (1 − coverage) × settlementCents)',
    assumptions: Object.freeze([
      'Assumes a matched index for compute cost and hedge settlement.',
      'Assumes all 86,016 GPU-hours are fully used.',
      'Excludes basis differences, fees, and collateral requirements.',
      'Models floating compute cost separately from the selected fixed rental quote.',
      'Illustrative only; nothing booked and no recommendation.',
    ]),
  }),
  scenarios: Object.freeze(COVERAGE_LEVELS.map(coverage => Object.freeze({
    coverage,
    coverageLabel: `${coverage * 100}% coverage`,
    outcomes: Object.freeze(SETTLEMENTS_CENTS.map(settlementCents => modeledBuyerCost({ coverage, settlementCents }))),
  }))),
});
