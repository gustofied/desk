import assert from 'node:assert/strict';
import test from 'node:test';
import { walkthroughDeskUrl } from '../src/walkthrough-desk-link.js';
import { readSharedDeskUrl } from '../src/shared-desk.js';

test('the walkthrough link opens the real root gallery with three exact chart definitions', () => {
  const href = walkthroughDeskUrl('https://desk.example/walkthrough/?preview=1#chapter');
  const url = new URL(href);
  assert.equal(url.origin, 'https://desk.example');
  assert.equal(url.pathname, '/');
  assert.equal(url.search, '?view=gallery');
  assert.match(url.hash, /^#desk=/);
  const { snapshot, error } = readSharedDeskUrl(href);
  assert.equal(error, null);
  const shared = { gpu: 'H100', layers: ['H100'], palette: 'sage', theme: 'dark', colormap: 'current' };
  assert.deepEqual(snapshot, {
    version: 1, name: 'H100 request', palette: 'sage', theme: 'dark',
    entries: [
      {
        cardId: 'gpu-price-snapshot', name: 'H100 prices',
        state: { ...shared, scale: 'price', range: '1d' },
      },
      {
        cardId: 'forward-prices', name: 'Forward prices',
        state: { ...shared, scale: 'price', range: 'now' },
      },
      {
        cardId: 'gpu-hedge', name: 'Hedge coverage',
        state: {
          ...shared, scale: 'coverage', range: 'now', side: 'buyer',
          delivery: '2026-10', hours: 86_016, revenue: 0, costs: 0,
          rate: 2.6, coverage: 50, basis: 0,
        },
      },
    ],
  });
  assert.ok(snapshot.entries.every(entry => !['quote-view', 'deal-view'].includes(entry.cardId)));
  assert.doesNotMatch(JSON.stringify(snapshot), /Ashburn|211599|2026-10-08|2026-10-22/);
});

test('the link also resolves from the walkthrough index and strips credentials', () => {
  const href = walkthroughDeskUrl('https://user:secret@desk.example/walkthrough/index.html?preview=1');
  const url = new URL(href);
  assert.equal(url.pathname, '/');
  assert.equal(url.username, '');
  assert.equal(url.password, '');
  assert.equal(readSharedDeskUrl(href).error, null);
  assert.equal(href, walkthroughDeskUrl('https://desk.example/walkthrough/'));
});
