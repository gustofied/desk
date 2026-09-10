import assert from 'node:assert/strict';
import test from 'node:test';
import { QUOTE_REQUEST, QUOTE_OFFERS, quoteFor, rankedQuotes, formatUsd } from '../src/quote-story-model.js';

test('illustrative quotes use GPU-hours and exact integer cents', () => {
  assert.equal(QUOTE_REQUEST.nodeCount, 32);
  assert.equal(QUOTE_REQUEST.gpuHours, 86_016);
  const expected = [
    ['ashburn-01', 268, 23_052_288, 262, 22_536_192],
    ['ashburn-02', 282, 24_256_512, 246, 21_159_936],
    ['newark-01', 274, 23_568_384, 269, 23_138_304],
  ];
  for (const [id, originalRate, originalTotal, shiftedRate, shiftedTotal] of expected) {
    for (const [start, rate, total] of [
      [QUOTE_REQUEST.initialStart, originalRate, originalTotal],
      [QUOTE_REQUEST.alternateStart, shiftedRate, shiftedTotal],
    ]) {
      const quote = quoteFor(id, start);
      assert.equal(quote.kind, 'illustrative');
      assert.ok(quote.availableGpus >= quote.gpuCount);
      assert.equal(quote.rateUnit, 'USD/GPU-hour');
      assert.equal(quote.rateCents, rate);
      assert.equal(quote.totalCents, total);
      assert.ok(Number.isSafeInteger(quote.totalCents));
      assert.equal(quote.totalUsd, total / 100);
    }
  }
  assert.equal(formatUsd(230522.88), '$230,523');
  assert.equal(formatUsd(2.68, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), '$2.68');
});

test('moving the start date changes ranking while preserving a fourteen-day exclusive window', () => {
  assert.deepEqual(rankedQuotes().map(quote => quote.id), ['ashburn-01', 'newark-01', 'ashburn-02']);
  assert.deepEqual(rankedQuotes(QUOTE_REQUEST.alternateStart).map(quote => quote.id), ['ashburn-02', 'ashburn-01', 'newark-01']);
  for (const [start, end] of [['2026-10-05', '2026-10-19'], ['2026-10-08', '2026-10-22']]) {
    const quote = quoteFor('ashburn-01', start);
    assert.equal(quote.endDate, end);
    assert.equal(quote.endExclusive, true);
    assert.equal(quote.startsAt, `${start}T00:00:00.000Z`);
    assert.equal(quote.endsAt, `${end}T00:00:00.000Z`);
    assert.equal(Date.parse(quote.endsAt) - Date.parse(quote.startsAt), 14 * 24 * 60 * 60 * 1000);
  }
});

test('request, offers and computed quotes cannot be mutated by playback', () => {
  assert.ok(Object.isFrozen(QUOTE_REQUEST));
  assert.ok(Object.isFrozen(QUOTE_OFFERS));
  for (const offer of QUOTE_OFFERS) {
    assert.ok(Object.isFrozen(offer));
    assert.ok(Object.isFrozen(offer.ratesCents));
    assert.throws(() => { offer.ratesCents['2026-10-05'] = 1; }, TypeError);
  }
  const quotes = rankedQuotes();
  assert.ok(Object.isFrozen(quotes));
  assert.ok(quotes.every(Object.isFrozen));
  assert.throws(() => { quotes[0].totalCents = 1; }, TypeError);
});

test('unsupported or invalid starts and offers do not silently produce a quote', () => {
  for (const start of [null, '', 'invalid', '2026-10-32', '2026-10-06', '2026-10-05T00:00:00Z']) {
    assert.throws(() => quoteFor('ashburn-01', start), RangeError);
    assert.throws(() => rankedQuotes(start), RangeError);
  }
  for (const id of [undefined, null, '', 'unknown']) assert.throws(() => quoteFor(id), RangeError);
  for (const value of [NaN, Infinity, '2.68']) assert.throws(() => formatUsd(value), RangeError);
});
