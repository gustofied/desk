import {
  migrateCardVisualizationState,
  normalizeCardDocumentName,
  normalizeCardVisualization,
} from "./card-document.js";
import { EQUITY_LAYERS, paletteIds, THEMES } from "./card-registry.js";
import { createSharedDesk } from "./shared-desk.js";

const STORAGE_KEY = "desk.catalog-collections.v1";
const STORAGE_VERSION = 8;
const LEGACY_STORAGE_VERSIONS = new Set([1, 2, 3, 4, 5, 6, 7]);
const ALL_CARDS_ID = "all";
const OVERVIEW_CATALOG_ID = "overview";
const HEDGE_CATALOG_ID = "hedge";
const PRIVATE_CATALOG_ID = "private";
const EQUITIES_CATALOG_ID = "equities";
const POWER_CATALOG_ID = "power";
const LEGACY_QUOTE_KEY = "preset-quote-view-quote-041";
const STARTER_CATALOGS = Object.freeze([
  Object.freeze({
    id: OVERVIEW_CATALOG_ID,
    name: "Overview",
    keys: Object.freeze([
      "preset-gpu-price-snapshot-prices",
      "preset-gpu-index-h200",
      "preset-gpu-index-b200",
      "preset-gpu-index-compute-market",
      "preset-gpu-market-depth-h100-us",
      "preset-gpu-market-depth-h100-history",
      "preset-power-basis-pjm-west",
      "preset-power-basis-pjm-west-spread",
      "preset-deal-view-deal-041",
    ]),
  }),
  Object.freeze({
    id: HEDGE_CATALOG_ID,
    name: "Hedge",
    keys: Object.freeze([
      "preset-gpu-index-compute-market",
      "preset-gpu-index-h100-b200-spread",
      "preset-gpu-index-h200-b300-spread",
      "preset-power-basis-pjm-west-spread",
      "preset-gpu-market-depth-h100-history",
    ]),
  }),
  Object.freeze({
    id: PRIVATE_CATALOG_ID,
    name: "Private",
    keys: Object.freeze([
      "preset-deal-view-deal-041",
      "preset-gpu-index-b200",
      "preset-gpu-price-snapshot-prices",
      "preset-gpu-market-depth-h100-us",
    ]),
  }),
  Object.freeze({
    id: EQUITIES_CATALOG_ID,
    name: "Equities",
    keys: Object.freeze(EQUITY_LAYERS.map((layer) =>
      `preset-equities-${layer.id.toLowerCase()}`)),
  }),
  Object.freeze({
    id: POWER_CATALOG_ID,
    name: "Power",
    keys: Object.freeze([
      "preset-power-basis-pjm-dominion",
      "preset-power-basis-ercot-north",
      "preset-power-basis-gpu-energy",
    ]),
  }),
]);
const MAX_COLLECTIONS = 16;
const MAX_COLLECTION_NAME_LENGTH = 48;
const MAX_COLLECTION_KEYS = 128;
const MAX_EMBEDDED_VIEWS = 32;
const MAX_KEY_LENGTH = 240;

export const CATALOG_COLLECTIONS_STORAGE_KEY = STORAGE_KEY;
export const ALL_CARDS_CATALOG_ID = ALL_CARDS_ID;
export const MAX_CATALOG_COLLECTION_NAME_LENGTH =
  MAX_COLLECTION_NAME_LENGTH;

export function loadCatalogCollections({ readOnly = false } = {}) {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === null) {
      const initial = emptyState();
      return readOnly ? initial : persistLoadedState(initial);
    }
    const parsed = JSON.parse(stored);
    const normalized = normalizeState(parsed);
    return readOnly || parsed?.version === STORAGE_VERSION
      ? normalized
      : persistLoadedState(normalized);
  } catch (error) {
    console.error("Catalog data could not be read", error);
    return emptyState(true);
  }
}

export function createCatalogCollection(name) {
  return updateState((state) => {
    if (state.collections.length >= MAX_COLLECTIONS) {
      throw new TypeError("Catalog limit reached");
    }
    const cleanName = normalizeCatalogCollectionName(name);
    if (!cleanName) throw new TypeError("Enter a name");
    requireUniqueCollectionName(state, cleanName);
    const now = new Date().toISOString();
    const collection = {
      id: createCollectionId(),
      name: cleanName,
      keys: [],
      createdAt: now,
      updatedAt: now,
    };
    return {
      ...state,
      collections: [...state.collections, collection],
    };
  });
}

export function saveSharedDeskCollection(snapshot) {
  // Validate before touching storage. A copy lives entirely in this envelope,
  // so a failed write can never leave half an import in the saved-views store.
  const shared = createSharedDesk(snapshot, { includePrivate: true });
  return updateState((state) => {
    if (state.collections.length >= MAX_COLLECTIONS) {
      throw new TypeError("Catalog limit reached");
    }
    const id = createSharedCollectionId(state, shared.entries.length);
    const now = new Date().toISOString();
    const views = shared.entries.map((entry, index) => ({
      key: `desk-${id}-${index}`,
      cardId: entry.cardId,
      name: entry.name,
      state: cloneValue(entry.state),
    }));
    return {
      ...state,
      collections: [...state.collections, {
        id,
        name: uniqueSharedCollectionName(state, shared.name),
        keys: views.map((view) => view.key),
        views,
        palette: shared.palette,
        theme: shared.theme,
        createdAt: now,
        updatedAt: now,
      }],
    };
  });
}

export function renameCatalogCollection(collectionId, name) {
  return updateState((state) => {
    const id = requireCustomCollectionId(collectionId);
    const cleanName = normalizeCatalogCollectionName(name);
    if (!cleanName) throw new TypeError("Enter a name");
    requireUniqueCollectionName(state, cleanName, id);
    let found = false;
    const now = new Date().toISOString();
    const collections = state.collections.map((collection) => {
      if (collection.id !== id) return collection;
      found = true;
      return { ...collection, name: cleanName, updatedAt: now };
    });
    if (!found) throw new TypeError("Catalog not found");
    return { ...state, collections };
  });
}

export function deleteCatalogCollection(collectionId) {
  return updateState((state) => {
    const id = requireCustomCollectionId(collectionId);
    const collections = state.collections.filter(
      (collection) => collection.id !== id,
    );
    if (collections.length === state.collections.length) {
      throw new TypeError("Catalog not found");
    }
    return {
      ...state,
      activeId: state.activeId === id ? ALL_CARDS_ID : state.activeId,
      collections,
    };
  });
}

export function replaceCatalogCollectionKeys(collectionId, keys) {
  return updateState((state) => {
    const id = requireCustomCollectionId(collectionId);
    let found = false;
    const now = new Date().toISOString();
    const collections = state.collections.map((collection) => {
      if (collection.id !== id) return collection;
      found = true;
      return {
        ...withEmbeddedViews(collection, normalizeKeys(keys), state),
        updatedAt: now,
      };
    });
    if (!found) throw new TypeError("Catalog not found");
    return { ...state, collections };
  });
}

export function toggleCatalogCollectionKey(collectionId, key) {
  return updateState((state) => {
    const id = requireCustomCollectionId(collectionId);
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey) throw new TypeError("Invalid view reference");
    let found = false;
    const now = new Date().toISOString();
    const collections = state.collections.map((collection) => {
      if (collection.id !== id) return collection;
      found = true;
      const included = collection.keys.includes(normalizedKey);
      const keys = included
        ? collection.keys.filter((candidate) => candidate !== normalizedKey)
        : normalizeKeys([...collection.keys, normalizedKey]);
      return {
        ...withEmbeddedViews(collection, keys, state),
        updatedAt: now,
      };
    });
    if (!found) throw new TypeError("Catalog not found");
    return { ...state, collections };
  });
}

export function addCatalogCollectionKey(collectionId, key) {
  return updateState((state) => {
    const id = requireCustomCollectionId(collectionId);
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey) throw new TypeError("Invalid view reference");
    let found = false;
    const now = new Date().toISOString();
    const collections = state.collections.map((collection) => {
      if (collection.id !== id) return collection;
      found = true;
      const included = collection.keys.includes(normalizedKey);
      const keys = included
        ? collection.keys
        : normalizeKeys([...collection.keys, normalizedKey]);
      const next = withEmbeddedViews(collection, keys, state);
      if (included && next.views === collection.views) return collection;
      return {
        ...next,
        updatedAt: now,
      };
    });
    if (!found) throw new TypeError("Catalog not found");
    return { ...state, collections };
  });
}

export function removeCatalogKeyFromCollections(key) {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) return loadCatalogCollections();
  return updateState((state) => {
    const now = new Date().toISOString();
    const collections = state.collections.map((collection) => {
      if (!collection.keys.includes(normalizedKey)) return collection;
      return {
        ...collection,
        keys: collection.keys.filter(
          (candidate) => candidate !== normalizedKey,
        ),
        updatedAt: now,
      };
    });
    return { ...state, collections };
  });
}

export function activeCatalogCollection(
  state = loadCatalogCollections(),
  activeId = state.activeId,
) {
  if (activeId === ALL_CARDS_ID) {
    return { id: ALL_CARDS_ID, name: "All views", keys: null, system: true };
  }
  return state.collections.find((item) => item.id === activeId) ||
    { id: ALL_CARDS_ID, name: "All views", keys: null, system: true };
}

export function normalizeCatalogCollectionName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_COLLECTION_NAME_LENGTH);
}

function requireUniqueCollectionName(state, name, excludedId = "") {
  const comparable = name.toLocaleLowerCase();
  const duplicate =
    comparable === "all views" ||
    comparable === "all cards" ||
    state.collections.some(
      (collection) =>
        collection.id !== excludedId &&
        collection.name.toLocaleLowerCase() === comparable,
    );
  if (duplicate) throw new TypeError("Catalog name already exists");
}

function uniqueSharedCollectionName(state, name) {
  const base = normalizeCatalogCollectionName(name);
  const names = new Set([
    "all views", "all cards",
    ...state.collections.map((collection) => collection.name.toLocaleLowerCase()),
  ]);
  let candidate = base;
  for (let suffix = 2; names.has(candidate.toLocaleLowerCase()); suffix += 1) {
    const ending = ` (${suffix})`;
    const stem = base.slice(0, MAX_COLLECTION_NAME_LENGTH - ending.length).trimEnd();
    candidate = `${stem}${ending}`;
  }
  return candidate;
}

function updateState(transform) {
  const current = readWritableState();
  const next = normalizeState(transform(cloneState(current)));
  writeState(next);
  return cloneState(next);
}

function withEmbeddedViews(collection, keys, state) {
  const owned = new Set((collection.views || []).map((view) => view.key));
  const available = new Map(state.collections.flatMap((candidate) =>
    (candidate.views || []).map((view) => [view.key, view])));
  const additions = keys.filter((key) => !owned.has(key) && available.has(key))
    .map((key) => cloneValue(available.get(key)));
  if (!additions.length) return { ...collection, keys };
  const views = [...(collection.views || []), ...additions];
  if (views.length > MAX_EMBEDDED_VIEWS) throw new TypeError("Catalog is full");
  // A selected imported view must survive deletion of its original collection.
  // Each receiving collection owns its own snapshot, under the same view key.
  return { ...collection, keys, views };
}

function readWritableState() {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === null) return emptyState();
  try {
    return normalizeState(JSON.parse(stored));
  } catch {
    throw new Error("Catalog data is unavailable");
  }
}

function writeState(state) {
  const normalized = normalizeState(state);
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: normalized.version,
      activeId: normalized.activeId,
      collections: normalized.collections,
    }),
  );
}

function persistLoadedState(state) {
  try {
    writeState(state);
    return state;
  } catch (error) {
    console.error("Catalog data could not be saved", error);
    return { ...state, unavailable: true };
  }
}

function normalizeState(value) {
  if (LEGACY_STORAGE_VERSIONS.has(value?.version)) {
    return normalizeState(migrateLegacyState(value));
  }
  if (
    !value ||
    value.version !== STORAGE_VERSION ||
    !Array.isArray(value.collections) ||
    value.collections.length > MAX_COLLECTIONS
  ) {
    throw new TypeError("Unsupported Catalog version");
  }
  const seen = new Set();
  const embeddedDefinitions = new Map();
  const collections = value.collections.map(normalizeCollection);
  if (
    collections.some((collection) => !collection) ||
    collections.some((collection) => {
      if (seen.has(collection.id)) return true;
      seen.add(collection.id);
      return (collection.views || []).some((view) => {
        const definition = JSON.stringify(view);
        if (embeddedDefinitions.has(view.key)) {
          return embeddedDefinitions.get(view.key) !== definition;
        }
        embeddedDefinitions.set(view.key, definition);
        return false;
      });
    })
  ) {
    throw new TypeError("Catalog data is invalid");
  }
  const requestedActiveId = normalizeCollectionId(value.activeId);
  const activeId =
    requestedActiveId === ALL_CARDS_ID ||
    collections.some((collection) => collection.id === requestedActiveId)
      ? requestedActiveId
      : ALL_CARDS_ID;
  return {
    version: STORAGE_VERSION,
    activeId,
    collections,
    unavailable: false,
  };
}

function normalizeCollection(value) {
  try {
    if (!value || typeof value !== "object") return null;
    const id = requireCustomCollectionId(value.id);
    const name = normalizeCatalogCollectionName(value.name);
    if (!name || !Array.isArray(value.keys)) return null;
    const keys = normalizeKeys(value.keys);
    if (keys.length !== value.keys.length) return null;
    const embedded = Object.hasOwn(value, "views")
      ? { views: normalizeEmbeddedViews(value.views) }
      : {};
    return {
      id,
      name,
      keys,
      ...embedded,
      ...normalizeAppearance(value),
      createdAt: requireDate(value.createdAt),
      updatedAt: requireDate(value.updatedAt),
    };
  } catch {
    return null;
  }
}

function normalizeEmbeddedViews(views) {
  if (!Array.isArray(views) || views.length > MAX_EMBEDDED_VIEWS) {
    throw new TypeError("Invalid embedded Catalog views");
  }
  const seen = new Set();
  return views.map((value) => {
    if (!isRecord(value) || !isRecord(value.state) ||
      typeof value.cardId !== "string" ||
      Object.keys(value).some((field) =>
        !["key", "cardId", "name", "state", "palette", "theme"].includes(field))) {
      throw new TypeError("Invalid embedded Catalog view");
    }
    const key = normalizeKey(value.key);
    const name = normalizeCardDocumentName(value.name);
    if (!key || key !== value.key || seen.has(key) ||
      !name || name !== value.name) {
      throw new TypeError("Invalid embedded Catalog view");
    }
    seen.add(key);
    const compatible = migrateCardVisualizationState(value.cardId, value.state);
    const state = normalizeCardVisualization(value.cardId, compatible);
    const fields = Object.keys(state);
    // Persisted views are complete snapshots, not partial edit inputs. Reject
    // damaged or newer state instead of silently replacing it with defaults.
    if (
      Object.keys(compatible).length !== fields.length ||
      fields.some((field) =>
        !Object.hasOwn(compatible, field) ||
        JSON.stringify(state[field]) !== JSON.stringify(compatible[field]))
    ) {
      throw new TypeError("Invalid embedded Catalog state");
    }
    return {
      key,
      cardId: value.cardId,
      name,
      state,
      ...normalizeAppearance(value),
    };
  });
}

function normalizeAppearance(value) {
  const appearance = {};
  if (Object.hasOwn(value, "palette")) {
    if (!paletteIds().includes(value.palette)) {
      throw new TypeError("Invalid Catalog palette");
    }
    appearance.palette = value.palette;
  }
  if (Object.hasOwn(value, "theme")) {
    if (!THEMES.includes(value.theme)) {
      throw new TypeError("Invalid Catalog theme");
    }
    appearance.theme = value.theme;
  }
  return appearance;
}

function normalizeKeys(keys) {
  if (!Array.isArray(keys)) return [];
  const seen = new Set();
  const normalized = keys
    .map(normalizeKey)
    .filter((key) => {
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  if (normalized.length > MAX_COLLECTION_KEYS) {
    throw new TypeError("Catalog is full");
  }
  return normalized;
}

function normalizeKey(value) {
  const key = String(value || "").trim();
  return key &&
    key.length <= MAX_KEY_LENGTH &&
    /^[a-zA-Z0-9_-]+$/.test(key)
    ? key
    : "";
}

function normalizeCollectionId(value) {
  const id = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{1,96}$/.test(id) ? id : "";
}

function requireCustomCollectionId(value) {
  const id = normalizeCollectionId(value);
  if (!id || id === ALL_CARDS_ID) {
    throw new TypeError("Choose a named Catalog");
  }
  return id;
}

function requireDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("Invalid Catalog date");
  return date.toISOString();
}

function createCollectionId() {
  if (typeof window.crypto?.randomUUID === "function") {
    return `catalog-${window.crypto.randomUUID()}`;
  }
  return `catalog-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createSharedCollectionId(state, viewCount) {
  const ids = new Set(state.collections.map((collection) => collection.id));
  const keys = new Set(state.collections.flatMap((collection) => [
    ...collection.keys,
    ...(collection.views || []).map((view) => view.key),
  ]));
  const base = requireCustomCollectionId(createCollectionId());
  const collides = (id) => ids.has(id) ||
    Array.from({ length: viewCount }, (_, index) => `desk-${id}-${index}`)
      .some((key) => keys.has(key));
  let id = base;
  for (let suffix = 2; collides(id); suffix += 1) {
    const ending = `-${suffix}`;
    id = `${base.slice(0, 96 - ending.length)}${ending}`;
  }
  return id;
}

function emptyState(unavailable = false) {
  const now = new Date().toISOString();
  return {
    version: STORAGE_VERSION,
    activeId: unavailable ? ALL_CARDS_ID : OVERVIEW_CATALOG_ID,
    collections: unavailable
      ? []
      : STARTER_CATALOGS.map((catalog) => ({
          id: catalog.id,
          name: catalog.name,
          keys: [...catalog.keys],
          createdAt: now,
          updatedAt: now,
        })),
    unavailable,
  };
}

function migrateLegacyState(value) {
  const sourceVersion = value.version;
  const legacyState = normalizeState({
    ...value,
    version: STORAGE_VERSION,
  });
  const now = new Date().toISOString();
  let collections = [...legacyState.collections];
  // Introduce only starters newer than the stored schema. In particular v7
  // remembers Equities removals, so upgrading it must introduce Power alone.
  const additions = sourceVersion >= 7
    ? STARTER_CATALOGS.filter((catalog) => catalog.id === POWER_CATALOG_ID)
    : sourceVersion >= 4
      ? STARTER_CATALOGS.filter((catalog) =>
          [EQUITIES_CATALOG_ID, POWER_CATALOG_ID].includes(catalog.id))
      : sourceVersion === 2
        ? STARTER_CATALOGS.filter((catalog) => catalog.id !== PRIVATE_CATALOG_ID)
        : STARTER_CATALOGS;
  for (const starter of additions) {
    const starterName = starter.name.toLocaleLowerCase();
    const exists = collections.some(
      (collection) =>
        collection.id === starter.id ||
        collection.name.toLocaleLowerCase() === starterName,
    );
    if (exists || collections.length >= MAX_COLLECTIONS) continue;
    collections.push({
      id: starter.id,
      name: starter.name,
      keys: [...starter.keys],
      createdAt: now,
      updatedAt: now,
    });
  }
  if (sourceVersion >= 5) return { ...legacyState, collections };
  collections = collections.map((collection) => {
    if (
      ![OVERVIEW_CATALOG_ID, PRIVATE_CATALOG_ID].includes(collection.id) ||
      !collection.keys.includes(LEGACY_QUOTE_KEY)
    ) {
      return collection;
    }
    return {
      ...collection,
      keys: collection.keys.filter((key) => key !== LEGACY_QUOTE_KEY),
      updatedAt: now,
    };
  });
  return {
    ...legacyState,
    collections,
  };
}

function cloneState(state) {
  return {
    version: state.version,
    activeId: state.activeId,
    unavailable: Boolean(state.unavailable),
    collections: state.collections.map((collection) => ({
      ...collection,
      keys: [...collection.keys],
      ...(collection.views ? { views: collection.views.map((view) => ({
        ...view,
        state: cloneValue(view.state),
      })) } : {}),
    })),
  };
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]),
    );
  }
  return value;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
