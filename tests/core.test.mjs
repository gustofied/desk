import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { CARD_REGISTRY, normalizeCardState } from '../src/card-registry.js';
import { loadSavedCatalog, saveCatalogItem, deleteCatalogItem } from '../src/saved-catalog.js';
import { createMarketWatchlist } from '../src/market-watchlist.js';
import { createSharedDesk, encodeSharedDesk, decodeSharedDesk } from '../src/shared-desk.js';
import { normalizePricePoints, alignIndexedPriceSeries } from '../src/price-series.js';
import { createForwardPricesModel } from '../src/forward-prices-model.js';
import { createDealViewModel, DEAL_041_PAYLOAD, JUNIPER_RESERVE_PAYLOAD } from '../src/deal-view-model.js';
import { createMonitorDataModel } from '../src/monitor-data-model.js';
import { forwardContours, nearestContour } from '../src/forward-contours.js';
import { renderCatalogShareArtifact } from '../scripts/catalog-share-artifacts.mjs';
import { renderForwardPricesSvg } from '../src/forward-prices-presentation.js';
import sharp from 'sharp';
import { immutablePreviewPath, isPublishedPreviewPath, mergePublishedPreviews } from '../scripts/published-preview-archive.mjs';

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}

test('every chart has bundled data and stable Light/Linen defaults', () => {
  for (const card of CARD_REGISTRY) {
    const state = normalizeCardState(card.id);
    assert.equal(state.theme, 'light', card.id);
    assert.equal(state.palette, 'linen', card.id);
    assert.deepEqual(normalizeCardState(card.id, state), state);
    assert.equal(normalizeCardState(card.id, { theme: 'dark' }).theme, 'dark');
    const source = CARD_REGISTRY.find(candidate => candidate.id === card.sourceCardId) ?? card;
    assert.ok(Object.keys(JSON.parse(readFileSync(new URL('../' + source.dataFile, import.meta.url)))).length, card.id);
  }
});

test('compute comparisons retain their layers and use percentage change', () => {
  const state = normalizeCardState('equities', { symbol: 'NVDA', layers: ['NVDA', 'H100', 'H200'], scale: 'price', range: '90d' });
  assert.deepEqual(state.layers, ['NVDA', 'H100', 'H200']);
  assert.equal(state.scale, 'index');
  assert.equal(state.range, '90d');
  assert.equal(normalizeCardState('sandbox-cost', { range: '7d' }).range, '7d');
  assert.equal(normalizeCardState('sandbox-cost', { range: 'now' }).range, 'now');
});

test('saved views persist, update in place and delete', t => {
  const previous = globalThis.window;
  globalThis.window = { localStorage: storage() };
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  const saved = saveCatalogItem({ cardId: 'gpu-index', name: 'My H200', state: { gpu: 'H200', range: '7d' } });
  assert.equal(loadSavedCatalog('gpu-index')[0].id, saved.id);
  saveCatalogItem({ cardId: 'gpu-index', itemId: saved.id, name: 'Renamed', state: { gpu: 'H200', range: 'all' } });
  const items = loadSavedCatalog('gpu-index');
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'Renamed');
  assert.equal(items[0].state.range, 'all');
  assert.equal(deleteCatalogItem({ cardId: 'gpu-index', itemId: saved.id }), true);
  assert.deepEqual(loadSavedCatalog('gpu-index'), []);
});

test('pins persist without duplicates and can be removed', () => {
  const local = storage();
  const list = createMarketWatchlist({ storage: local });
  const input = { cardId: 'gpu-index', state: { gpu: 'B200', range: 'all' }, label: 'B200 history' };
  const pinned = list.pin(input);
  assert.equal(list.pin(input).id, pinned.id);
  const reloaded = createMarketWatchlist({ storage: local });
  assert.equal(reloaded.list().filter(item => item.id === pinned.id).length, 1);
  reloaded.remove(pinned.id);
  assert.ok(!createMarketWatchlist({ storage: local }).list().some(item => item.id === pinned.id));
});

test('shared desks preserve chart order, names, settings and appearance', () => {
  const entries = CARD_REGISTRY.map(card => ({ cardId: card.id, name: card.title, state: normalizeCardState(card.id) }));
  const desk = createSharedDesk({ name: 'My desk', entries, palette: 'sage', theme: 'dark' }, { includePrivate: true });
  assert.deepEqual(decodeSharedDesk(encodeSharedDesk(desk)), desk);
  assert.deepEqual(desk.entries.map(entry => entry.cardId), entries.map(entry => entry.cardId));
});

test('sharing excludes private deal views by default and rejects broken links', () => {
  const desk = createSharedDesk({ name: 'Public', entries: ['gpu-index', 'quote-view', 'deal-view'].map(cardId => ({ cardId, name: cardId, state: {} })) });
  assert.deepEqual(desk.entries.map(entry => entry.cardId), ['gpu-index']);
  assert.throws(() => decodeSharedDesk('not-a-desk'));
});

test('deal names preserve authored titles while transaction ids remain stable', () => {
  const source = JSON.parse(readFileSync(new URL('../api/dashboard-snapshots/deal-041.json', import.meta.url)));
  const deal = createDealViewModel(JUNIPER_RESERVE_PAYLOAD);
  assert.equal(source.id, 'JNP-256');
  assert.equal(source.label, 'Juniper reserve');
  assert.equal(deal.id, source.id);
  assert.equal(deal.label, source.label);
  assert.equal(DEAL_041_PAYLOAD, JUNIPER_RESERVE_PAYLOAD, 'legacy imports remain supported');
  for (const kind of ['deal', 'quote']) {
    const authored = createDealViewModel(JUNIPER_RESERVE_PAYLOAD, { kind, viewName: '  Training reserve  ' });
    assert.equal(authored.label, 'Training reserve');
    assert.equal(authored.id, 'JNP-256');
  }
  assert.equal(createDealViewModel(JUNIPER_RESERVE_PAYLOAD, { kind: 'quote' }).label, 'Quote B200');
  assert.equal(createDealViewModel(JUNIPER_RESERVE_PAYLOAD, { viewName: '  ' }).label, 'Juniper reserve');
  const legacy = createDealViewModel({ ...JUNIPER_RESERVE_PAYLOAD, id: '041', label: undefined });
  assert.equal(legacy.id, '041');
  assert.equal(legacy.label, 'Deal 041');
});

test('private card details update current terms without exposing activity or data access', () => {
  const payload = JSON.parse(readFileSync(new URL('../data/deal-041.json', import.meta.url)));
  for (const cardId of ['quote-view', 'deal-view']) {
    const card = CARD_REGISTRY.find(candidate => candidate.id === cardId);
    const cardState = normalizeCardState(cardId);
    const dealModel = createDealViewModel(payload, { kind: card.viewKind });
    const details = model => createMonitorDataModel({ card, cardState, dealModel: model });
    const original = details(dealModel);
    const fields = Object.fromEntries(original.detailFields);
    assert.equal(original.railLabel, 'Details');
    assert.equal(original.label, dealModel.label);
    assert.equal(original.accessKind, 'source');
    assert.ok(original.detailDescription);
    assert.equal(fields.Capacity, '256 B200 GPUs');
    assert.equal(fields.Rate, '$3.65 / GPU hour');
    assert.equal(fields.Location, 'US East · InfiniBand');
    assert.equal(fields['Ready for service'], 'OCT 2026');
    assert.equal(fields.Prepayment, '20%');
    assert.equal(fields.Contract, cardId === 'deal-view' ? dealModel.contractStatusLabel : undefined);
    assert.equal(fields['Deal ID'], cardId === 'deal-view' ? dealModel.id : undefined);
    for (const key of ['sourceUrl', 'endpoint', 'command', 'sql', 'eventLog', 'quoteHistory', 'workflowStatus', 'nextAction']) {
      assert.equal(original[key], undefined, `${cardId} excludes ${key}`);
    }
    assert.equal(original.source, null);
    const renamed = details({ ...dealModel, label: 'Reserved training capacity' });
    assert.equal(renamed.label, 'Reserved training capacity');
    assert.notEqual(renamed.key, original.key, 'renaming refreshes the disclosure');
    const revised = details(createDealViewModel(payload, {
      kind: card.viewKind,
      overrides: { gpu: 'H200', quantity: 512, quote: 2.85, rfs: '2027-02' },
    }));
    const revisedFields = Object.fromEntries(revised.detailFields);
    assert.equal(revisedFields.Capacity, '512 H200 GPUs');
    assert.equal(revisedFields.Rate, '$2.85 / GPU hour');
    assert.equal(revisedFields['Ready for service'], 'FEB 2027');
    assert.notEqual(revised.key, original.key, 'edited terms refresh the disclosure');
    assert.notEqual(details({ ...dealModel, region: 'US West' }).key, original.key, 'detail fields alone refresh the disclosure');
    if (cardId === 'quote-view') {
      assert.match(original.summary, /Rate agreed/);
      const privateWorkflow = details({ ...dealModel, statusLabel: 'Hidden workflow status', contractStatusLabel: 'Hidden contract status',
        eventLog: [{ label: 'Hidden activity' }], nextAction: 'Hidden next action' });
      assert.equal(privateWorkflow.key, original.key, 'Quote ignores Deal workflow and event changes');
      assert.doesNotMatch(JSON.stringify(privateWorkflow), /Hidden|Terms review|Review service terms/);
    }
  }
});

test('comparison lines start on the same date and baseline', () => {
  const first = { rows: normalizePricePoints([[100, 10], [200, 20], [300, 40]], 'A') };
  const second = { rows: normalizePricePoints([[200, 100], [300, 150]], 'B') };
  const aligned = alignIndexedPriceSeries([first, second]);
  assert.deepEqual(aligned.map(series => series.rows.map(row => [+row.date, row.plotValue])), [
    [[200000, 100], [300000, 200]], [[200000, 100], [300000, 150]],
  ]);
  assert.equal(first.rows.length, 3);
});

test('the homepage has no default social preview image', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/i);
});

test('published previews survive clean deployments without replacing historical images', async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'desk-preview-test-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const archiveRoot = join(scratch, 'archive');
  const firstSite = join(scratch, 'first');
  const nextSite = join(scratch, 'next');
  const base = '/assets/social/forward-prices/published/v17/example/h200/price/h200/all/sage-light.png';
  const oldBytes = Buffer.from('original published image');
  const newBytes = Buffer.from('updated published image');
  const oldImage = immutablePreviewPath(base, oldBytes).slice(1);
  const newImage = immutablePreviewPath(base, newBytes).slice(1);
  const page = 'cards/forward-prices/published/h200/price/h200/all/sage/light/index.html';
  const retiredPage = page.replace('/sage/', '/linen/');
  const put = async (root, file, content) => {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), content);
  };
  assert.notEqual(oldImage, newImage, 'new image bytes get a new pathname, not just a query string');
  assert.equal(immutablePreviewPath(base, oldBytes), `/${oldImage}`);
  for (const file of [oldImage, newImage, page, retiredPage,
    'assets/social/gpu-market-depth/published/v14/old/h100/sage-light.png']) assert.equal(isPublishedPreviewPath(file), true);
  for (const file of ['data/equities-source.json', 'assets/social/default.png', 'cards/private/index.html',
    oldImage.replace('/example/', '/../'), oldImage.replace('/example/', '/%2e%2e/'), oldImage.replace('/example/', '/%2f/')]) {
    assert.equal(isPublishedPreviewPath(file), false, file);
  }
  await put(firstSite, oldImage, oldBytes);
  await put(firstSite, page, 'original page');
  await put(firstSite, retiredPage, 'retired page');
  await mergePublishedPreviews({ siteRoot: firstSite, archiveRoot });
  await put(nextSite, newImage, newBytes);
  await put(nextSite, page, 'current page');
  await put(nextSite, 'data/private.json', 'not a preview');
  const result = await mergePublishedPreviews({ siteRoot: nextSite, archiveRoot });
  assert.equal(result.restored, 2, 'a clean checkout regains both old image and retired page');
  assert.deepEqual(await readFile(join(nextSite, oldImage)), oldBytes);
  assert.equal(await readFile(join(nextSite, page), 'utf8'), 'current page');
  assert.equal(await readFile(join(archiveRoot, page), 'utf8'), 'current page');
  await assert.rejects(readFile(join(archiveRoot, 'data/private.json')), { code: 'ENOENT' });
  await put(nextSite, oldImage, 'changed at an old address');
  await assert.rejects(mergePublishedPreviews({ siteRoot: nextSite, archiveRoot }), /immutable path/);
  assert.deepEqual(await readFile(join(archiveRoot, oldImage)), oldBytes);
  await put(nextSite, oldImage, oldBytes);
  await symlink(join(scratch, 'outside'), join(archiveRoot, 'unsafe'));
  await assert.rejects(mergePublishedPreviews({ siteRoot: nextSite, archiveRoot }), /symlink/);
});

test('forward curves and contours share valid quotes and render both modes', async () => {
  const islands = forwardContours([[0,0,0,0,0], [0,2,0,2,0], [0,0,0,0,0]], [1], p => p, [0,0,5,3])[0];
  assert.equal(islands.paths.length, 2, 'separate peaks retain separate closed contours');
  for (const path of islands.paths) {
    assert.deepEqual(path.points[0], path.points.at(-1));
    for (const point of path.points) assert.ok(islands.coordinates.flat(2).includes(point));
  }
  assert.deepEqual(nearestContour([{ key: 1, points: [[0,0],[10,0]] }], { x: 5, y: 2 }), { key: 1, distance: 2, position: { x: 5, y: 0 } });
  const payload = JSON.parse(readFileSync(new URL('../data/forward-prices.json', import.meta.url)));
  for (const gpu of Object.keys(payload.surfaces)) {
    const model = createForwardPricesModel(payload, { gpu });
    assert.equal(model.structure, 'Contango');
    assert.ok(model.deliveries[0] > model.asOf);
    for (const range of ['now', 'all']) {
      const colors = { theme: 'light', paper: '#ffffff', line: '#849095', text: '#425661' };
      const themed = renderForwardPricesSvg({ ...model, range }, { colors, gallery: true });
      const strokes = [...themed.matchAll(/data-forward-line=""[^>]*stroke="([^"]+)"/g)];
      assert.ok(strokes.length > 0 && strokes.every(([, stroke]) => stroke === colors.line));
      assert.match(themed, /data-view-artifact-header/);
      assert.doesNotMatch(themed, /#181818/);
      const artifact = renderCatalogShareArtifact('forward-prices', { gpu, range }, new Map([['forward-prices', payload]]));
      assert.match(artifact.svg, /data-forward-line/);
      assert.match(artifact.svg, /data-view-artifact-header/);
      assert.doesNotMatch(artifact.svg, /translate\(40 0\)|data-forward-date=/);
      assert.match(artifact.svg, /viewBox="0 0 1200 630"/);
      if (range === 'now') assert.match(artifact.svg, /data-forward-area/);
      else assert.match(artifact.svg, /data-forward-series=/);
      assert.doesNotMatch(artifact.svg, /NaN|Infinity/);
      assert.ok((await sharp(Buffer.from(artifact.svg)).png().toBuffer()).length > 0);
    }
  }
  assert.throws(() => createForwardPricesModel({ ...payload, surfaces: { H100: [[null]] } }));
});
