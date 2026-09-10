import assert from 'node:assert/strict';
import test from 'node:test';
import { QUOTE_DESK_STORY } from '../src/quote-desk-story-model.js';
import { renderWalkthroughDeskCards } from '../src/walkthrough-desk-cards.js';

test('the Desk adapter preserves the selected rental without fabricating a negotiation', () => {
  const presentation = renderWalkthroughDeskCards();
  assert.deepEqual(presentation.cards.map(card => card.id), ['quote', 'prices', 'forwards', 'coverage']);
  const { model, mount } = presentation.cards[0];
  const { quote } = QUOTE_DESK_STORY;
  assert.equal(model.id, quote.id);
  assert.equal(model.label, 'Ashburn 02');
  assert.equal(model.asset, 'H100');
  assert.equal(model.quantity, 256);
  assert.equal(model.nodes, 32);
  assert.equal(model.quote.value, 2.46);
  assert.equal(model.region, 'US East');
  assert.equal(model.termMonths, null);
  assert.deepEqual(model.quoteHistory, []);
  assert.deepEqual(model.eventLog, []);
  assert.equal(model.market, null);
  assert.equal(model.statusLabel, 'QUOTE');
  assert.doesNotMatch(JSON.stringify(model), /agreed|B200|Juniper|24 months/i);
  assert.equal(typeof mount, 'function');
  assert.match(presentation.summary, /2026-10-08 to 2026-10-22 exclusive/);
  assert.match(presentation.summary, /\$211,599\.36 total/);
  assert.match(presentation.summary, /Nothing booked or saved/);
});

test('the quote uses the real deal ticket branch and destroys only its mounted content', () => {
  const ownerDocument = {
    getElementById: () => ({}),
    createElement: () => ({ dataset: {}, style: { setProperty() {} }, querySelector: () => null }),
  };
  const host = {
    ownerDocument,
    replaceChildren(...children) {
      this.children = children;
      for (const child of children) child.parentNode = this;
    },
  };
  const mounted = renderWalkthroughDeskCards().cards[0].mount(host);
  assert.match(mounted.element.innerHTML, /class="deal-view__ticket"/);
  assert.match(mounted.element.innerHTML, /Ashburn 02/);
  assert.match(mounted.element.innerHTML, /\$2\.46/);
  assert.match(mounted.element.innerHTML, /256 GPUs/);
  assert.match(mounted.element.innerHTML, /US East/);
  assert.doesNotMatch(mounted.element.innerHTML, /converged|negotiation-line|agreed/i);
  mounted.destroy();
  assert.deepEqual(host.children, []);
});

test('shared catalog renderers receive the illustrative snapshot and forward references', () => {
  const [, prices, forwards] = renderWalkthroughDeskCards().cards;
  assert.deepEqual(prices.model.bars.map(bar => [bar.id, bar.value]), [['H100', 2.6]]);
  assert.equal(prices.model.revision, 'walkthrough-illustrative-v1');
  assert.match(prices.svg, /data-price-ladder-rail/);
  assert.match(prices.svg, /data-price-bar-row/);
  assert.match(prices.svg, /data-view-artifact-header/);
  assert.equal(forwards.model.range, 'now');
  assert.deepEqual(forwards.model.latest, [2.6, 2.68, 2.76]);
  assert.deepEqual(forwards.model.values[0], [2.68, 2.76, 2.84]);
  assert.ok(forwards.model.observations.at(-1) < forwards.model.deliveries[0]);
  assert.equal(forwards.model.contract.kind, 'illustrative');
  assert.equal(forwards.model.contract.quantity, 256);
  assert.match(forwards.svg, /data-forward-chart/);
  assert.match(forwards.svg, /data-forward-series/);
  for (const card of [prices, forwards]) {
    assert.match(card.svg, /viewBox="0 0 1200 675"/);
    assert.doesNotMatch(card.svg, /NaN|Infinity|undefined/);
  }
});

test('the real coverage card represents 43,008 hedged hours without a profit claim', () => {
  const { model, svg } = renderWalkthroughDeskCards().cards[3];
  assert.equal(model.side, 'buyer');
  assert.equal(model.hours, 86_016);
  assert.equal(model.coverage, 50);
  assert.equal(model.hedgedHours, 43_008);
  assert.equal(model.exposedHours, 43_008);
  assert.equal(model.rate, 2.6);
  assert.equal(model.revenue, 0);
  assert.equal(model.costs, 0);
  assert.equal(model.basis, 0);
  assert.equal((svg.match(/data-gpu-coverage-tile=/g) ?? []).length, 100);
  assert.equal((svg.match(/data-gpu-coverage-fraction="1"/g) ?? []).length, 50);
  assert.equal((svg.match(/data-gpu-coverage-fraction="0"/g) ?? []).length, 50);
  assert.match(svg, /43,008 hedged and 43,008 exposed/);
  assert.match(svg, /Hedge coverage/);
  assert.doesNotMatch(svg, /profit|NaN|Infinity|undefined/i);
});
