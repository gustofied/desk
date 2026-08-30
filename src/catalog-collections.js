const STORAGE_KEY = "desk.catalog-collections.v1";
const STORAGE_VERSION = 2;
const LEGACY_STORAGE_VERSION = 1;
const ALL_CARDS_ID = "all";
const PRIVATE_CATALOG_ID = "private";
const PRIVATE_CATALOG_KEYS = Object.freeze([
  "preset-deal-view-deal-041",
  "preset-gpu-index-b200",
  "preset-gpu-price-snapshot-prices",
  "preset-gpu-market-depth-h100-us",
]);
const MAX_COLLECTIONS = 13;
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
    if (stored === null) return emptyState();
    return normalizeState(JSON.parse(stored));
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

function normalizeState(value) {
  if (value?.version === LEGACY_STORAGE_VERSION) {
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
    activeId: ALL_CARDS_ID,
    collections: unavailable
      ? []
      : [
          {
            id: PRIVATE_CATALOG_ID,
            name: "Private",
            keys: [...PRIVATE_CATALOG_KEYS],
            createdAt: now,
            updatedAt: now,
          },
        ],
    unavailable,
  };
}

function migrateLegacyState(value) {
  const legacyValue = {
    ...value,
    version: STORAGE_VERSION,
  };
  const normalized = normalizeState(legacyValue);
  const namedPrivate = normalized.collections.find(
    (collection) => collection.name.toLocaleLowerCase() === "private",
  );
  const now = new Date().toISOString();

  if (namedPrivate) {
    return {
      ...normalized,
      collections: normalized.collections.map((collection) =>
        collection.id === namedPrivate.id
          ? {
              ...collection,
              keys: normalizeKeys([...collection.keys, ...PRIVATE_CATALOG_KEYS]),
              updatedAt: now,
            }
          : collection,
      ),
    };
  }

  if (normalized.collections.length >= MAX_COLLECTIONS) {
    return normalized;
  }

  return {
    ...normalized,
    collections: [
      ...normalized.collections,
      {
        id: PRIVATE_CATALOG_ID,
        name: "Private",
        keys: [...PRIVATE_CATALOG_KEYS],
        createdAt: now,
        updatedAt: now,
      },
    ],
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
