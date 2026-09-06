import { CARD_REGISTRY, cardStateParamIds } from "./card-registry.js";
import {
  migrateCardVisualizationState,
  normalizeCardDocumentName,
  normalizeCardVisualization,
} from "./card-document.js";

export const MARKET_WATCHLIST_STORAGE_KEY = "desk.market-watchlist.v1";
const VERSION = 1;
const MAX_ITEMS = 32;
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,96}$/;
const cards = new Map(CARD_REGISTRY.map((card) => [card.id, card]));
const legacyEquityAllEntries = new WeakSet();
let idSequence = 0;

const defaults = Object.freeze([
  ...["H100", "H200", "B200", "B300"].map((id) => entry({
    id, cardId: "gpu-index", label: id,
    state: { gpu: id, layers: [id], scale: "price", range: "7d" },
  })),
  entry({
    id: "PJM-WEST-RT", cardId: "power-basis", label: "PJM West RT",
    state: { location: "PJM-WEST", layers: ["PJM-WEST"], scale: "price", range: "1d" },
  }),
]);
const defaultIds = new Map(defaults.map((item) => [
  watchlistKey(item.cardId, item.state), item.id,
]));

/** Chart identity includes its type and normalized composition, not appearance. */
export function watchlistKey(cardId, state = {}) {
  const card = requireCard(cardId);
  const normalized = normalizeState(card.id, state);
  return JSON.stringify([
    card.id,
    ...cardStateParamIds(card)
      .filter((key) => key !== "palette" && key !== "theme")
      .map((key) => [key, normalized[key]]),
  ]);
}

/** Reads are safe; explicit edits fail atomically rather than replace unreadable data. */
export function createMarketWatchlist(options = {}) {
  let items = read().items;

  function storage() {
    // Access inside the read boundary: browsers can throw just getting storage.
    const value = options && Object.hasOwn(options, "storage")
      ? options.storage
      : globalThis.localStorage ?? globalThis.window?.localStorage;
    if (!value || typeof value.getItem !== "function") {
      throw new Error("Market watchlist storage is unavailable");
    }
    return value;
  }

  function read(strict = false) {
    try {
      const store = storage();
      const text = store.getItem(MARKET_WATCHLIST_STORAGE_KEY);
      return { store, items: text === null ? defaults : parseEnvelope(text) };
    } catch (error) {
      if (strict) throw error;
      return { store: null, items: defaults };
    }
  }

  function commit(next, store) {
    if (typeof store.setItem !== "function") {
      throw new Error("Market watchlist storage is unavailable");
    }
    const snapshot = Object.freeze(next);
    const counts = new Map();
    for (const item of snapshot) {
      const key = watchlistKey(item.cardId, item.state);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    store.setItem(MARKET_WATCHLIST_STORAGE_KEY, JSON.stringify({
      version: VERSION,
      items: snapshot.map(item => {
        // Preserve the old range only as a stored witness for an existing
        // All/1Y collision. Both visible pins stay canonical, with their IDs
        // and labels intact, and arbitrary duplicate pins remain invalid.
        const collision = counts.get(watchlistKey(item.cardId, item.state)) > 1;
        return collision && legacyEquityAllEntries.has(item)
          ? { ...item, state: { ...item.state, range: "all" } }
          : item;
      }),
    }));
    items = snapshot;
  }

  return {
    list() { return items; },
    pin(value) {
      if (!isRecord(value)) throw new TypeError("A watchlist view is required");
      const normalized = entry({ ...value, id: "pending" });
      const key = watchlistKey(normalized.cardId, normalized.state);
      // Re-read before every edit, including no-ops, so stale tabs cannot replace
      // newer data or silently overwrite a future/corrupt storage envelope.
      const current = read(true);
      const existing = current.items.find((item) =>
        watchlistKey(item.cardId, item.state) === key,
      );
      if (existing) {
        items = current.items;
        return existing;
      }
      if (current.items.length >= MAX_ITEMS) {
        throw new Error("Market watchlist is full (32 views)");
      }
      const ids = new Set(current.items.map((item) => item.id));
      const canonicalId = defaultIds.get(key);
      const id = canonicalId && !ids.has(canonicalId)
        ? canonicalId
        : uniqueId(ids);
      const pinned = Object.freeze({ ...normalized, id });
      commit([...current.items, pinned], current.store);
      return pinned;
    },
    remove(id) {
      requireId(id);
      const current = read(true);
      const next = current.items.filter((item) => item.id !== id);
      if (next.length === current.items.length) {
        items = current.items;
        return false;
      }
      commit(next, current.store);
      return true;
    },
    reload() {
      items = read().items;
      return items;
    },
  };
}

function parseEnvelope(text) {
  let value;
  try { value = JSON.parse(text); }
  catch { throw new TypeError("Market watchlist data is invalid"); }
  if (!isRecord(value) || value.version !== VERSION) {
    throw new TypeError("Unsupported market watchlist version");
  }
  if (
    Object.keys(value).some((key) => key !== "version" && key !== "items") ||
    !Array.isArray(value.items) || value.items.length > MAX_ITEMS
  ) throw new TypeError("Market watchlist data is invalid");

  const ids = new Set();
  const keys = new Map();
  const items = value.items.map((value) => {
    const normalized = entry(value);
    const compatible = migrateCardVisualizationState(normalized.cardId, value.state);
    const legacyAll = compatible !== value.state;
    const stateKeys = Object.keys(normalized.state);
    // Stored entries are complete snapshots. Do not repair missing/unknown
    // fields or invalid state by overwriting them with normalizer defaults.
    if (
      Object.keys(value).some((key) => !["id", "cardId", "state", "label"].includes(key)) ||
      value.label !== normalized.label ||
      Object.keys(compatible).length !== stateKeys.length ||
      stateKeys.some((key) => !Object.hasOwn(compatible, key) ||
        JSON.stringify(compatible[key]) !== JSON.stringify(normalized.state[key]))
    ) throw new TypeError("Market watchlist entry is invalid");
    const key = watchlistKey(normalized.cardId, normalized.state);
    const previous = keys.get(key);
    if (ids.has(normalized.id) ||
      (previous && (previous.count !== 1 || previous.legacyAll === legacyAll))) {
      throw new TypeError("Market watchlist entries must be unique");
    }
    ids.add(normalized.id);
    keys.set(key, { count: (previous?.count || 0) + 1, legacyAll });
    if (legacyAll) legacyEquityAllEntries.add(normalized);
    return normalized;
  });
  return Object.freeze(items);
}

function entry(value) {
  if (!isRecord(value)) throw new TypeError("A watchlist view is required");
  requireId(value.id);
  const card = requireCard(value.cardId);
  if (typeof value.label !== "string" || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.label)) {
    throw new TypeError("A watchlist view label is required");
  }
  const label = normalizeCardDocumentName(value.label).trim();
  if (!label) throw new TypeError("A watchlist view label is required");
  return Object.freeze({
    id: value.id, cardId: card.id,
    state: freezeState(normalizeState(card.id, value.state)), label,
  });
}

function normalizeState(cardId, state) {
  requireCard(cardId);
  if (!isRecord(state)) throw new TypeError("A watchlist chart state is required");
  for (const [key, value] of Object.entries(state)) {
    if (key === "layers" && (Array.isArray(value) || value instanceof Set)) {
      if ([...value].every((layer) => typeof layer === "string")) continue;
    } else if (typeof value === "string" || typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))) continue;
    throw new TypeError("Watchlist chart state must contain valid scalar values");
  }
  return normalizeCardVisualization(cardId, state);
}

function requireCard(cardId) {
  const card = cards.get(cardId);
  if (!card) throw new TypeError("Unknown watchlist view type");
  return card;
}

function requireId(id) {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    throw new TypeError("Invalid watchlist view id");
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function freezeState(state) {
  for (const value of Object.values(state)) {
    if (Array.isArray(value)) Object.freeze(value);
  }
  return Object.freeze(state);
}

function uniqueId(ids) {
  let id;
  do {
    let random;
    try { random = globalThis.crypto?.randomUUID?.(); } catch {}
    id = `watch-${random || Date.now().toString(36)}-${(++idSequence).toString(36)}`;
  } while (ids.has(id));
  return id;
}
