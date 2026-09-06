import assert from "node:assert/strict";
import test from "node:test";
import { CARD_REGISTRY, normalizeCardState } from "../src/card-registry.js";
import { normalizeCardVisualization } from "../src/card-document.js";
import {
  SHARED_DESK_VERSION,
  MAX_SHARED_DESK_ENTRIES,
  MAX_SHARED_DESK_NAME_LENGTH,
  MAX_SHARED_DESK_TOKEN_LENGTH,
  createSharedDesk,
  encodeSharedDesk,
  decodeSharedDesk,
  sharedDeskUrl,
  readSharedDeskUrl,
} from "../src/shared-desk.js";

const view = (cardId = "gpu-index", state = {}, name = "My view") => ({ cardId, name, state });
const input = (entries = [view()], extra = {}) => ({ name: "My desk", entries, ...extra });
const snapshot = () => createSharedDesk(input());
const rawToken = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
const roundTrip = (value) => decodeSharedDesk(encodeSharedDesk(value));

test("exports the version and explicit bounded format", () => {
  assert.equal(SHARED_DESK_VERSION, 1);
  assert.equal(MAX_SHARED_DESK_ENTRIES, 32);
  assert.equal(MAX_SHARED_DESK_NAME_LENGTH, 48);
  assert.equal(MAX_SHARED_DESK_TOKEN_LENGTH, 32_768);
  assert.deepEqual(Object.keys(snapshot()), ["version", "name", "entries", "palette", "theme"]);
});

test("all registered chart families preserve their canonical state and entry order", () => {
  const states = [
    { gpu: "H100", layers: ["H100", "H200"], scale: "spread", range: "all", palette: "azure", theme: "light" },
    { gpu: "B300", layers: ["H100", "B200", "B300"], scale: "price", range: "1d" },
    { gpu: "H100", target: "256", scale: "history", range: "now" },
    { location: "PJM-WEST", scale: "basis", range: "7d" },
    { gpu: "H200", quantity: 1024, quote: 5.23, rfs: "2027-06" },
    { gpu: "B300", quantity: 2048, quote: 9.75, rfs: "2030-12" },
    { symbol: "NVDA", layers: ["MSFT", "NVDA", "AMD"], scale: "index", range: "1y" },
    { provider: "daytona-vm", layers: ["novita", "daytona-vm", "modal-gvisor"], scale: "price", range: "7d" },
  ];
  const entries = CARD_REGISTRY.map((card, index) => view(card.id, states[index], card.title));
  const created = createSharedDesk(input(entries, { palette: "sage", theme: "light" }), { includePrivate: true });
  const decoded = roundTrip(created);
  assert.deepEqual(decoded, created);
  assert.deepEqual(decoded.entries.map(({ cardId }) => cardId), CARD_REGISTRY.map(({ id }) => id));
  decoded.entries.forEach((entry, index) => {
    assert.deepEqual(entry.state, normalizeCardVisualization(entry.cardId, states[index]));
    assert.deepEqual(Object.keys(entry), ["cardId", "name", "state"]);
  });
  assert.deepEqual(Object.keys(decoded.entries[4].state), ["gpu", "quantity", "quote", "rfs", "palette", "theme"]);
  assert.deepEqual(decoded.entries[6].state.layers, ["MSFT", "NVDA", "AMD"]);
  assert.equal(decoded.entries[6].state.symbol, "NVDA");
  assert.equal(Object.hasOwn(decoded.entries[6].state, "gpu"), false);
});

test("normalizes partial and full renderer state without retaining redundant fields", () => {
  for (const card of CARD_REGISTRY) {
    const full = normalizeCardState(card.id, {});
    const created = createSharedDesk(input([view(card.id, full)]), { includePrivate: true });
    assert.deepEqual(created.entries[0].state, normalizeCardVisualization(card.id, full));
  }
  const created = createSharedDesk(input([view("gpu-index", { gpu: "h100", range: "ALL" }, "  First\n view ")], {
    name: "  My\t Desk ", palette: "AZURE", theme: "LIGHT",
  }));
  assert.equal(created.name, "My Desk");
  assert.equal(created.entries[0].name, "First view");
  assert.equal(created.entries[0].state.gpu, "H100");
  assert.equal(created.entries[0].state.range, "all");
  assert.equal(created.palette, "azure");
  assert.equal(created.theme, "light");
  assert.deepEqual(createSharedDesk(created), created);
});

test("equity and compute comparisons preserve their layers, common scale and name in shared desks", () => {
  const created = createSharedDesk(input([
    view("equities", {
      symbol: "NVDA", layers: ["NVDA", "H100", "H200"], scale: "price", range: "90d",
    }, "NVDA + compute"),
  ]));
  const entry = roundTrip(created).entries[0];
  assert.equal(entry.name, "NVDA + compute");
  assert.equal(entry.state.symbol, "NVDA");
  assert.deepEqual(entry.state.layers, ["NVDA", "H100", "H200"]);
  assert.equal(entry.state.scale, "index");
  assert.equal(entry.state.range, "90d");
});

test("legacy All equity links migrate exactly to one year without relaxing strict state validation", () => {
  const canonical = createSharedDesk(input([
    view("equities", { symbol: "NVDA", layers: ["NVDA", "H100", "H200"], scale: "index", range: "1y" }, "Stocks and compute"),
    view("gpu-index", { range: "all" }, "GPU history"),
  ]));
  const legacy = structuredClone(canonical);
  legacy.entries[0].state.range = "all";
  const before = structuredClone(legacy);
  assert.deepEqual(decodeSharedDesk(rawToken(legacy)), canonical);
  assert.deepEqual(roundTrip(legacy), canonical);
  assert.deepEqual(createSharedDesk(legacy), canonical);
  assert.equal(canonical.entries[1].state.range, "all");
  assert.deepEqual(legacy, before);
  for (const mutate of [
    state => { state.symbol = "nvda"; },
    state => { delete state.symbol; },
    state => { state.scale = "price"; },
    state => { state.layers.reverse(); },
    state => { state.layers.push("H100"); },
    state => { state.extra = "unknown"; },
    state => { state.palette = "bad"; },
    state => { state.range = "ALL"; },
    state => { state.range = "invalid"; },
  ]) {
    const invalid = structuredClone(legacy);
    mutate(invalid.entries[0].state);
    assert.throws(() => decodeSharedDesk(rawToken(invalid)), mutate.toString());
  }
});

test("UTF-8 Unicode and HTML-like names are inert data and round-trip exactly", () => {
  const created = createSharedDesk(input([view("gpu-index", {}, "東京 • GPU 🚀 <b>one</b>")], {
    name: "Café — مرحباً 🧪 <script>x</script>",
  }));
  const token = encodeSharedDesk(created);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeSharedDesk(token), created);
  assert.equal(decodeSharedDesk(token).entries[0].name, "東京 • GPU 🚀 <b>one</b>");
  assert.throws(() => createSharedDesk(input(undefined, { name: "bad\ud800" })));
});

test("private Quote and Deal are omitted by default, but opt-in survives decode and copying", () => {
  const entries = CARD_REGISTRY.map((card) => view(card.id));
  const safe = createSharedDesk(input(entries));
  assert.deepEqual(safe.entries.map(({ cardId }) => cardId), CARD_REGISTRY.filter(({ renderer }) => renderer !== "deal").map(({ id }) => id));
  const all = createSharedDesk(input(entries), { includePrivate: true });
  assert.equal(roundTrip(all).entries.length, CARD_REGISTRY.length);
  assert.deepEqual(createSharedDesk(roundTrip(all), { includePrivate: true }), all);
  assert.throws(() => createSharedDesk(input(), { includePrivate: "true" }));
});

test("equity symbol query state and the renderer alias share one portable canonical identity", () => {
  const query = Object.fromEntries(new URLSearchParams("symbol=amd&layers=NVDA,AMD&scale=index&range=90d"));
  const rendererState = normalizeCardState("equities", query);
  const canonical = roundTrip(createSharedDesk(input([view("equities", rendererState, "AMD and NVIDIA")]))).entries[0].state;
  assert.equal(canonical.symbol, "AMD");
  assert.deepEqual(canonical.layers, ["NVDA", "AMD"]);
  assert.equal(canonical.range, "90d");
  assert.equal(Object.hasOwn(canonical, "gpu"), false);
  const alias = roundTrip(createSharedDesk(input([view("equities", { gpu: "AMD", layers: ["NVDA", "AMD"], scale: "index", range: "90d" })]))).entries[0].state;
  assert.deepEqual(alias, canonical);
  assert.throws(() => createSharedDesk(input([view("equities", { symbol: "AMD", gpu: "NVDA" })])), /inconsistent/);
  assert.throws(() => createSharedDesk(input([view("equities", { symbol: "AMD", scale: "spread" })])), /scale/);
});

test("empty and all-private collections report the specific empty error", () => {
  for (const entries of [[], [view("quote-view")], [view("quote-view"), view("deal-view")]]) {
    assert.throws(() => createSharedDesk(input(entries)), { message: "This desk has no shareable views." });
  }
  const empty = { ...snapshot(), entries: [] };
  assert.throws(() => decodeSharedDesk(rawToken(empty)), /no shareable views/);
  assert.throws(() => encodeSharedDesk(empty), /no shareable views/);
});

test("preserves duplicate types and distinct configurations without deduplication", () => {
  const entries = [view("gpu-index", { range: "1d" }, "Short"), view("gpu-index", { range: "all" }, "Long"), view("gpu-index", { range: "1d" }, "Again")];
  const result = roundTrip(createSharedDesk(input(entries)));
  assert.deepEqual(result.entries.map(({ name }) => name), ["Short", "Long", "Again"]);
  assert.deepEqual(result.entries.map(({ state }) => state.range), ["1d", "all", "1d"]);
});

test("returned snapshots have no references into caller-owned state", () => {
  const source = input([view("gpu-index", { layers: ["H100", "H200"] })]);
  const created = createSharedDesk(source);
  source.entries[0].state.layers.push("B200");
  source.entries[0].name = "Changed";
  assert.deepEqual(created.entries[0].state.layers, ["H100", "H200"]);
  assert.equal(created.entries[0].name, "My view");
});

test("32 entries and 48-unit names are accepted, while raw overlong inputs fail before truncation", () => {
  const entries = Array.from({ length: 32 }, () => view("gpu-index", {}, "界".repeat(48)));
  const created = createSharedDesk(input(entries, { name: "x".repeat(48) }));
  assert.deepEqual(roundTrip(created), created);
  assert.ok(encodeSharedDesk(created).length < MAX_SHARED_DESK_TOKEN_LENGTH);
  assert.throws(() => createSharedDesk(input([...entries, view()])), { message: "A shared desk can contain at most 32 views." });
  assert.throws(() => createSharedDesk(input(undefined, { name: "x".repeat(49) })), /at most 48/);
  assert.throws(() => createSharedDesk(input([view("gpu-index", {}, ` ${"x".repeat(48)}`)])), /at most 48/);
  assert.throws(() => decodeSharedDesk("a".repeat(MAX_SHARED_DESK_TOKEN_LENGTH + 1)), { message: "Shared desk link is too large." });
  assert.throws(() => decodeSharedDesk(rawToken({ ...created, name: "x".repeat(49) })), /at most 48/);
});

test("unknown versions/cards and malformed envelopes cannot fall back to GPU index", () => {
  for (const version of [0, 2, "1", null]) {
    assert.throws(() => decodeSharedDesk(rawToken({ ...snapshot(), version })), /version/);
  }
  for (const cardId of ["unknown", "constructor", "__proto__", "gpu-index ", "gpu-index".repeat(200)]) {
    assert.throws(() => createSharedDesk(input([view(cardId)])), /Unknown/);
    const value = snapshot();
    value.entries[0].cardId = cardId;
    assert.throws(() => decodeSharedDesk(rawToken(value)), /Unknown/);
  }
  for (const value of [null, [], true, 1, "desk", {}, { ...snapshot(), id: "local-id" }]) {
    assert.throws(() => decodeSharedDesk(rawToken(value)));
  }
});

test("invalid enum, layer, and nested state values fail before normalization", () => {
  for (const appearance of [{ palette: null }, { theme: null }, { palette: "red" }, { theme: undefined }]) {
    assert.throws(() => createSharedDesk(input(undefined, appearance)));
  }
  for (const state of [
    { gpu: "A100" }, { range: "year" }, { scale: "script" }, { palette: "red" }, { theme: "auto" },
    { layers: [] }, { layers: ["H200", "A100"] }, { layers: ["H200", "H200"] },
    { layers: "H200" }, { layers: [null] }, { gpu: { value: "H200" } },
    { range: "7d".repeat(100) }, { theme: true }, { localId: "secret" },
  ]) assert.throws(() => createSharedDesk(input([view("gpu-index", state)])));
  assert.throws(() => createSharedDesk(input([view("gpu-market-depth", { target: "1024" })])));
  assert.throws(() => createSharedDesk(input([view("gpu-market-depth", { range: "7d" })])));
  assert.throws(() => createSharedDesk(input([view("power-basis", { location: "PJM-WEST", gpu: "H200" })])));
  assert.throws(() => createSharedDesk(input([view("deal-view", { layers: ["H100"] })]), { includePrivate: true }));
});

test("invalid numeric and month options cannot clamp, coerce, or fall back", () => {
  const invalid = [
    ...[null, true, "256", 0, 7, 4097, 8.5, Number.NaN, Infinity].map((quantity) => ({ quantity })),
    ...[null, false, "3.65", 0, 100.01, 3.651, Number.NaN, Infinity].map((quote) => ({ quote })),
    ...["2025-12", "2036-01", "2026-00", "2026-13", "2026-1", 202610, null].map((rfs) => ({ rfs })),
  ];
  for (const state of invalid) {
    assert.throws(() => createSharedDesk(input([view("quote-view", state)]), { includePrivate: true }));
    // Private exclusion is not a bypass around input validation.
    assert.throws(() => createSharedDesk(input([view(), view("deal-view", state)])));
    const value = createSharedDesk(input([view("quote-view")]), { includePrivate: true });
    Object.assign(value.entries[0].state, state);
    assert.throws(() => decodeSharedDesk(rawToken(value)));
  }
});

test("decoding requires complete canonical snapshots rather than repaired state", () => {
  const mutations = [
    (value) => { delete value.entries[0].state.range; },
    (value) => { value.entries[0].state.gpu = "h200"; },
    (value) => { value.entries[0].state.scale = "spread"; },
    (value) => { value.entries[0].state.layers = ["B200", "H200"]; },
    (value) => { value.entries[0].state.layers = ["H100"]; },
    (value) => { value.entries[0].name = " name "; },
    (value) => { value.name = " name "; },
    (value) => { value.theme = "DARK"; },
    (value) => { delete value.palette; },
    (value) => { value.entries[0].id = "local-id"; },
    (value) => { value.entries[0].state.auth = "secret"; },
  ];
  for (const mutate of mutations) {
    const value = snapshot();
    mutate(value);
    assert.throws(() => decodeSharedDesk(rawToken(value)));
    assert.throws(() => encodeSharedDesk(value));
  }
});

test("malformed base64url, invalid UTF-8, and non-JSON tokens are rejected", () => {
  const token = encodeSharedDesk(snapshot());
  for (const malformed of [
    "", "A", "A===", "abc+def", "abc/def", "abc def", `${token}=`, `${token}\n`,
    "%65y", "_w", Buffer.from("not json").toString("base64url"), Buffer.from([0xc0, 0xaf]).toString("base64url"),
    "Zh", // Noncanonical trailing padding bits encode the same byte as Zg.
    Buffer.from(`\ufeff${JSON.stringify(snapshot())}`).toString("base64url"),
  ]) assert.throws(() => decodeSharedDesk(malformed));
  for (const malformed of [null, 123, {}, []]) assert.throws(() => decodeSharedDesk(malformed));
});

test("malicious keys, prototypes, controls, accessors, and sparse inputs are rejected", () => {
  const value = snapshot();
  for (const key of ["__proto__", "constructor", "prototype", "data", "auth"]) {
    const unsafe = JSON.parse(JSON.stringify(value));
    Object.defineProperty(unsafe.entries[0].state, key, { enumerable: true, value: { polluted: true } });
    assert.throws(() => decodeSharedDesk(rawToken(unsafe)));
  }
  assert.equal({}.polluted, undefined);
  for (const name of ["", "   ", "bad\0name", "bad\u007fname", {}, 7, null]) {
    assert.throws(() => createSharedDesk(input(undefined, { name })));
  }
  assert.throws(() => createSharedDesk(input(new Array(2))));
  const sparse = new Array(1);
  sparse.unexpected = view();
  assert.throws(() => createSharedDesk(input(sparse)));
  assert.throws(() => createSharedDesk(input([view("gpu-index", { layers: new Array(1) })])));
  const arrayAccessor = [view()];
  Object.defineProperty(arrayAccessor, 0, { enumerable: true, get() { throw new Error("must not evaluate"); } });
  assert.throws(() => createSharedDesk(input(arrayAccessor)), { message: "Shared desk link is invalid." });
  assert.throws(() => createSharedDesk(Object.create(input())));
  const accessor = input();
  Object.defineProperty(accessor, "name", { enumerable: true, get() { throw new Error("must not evaluate"); } });
  assert.throws(() => createSharedDesk(accessor), { message: "Shared desk link is invalid." });
});

test("shared URLs keep the origin/path, reset all query state, and contain only the desk hash", () => {
  const value = snapshot();
  const href = sharedDeskUrl(value, "https://desk.example/app/?card=deal-view&gpu=B300&private=yes&view=monitor#old");
  const url = new URL(href);
  assert.equal(url.origin, "https://desk.example");
  assert.equal(url.pathname, "/app/");
  assert.equal(url.search, "?view=gallery");
  assert.equal(new URL(sharedDeskUrl(value, "https://user:secret@desk.example/")).username, "");
  assert.equal(new URL(sharedDeskUrl(value, "https://user:secret@desk.example/")).password, "");
  assert.match(url.hash, /^#desk=[A-Za-z0-9_-]+$/);
  assert.deepEqual(readSharedDeskUrl(href), { snapshot: value, error: null });
  for (const base of ["javascript:alert(1)", "data:text/html,test", "file:///desk/index.html", "not a URL"]) {
    assert.throws(() => sharedDeskUrl(value, base));
  }
});

test("readSharedDeskUrl ignores ordinary anchors and never throws on malformed links", () => {
  for (const suffix of ["", "#", "#gpu-benchmark-card", "#desktop", "?desk=invalid"]) {
    assert.deepEqual(readSharedDeskUrl(`https://desk.example/${suffix}`), { snapshot: null, error: null });
  }
  for (const suffix of ["#desk", "#desk=", "#desk=invalid", "#desk=%61", "#desk=abc&other=yes", `#desk=${"a".repeat(32_769)}`]) {
    assert.deepEqual(readSharedDeskUrl(`https://desk.example/${suffix}`), { snapshot: null, error: "Shared desk link is invalid." });
  }
  assert.deepEqual(readSharedDeskUrl("not a URL"), { snapshot: null, error: "Shared desk link is invalid." });
});
