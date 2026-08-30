import { CARD_REGISTRY } from "./card-registry.js";
import {
  CARD_DOCUMENT_SCHEMA,
  CARD_DOCUMENT_VERSION,
  MAX_CARD_DOCUMENT_NAME_LENGTH,
  cardDocumentFromCatalogItem,
  catalogItemFromCardDocument,
  createCardDocument,
  normalizeCardDocument,
  normalizeCardDocumentName,
} from "./card-document.js";

const STORAGE_KEY = "desk.catalog.v2";
const LEGACY_STORAGE_KEY = "desk.catalog.v1";
const STORAGE_VERSION = 2;
const LEGACY_STORAGE_VERSION = 1;
const MAX_ITEMS_PER_CARD = 48;
export const MAX_CATALOG_NAME_LENGTH = MAX_CARD_DOCUMENT_NAME_LENGTH;

const cardIds = new Set(CARD_REGISTRY.map((card) => card.id));

export function loadSavedCatalog(cardId) {
  return readEnvelope().items
    .filter((document) => document.cardId === cardId)
    .map(catalogItemFromCardDocument)
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
        (document) => document.id === itemId && document.cardId === cardId,
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
  const document = createCardDocument({
    id: existing?.id || createCatalogId(),
    name: cleanName,
    cardId,
    state,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  });
  const items = [
    document,
    ...envelope.items.filter((candidate) => candidate.id !== document.id),
  ];

  writeEnvelope({ version: STORAGE_VERSION, items });
  return catalogItemFromCardDocument(document);
}

export function deleteCatalogItem({ cardId, itemId } = {}) {
  if (!cardIds.has(cardId)) {
    throw new TypeError("Unknown card type");
  }
  const id = String(itemId || "");
  if (!/^[a-zA-Z0-9_-]{1,96}$/.test(id)) {
    throw new TypeError("Invalid Catalog item id");
  }

  const envelope = readEnvelope({ writable: true });
  const items = envelope.items.filter(
    (document) => !(document.id === id && document.cardId === cardId),
  );
  if (items.length === envelope.items.length) return false;
  writeEnvelope({ version: STORAGE_VERSION, items });
  return true;
}

export function normalizeCatalogName(value) {
  return normalizeCardDocumentName(value);
}

function readEnvelope({ writable = false } = {}) {
  try {
    const current = window.localStorage.getItem(STORAGE_KEY);
    if (current !== null) {
      return parseCurrentEnvelope(current, { writable });
    }

    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy === null) return emptyEnvelope();
    const migrated = migrateLegacyEnvelope(legacy);
    try {
      writeEnvelope(migrated);
    } catch (error) {
      if (writable) throw error;
    }
    return migrated;
  } catch (error) {
    if (writable) throw error;
    return emptyEnvelope();
  }
}

function parseCurrentEnvelope(text, { writable }) {
  const parsed = JSON.parse(text);
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
    items: parsed.items.map(normalizeStoredDocument).filter(Boolean),
  };
}

function migrateLegacyEnvelope(text) {
  const parsed = JSON.parse(text);
  if (parsed?.version !== LEGACY_STORAGE_VERSION) {
    throw new Error("Unsupported legacy Catalog version");
  }
  if (!Array.isArray(parsed.items)) {
    throw new Error("Legacy Catalog data is invalid");
  }
  return {
    version: STORAGE_VERSION,
    items: parsed.items.map(migrateLegacyItem).filter(Boolean),
  };
}

function normalizeStoredDocument(value) {
  try {
    return normalizeCardDocument(value);
  } catch {
    return null;
  }
}

function migrateLegacyItem(value) {
  try {
    const legacy = {
      ...value,
      createdAt: normalizeLegacyDate(value?.createdAt),
      updatedAt: normalizeLegacyDate(value?.updatedAt),
    };
    return cardDocumentFromCatalogItem(legacy);
  } catch {
    return null;
  }
}

function normalizeLegacyDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? new Date(0).toISOString()
    : date.toISOString();
}

function writeEnvelope(envelope) {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: STORAGE_VERSION,
      items: envelope.items.map(normalizeCardDocument),
      documentSchema: CARD_DOCUMENT_SCHEMA,
      documentVersion: CARD_DOCUMENT_VERSION,
    }),
  );
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
