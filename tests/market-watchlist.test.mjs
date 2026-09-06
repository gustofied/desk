import assert from "node:assert/strict";
import test from "node:test";
import { CARD_REGISTRY } from "../src/card-registry.js";
import { normalizeCardVisualization } from "../src/card-document.js";
import {
  MARKET_WATCHLIST_STORAGE_KEY, createMarketWatchlist, watchlistKey,
} from "../src/market-watchlist.js";

const DEFAULT_IDS = ["H100", "H200", "B200", "B300", "PJM-WEST-RT"];
const quote = (quantity = 128) => ({ cardId: "quote-view", state: { quantity }, label: `Quote ${quantity}` });
const envelope = items => JSON.stringify({ version: 1, items });

function memoryStorage(raw = null) {
  return {
    raw, writes: [], getError: null, setError: null,
    getItem(key) {
      assert.equal(key, MARKET_WATCHLIST_STORAGE_KEY);
      if (this.getError) throw this.getError;
      return this.raw;
    },
    setItem(key, value) {
      assert.equal(key, MARKET_WATCHLIST_STORAGE_KEY);
      if (this.setError) throw this.setError;
      this.raw = value;
      this.writes.push(value);
    },
  };
}

function harness(raw = null) {
  const storage = memoryStorage(raw);
  return { storage, watchlist: createMarketWatchlist({ storage }) };
}

function replaceGlobal(t, name, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, name, original);
    else delete globalThis[name];
  });
}

function assertBlocked(watchlist, storage, pinValue = quote()) {
  const before = watchlist.list();
  const raw = storage.raw;
  const writes = storage.writes.length;
  assert.throws(() => watchlist.pin(pinValue));
  assert.throws(() => watchlist.remove("H100"));
  assert.equal(watchlist.list(), before);
  assert.equal(storage.raw, raw);
  assert.equal(storage.writes.length, writes);
}

function legacyEquityPin(range, id = `equity-${range}`, label = `Equities ${range}`) {
  return {
    id, label, cardId: "equities",
    state: { ...normalizeCardVisualization("equities", {
      symbol: "NVDA", layers: ["NVDA", "H100", "H200"], scale: "index", range: "1y",
    }), range },
  };
}

test("an All equity pin migrates without read writes and persists canonically on an explicit edit", () => {
  const old = legacyEquityPin("all");
  const raw = envelope([old]);
  const { storage, watchlist } = harness(raw);
  const expected = { ...old, state: { ...old.state, range: "1y" } };
  assert.deepEqual(watchlist.list(), [expected]);
  assert.deepEqual(watchlist.reload(), [expected]);
  assert.equal(storage.raw, raw);
  assert.equal(storage.writes.length, 0);
  watchlist.pin(quote());
  assert.deepEqual(JSON.parse(storage.raw).items[0], expected);
  assert.deepEqual(watchlist.reload()[0], expected);
});

test("legacy All and one-year pin collisions retain both IDs, labels and order across edit and reload", () => {
  for (const ranges of [["all", "1y"], ["1y", "all"]]) {
    for (const removedRange of ["all", "1y"]) {
      const old = ranges.map(range => legacyEquityPin(range));
      const expected = old.map(item => ({ ...item, state: { ...item.state, range: "1y" } }));
      const raw = envelope(old);
      const { storage, watchlist } = harness(raw);
      assert.deepEqual(watchlist.list(), expected);
      assert.deepEqual(watchlist.reload(), expected);
      assert.equal(storage.raw, raw);
      assert.equal(storage.writes.length, 0);
      assert.equal(watchlist.pin({ cardId: "equities", state: expected[0].state, label: "Do not replace" }).id, expected[0].id);
      assert.equal(storage.writes.length, 0);
      watchlist.pin(quote());
      assert.equal(storage.writes.length, 1);
      assert.deepEqual(JSON.parse(storage.raw).items.slice(0, 2), old, "only the colliding legacy pin retains its stored alias witness");
      const fresh = createMarketWatchlist({ storage });
      assert.deepEqual(fresh.list().slice(0, 2), expected);
      assert.equal(storage.writes.length, 1);
      fresh.remove(`equity-${removedRange}`);
      const survivor = expected.find(item => item.id !== `equity-${removedRange}`);
      assert.deepEqual(createMarketWatchlist({ storage }).list()[0], survivor);
      assert.deepEqual(JSON.parse(storage.raw).items[0], survivor, "the witness is no longer needed after the collision is removed");
    }
  }
});

test("the equity All pin compatibility case cannot admit arbitrary duplicate or malformed pins", () => {
  for (const items of [
    [legacyEquityPin("1y", "a"), legacyEquityPin("1y", "b")],
    [legacyEquityPin("all", "a"), legacyEquityPin("all", "b")],
    [legacyEquityPin("all", "a"), legacyEquityPin("1y", "b"), legacyEquityPin("1y", "c")],
    [legacyEquityPin("all", "same"), legacyEquityPin("1y", "same")],
  ]) {
    const { storage, watchlist } = harness(envelope(items));
    assert.deepEqual(watchlist.list().map(item => item.id), DEFAULT_IDS);
    assertBlocked(watchlist, storage);
  }
  for (const mutate of [
    state => { delete state.symbol; }, state => { state.symbol = "nvda"; },
    state => { state.layers.reverse(); }, state => { state.extra = true; },
    state => { state.scale = "price"; }, state => { state.range = "ALL"; },
  ]) {
    const old = legacyEquityPin("all");
    mutate(old.state);
    const { storage, watchlist } = harness(envelope([old]));
    assertBlocked(watchlist, storage);
  }
});

test("initial defaults are five frozen in-memory views and never write storage", () => {
  assert.equal(MARKET_WATCHLIST_STORAGE_KEY, "desk.market-watchlist.v1");
  const { storage, watchlist } = harness();
  assert.deepEqual(watchlist.list().map(item => item.id), DEFAULT_IDS);
  for (const item of watchlist.list().slice(0, 4)) {
    assert.equal(item.cardId, "gpu-index");
    assert.equal(item.label, item.id);
    assert.deepEqual(item.state, {
      gpu: item.id, layers: [item.id], scale: "price", range: "7d", palette: "linen", theme: "dark",
    });
  }
  assert.deepEqual(watchlist.list().at(-1), {
    id: "PJM-WEST-RT", cardId: "power-basis", label: "PJM West RT",
    state: { location: "PJM-WEST", layers: ["PJM-WEST"], scale: "price", range: "1d", palette: "linen", theme: "dark" },
  });
  assert.ok(Object.isFrozen(watchlist.list()));
  assert.ok(watchlist.list().every(item => Object.isFrozen(item) && Object.isFrozen(item.state) && Object.isFrozen(item.state.layers)));
  assert.equal(storage.raw, null);
  assert.deepEqual(storage.writes, []);
  watchlist.reload();
  assert.deepEqual(storage.writes, []);
});

test("first edit persists defaults plus the change in a versioned envelope", () => {
  const { storage, watchlist } = harness();
  const pinned = watchlist.pin(quote());
  assert.match(pinned.id, /^watch-[a-zA-Z0-9_-]+$/);
  assert.ok(pinned.id.length <= 96);
  assert.equal(storage.writes.length, 1);
  assert.deepEqual(JSON.parse(storage.raw), { version: 1, items: [...watchlist.list()] });
  assert.deepEqual(watchlist.list().slice(0, 5).map(item => item.id), DEFAULT_IDS);
  assert.deepEqual(createMarketWatchlist({ storage }).list(), watchlist.list());
});

test("pin supports partial state for every registered chart family", () => {
  const { watchlist } = harness(envelope([]));
  const states = {
    "gpu-index": { gpu: "h100", layers: ["h200", "h100"], scale: "SPREAD", range: "1D" },
    "gpu-price-snapshot": { gpu: "h100", layers: ["b200", "h100"] },
    "gpu-market-depth": { target: "256", scale: "history" },
    "power-basis": { location: "pjm-west", scale: "basis", range: "7d" },
    "quote-view": { gpu: "h200", quantity: "64.6", quote: "4.567", rfs: "2027-02" },
    "deal-view": { gpu: "b300", quantity: 512, quote: 8.765, rfs: "2028-06" },
    equities: { symbol: "amd", layers: ["NVDA", "amd"], scale: "index", range: "90d" },
    "sandbox-cost": { provider: "DAYTONA-VM", layers: ["DAYTONA-VM", "novita"], range: "7d" },
  };
  assert.deepEqual(Object.keys(states), CARD_REGISTRY.map(card => card.id));
  for (const card of CARD_REGISTRY) {
    const pinned = watchlist.pin({ cardId: card.id, state: states[card.id], label: card.title });
    assert.deepEqual(pinned.state, normalizeCardVisualization(card.id, states[card.id]));
    assert.equal(watchlistKey(card.id), watchlistKey(card.id, {}));
  }
  const byCard = Object.fromEntries(watchlist.list().map(item => [item.cardId, item.state]));
  assert.equal(byCard["gpu-index"].scale, "spread");
  assert.deepEqual(byCard["gpu-price-snapshot"].layers, ["H100", "B200"]);
  assert.equal(byCard["gpu-market-depth"].target, "256");
  assert.equal(byCard["power-basis"].location, "PJM-WEST");
  assert.equal(byCard["quote-view"].quantity, 65);
  assert.equal(byCard["quote-view"].quote, 4.57);
  assert.equal(byCard["deal-view"].quote, 8.77);
  assert.equal(byCard.equities.symbol, "AMD");
  assert.deepEqual(byCard.equities.layers, ["NVDA", "AMD"]);
  assert.equal(byCard.equities.range, "90d");
  assert.equal(Object.hasOwn(byCard.equities, "gpu"), false);
});

test("identity ignores colors, case, and layer ordering but retains chart composition", () => {
  const first = { gpu: "h100", layers: new Set(["h200", "h100"]), scale: "SPREAD", range: "7D", palette: "linen", theme: "dark" };
  const equivalent = { gpu: "H100", layers: ["H100", "H200", "H100"], scale: "spread", range: "7d", palette: "sage", theme: "light" };
  assert.equal(watchlistKey("gpu-index", first), watchlistKey("gpu-index", equivalent));
  for (const change of [{ gpu: "H200" }, { layers: ["H100", "B200"] }, { scale: "index" }, { range: "1d" }]) {
    assert.notEqual(watchlistKey("gpu-index", first), watchlistKey("gpu-index", { ...equivalent, ...change }));
  }
  assert.notEqual(watchlistKey("quote-view", {}), watchlistKey("deal-view", {}));
  for (const [cardId, change] of [
    ["gpu-price-snapshot", { layers: ["H100"] }],
    ["gpu-market-depth", { target: "64" }],
    ["power-basis", { scale: "basis" }],
    ["quote-view", { quantity: 64 }], ["quote-view", { quote: 6 }],
    ["quote-view", { rfs: "2027-01" }], ["quote-view", { gpu: "H100" }],
  ]) assert.notEqual(watchlistKey(cardId), watchlistKey(cardId, change));
});

test("duplicate compositions preserve the original ID, label, colors, and write count", () => {
  const { storage, watchlist } = harness();
  const original = watchlist.pin({ cardId: "gpu-index", state: { gpu: "H100", layers: ["H100", "H200"], scale: "spread" }, label: "Original spread" });
  const writes = storage.writes.length;
  const duplicate = watchlist.pin({ cardId: "gpu-index", state: { gpu: "h100", layers: new Set(["h200", "h100"]), scale: "SPREAD", theme: "light" }, label: "Replacement name" });
  assert.deepEqual(duplicate, original);
  assert.equal(duplicate.state.theme, "dark");
  assert.equal(storage.writes.length, writes);
  const defaultDuplicate = watchlist.pin({ cardId: "gpu-index", state: { gpu: "H100" }, label: "Different H100 name" });
  assert.equal(defaultDuplicate.id, "H100");
  assert.equal(defaultDuplicate.label, "H100");
  assert.equal(storage.writes.length, writes);
});

test("removals persist, missing IDs are no-ops, and an explicitly empty watchlist stays empty", () => {
  const { storage, watchlist } = harness();
  assert.equal(watchlist.remove("not-present"), false);
  assert.equal(storage.writes.length, 0);
  for (const id of DEFAULT_IDS) assert.equal(watchlist.remove(id), true);
  assert.deepEqual(JSON.parse(storage.raw), { version: 1, items: [] });
  assert.deepEqual(watchlist.list(), []);
  assert.deepEqual(watchlist.reload(), []);
  assert.deepEqual(createMarketWatchlist({ storage }).list(), []);
  assert.equal(watchlist.remove("H100"), false);
  assert.equal(storage.writes.length, 5);
});

test("repinning a removed default composition restores its canonical ID", () => {
  const { watchlist } = harness();
  watchlist.remove("H100");
  const pinned = watchlist.pin({ cardId: "gpu-index", state: { gpu: "h100" }, label: "H100 again" });
  assert.equal(pinned.id, "H100");
  assert.equal(pinned.label, "H100 again");
});

test("snapshots are deeply frozen and independent of caller or later catalog edits", () => {
  const { watchlist } = harness();
  const input = { cardId: "gpu-index", state: { gpu: "H100", layers: ["H100", "H200"], scale: "spread" }, label: "Catalog spread" };
  const pinned = watchlist.pin(input);
  const snapshot = watchlist.list();
  input.state.layers.push("B200");
  input.state.scale = "index";
  input.label = "Catalog renamed";
  assert.deepEqual(pinned.state.layers, ["H100", "H200"]);
  assert.equal(pinned.state.scale, "spread");
  assert.equal(pinned.label, "Catalog spread");
  for (const items of [snapshot, watchlist.reload()]) {
    assert.ok(Object.isFrozen(items));
    for (const item of items) {
      assert.ok(Object.isFrozen(item));
      assert.ok(Object.isFrozen(item.state));
      if (item.state.layers) assert.ok(Object.isFrozen(item.state.layers));
    }
  }
  assert.throws(() => pinned.state.layers.push("B300"), TypeError);
  assert.throws(() => { pinned.label = "Changed"; }, TypeError);
  watchlist.remove(pinned.id);
  assert.equal(snapshot.length, 6);
  assert.equal(watchlist.list().length, 5);
});

test("labels trim, collapse whitespace, truncate at 48, and reject blank or control characters", () => {
  const { storage, watchlist } = harness();
  assert.equal(watchlist.pin({ ...quote(64), label: "  My\t quote\n view  " }).label, "My quote view");
  assert.equal(watchlist.pin({ ...quote(65), label: "x".repeat(60) }).label, "x".repeat(48));
  const before = watchlist.list();
  const writes = storage.writes.length;
  for (const label of ["", " \t\n ", null, undefined, 42, "bad\u0000name", "bad\u001bname", "bad\u007fname"]) {
    assert.throws(() => watchlist.pin({ ...quote(), label }), TypeError);
  }
  assert.equal(watchlist.list(), before);
  assert.equal(storage.writes.length, writes);
});

test("invalid view/state inputs and unknown cards fail without changing memory or storage", () => {
  const { storage, watchlist } = harness();
  const before = watchlist.list();
  for (const value of [null, [], 1, "view", new Date(), { cardId: "unknown", state: {}, label: "Unknown" }]) {
    assert.throws(() => watchlist.pin(value), TypeError);
  }
  for (const state of [null, [], "state", new Date(), { range: null }, { gpu: undefined }, { nested: {} }, { fn() {} }, { quantity: Infinity }, { quote: NaN }, { layers: ["H100", 2] }, { layers: new Set([null]) }, { list: ["H100"] }]) {
    assert.throws(() => watchlist.pin({ ...quote(), state }), TypeError);
    assert.throws(() => watchlistKey("gpu-index", state), TypeError);
  }
  assert.throws(() => watchlistKey("unknown"), TypeError);
  assert.equal(watchlist.list(), before);
  assert.equal(storage.raw, null);
  assert.equal(storage.writes.length, 0);
});

test("future and corrupt envelopes fall back on reads but block edits without overwriting", () => {
  for (const raw of [
    "not-json", "null", "[]", "42", "{}", JSON.stringify({ version: 2, items: [] }),
    JSON.stringify({ version: "1", items: [] }), JSON.stringify({ version: 1 }),
    JSON.stringify({ version: 1, items: {} }), JSON.stringify({ version: 1, items: [], extra: true }),
  ]) {
    const { storage, watchlist } = harness(raw);
    assert.deepEqual(watchlist.list().map(item => item.id), DEFAULT_IDS);
    assertBlocked(watchlist, storage);
    assert.deepEqual(watchlist.reload().map(item => item.id), DEFAULT_IDS);
    assert.equal(storage.raw, raw);
    assert.equal(storage.writes.length, 0);
  }
});

test("one malformed stored entry invalidates the whole envelope instead of repairing it", () => {
  const seed = harness().watchlist.list();
  const cases = [
    item => { item.extra = true; }, item => { delete item.state; },
    item => { item.state = null; }, item => { delete item.state.range; },
    item => { item.state.extra = "unknown"; }, item => { item.state.range = "invalid"; },
    item => { item.state.gpu = "h100"; }, item => { item.state.palette = "invalid"; },
    item => { item.state.layers = ["H100", "H100"]; }, item => { item.label = " H100 "; },
    item => { item.label = "x".repeat(49); }, item => { item.label = "bad\u0000name"; },
    item => { item.cardId = "unknown"; }, item => { item.id = "bad id"; },
  ];
  for (const corrupt of cases) {
    const entries = structuredClone(seed);
    corrupt(entries[0]);
    const { storage, watchlist } = harness(envelope(entries));
    assert.deepEqual(watchlist.list(), seed);
    assertBlocked(watchlist, storage);
  }
});

test("stored duplicate IDs/compositions are rejected while canonical object key order is irrelevant", () => {
  const seed = structuredClone(harness().watchlist.list());
  for (const entries of [
    [...seed, { ...seed[0], id: "another-id", label: "Same view" }],
    [...seed, { ...seed[1], id: seed[0].id }],
    [...seed, null],
  ]) {
    const { storage, watchlist } = harness(envelope(entries));
    assertBlocked(watchlist, storage);
  }
  const reversed = { ...seed[0], id: "a".repeat(96), state: Object.fromEntries(Object.entries(seed[0].state).reverse()) };
  const { storage, watchlist } = harness(envelope([reversed]));
  assert.equal(watchlist.list().length, 1);
  assert.deepEqual(watchlist.list()[0].state, seed[0].state);
  assert.equal(watchlist.remove(reversed.id), true);
  assert.equal(storage.writes.length, 1);
});

test("invalid IDs are rejected without writes and custom IDs stay unique when randomness fails", t => {
  const { storage, watchlist } = harness();
  for (const id of [null, 1, "", "has space", "../path", "é", "x".repeat(97)]) {
    assert.throws(() => watchlist.remove(id), TypeError);
  }
  assert.equal(storage.writes.length, 0);
  replaceGlobal(t, "crypto", { randomUUID() { throw Error("random unavailable"); } });
  const first = watchlist.pin(quote(64));
  const second = watchlist.pin(quote(65));
  assert.notEqual(first.id, second.id);
  assert.match(first.id, /^[a-zA-Z0-9_-]{1,96}$/);
  assert.match(second.id, /^[a-zA-Z0-9_-]{1,96}$/);
});

test("quota errors leave both pin and remove atomic and permit a later retry", () => {
  const { storage, watchlist } = harness();
  const before = watchlist.list();
  storage.setError = Error("quota exceeded");
  assertBlocked(watchlist, storage);
  storage.setError = null;
  assert.equal(watchlist.pin(quote()).cardId, "quote-view");
  const pinned = watchlist.list();
  storage.setError = Error("quota exceeded");
  assertBlocked(watchlist, storage, quote(129));
  assert.equal(watchlist.list(), pinned);
  assert.equal(before.length, 5);
  storage.setError = null;
  assert.equal(watchlist.remove("H100"), true);
});

test("getItem failures and malformed missing returns are safe on reads and atomic on edits", () => {
  const storage = memoryStorage();
  storage.getError = Error("storage access denied");
  const watchlist = createMarketWatchlist({ storage });
  assert.deepEqual(watchlist.list().map(item => item.id), DEFAULT_IDS);
  assertBlocked(watchlist, storage);
  storage.getError = null;
  watchlist.pin(quote());
  storage.getError = Error("storage access denied again");
  assertBlocked(watchlist, storage);
  assert.deepEqual(watchlist.reload().map(item => item.id), DEFAULT_IDS);
  storage.getError = null;
  storage.raw = undefined;
  assertBlocked(watchlist, storage);
});

test("storage access getters and unavailable storage never crash reads or permit edits", t => {
  const denied = createMarketWatchlist({ get storage() { throw Error("getter denied"); } });
  assert.deepEqual(denied.list().map(item => item.id), DEFAULT_IDS);
  assert.doesNotThrow(() => denied.reload());
  assert.throws(() => denied.pin(quote()));
  assert.throws(() => denied.remove("H100"));
  for (const storage of [null, {}, { getItem: 1 }, { getItem() { return null; } }]) {
    const watchlist = createMarketWatchlist({ storage });
    const before = watchlist.list();
    assert.doesNotThrow(() => watchlist.reload());
    assert.throws(() => watchlist.pin(quote()));
    assert.throws(() => watchlist.remove("H100"));
    assert.deepEqual(watchlist.list(), before);
  }
  replaceGlobal(t, "localStorage", undefined);
  replaceGlobal(t, "window", { get localStorage() { throw Error("window getter denied"); } });
  const implicit = createMarketWatchlist();
  assert.deepEqual(implicit.list().map(item => item.id), DEFAULT_IDS);
  assert.throws(() => implicit.pin(quote()));
});

test("the 32-view cap blocks additions but allows duplicates, removals, and replacement", () => {
  const { storage, watchlist } = harness();
  for (let quantity = 8; quantity < 35; quantity++) watchlist.pin(quote(quantity));
  assert.equal(watchlist.list().length, 32);
  const snapshot = watchlist.list();
  const writes = storage.writes.length;
  assert.throws(() => watchlist.pin(quote(4096)), /32/);
  assert.equal(watchlist.list(), snapshot);
  assert.equal(storage.writes.length, writes);
  assert.equal(watchlist.pin(quote(8)).state.quantity, 8);
  assert.equal(storage.writes.length, writes);
  assert.equal(watchlist.remove("H100"), true);
  watchlist.pin(quote(4096));
  assert.equal(watchlist.list().length, 32);
  const oversized = JSON.parse(storage.raw);
  oversized.items.push({ ...oversized.items[0], id: "overflow" });
  storage.raw = JSON.stringify(oversized);
  assertBlocked(watchlist, storage);
});

test("every edit merges against the latest stored snapshot so tabs preserve each other's changes", () => {
  const storage = memoryStorage();
  const first = createMarketWatchlist({ storage });
  const second = createMarketWatchlist({ storage });
  const firstPin = first.pin(quote(64));
  second.remove("H100");
  assert.ok(second.list().some(item => item.id === firstPin.id));
  const secondPin = second.pin(quote(65));
  first.pin(quote(66));
  assert.ok(first.list().some(item => item.id === secondPin.id));
  assert.ok(first.list().every(item => item.id !== "H100"));
  const writes = storage.writes.length;
  assert.equal(second.remove("missing"), false);
  assert.deepEqual(second.list(), first.list());
  assert.equal(storage.writes.length, writes);
  const duplicate = first.pin({ ...quote(65), label: "Do not replace", state: { quantity: 65, theme: "light" } });
  assert.deepEqual(duplicate, secondPin);
  assert.equal(storage.writes.length, writes);
});

test("a future/corrupt cross-tab update blocks even no-op mutations until storage is recoverable", () => {
  const { storage, watchlist } = harness();
  watchlist.pin(quote());
  const valid = storage.raw;
  const snapshot = watchlist.list();
  for (const raw of ["corrupt", JSON.stringify({ version: 2, items: [] })]) {
    storage.raw = raw;
    assert.throws(() => watchlist.pin({ cardId: "gpu-index", state: { gpu: "H100" }, label: "Duplicate" }));
    assert.throws(() => watchlist.remove("missing"));
    assert.equal(watchlist.list(), snapshot);
    assert.equal(storage.raw, raw);
  }
  storage.raw = valid;
  assert.deepEqual(watchlist.reload(), snapshot);
  assert.equal(watchlist.remove("H100"), true);
});
