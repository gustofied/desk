const STORAGE_KEY = "desk.catalog-order.v1";
const STORAGE_VERSION = 1;
const MAX_CATALOG_KEYS = 256;
const MAX_KEY_LENGTH = 240;
export const CATALOG_ORDER_STORAGE_KEY = STORAGE_KEY;

export function loadCatalogOrder() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
    if (parsed?.version !== STORAGE_VERSION || !Array.isArray(parsed.keys)) {
      return [];
    }
    return normalizeKeys(parsed.keys);
  } catch {
    return [];
  }
}

export function orderCatalogEntries(entries, storedKeys) {
  const entriesByKey = new Map(entries.map((entry) => [entry.key, entry]));
  const ordered = normalizeKeys(storedKeys)
    .map((key) => entriesByKey.get(key))
    .filter(Boolean);
  const included = new Set(ordered.map((entry) => entry.key));
  return [
    ...ordered,
    ...entries.filter((entry) => !included.has(entry.key)),
  ];
}

export function saveCatalogOrder(keys) {
  const normalized = normalizeKeys(keys);
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: STORAGE_VERSION, keys: normalized }),
    );
  } catch {
    // The in-memory order still applies when storage is unavailable.
  }
  return normalized;
}

function normalizeKeys(keys) {
  if (!Array.isArray(keys)) return [];
  const seen = new Set();
  return keys
    .map((key) => String(key || "").trim())
    .filter((key) => {
      if (
        !key ||
        key.length > MAX_KEY_LENGTH ||
        !/^[a-zA-Z0-9_-]+$/.test(key) ||
        seen.has(key)
      ) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, MAX_CATALOG_KEYS);
}
