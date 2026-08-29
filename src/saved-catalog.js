import {
  CARD_REGISTRY,
  normalizeCardState,
} from "./card-registry.js";

const STORAGE_KEY = "desk.catalog.v1";
const STORAGE_VERSION = 1;
const MAX_ITEMS_PER_CARD = 48;
export const MAX_CATALOG_NAME_LENGTH = 48;

const cardIds = new Set(CARD_REGISTRY.map((card) => card.id));

export function loadSavedCatalog(cardId) {
  return readEnvelope().items
    .filter((item) => item.cardId === cardId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function saveCatalogItem({
  cardId,
  name,
  state,
  itemId = null,
}) {
  if (!cardIds.has(cardId)) {
    throw new TypeError("Unknown card type");
  }

  const cleanName = normalizeCatalogName(name);
  if (!cleanName) {
    throw new TypeError("Enter a name");
  }

  const envelope = readEnvelope({ writable: true });
  const existing = itemId
    ? envelope.items.find(
        (item) => item.id === itemId && item.cardId === cardId,
      )
    : null;
  if (itemId && !existing) {
    throw new TypeError("This Catalog item no longer exists");
  }
  if (
    !existing &&
    envelope.items.filter((item) => item.cardId === cardId).length >=
      MAX_ITEMS_PER_CARD
  ) {
    throw new TypeError("Catalog is full");
  }
  const now = new Date().toISOString();
  const item = {
    id: existing?.id || createCatalogId(),
    name: cleanName,
    cardId,
    state: normalizeCardState(cardId, state),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  const items = [
    item,
    ...envelope.items.filter((candidate) => candidate.id !== item.id),
  ];

  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ version: STORAGE_VERSION, items }),
  );
  return item;
}

export function normalizeCatalogName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_CATALOG_NAME_LENGTH);
}

function readEnvelope({ writable = false } = {}) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
    if (parsed === null) return emptyEnvelope();
    if (parsed?.version !== STORAGE_VERSION) {
      if (writable) throw new Error("Unsupported Catalog version");
      return emptyEnvelope();
    }
    if (!Array.isArray(parsed.items)) {
      if (writable) throw new Error("Catalog data is invalid");
      return emptyEnvelope();
    }
    return {
      version: STORAGE_VERSION,
      items: parsed.items.map(normalizeStoredItem).filter(Boolean),
    };
  } catch (error) {
    if (writable) throw error;
    return emptyEnvelope();
  }
}

function normalizeStoredItem(value) {
  if (
    !value ||
    typeof value !== "object" ||
    !value.state ||
    typeof value.state !== "object"
  ) {
    return null;
  }
  const id = String(value.id || "");
  const cardId = String(value.cardId || "");
  const name = normalizeCatalogName(value.name);
  if (
    !/^[a-zA-Z0-9_-]{1,96}$/.test(id) ||
    !cardIds.has(cardId) ||
    !name
  ) {
    return null;
  }

  const createdAt = normalizeDate(value.createdAt);
  const updatedAt = normalizeDate(value.updatedAt);
  return {
    id,
    name,
    cardId,
    state: normalizeCardState(cardId, value.state),
    createdAt,
    updatedAt,
  };
}

function normalizeDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? new Date(0).toISOString()
    : date.toISOString();
}

function createCatalogId() {
  if (typeof window.crypto?.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `card-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function emptyEnvelope() {
  return { version: STORAGE_VERSION, items: [] };
}
