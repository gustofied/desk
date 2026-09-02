const STORAGE_KEY = "desk.catalog-collections.v1";
const STORAGE_VERSION = 3;
const LEGACY_STORAGE_VERSIONS = new Set([1, 2]);
const ALL_CARDS_ID = "all";
const OVERVIEW_CATALOG_ID = "overview";
const HEDGE_CATALOG_ID = "hedge";
const PRIVATE_CATALOG_ID = "private";
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
]);
const MAX_COLLECTIONS = 16;
const MAX_COLLECTION_NAME_LENGTH = 48;
const MAX_COLLECTION_KEYS = 128;
const MAX_KEY_LENGTH = 240;

export const CATALOG_COLLECTIONS_STORAGE_KEY = STORAGE_KEY;
export const ALL_CARDS_CATALOG_ID = ALL_CARDS_ID;
export const MAX_CATALOG_COLLECTION_NAME_LENGTH =
  MAX_COLLECTION_NAME_LENGTH;

export function loadCatalogCollections() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === null) {
      const initial = emptyState();
      return persistLoadedState(initial);
    }
    const parsed = JSON.parse(stored);
    const normalized = normalizeState(parsed);
    return parsed?.version === STORAGE_VERSION
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
        ...collection,
        keys: normalizeKeys(keys),
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
      return {
        ...collection,
        keys: included
          ? collection.keys.filter((candidate) => candidate !== normalizedKey)
          : normalizeKeys([...collection.keys, normalizedKey]),
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
      if (collection.keys.includes(normalizedKey)) return collection;
      return {
        ...collection,
        keys: normalizeKeys([...collection.keys, normalizedKey]),
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

function updateState(transform) {
  const current = readWritableState();
  const next = normalizeState(transform(cloneState(current)));
  writeState(next);
  return cloneState(next);
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
  const collections = value.collections.map(normalizeCollection);
  if (
    collections.some((collection) => !collection) ||
    collections.some((collection) => {
      if (seen.has(collection.id)) return true;
      seen.add(collection.id);
      return false;
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
    return {
      id,
      name,
      keys,
      createdAt: requireDate(value.createdAt),
      updatedAt: requireDate(value.updatedAt),
    };
  } catch {
    return null;
  }
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
  const collections = [...legacyState.collections];
  const additions = sourceVersion === 2
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
    })),
  };
}
