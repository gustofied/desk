import assert from "node:assert/strict";
import test from "node:test";
import {
  CATALOG_COLLECTIONS_STORAGE_KEY, addCatalogCollectionKey, deleteCatalogCollection,
  loadCatalogCollections, removeCatalogKeyFromCollections, renameCatalogCollection,
  replaceCatalogCollectionKeys, saveSharedDeskCollection, toggleCatalogCollectionKey,
} from "../src/catalog-collections.js";
import { normalizeCardVisualization } from "../src/card-document.js";
import { SAVED_CATALOG_STORAGE_KEY } from "../src/saved-catalog.js";

const DATE = "2026-09-06T12:00:00.000Z";
const EQUITIES_KEYS = ["MSFT", "AMZN", "GOOGL", "ORCL", "CRWV", "NBIS", "NVDA", "AMD", "TSM"]
  .map(ticker => `preset-equities-${ticker.toLowerCase()}`);
const POWER_KEYS = ["pjm-dominion", "ercot-north", "gpu-energy"]
  .map(id => `preset-power-basis-${id}`);
const STATES = {
  "gpu-index": { gpu: "H100", layers: ["H100", "H200"], range: "1d", scale: "spread" },
  "gpu-price-snapshot": { gpu: "B200", layers: ["H100", "B200"] },
  "gpu-market-depth": { target: "256", scale: "history" },
  "power-basis": { location: "PJM-WEST", scale: "basis", range: "7d" },
  "quote-view": { gpu: "H200", quantity: 64, quote: 4.25, rfs: "2027-02" },
  "deal-view": { gpu: "B300", quantity: 512, quote: 7.5, rfs: "2028-06" },
};
function snapshot(name = "Shared Desk") {
  return {
    name, palette: "linen", theme: "light",
    entries: Object.entries(STATES).map(([cardId, state], index) => ({
      cardId, name: `View ${index + 1}`, state: normalizeCardVisualization(cardId, state),
    })),
  };
}
function collection(id = "existing", name = "Existing") {
  return { id, name, keys: ["preset-existing-view"], createdAt: DATE, updatedAt: DATE };
}
function envelope(collections = [collection()], version = 8, activeId = collections[0]?.id ?? "all") {
  return { version, collections, activeId };
}
function harness(t, initial = envelope()) {
  const savedSentinel = '{"saved":"leave this store untouched"}';
  const values = new Map([[SAVED_CATALOG_STORAGE_KEY, savedSentinel]]);
  if (initial !== null) values.set(CATALOG_COLLECTIONS_STORAGE_KEY, typeof initial === "string" ? initial : JSON.stringify(initial));
  const storage = {
    writes: [], readError: null, writeError: null,
    getItem(key) {
      if (this.readError) throw this.readError;
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      if (this.writeError) throw this.writeError;
      this.writes.push({ key, value });
      values.set(key, value);
    },
  };
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const window = { localStorage: storage, crypto: { randomUUID: () => "fixed-random-id" } };
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: window });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "window", original);
    else delete globalThis.window;
  });
  t.mock.method(console, "error", () => {});
  return {
    storage, values, window, savedSentinel,
    raw: () => values.get(CATALOG_COLLECTIONS_STORAGE_KEY),
    stored: () => JSON.parse(values.get(CATALOG_COLLECTIONS_STORAGE_KEY)),
  };
}
function assertSaveBlocked(h, input = snapshot()) {
  const before = h.raw();
  const writes = h.storage.writes.length;
  const copy = structuredClone(input);
  assert.throws(() => saveSharedDeskCollection(input));
  assert.equal(h.raw(), before);
  assert.equal(h.storage.writes.length, writes);
  assert.deepEqual(input, copy);
  assert.equal(h.values.get(SAVED_CATALOG_STORAGE_KEY), h.savedSentinel);
}

test("shared saving embeds all six families in order with a single atomic collection-store write", t => {
  const h = harness(t);
  const input = snapshot();
  const result = saveSharedDeskCollection(input);
  assert.equal(result.version, 8);
  assert.equal(result.activeId, "existing");
  assert.deepEqual(result.collections[0], collection());
  const added = result.collections.at(-1);
  assert.equal(added.name, input.name);
  assert.equal(added.palette, "linen");
  assert.equal(added.theme, "light");
  assert.deepEqual(added.keys, added.views.map(view => view.key));
  assert.equal(new Set(added.keys).size, 6);
  assert.deepEqual(added.views.map(view => view.cardId), Object.keys(STATES));
  for (const [index, view] of added.views.entries()) {
    assert.equal(view.name, input.entries[index].name);
    assert.deepEqual(view.state, normalizeCardVisualization(view.cardId, input.entries[index].state));
  }
  assert.equal(added.views[0].state.scale, "spread");
  assert.equal(added.views[2].state.target, "256");
  assert.equal(added.views[2].state.scale, "history");
  assert.equal(added.views[3].state.location, "PJM-WEST");
  assert.equal(added.views[3].state.scale, "basis");
  assert.equal(added.views[4].state.quantity, 64);
  assert.equal(added.views[5].state.quote, 7.5);
  assert.equal(h.storage.writes.length, 1);
  assert.equal(h.storage.writes[0].key, CATALOG_COLLECTIONS_STORAGE_KEY);
  assert.equal(h.values.get(SAVED_CATALOG_STORAGE_KEY), h.savedSentinel);
  assert.deepEqual(h.stored().collections, result.collections);
});

test("saving to absent storage seeds starter collections and the shared collection in one write", t => {
  const h = harness(t, null);
  const result = saveSharedDeskCollection(snapshot());
  assert.deepEqual(result.collections.slice(0, 5).map(item => item.id), ["overview", "hedge", "private", "equities", "power"]);
  assert.equal(result.collections.length, 6);
  assert.equal(h.storage.writes.length, 1);
  assert.equal(h.stored().version, 8);
});

test("repeated normalized names receive unique suffixes without exceeding 48 characters", t => {
  harness(t);
  const first = saveSharedDeskCollection(snapshot("  Research   Desk  ")).collections.at(-1);
  const second = saveSharedDeskCollection(snapshot("Research Desk")).collections.at(-1);
  const third = saveSharedDeskCollection(snapshot("Research Desk")).collections.at(-1);
  assert.equal(first.name, "Research Desk");
  assert.equal(second.name, "Research Desk (2)");
  assert.equal(third.name, "Research Desk (3)");
  const longName = "x".repeat(48);
  assert.equal(saveSharedDeskCollection(snapshot(longName)).collections.at(-1).name, longName);
  const repeated = saveSharedDeskCollection(snapshot(longName)).collections.at(-1).name;
  assert.equal(repeated.length, 48);
  assert.ok(repeated.endsWith(" (2)"));
});

test("colliding random IDs still produce fresh collection IDs and disjoint embedded keys", t => {
  harness(t);
  const first = saveSharedDeskCollection(snapshot()).collections.at(-1);
  const second = saveSharedDeskCollection(snapshot()).collections.at(-1);
  assert.notEqual(first.id, second.id);
  assert.match(first.id, /^[a-zA-Z0-9_-]{1,96}$/);
  assert.match(second.id, /^[a-zA-Z0-9_-]{1,96}$/);
  assert.ok(second.keys.every(key => !first.keys.includes(key)));
});

test("input and returned embedded state are deep copies independent of persisted snapshots", t => {
  const h = harness(t);
  const input = snapshot();
  const expected = structuredClone(input);
  const result = saveSharedDeskCollection(input);
  assert.deepEqual(input, expected);
  const stored = h.raw();
  input.entries[0].state.layers.push("B300");
  input.entries[4].state.quantity = 4096;
  const saved = result.collections.at(-1);
  saved.views[0].state.layers.push("B200");
  saved.views[4].state.quantity = 8;
  assert.equal(h.raw(), stored);
  const reloaded = loadCatalogCollections().collections.at(-1);
  assert.deepEqual(reloaded.views[0].state.layers, ["H100", "H200"]);
  assert.equal(reloaded.views[4].state.quantity, 64);
  reloaded.views[0].state.layers.length = 0;
  assert.equal(loadCatalogCollections().collections.at(-1).views[0].state.layers.length, 2);
});

test("versioned shared snapshots retain private quote/deal entries and collection appearance", t => {
  const h = harness(t);
  const input = { version: 1, ...snapshot() };
  input.entries = input.entries.filter(item => ["quote-view", "deal-view"].includes(item.cardId));
  const saved = saveSharedDeskCollection(input).collections.at(-1);
  assert.deepEqual(saved.views.map(item => item.cardId), ["quote-view", "deal-view"]);
  const loaded = loadCatalogCollections().collections.at(-1);
  assert.deepEqual(loaded, saved);
  assert.equal(h.storage.writes.length, 1, "reading current schema does not write again");
});

test("renaming and deleting shared collections preserve embedded states and existing collections", t => {
  const h = harness(t);
  const saved = saveSharedDeskCollection(snapshot()).collections.at(-1);
  const renamed = renameCatalogCollection(saved.id, "New shared name").collections.at(-1);
  assert.equal(renamed.name, "New shared name");
  assert.deepEqual(renamed.views, saved.views);
  assert.deepEqual(renamed.keys, saved.keys);
  assert.equal(renamed.palette, saved.palette);
  assert.equal(renamed.theme, saved.theme);
  const raw = h.stored();
  raw.activeId = saved.id;
  h.values.set(CATALOG_COLLECTIONS_STORAGE_KEY, JSON.stringify(raw));
  const deleted = deleteCatalogCollection(saved.id);
  assert.equal(deleted.activeId, "all");
  assert.deepEqual(deleted.collections, [collection()]);
  assert.deepEqual(loadCatalogCollections().collections, [collection()]);
});

test("removing selected keys retains embedded definitions so views can be re-added", t => {
  harness(t);
  const saved = saveSharedDeskCollection(snapshot()).collections.at(-1);
  const [firstKey, secondKey] = saved.keys;
  const find = state => state.collections.find(item => item.id === saved.id);
  let current = find(toggleCatalogCollectionKey(saved.id, firstKey));
  assert.ok(!current.keys.includes(firstKey));
  assert.deepEqual(current.views, saved.views);
  current = find(addCatalogCollectionKey(saved.id, firstKey));
  assert.ok(current.keys.includes(firstKey));
  assert.deepEqual(current.views, saved.views);
  current = find(replaceCatalogCollectionKeys(saved.id, [secondKey]));
  assert.deepEqual(current.keys, [secondKey]);
  assert.deepEqual(current.views, saved.views);
  current = find(removeCatalogKeyFromCollections(secondKey));
  assert.deepEqual(current.keys, []);
  assert.deepEqual(current.views, saved.views);
  current = find(addCatalogCollectionKey(saved.id, secondKey));
  assert.deepEqual(current.keys, [secondKey]);
});

test("v5 migration adds only Equities and Power and never recreates removed older starters", t => {
  const existing = collection("custom", "Only custom");
  const h = harness(t, envelope([existing], 5, "custom"));
  const result = loadCatalogCollections();
  assert.equal(result.version, 8);
  assert.equal(result.activeId, "custom");
  assert.deepEqual(result.collections[0], existing);
  assert.deepEqual(result.collections.map(item => item.id), ["custom", "equities", "power"]);
  assert.equal(result.collections[1].name, "Equities");
  assert.deepEqual(result.collections[1].keys, EQUITIES_KEYS);
  assert.deepEqual(result.collections[2].keys, POWER_KEYS);
  assert.equal(h.storage.writes.length, 1);
  assert.deepEqual(h.stored(), envelope(result.collections, 8, "custom"));
  loadCatalogCollections();
  assert.equal(h.storage.writes.length, 1);
});

test("an empty v5 list receives only Equities and Power without recreating older starters", t => {
  const h = harness(t, envelope([], 5, "all"));
  const result = loadCatalogCollections();
  assert.deepEqual(result.collections.map(item => item.id), ["equities", "power"]);
  assert.deepEqual(result.collections[0].keys, EQUITIES_KEYS);
  assert.deepEqual(h.stored(), envelope(result.collections, 8, "all"));
  assert.equal(h.storage.writes.length, 1);
});

test("versions 1–4 preserve legacy starter-addition behavior during migration", t => {
  const h = harness(t);
  for (const version of [1, 2, 3, 4]) {
    h.values.set(CATALOG_COLLECTIONS_STORAGE_KEY, JSON.stringify(envelope([collection()], version)));
    const beforeWrites = h.storage.writes.length;
    const result = loadCatalogCollections();
    const additions = version === 4 ? [] : version === 2 ? ["overview", "hedge"] : ["overview", "hedge", "private"];
    assert.deepEqual(result.collections.map(item => item.id), ["existing", ...additions, "equities", "power"]);
    assert.deepEqual(result.collections[0], collection());
    assert.equal(result.version, 8);
    assert.equal(h.storage.writes.length, beforeWrites + 1);
  }
});

test("saving into v5 migrates and adds atomically without an intermediate write", t => {
  const h = harness(t, envelope([collection()], 5));
  const result = saveSharedDeskCollection(snapshot());
  assert.equal(result.collections.length, 4);
  assert.deepEqual(result.collections[0], collection());
  assert.equal(h.storage.writes.length, 1);
  assert.equal(h.stored().version, 8);
});

test("invalid stored embedded definitions reject the whole store without writing repairs", t => {
  const h = harness(t);
  saveSharedDeskCollection(snapshot());
  const valid = h.stored();
  for (const corrupt of [
    view => { delete view.state.range; },
    view => { view.state.layers = ["H100", "H100"]; },
    view => { view.state.gpu = "h100"; },
    view => { view.state.extra = "unknown"; },
    view => { view.state = null; },
    view => { view.state.layers = [{ gpu: "H100" }]; },
    view => { view.cardId = "unknown"; },
    view => { view.name = ""; },
    view => { view.key = "invalid key"; },
  ]) {
    const broken = structuredClone(valid);
    corrupt(broken.collections.at(-1).views[0]);
    h.values.set(CATALOG_COLLECTIONS_STORAGE_KEY, JSON.stringify(broken));
    assertSaveBlocked(h);
    const writes = h.storage.writes.length;
    assert.equal(loadCatalogCollections().unavailable, true);
    assert.equal(h.storage.writes.length, writes);
  }
  const duplicate = structuredClone(valid);
  duplicate.collections.at(-1).views[1].key = duplicate.collections.at(-1).views[0].key;
  h.values.set(CATALOG_COLLECTIONS_STORAGE_KEY, JSON.stringify(duplicate));
  assertSaveBlocked(h);
});

test("corrupt JSON and unsupported versions block saves without modifying either store", t => {
  const h = harness(t);
  for (const raw of ["broken JSON", "null", "[]", JSON.stringify(envelope([], 99)), JSON.stringify({ version: 8, collections: {} })]) {
    h.values.set(CATALOG_COLLECTIONS_STORAGE_KEY, raw);
    assertSaveBlocked(h);
    const writes = h.storage.writes.length;
    assert.equal(loadCatalogCollections().unavailable, true);
    assert.equal(h.storage.writes.length, writes);
  }
});

test("quota failures preserve existing collection bytes, input state, and saved-view storage", t => {
  const h = harness(t);
  const loaded = loadCatalogCollections();
  const before = structuredClone(loaded);
  h.storage.writeError = Error("quota exceeded");
  assertSaveBlocked(h);
  assert.deepEqual(loaded, before);
  h.storage.writeError = null;
  assert.equal(saveSharedDeskCollection(snapshot()).collections.length, 2);
  assert.equal(h.storage.writes.length, 1);
});

test("denied storage getters and read failures expose unavailability without mutations", t => {
  const h = harness(t);
  h.storage.readError = Error("getItem denied");
  assertSaveBlocked(h);
  assert.equal(loadCatalogCollections().unavailable, true);
  h.storage.readError = null;
  Object.defineProperty(h.window, "localStorage", { configurable: true, get() { throw Error("storage getter denied"); } });
  assertSaveBlocked(h);
  assert.equal(loadCatalogCollections().unavailable, true);
  assert.equal(h.storage.writes.length, 0);
});

test("the collection limit allows the sixteenth collection and rejects the seventeenth atomically", t => {
  const initial = Array.from({ length: 15 }, (_, index) => collection(`existing-${index}`, `Existing ${index}`));
  const h = harness(t, envelope(initial));
  const result = saveSharedDeskCollection(snapshot());
  assert.equal(result.collections.length, 16);
  assert.deepEqual(result.collections.slice(0, 15), initial);
  assertSaveBlocked(h);
  assert.equal(h.storage.writes.length, 1);
});

test("shared snapshots accept 32 embedded views and reject 33 before any write", t => {
  const h = harness(t);
  const input = snapshot();
  input.entries = Array.from({ length: 32 }, (_, index) => ({
    cardId: "quote-view", name: `Quote ${index}`, state: normalizeCardVisualization("quote-view", { quantity: index + 8 }),
  }));
  const saved = saveSharedDeskCollection(input).collections.at(-1);
  assert.equal(saved.views.length, 32);
  assert.deepEqual(saved.keys, saved.views.map(view => view.key));
  input.entries.push({ cardId: "quote-view", name: "Overflow", state: { quantity: 100 } });
  assertSaveBlocked(h, input);
  assert.equal(h.storage.writes.length, 1);
});

test("optional per-view appearance survives loading and renaming a shared collection", t => {
  const h = harness(t);
  const saved = saveSharedDeskCollection(snapshot()).collections.at(-1);
  const stored = h.stored();
  const view = stored.collections.at(-1).views[0];
  view.palette = "linen";
  view.theme = "light";
  h.values.set(CATALOG_COLLECTIONS_STORAGE_KEY, JSON.stringify(stored));
  const loaded = loadCatalogCollections().collections.at(-1);
  assert.equal(loaded.views[0].palette, "linen");
  assert.equal(loaded.views[0].theme, "light");
  const renamed = renameCatalogCollection(saved.id, "Appearance retained").collections.at(-1);
  assert.deepEqual(renamed.views, loaded.views);
  assert.deepEqual(h.stored().collections.at(-1).views, loaded.views);
});

test("conflicting definitions for the same embedded key across collections invalidate the store", t => {
  const h = harness(t);
  saveSharedDeskCollection(snapshot("First"));
  saveSharedDeskCollection(snapshot("Second"));
  const stored = h.stored();
  stored.collections[2].views[0].key = stored.collections[1].views[0].key;
  stored.collections[2].views[0].name = "Conflicting view definition";
  stored.collections[2].keys[0] = stored.collections[1].views[0].key;
  h.values.set(CATALOG_COLLECTIONS_STORAGE_KEY, JSON.stringify(stored));
  assertSaveBlocked(h);
  const beforeWrites = h.storage.writes.length;
  assert.equal(loadCatalogCollections().unavailable, true);
  assert.equal(h.storage.writes.length, beforeWrites);
});

test("a planned embedded key colliding with an ordinary selected key forces a fresh collection ID", t => {
  const plannedId = "catalog-fixed-random-id";
  const collidingKey = `desk-${plannedId}-0`;
  const existing = { ...collection(), keys: [collidingKey] };
  const h = harness(t, envelope([existing]));
  const result = saveSharedDeskCollection(snapshot());
  const saved = result.collections.at(-1);
  assert.notEqual(saved.id, plannedId);
  assert.ok(!saved.keys.includes(collidingKey));
  assert.deepEqual(result.collections[0], existing);
  assert.equal(h.storage.writes.length, 1);
});

test("read-only loading absent storage returns starters without persisting a seed", t => {
  const h = harness(t, null);
  const result = loadCatalogCollections({ readOnly: true });
  assert.equal(result.version, 8);
  assert.equal(result.unavailable, false);
  assert.deepEqual(result.collections.map(item => item.id), ["overview", "hedge", "private", "equities", "power"]);
  assert.equal(h.raw(), undefined);
  assert.equal(h.storage.writes.length, 0);
  assert.equal(h.values.get(SAVED_CATALOG_STORAGE_KEY), h.savedSentinel);
  const saved = saveSharedDeskCollection(snapshot());
  assert.equal(saved.collections.length, 6);
  assert.equal(h.storage.writes.length, 1, "explicit copying still seeds and saves atomically");
});

test("read-only loading migrates v5 and v6 in memory without writes or recreating older starters", t => {
  const existing = collection("custom", "Only custom");
  const h = harness(t);
  for (const version of [5, 6]) {
    h.values.set(CATALOG_COLLECTIONS_STORAGE_KEY, JSON.stringify(envelope([existing], version, "custom")));
    const before = h.raw();
    const writes = h.storage.writes.length;
    const result = loadCatalogCollections({ readOnly: true });
    assert.equal(result.version, 8);
    assert.equal(result.activeId, "custom");
    assert.deepEqual(result.collections[0], existing);
    assert.deepEqual(result.collections.map(item => item.id), ["custom", "equities", "power"]);
    assert.deepEqual(result.collections[1].keys, EQUITIES_KEYS);
    assert.equal(h.raw(), before);
    assert.equal(h.storage.writes.length, writes);
    loadCatalogCollections();
    assert.equal(h.stored().version, 8, "ordinary loads still persist migration");
    assert.equal(h.storage.writes.length, writes + 1);
  }
});

test("read-only loading invalid or inaccessible storage safely reports unavailable without repairs", t => {
  const h = harness(t);
  for (const raw of ["broken JSON", JSON.stringify(envelope([], 99)), JSON.stringify({ version: 8, collections: {} })]) {
    h.values.set(CATALOG_COLLECTIONS_STORAGE_KEY, raw);
    const result = loadCatalogCollections({ readOnly: true });
    assert.equal(result.unavailable, true);
    assert.deepEqual(result.collections, []);
    assert.equal(h.raw(), raw);
    assert.equal(h.storage.writes.length, 0);
  }
  h.storage.readError = Error("getItem denied");
  assert.equal(loadCatalogCollections({ readOnly: true }).unavailable, true);
  assert.equal(h.storage.writes.length, 0);
  Object.defineProperty(h.window, "localStorage", { configurable: true, get() { throw Error("storage getter denied"); } });
  assert.equal(loadCatalogCollections({ readOnly: true }).unavailable, true);
  assert.equal(h.storage.writes.length, 0);
});

const selectionMethods = [
  ["add", (id, key) => addCatalogCollectionKey(id, key)],
  ["toggle on", (id, key) => toggleCatalogCollectionKey(id, key)],
  ["replace", (id, key) => replaceCatalogCollectionKeys(id, [key])],
];

for (const [name, select] of selectionMethods) {
  test(`${name} copies an independent embedded definition that survives deleting its original owner`, t => {
    const h = harness(t);
    const input = snapshot();
    const originalInput = structuredClone(input);
    const savedState = saveSharedDeskCollection(input);
    const owner = savedState.collections.at(-1);
    const definition = structuredClone(owner.views[0]);
    const beforeWrites = h.storage.writes.length;
    const result = select("existing", definition.key);
    const recipient = result.collections.find(item => item.id === "existing");
    const source = result.collections.find(item => item.id === owner.id);
    assert.ok(recipient.keys.includes(definition.key));
    assert.deepEqual(recipient.views, [definition]);
    assert.deepEqual(source.views, owner.views);
    assert.notEqual(recipient.views[0], source.views[0]);
    assert.notEqual(recipient.views[0].state, source.views[0].state);
    assert.notEqual(recipient.views[0].state.layers, source.views[0].state.layers);
    assert.equal(h.storage.writes.length, beforeWrites + 1);
    assert.equal(loadCatalogCollections().unavailable, false, "identical definitions across collections are valid");

    recipient.views[0].state.layers.push("B300");
    recipient.views[0].name = "Mutated return value";
    assert.deepEqual(source.views[0], definition);
    assert.deepEqual(owner.views[0], definition);
    assert.deepEqual(input, originalInput);
    const beforeDelete = loadCatalogCollections().collections.find(item => item.id === "existing");
    assert.deepEqual(beforeDelete.views, [definition]);
    deleteCatalogCollection(owner.id);
    const reloaded = loadCatalogCollections();
    assert.equal(reloaded.unavailable, false);
    assert.ok(reloaded.collections.every(item => item.id !== owner.id));
    assert.deepEqual(reloaded.collections.find(item => item.id === "existing").views, [definition]);
    assert.equal(h.values.get(SAVED_CATALOG_STORAGE_KEY), h.savedSentinel);
  });
}

test("ordinary keys without embedded definitions do not invent recipient view snapshots", t => {
  const h = harness(t);
  for (const [name, select] of selectionMethods) {
    h.values.set(CATALOG_COLLECTIONS_STORAGE_KEY, JSON.stringify(envelope()));
    const result = select("existing", `ordinary-${name.replaceAll(" ", "-")}`);
    const recipient = result.collections[0];
    assert.deepEqual(recipient.views ?? [], []);
    assert.equal(loadCatalogCollections().unavailable, false);
  }
});

test("copying a thirty-third embedded definition through any selection API fails atomically", t => {
  const h = harness(t);
  const input = snapshot("Full recipient");
  input.entries = Array.from({ length: 32 }, (_, index) => ({
    cardId: "quote-view", name: `Existing quote ${index}`,
    state: normalizeCardVisualization("quote-view", { quantity: index + 8 }),
  }));
  const recipient = saveSharedDeskCollection(input).collections.at(-1);
  const owner = saveSharedDeskCollection(snapshot("Other owner")).collections.at(-1);
  const before = h.raw();
  const beforeWrites = h.storage.writes.length;
  for (const [, select] of selectionMethods) {
    assert.throws(() => select(recipient.id, owner.keys[0]));
    assert.equal(h.raw(), before);
    assert.equal(h.storage.writes.length, beforeWrites);
  }
  const reloaded = loadCatalogCollections();
  assert.deepEqual(reloaded.collections.find(item => item.id === recipient.id), recipient);
  assert.deepEqual(reloaded.collections.find(item => item.id === owner.id), owner);
});

test("quota failures during embedded selection leave owner and recipient unchanged for every API", t => {
  const h = harness(t);
  const owner = saveSharedDeskCollection(snapshot()).collections.at(-1);
  const before = h.raw();
  const beforeWrites = h.storage.writes.length;
  const sourceSnapshot = structuredClone(owner);
  h.storage.writeError = Error("quota exceeded while copying");
  for (const [, select] of selectionMethods) {
    assert.throws(() => select("existing", owner.keys[0]));
    assert.equal(h.raw(), before);
    assert.equal(h.storage.writes.length, beforeWrites);
    assert.deepEqual(owner, sourceSnapshot);
  }
  h.storage.writeError = null;
  assert.deepEqual(loadCatalogCollections().collections[0], collection());
  assert.equal(h.values.get(SAVED_CATALOG_STORAGE_KEY), h.savedSentinel);
});

test("v6 migration adds Equities exactly once while preserving embedded collections and selection", t => {
  const h = harness(t);
  const saved = saveSharedDeskCollection(snapshot());
  const existing = structuredClone(saved.collections);
  const activeId = existing.at(-1).id;
  h.values.set(CATALOG_COLLECTIONS_STORAGE_KEY, JSON.stringify(envelope(existing, 6, activeId)));
  const writes = h.storage.writes.length;
  const result = loadCatalogCollections();
  assert.equal(result.version, 8);
  assert.equal(result.activeId, activeId);
  assert.deepEqual(result.collections.slice(0, existing.length), existing);
  assert.deepEqual(result.collections.at(-2).keys, EQUITIES_KEYS);
  assert.equal(result.collections.at(-2).id, "equities");
  assert.equal(result.collections.at(-2).name, "Equities");
  assert.deepEqual(result.collections.at(-1).keys, POWER_KEYS);
  assert.equal(h.storage.writes.length, writes + 1);
  assert.deepEqual(loadCatalogCollections(), result);
  assert.equal(h.storage.writes.length, writes + 1, "schema 8 reload must not seed again");
});

test("v5 and v6 migrations avoid Equities duplicates by ID or case-insensitive name", t => {
  const h = harness(t);
  for (const version of [5, 6]) {
    for (const existing of [collection("equities", "Renamed stocks"), collection("my-equities", "eQuItIeS")]) {
      const initial = [collection(), existing];
      h.values.set(CATALOG_COLLECTIONS_STORAGE_KEY, JSON.stringify(envelope(initial, version, existing.id)));
      const result = loadCatalogCollections();
      assert.equal(result.version, 8);
      assert.equal(result.activeId, existing.id);
      assert.deepEqual(result.collections.slice(0, initial.length), initial);
      assert.deepEqual(h.stored().collections.slice(0, initial.length), initial);
      assert.equal(result.collections.length, initial.length + 1);
      assert.deepEqual(result.collections.at(-1).keys, POWER_KEYS);
    }
  }
});

test("a full legacy catalog skips the Equities seed without removing existing collections", t => {
  const h = harness(t);
  const initial = Array.from({ length: 16 }, (_, index) => collection(`kept-${index}`, `Kept ${index}`));
  for (const version of [5, 6]) {
    h.values.set(CATALOG_COLLECTIONS_STORAGE_KEY, JSON.stringify(envelope(initial, version, "kept-15")));
    const result = loadCatalogCollections();
    assert.equal(result.version, 8);
    assert.equal(result.activeId, "kept-15");
    assert.deepEqual(result.collections, initial);
    assert.deepEqual(h.stored().collections, initial);
    assert.equal(h.stored().version, 8);
  }
});

test("deleting Equities from schema 8 persists and reload never recreates it", t => {
  const h = harness(t, envelope([collection()], 6));
  const migrated = loadCatalogCollections();
  assert.ok(migrated.collections.some(item => item.id === "equities"));
  const deleted = deleteCatalogCollection("equities");
  assert.equal(deleted.version, 8);
  assert.deepEqual(deleted.collections.map(item => item.id), ["existing", "power"]);
  const before = h.raw();
  const writes = h.storage.writes.length;
  assert.deepEqual(loadCatalogCollections().collections, deleted.collections);
  assert.deepEqual(loadCatalogCollections({ readOnly: true }).collections, deleted.collections);
  assert.equal(h.raw(), before);
  assert.equal(h.storage.writes.length, writes);
});

test("an embedded equities comparison copies its full state and survives owner deletion", t => {
  const h = harness(t);
  const state = normalizeCardVisualization("equities", {
    symbol: "AMD", layers: ["AMD", "NVDA"], scale: "index", range: "90d",
  });
  const input = { name: "Equities comparison", palette: "linen", theme: "light",
    entries: [{ cardId: "equities", name: "AMD and Nvidia", state }],
  };
  const owner = saveSharedDeskCollection(input).collections.at(-1);
  assert.equal(owner.views[0].state.symbol, "AMD");
  assert.deepEqual(owner.views[0].state.layers, ["NVDA", "AMD"]);
  assert.equal(owner.views[0].state.range, "90d");
  assert.equal(owner.views[0].state.scale, "index");
  const copied = addCatalogCollectionKey("existing", owner.keys[0]);
  assert.deepEqual(copied.collections[0].views[0].state, state);
  deleteCatalogCollection(owner.id);
  const reloaded = loadCatalogCollections();
  assert.equal(reloaded.unavailable, false);
  assert.deepEqual(reloaded.collections[0].views, owner.views);
  assert.equal(h.stored().version, 8);
  assert.equal(h.values.get(SAVED_CATALOG_STORAGE_KEY), h.savedSentinel);
});

test("stored All equity collections migrate in memory and retain their keys and names on the next edit", t => {
  const canonical = normalizeCardVisualization("equities", {
    symbol: "NVDA", layers: ["NVDA", "H100", "H200"], scale: "index", range: "1y",
  });
  const legacy = { ...collection("legacy-equities", "My equities"),
    keys: ["desk-legacy-equities-0"],
    views: [{ key: "desk-legacy-equities-0", cardId: "equities", name: "Stocks and compute", state: { ...canonical, range: "all" } }],
  };
  const h = harness(t, envelope([legacy]));
  const before = h.raw();
  for (const readOnly of [true, false]) {
    const loaded = loadCatalogCollections({ readOnly });
    assert.equal(loaded.unavailable, false);
    assert.equal(loaded.activeId, legacy.id);
    assert.deepEqual(loaded.collections[0], { ...legacy, views: [{ ...legacy.views[0], state: canonical }] });
    assert.equal(h.raw(), before);
    assert.equal(h.storage.writes.length, 0);
  }
  renameCatalogCollection(legacy.id, "Renamed equities");
  assert.equal(h.storage.writes.length, 1);
  const reloaded = loadCatalogCollections({ readOnly: true }).collections[0];
  assert.equal(reloaded.id, legacy.id);
  assert.equal(reloaded.name, "Renamed equities");
  assert.deepEqual(reloaded.keys, legacy.keys);
  assert.deepEqual(reloaded.views, [{ ...legacy.views[0], state: canonical }]);
  assert.deepEqual(h.stored().collections[0].views, reloaded.views);
  assert.equal(h.values.get(SAVED_CATALOG_STORAGE_KEY), h.savedSentinel);
});

test("the All equity collection alias does not repair other malformed embedded fields", t => {
  const canonical = normalizeCardVisualization("equities", { symbol: "NVDA", range: "1y" });
  const h = harness(t);
  for (const mutate of [
    state => { delete state.symbol; }, state => { state.symbol = "nvda"; },
    state => { state.layers = ["FAKE"]; }, state => { state.extra = true; },
    state => { state.scale = "bad"; }, state => { state.range = "ALL"; },
  ]) {
    const state = { ...canonical, range: "all" };
    mutate(state);
    const legacy = { ...collection(), keys: ["desk-legacy-0"],
      views: [{ key: "desk-legacy-0", cardId: "equities", name: "Legacy", state }],
    };
    h.values.set(CATALOG_COLLECTIONS_STORAGE_KEY, JSON.stringify(envelope([legacy])));
    const before = h.raw();
    assert.equal(loadCatalogCollections({ readOnly: true }).unavailable, true);
    assert.equal(h.raw(), before);
    assertSaveBlocked(h);
  }
  assert.equal(h.storage.writes.length, 0);
});

test("schema 7 gains exactly the Power starter without restoring removed collections or changing saved West views", t => {
  const west = normalizeCardVisualization("power-basis", { location: "PJM-WEST", scale: "basis", range: "all" });
  const existing = { ...collection("custom", "Custom West"), keys: ["desk-custom-west"],
    views: [{ key: "desk-custom-west", cardId: "power-basis", name: "My West basis", state: west }],
  };
  const h = harness(t, envelope([existing], 7, "custom"));
  const raw = h.raw();
  const preview = loadCatalogCollections({ readOnly: true });
  assert.equal(preview.version, 8);
  assert.equal(preview.activeId, "custom");
  assert.deepEqual(preview.collections.map(item => item.id), ["custom", "power"]);
  assert.deepEqual(preview.collections[0], existing);
  assert.deepEqual(preview.collections[1].keys, POWER_KEYS);
  assert.equal(preview.collections[1].name, "Power");
  assert.equal(h.raw(), raw);
  assert.equal(h.storage.writes.length, 0);
  const migrated = loadCatalogCollections();
  assert.deepEqual(migrated.collections[0], existing);
  assert.deepEqual(migrated.collections[1].keys, POWER_KEYS);
  assert.equal(h.storage.writes.length, 1);
  assert.equal(h.stored().version, 8);
  loadCatalogCollections();
  assert.equal(h.storage.writes.length, 1);
  assert.equal(h.values.get(SAVED_CATALOG_STORAGE_KEY), h.savedSentinel);
});

test("Power migration preserves renamed or case-insensitive existing Power catalogs and full storage", t => {
  const h = harness(t);
  for (const initial of [
    [collection("power", "Renamed power")],
    [collection("custom-power", "pOwEr")],
    Array.from({ length: 16 }, (_, index) => collection(`kept-${index}`, `Kept ${index}`)),
  ]) {
    const activeId = initial.at(-1).id;
    h.values.set(CATALOG_COLLECTIONS_STORAGE_KEY, JSON.stringify(envelope(initial, 7, activeId)));
    const result = loadCatalogCollections();
    assert.equal(result.version, 8);
    assert.equal(result.activeId, activeId);
    assert.deepEqual(result.collections, initial);
  }
});

test("Power is added to empty schema 7 only once and deletion persists in schema 8", t => {
  const h = harness(t, envelope([], 7));
  const migrated = loadCatalogCollections();
  assert.deepEqual(migrated.collections.map(item => item.id), ["power"]);
  assert.deepEqual(migrated.collections[0].keys, POWER_KEYS);
  deleteCatalogCollection("power");
  const raw = h.raw();
  const writes = h.storage.writes.length;
  assert.deepEqual(loadCatalogCollections().collections, []);
  assert.deepEqual(loadCatalogCollections({ readOnly: true }).collections, []);
  assert.equal(h.raw(), raw);
  assert.equal(h.storage.writes.length, writes);
});

test("new starter Power contains exactly three views while Overview keeps both legacy West keys", t => {
  harness(t, null);
  const { collections } = loadCatalogCollections({ readOnly: true });
  assert.deepEqual(collections.find(item => item.id === "power").keys, POWER_KEYS);
  const overview = collections.find(item => item.id === "overview");
  assert(overview.keys.includes("preset-power-basis-pjm-west"));
  assert(overview.keys.includes("preset-power-basis-pjm-west-spread"));
  assert(POWER_KEYS.every(key => !overview.keys.includes(key)));
});

test("saving an energy desk during schema 7 migration is atomic and survives independent copying", t => {
  const h = harness(t, envelope([collection()], 7));
  const energy = normalizeCardVisualization("power-basis", { location: "PJM-DOMINION", scale: "energy", range: "1y" });
  const input = { name: "Energy desk", entries: [{ cardId: "power-basis", name: "GPU energy", state: energy }], palette: "linen", theme: "dark" };
  const result = saveSharedDeskCollection(input);
  assert.equal(h.storage.writes.length, 1);
  assert.deepEqual(result.collections.map(item => item.id).slice(0, 2), ["existing", "power"]);
  const owner = result.collections.at(-1);
  assert.deepEqual(owner.views[0].state, energy);
  addCatalogCollectionKey("existing", owner.keys[0]);
  deleteCatalogCollection(owner.id);
  assert.deepEqual(loadCatalogCollections().collections[0].views[0].state, energy);
  assert.equal(h.values.get(SAVED_CATALOG_STORAGE_KEY), h.savedSentinel);
});
