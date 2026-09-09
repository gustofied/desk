import {
  migrateCardVisualizationState,
  normalizeCardDocumentName,
  normalizeCardVisualization,
} from "./card-document.js";
import { EQUITY_LAYERS, paletteIds, THEMES } from "./card-registry.js";
import { createSharedDesk } from "./shared-desk.js";

const STORAGE_KEY = "desk.catalog-collections.v1";
const STORAGE_VERSION = 18;
const LEGACY_STORAGE_VERSIONS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
const ALL_CARDS_ID = "all";
const OVERVIEW_CATALOG_ID = "overview";
const HEDGE_CATALOG_ID = "hedge";
const LEASE_CATALOG_ID = "lease";
const PRIVATE_CATALOG_ID = "private";
const EQUITIES_CATALOG_ID = "equities";
const POWER_CATALOG_ID = "power";
const SANDBOX_CATALOG_ID = "sandbox";
const COMPUTE_CATALOG_ID = "compute";
const DEALS_CATALOG_ID = "deals";
const TEAM_CATALOG_ID = "team";
const LEGACY_QUOTE_KEY = "preset-quote-view-quote-041";
const PREVIOUS_OVERVIEW_STARTER = Object.freeze({
  id: OVERVIEW_CATALOG_ID,
  name: "Overview",
  keys: Object.freeze([
    "preset-gpu-price-snapshot-prices",
    "preset-gpu-index-h200",
    "preset-gpu-market-depth-h100-us",
    "preset-power-basis-pjm-dominion",
    "preset-equities-coreweave-compute",
    "preset-sandbox-cost-cost",
    "preset-forward-prices-h100-curve",
    "preset-forward-prices-h100",
  ]),
});
const STARTER_CATALOGS = Object.freeze([
  Object.freeze({
    id: OVERVIEW_CATALOG_ID,
    name: "Overview",
    keys: Object.freeze([
      "preset-gpu-price-snapshot-prices",
      "preset-gpu-index-h200",
      "preset-gpu-market-depth-h100-us",
      "preset-power-basis-pjm-dominion",
      "preset-equities-nvidia-compute-bars",
      "preset-forward-prices-h100-curve",
      "preset-forward-prices-h100",
      "preset-gpu-hedge-buyer",
      "preset-gpu-hedge-seller",
      "preset-gpu-lease-residual",
      "preset-deal-view-deal-041",
      "preset-sandbox-cost-cost",
    ]),
  }),
  Object.freeze({
    id: COMPUTE_CATALOG_ID,
    name: "Compute",
    keys: Object.freeze([
      "preset-gpu-price-snapshot-prices",
      "preset-gpu-index-h100",
      "preset-gpu-index-h200",
      "preset-gpu-index-b200",
      "preset-gpu-index-compute-market",
      "preset-gpu-market-depth-h100-us",
    ]),
  }),
  Object.freeze({
    id: "forward", name: "Forward", keys: Object.freeze([
      "preset-forward-prices-h100", "preset-forward-prices-h100-curve",
      "preset-forward-prices-h200", "preset-forward-prices-b200",
    ]),
  }),
  Object.freeze({
    id: HEDGE_CATALOG_ID,
    name: "Hedge",
    keys: Object.freeze([
      "preset-gpu-hedge-buyer",
      "preset-gpu-hedge-seller",
      "preset-gpu-hedge-coverage",
      "preset-gpu-index-h100-b200-spread",
      "preset-gpu-index-h200-b300-spread",
      "preset-power-basis-pjm-west-spread",
      "preset-equities-nvidia-compute",
      "preset-equities-clouds-compute",
    ]),
  }),
  Object.freeze({
    id: LEASE_CATALOG_ID,
    name: "Lease",
    keys: Object.freeze(["preset-gpu-lease-residual"]),
  }),
  Object.freeze({
    id: POWER_CATALOG_ID,
    name: "Power",
    keys: Object.freeze([
      "preset-power-basis-pjm-dominion",
      "preset-power-basis-ercot-north",
      "preset-power-basis-pjm-west-spread",
    ]),
  }),
  Object.freeze({
    id: EQUITIES_CATALOG_ID,
    name: "Equities",
    keys: Object.freeze([
      "preset-equities-nvda",
      "preset-equities-chips",
      "preset-equities-hyperscalers",
      "preset-equities-neoclouds",
      "preset-equities-nvidia-compute",
    ]),
  }),
  Object.freeze({
    id: DEALS_CATALOG_ID,
    name: "Deals",
    keys: Object.freeze([
      "preset-quote-view-b200",
      "preset-deal-view-deal-041",
      "preset-gpu-index-b200",
    ]),
  }),
  Object.freeze({
    id: SANDBOX_CATALOG_ID,
    name: "Sandbox",
    keys: Object.freeze([
      "preset-sandbox-cost-cost",
      "preset-sandbox-cost-history",
    ]),
  }),
  Object.freeze({
    id: PRIVATE_CATALOG_ID,
    name: "Private",
    keys: Object.freeze([
      "preset-quote-view-h200",
      "preset-gpu-index-h200",
      "preset-equities-nvidia-compute",
    ]),
  }),
  Object.freeze({
    id: TEAM_CATALOG_ID,
    name: "Team",
    keys: Object.freeze([
      "preset-gpu-price-snapshot-prices",
      "preset-gpu-index-compute-market",
      "preset-gpu-market-depth-h100-us",
      "preset-power-basis-pjm-dominion",
      "preset-deal-view-deal-041",
    ]),
  }),
]);
// Keep the previous definitions for a conservative upgrade: authored catalogs
// are never replaced just because they happen to use a starter's ID or name.
const LEGACY_STARTER_CATALOGS = Object.freeze([
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
  Object.freeze({
    id: SANDBOX_CATALOG_ID,
    name: "Sandbox",
    keys: Object.freeze([
      "preset-sandbox-cost-cost",
      "preset-sandbox-cost-history",
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
    return normalizeState(upgradeOverviewStarter(migrateLegacyState(value)));
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
  if (sourceVersion >= 17) return legacyState;
  // Add Revenue hedge only to an untouched prior Hedge; never restore Lease.
  if (sourceVersion >= 16) return upgradeHedgeStarter(legacyState, now, sourceVersion);
  // Introduce Lease once, without restoring removed older starters or views.
  if (sourceVersion >= 15) return addLeaseStarter(upgradeHedgeStarter(legacyState, now, sourceVersion), now);
  if (sourceVersion >= 13) return addLeaseStarter(upgradeHedgeStarter(legacyState, now, sourceVersion), now);
  let collections = [...legacyState.collections];
  const forward = STARTER_CATALOGS.find(starter => starter.id === "forward");
  if (sourceVersion < 11 && collections.length < MAX_COLLECTIONS && !collections.some(collection => collection.id === forward.id || collection.name.toLowerCase() === "forward")) {
    collections.push({ ...forward, keys: [...forward.keys], createdAt: now, updatedAt: now });
  }
  if (sourceVersion >= 10) return addLeaseStarter(upgradeHedgeStarter(composeStarterUpgrade({ ...legacyState, collections }, now), now, sourceVersion), now);
  // Introduce only starters newer than the stored schema; current-version
  // removals remain intentional and must not recreate a user's deleted catalog.
  const additions = LEGACY_STARTER_CATALOGS.filter((catalog) => {
    if (sourceVersion >= 9) return false;
    if (sourceVersion >= 8) return catalog.id === SANDBOX_CATALOG_ID;
    if (sourceVersion >= 7) return [POWER_CATALOG_ID, SANDBOX_CATALOG_ID].includes(catalog.id);
    if (sourceVersion >= 4) return [EQUITIES_CATALOG_ID, POWER_CATALOG_ID, SANDBOX_CATALOG_ID].includes(catalog.id);
    return sourceVersion !== 2 || catalog.id !== PRIVATE_CATALOG_ID;
  });
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
  if (sourceVersion < 5) collections = collections.map((collection) => {
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
  return addLeaseStarter(upgradeHedgeStarter(composeStarterUpgrade({ ...legacyState, collections }, now), now, sourceVersion), now);
}

function addLeaseStarter(state, now) {
  const starter = STARTER_CATALOGS.find(catalog => catalog.id === LEASE_CATALOG_ID);
  if (state.collections.length >= MAX_COLLECTIONS || state.collections.some(collection =>
    collection.id === starter.id || collection.name.toLocaleLowerCase() === starter.name.toLocaleLowerCase())) {
    return state;
  }
  const collections = [...state.collections];
  const hedgeIndex = collections.findIndex(collection => collection.id === HEDGE_CATALOG_ID);
  collections.splice(hedgeIndex < 0 ? collections.length : hedgeIndex + 1, 0, {
    ...starter, keys: [...starter.keys], createdAt: now, updatedAt: now,
  });
  return { ...state, collections };
}

function upgradeHedgeStarter(state, now, sourceVersion) {
  const next = STARTER_CATALOGS.find(starter => starter.id === HEDGE_CATALOG_ID);
  const previous = { ...next, keys: next.keys.filter(key =>
    key !== "preset-gpu-hedge-seller" &&
    (sourceVersion >= 15 || key !== "preset-gpu-hedge-coverage") &&
    (sourceVersion >= 14 || key !== "preset-gpu-hedge-buyer")) };
  return {
    ...state,
    collections: state.collections.map(collection => matchesStarter(collection, previous)
      ? { ...collection, keys: [...next.keys], updatedAt: now }
      : collection),
  };
}

function upgradeOverviewStarter(state) {
  const next = STARTER_CATALOGS.find(starter => starter.id === OVERVIEW_CATALOG_ID);
  return {
    ...state,
    collections: state.collections.map(collection => matchesStarter(collection, PREVIOUS_OVERVIEW_STARTER)
      ? { ...collection, keys: [...next.keys], updatedAt: new Date().toISOString() }
      : collection),
  };
}

function matchesStarter(collection, starter) {
  return collection.id === starter.id && collection.name === starter.name &&
    !Object.hasOwn(collection, "views") &&
    !Object.hasOwn(collection, "palette") && !Object.hasOwn(collection, "theme") &&
    JSON.stringify(collection.keys) === JSON.stringify(starter.keys);
}

function composeStarterUpgrade(state, now) {
  const legacyById = new Map(LEGACY_STARTER_CATALOGS.map((starter) => [starter.id, starter]));
  const starterById = new Map(STARTER_CATALOGS.map((starter) => [starter.id, starter]));
  // Only the untouched original ordering is replaced with the new showcase
  // order. A user's reordered, renamed, or custom collection list stays put.
  const originalOrder = LEGACY_STARTER_CATALOGS.filter((starter) =>
    state.collections.some((collection) => collection.id === starter.id));
  const pristineOrder = state.collections.length === originalOrder.length &&
    state.collections.every((collection, index) => matchesStarter(collection, originalOrder[index]));
  const collections = state.collections.map((collection) => {
    const previous = legacyById.get(collection.id);
    const next = starterById.get(collection.id);
    if (next?.id === OVERVIEW_CATALOG_ID) {
      const oldKeys = PREVIOUS_OVERVIEW_STARTER.keys.map(key => key === "preset-equities-coreweave-compute" ? "preset-equities-nvda" : key);
      const variants = [oldKeys, oldKeys.filter(key => !key.startsWith("preset-forward-prices-"))];
      if (variants.some(keys => matchesStarter(collection, { ...next, keys }))) {
        return { ...collection, keys: [...next.keys], updatedAt: now };
      }
    }
    if (!previous || !next || !matchesStarter(collection, previous)) return collection;
    if (JSON.stringify(collection.keys) === JSON.stringify(next.keys)) return collection;
    return { ...collection, keys: [...next.keys], updatedAt: now };
  });
  for (const id of [COMPUTE_CATALOG_ID, DEALS_CATALOG_ID, TEAM_CATALOG_ID]) {
    const starter = starterById.get(id);
    if (collections.length >= MAX_COLLECTIONS || collections.some((collection) =>
      collection.id === id || collection.name.toLocaleLowerCase() === starter.name.toLocaleLowerCase())) continue;
    collections.push({
      id, name: starter.name, keys: [...starter.keys], createdAt: now, updatedAt: now,
    });
  }
  if (pristineOrder) {
    const order = new Map(STARTER_CATALOGS.map((starter, index) => [starter.id, index]));
    collections.sort((a, b) => order.get(a.id) - order.get(b.id));
  }
  return { ...state, collections };
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
