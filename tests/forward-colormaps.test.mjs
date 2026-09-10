import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { rgb } from 'd3';
import { FORWARD_COLORMAPS, forwardColormapColor, forwardColormapGradient } from '../src/forward-colormaps.js';
import { withChartColormap } from '../src/chart-colors.js';
import { CARD_REGISTRY, normalizeCardState, publishedCardSharePath, publishedCardPreviewPath } from '../src/card-registry.js';
import { CATALOG_SHARE_CARD_IDS, catalogShareStates, supportsCatalogShareState } from '../src/catalog-share-previews.js';
import { loadSavedCatalog, saveCatalogItem } from '../src/saved-catalog.js';
import { createSharedDesk, encodeSharedDesk, decodeSharedDesk } from '../src/shared-desk.js';
import { MARKET_WATCHLIST_STORAGE_KEY, createMarketWatchlist } from '../src/market-watchlist.js';
import { CATALOG_COLLECTIONS_STORAGE_KEY, saveSharedDeskCollection, loadCatalogCollections } from '../src/catalog-collections.js';
import { createForwardPricesModel } from '../src/forward-prices-model.js';
import { renderForwardPricesSvg } from '../src/forward-prices-presentation.js';
import { renderCatalogShareArtifact } from '../scripts/catalog-share-artifacts.mjs';

const rawToken = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const payload = JSON.parse(readFileSync(new URL('../data/forward-prices.json', import.meta.url)));
const input = { gpu: 'H100', range: 'all', palette: 'sage', theme: 'dark' };

test('chart colors preserve surfaces and keep translucent chart ink readable in both themes', () => {
  const luminance = channels => channels.map(channel => {
    const value = channel / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const channels = color => { const { r, g, b } = rgb(color); return [r, g, b]; };
  const contrast = (ink, paper, opacity) => {
    const background = channels(paper);
    const foreground = channels(ink).map((channel, index) => channel * opacity + background[index] * (1 - opacity));
    const values = [luminance(background), luminance(foreground)].sort((a, b) => a - b);
    return (values[1] + .05) / (values[0] + .05);
  };
  for (const theme of ['light', 'dark']) {
    const original = Object.freeze({
      theme, paper: theme === 'light' ? '#ffffff' : '#181818',
      text: theme === 'light' ? '#425661' : '#e8eeee',
      line: '#849095', secondary: '#667788', area: '#667788', accent: '#aabbcc',
    });
    assert.equal(withChartColormap(original, 'current'), original);
    const inks = new Set();
    for (const colormap of ['cividis', 'viridis', 'magma']) {
      const colors = withChartColormap(original, colormap);
      assert.deepEqual([colors.paper, colors.text, colors.theme], [original.paper, original.text, original.theme]);
      assert.ok(contrast(colors.line, colors.paper, .68) >= 4.5, `${colormap} ${theme} primary contrast`);
      assert.ok(contrast(colors.secondary, colors.paper, .64) >= 4.5, `${colormap} ${theme} secondary contrast`);
      inks.add(`${colors.line}/${colors.secondary}`);
    }
    assert.equal(inks.size, 3, `${theme} maps have distinct chart ink`);
  }
});

test('forward colormaps keep old paths and give colored contours their own preview identities', () => {
  const oldPath = '/cards/forward-prices/published/h100/price/h100/all/sage/dark/';
  assert.equal(publishedCardSharePath('forward-prices', input), oldPath);
  assert.equal(publishedCardSharePath('forward-prices', { ...input, colormap: 'current' }), oldPath);
  assert.equal(normalizeCardState('forward-prices', { colormap: 'unknown' }).colormap, 'current');
  const revisions = new Set();
  for (const { id } of FORWARD_COLORMAPS) {
    const state = { ...input, colormap: id };
    assert.equal(publishedCardSharePath('forward-prices', state), id === 'current' ? oldPath : `${oldPath}colormap-${id}/`);
    assert.ok(publishedCardPreviewPath('forward-prices', state, 'test').endsWith(id === 'current' ? '/sage-dark.png' : `/sage-dark--colormap-${id}.png`));
    assert.equal(supportsCatalogShareState('forward-prices', state), true);
    const artifact = renderCatalogShareArtifact('forward-prices', state, new Map([['forward-prices', payload]]));
    revisions.add(artifact.revision);
    assert.equal(new URL(artifact.destination).searchParams.get('colormap'), id);
    if (id === 'current') {
      const { colormap, ...legacyState } = artifact.state;
      const oldRevision = createHash('sha256').update(JSON.stringify({ renderer: 'catalog-share-v1', cardId: 'forward-prices', state: legacyState, sources: [['forward-prices', payload.revision]], svg: artifact.svg })).digest('hex').slice(0, 16);
      assert.equal(artifact.revision, oldRevision);
    }
  }
  assert.equal(revisions.size, FORWARD_COLORMAPS.length);
  const variants = catalogShareStates('forward-prices');
  assert.ok(variants.length > 0);
  assert.deepEqual(new Set(variants.map(state => state.colormap)), new Set(FORWARD_COLORMAPS.map(({ id }) => id)));
  assert.equal(supportsCatalogShareState('forward-prices', { ...input, range: 'now', colormap: 'magma' }), true);
});

test('every card preserves colors and accepts legacy saved views, pins and desk links', t => {
  const previous = globalThis.window;
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
  globalThis.window = { localStorage: storage };
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  const entries = CARD_REGISTRY.map(card => {
    const saved = saveCatalogItem({ cardId: card.id, name: card.title, state: { ...card.defaults, colormap: 'viridis' } });
    assert.equal(loadSavedCatalog(card.id)[0].state.colormap, 'viridis', card.id);
    assert.equal(normalizeCardState(card.id).colormap, 'current', card.id);
    assert.equal(normalizeCardState(card.id, { colormap: 'unknown' }).colormap, 'current', card.id);
    assert.equal(publishedCardSharePath(card.id, card.defaults), publishedCardSharePath(card.id, { ...card.defaults, colormap: 'current' }), card.id);
    assert.doesNotMatch(publishedCardSharePath(card.id, card.defaults), /colormap-/);
    assert.match(publishedCardSharePath(card.id, saved.state), /colormap-viridis\//);
    return { cardId: card.id, name: saved.name, state: saved.state };
  });
  const desk = createSharedDesk({ name: 'Color desk', entries }, { includePrivate: true });
  assert.deepEqual(decodeSharedDesk(encodeSharedDesk(desk)), desk);
  const legacy = structuredClone(desk);
  const removeLegacyFields = (cardId, state) => {
    delete state.colormap;
    if (cardId === 'gpu-hedge') delete state.side;
    if (cardId === 'equities') {
      delete state.style;
      state.range = 'all';
    }
  };
  for (const entry of legacy.entries) removeLegacyFields(entry.cardId, entry.state);
  const restored = decodeSharedDesk(rawToken(legacy));
  assert.equal(restored.entries.length, CARD_REGISTRY.length);
  assert.ok(restored.entries.every(entry => entry.state.colormap === 'current'));
  assert.equal(restored.entries.find(entry => entry.cardId === 'gpu-hedge').state.side, 'buyer');
  assert.equal(restored.entries.find(entry => entry.cardId === 'equities').state.style, 'lines');
  assert.equal(restored.entries.find(entry => entry.cardId === 'equities').state.range, '1y');
  const envelope = JSON.parse(storage.getItem('desk.catalog.v2'));
  for (const document of envelope.items) removeLegacyFields(document.cardId, document.visualization);
  storage.setItem('desk.catalog.v2', JSON.stringify(envelope));
  for (const card of CARD_REGISTRY) assert.equal(loadSavedCatalog(card.id)[0]?.state.colormap, 'current', card.id);
  storage.setItem(MARKET_WATCHLIST_STORAGE_KEY, JSON.stringify({ version: 1, items: legacy.entries.map(entry => ({
    id: `legacy-${entry.cardId}`, cardId: entry.cardId, label: entry.name, state: entry.state,
  })) }));
  const pins = createMarketWatchlist({ storage });
  assert.equal(pins.list().length, CARD_REGISTRY.length);
  assert.ok(pins.list().every(pin => pin.id === `legacy-${pin.cardId}` && pin.state.colormap === 'current'));
  saveSharedDeskCollection(desk);
  const collections = JSON.parse(storage.getItem(CATALOG_COLLECTIONS_STORAGE_KEY));
  for (const collection of collections.collections) for (const view of collection.views || []) removeLegacyFields(view.cardId, view.state);
  storage.setItem(CATALOG_COLLECTIONS_STORAGE_KEY, JSON.stringify(collections));
  const views = loadCatalogCollections().collections.find(collection => collection.views?.length)?.views;
  assert.equal(views?.length, CARD_REGISTRY.length);
  assert.ok(views.every(view => view.state.colormap === 'current'));
  for (const entry of legacy.entries) {
    entry.state.colormap = 'unknown';
    assert.throws(() => decodeSharedDesk(rawToken(legacy)), entry.cardId);
    delete entry.state.colormap;
  }
});

test('colored previews cover the registered catalog without replacing legacy preview identities', () => {
  const payloads = new Map(CARD_REGISTRY.map(card => {
    const source = CARD_REGISTRY.find(candidate => candidate.id === card.sourceCardId) || card;
    const data = JSON.parse(readFileSync(new URL(`../${source.dataFile}`, import.meta.url)));
    return [data.cardId, data];
  }));
  const legacyCounts = { equities: 1056, 'sandbox-cost': 144, 'quote-view': 16, 'deal-view': 8, 'forward-prices': 48, 'gpu-hedge': 48, 'gpu-lease': 8 };
  for (const cardId of CATALOG_SHARE_CARD_IDS) {
    const artifact = renderCatalogShareArtifact(cardId, {}, payloads);
    const { colormap, ...legacyState } = artifact.state;
    assert.equal(colormap, 'current');
    const sourceId = cardId === 'quote-view' ? 'deal-view' : cardId;
    const sources = [[sourceId, payloads.get(sourceId).revision]];
    const card = CARD_REGISTRY.find(card => card.id === cardId);
    if (cardId === 'equities' && artifact.state.layers.some(id => card.layers.find(layer => layer.id === id)?.sourceCardId === 'gpu-index')) {
      sources.push(['gpu-index', payloads.get('gpu-index').revision]);
    }
    const oldRevision = createHash('sha256').update(JSON.stringify({ renderer: 'catalog-share-v1', cardId, state: legacyState, sources, svg: artifact.svg })).digest('hex').slice(0, 16);
    assert.equal(artifact.revision, oldRevision, cardId);
    const variants = catalogShareStates(cardId);
    assert.equal(variants.length, legacyCounts[cardId] * FORWARD_COLORMAPS.length, cardId);
    assert.ok(variants.slice(0, legacyCounts[cardId]).every(state => state.colormap === 'current'), `${cardId} legacy inventory stays first`);
    assert.equal(new Set(variants.map(state => publishedCardSharePath(cardId, state))).size, variants.length, `${cardId} unique paths`);
    const revisions = new Set([artifact.revision]);
    const images = new Set([artifact.svg]);
    for (const colormap of ['cividis', 'viridis', 'magma']) {
      const state = { ...artifact.state, colormap };
      assert.equal(supportsCatalogShareState(cardId, state), true, cardId);
      assert.equal(variants.filter(state => state.colormap === colormap).length, legacyCounts[cardId], cardId);
      const colored = renderCatalogShareArtifact(cardId, state, payloads);
      revisions.add(colored.revision);
      images.add(colored.svg);
      assert.match(publishedCardSharePath(cardId, state), new RegExp(`[/~]colormap-${colormap}/$`));
      assert.match(publishedCardPreviewPath(cardId, state, colored.revision), new RegExp(`[-~]colormap-${colormap}\\.png$`));
      const restored = normalizeCardState(cardId, Object.fromEntries(new URL(colored.destination).searchParams));
      assert.equal(restored.colormap, colormap, `${cardId} share opens in its preview colors`);
      assert.deepEqual(restored, normalizeCardState(cardId, state), `${cardId} share restores the full composition`);
    }
    assert.equal(revisions.size, FORWARD_COLORMAPS.length, `${cardId} distinct content addresses`);
    assert.equal(images.size, FORWARD_COLORMAPS.length, `${cardId} distinct rendered colors`);
  }
  assert.equal(supportsCatalogShareState('gpu-hedge', { hours: 9999, colormap: 'viridis' }), false, 'unpublished custom terms still fall back to exact state links');
});

test('colormaps change contour fills with readable labels and leave curve rendering alone', () => {
  const luminance = color => {
    const value = rgb(color);
    const linear = channel => channel / 255 <= .04045 ? channel / 255 / 12.92 : ((channel / 255 + .055) / 1.055) ** 2.4;
    return .2126 * linear(value.r) + .7152 * linear(value.g) + .0722 * linear(value.b);
  };
  for (const theme of ['light', 'dark']) {
    const colors = { theme, paper: theme === 'light' ? '#ffffff' : '#181818', line: theme === 'light' ? '#849095' : '#d1d7d9', text: theme === 'light' ? '#425661' : '#e8eeee' };
    const current = renderForwardPricesSvg(createForwardPricesModel(payload, input), { colors });
    const curve = renderForwardPricesSvg(createForwardPricesModel(payload, { ...input, range: 'now' }), { colors });
    const geometry = svg => [...svg.matchAll(/<path\b[^>]*data-forward-line=""[^>]*d="([^"]+)"/g)].map(([, d]) => d);
    for (const { id } of FORWARD_COLORMAPS) {
      const model = createForwardPricesModel(payload, { ...input, colormap: id });
      const svg = renderForwardPricesSvg(model, { colors });
      assert.deepEqual(geometry(svg), geometry(current));
      assert.equal(renderForwardPricesSvg({ ...model, range: 'now' }, { colors }), curve);
      assert.doesNotMatch(svg, /NaN|Infinity/);
      assert.match(forwardColormapGradient(id, colors), /^linear-gradient\(90deg,/);
      if (id === 'current') { assert.equal(svg, current); continue; }
      assert.notEqual(svg, current);
      assert.ok(svg.includes(`fill="${forwardColormapColor(id, 0)}"`));
      const labels = [...svg.matchAll(/<text[^>]*fill="([^"]+)" stroke="([^"]+)"/g)];
      assert.ok(labels.length > 0);
      for (const [, ink, halo] of labels) {
        const values = [luminance(ink), luminance(halo)].sort((a, b) => a - b);
        assert.ok((values[1] + .05) / (values[0] + .05) >= 4.5, `${id} ${theme} chart text contrast`);
      }
    }
  }
});
