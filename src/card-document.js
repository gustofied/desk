import {
  cardStateParamIds,
  getCardDefinition,
  normalizeCardState,
} from "./card-registry.js";

export const CARD_DOCUMENT_SCHEMA = "desk.card";
export const CARD_DOCUMENT_VERSION = 1;
export const MAX_CARD_DOCUMENT_NAME_LENGTH = 48;

const DOCUMENT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,96}$/;

export function createCardDocument({
  id,
  cardId,
  name,
  state,
  visualization = state,
  createdAt = new Date().toISOString(),
  updatedAt = createdAt,
} = {}) {
  const card = requireCardDefinition(cardId);
  return normalizeCardDocument({
    schema: CARD_DOCUMENT_SCHEMA,
    version: CARD_DOCUMENT_VERSION,
    id,
    cardId: card.id,
    renderer: card.renderer,
    name,
    visualization,
    createdAt,
    updatedAt,
  });
}

export function normalizeCardDocument(value) {
  if (!isRecord(value)) {
    throw new TypeError("A Desk CardDocument is required");
  }
  if (
    value.schema !== CARD_DOCUMENT_SCHEMA ||
    value.version !== CARD_DOCUMENT_VERSION
  ) {
    throw new TypeError("Unsupported Desk CardDocument version");
  }

  const card = requireCardDefinition(value.cardId);
  if (value.renderer !== card.renderer) {
    throw new TypeError("Card renderer does not match its registered type");
  }

  const id = normalizeDocumentId(value.id);
  const name = normalizeCardDocumentName(value.name);
  if (!name) throw new TypeError("Enter a name");

  return {
    schema: CARD_DOCUMENT_SCHEMA,
    version: CARD_DOCUMENT_VERSION,
    id,
    cardId: card.id,
    renderer: card.renderer,
    name,
    visualization: normalizeCardVisualization(card.id, value.visualization),
    createdAt: normalizeDocumentDate(value.createdAt, "createdAt"),
    updatedAt: normalizeDocumentDate(value.updatedAt, "updatedAt"),
  };
}

export function normalizeCardVisualization(cardId, state = {}) {
  const card = requireCardDefinition(cardId);
  const normalized = normalizeCardState(card.id, isRecord(state) ? state : {});
  const visualization = {};

  for (const paramId of cardStateParamIds(card)) {
    if (!Object.hasOwn(normalized, paramId)) {
      throw new TypeError(
        `Card state normalizer did not provide ${JSON.stringify(paramId)}`,
      );
    }
    visualization[paramId] = cloneStateValue(normalized[paramId]);
  }

  return visualization;
}

export function normalizeCardDocumentName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_CARD_DOCUMENT_NAME_LENGTH);
}

export function cardDocumentFromCatalogItem(item) {
  if (!isRecord(item)) {
    throw new TypeError("A Catalog item is required");
  }
  return createCardDocument({
    id: item.id,
    cardId: item.cardId,
    name: item.name,
    state: item.state,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  });
}

export function catalogItemFromCardDocument(value) {
  const document = normalizeCardDocument(value);
  return {
    id: document.id,
    name: document.name,
    cardId: document.cardId,
    state: cloneStateValue(document.visualization),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function requireCardDefinition(cardId) {
  const requestedId = String(cardId || "");
  const card = getCardDefinition(requestedId);
  if (!requestedId || card.id !== requestedId) {
    throw new TypeError("Unknown card type");
  }
  if (typeof card.renderer !== "string" || !card.renderer) {
    throw new TypeError("Card type is missing a renderer");
  }
  return card;
}

function normalizeDocumentId(value) {
  const id = String(value || "");
  if (!DOCUMENT_ID_PATTERN.test(id)) {
    throw new TypeError("Invalid CardDocument id");
  }
  return id;
}

function normalizeDocumentDate(value, field) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Invalid CardDocument ${field}`);
  }
  return date.toISOString();
}

function cloneStateValue(value) {
  if (Array.isArray(value)) return value.map(cloneStateValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneStateValue(entry)]),
    );
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  throw new TypeError("Card visualization state must be JSON-safe");
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
