import {
  CARD_REGISTRY,
  DEFAULT_PALETTE,
  DEFAULT_THEME,
  THEMES,
  cardStateParamIds,
  paletteIds,
} from "./card-registry.js";
import {
  MAX_CARD_DOCUMENT_NAME_LENGTH,
  normalizeCardDocumentName,
  normalizeCardVisualization,
} from "./card-document.js";

export const SHARED_DESK_VERSION = 1;
export const MAX_SHARED_DESK_ENTRIES = 32;
export const MAX_SHARED_DESK_NAME_LENGTH = MAX_CARD_DOCUMENT_NAME_LENGTH;
export const MAX_SHARED_DESK_TOKEN_LENGTH = 32_768;

const INVALID_LINK = "Shared desk link is invalid.";
const cards = new Map(CARD_REGISTRY.map((card) => [card.id, card]));
const snapshotKeys = ["version", "name", "entries", "palette", "theme"];
const entryKeys = ["cardId", "name", "state"];

/** A share contains chart definitions only: no local IDs, data, or account state. */
export function createSharedDesk(value, { includePrivate = false } = {}) {
  requireKeys(value, snapshotKeys, ["name", "entries"]);
  if (Object.hasOwn(value, "version") && value.version !== SHARED_DESK_VERSION) {
    throw new TypeError("Unsupported shared desk version.");
  }
  if (typeof includePrivate !== "boolean") {
    throw new TypeError("Shared desk privacy choice must be a boolean.");
  }
  const name = normalizeName(value.name);
  const palette = enumValue(Object.hasOwn(value, "palette") ? value.palette : DEFAULT_PALETTE, paletteIds(), "palette");
  const theme = enumValue(Object.hasOwn(value, "theme") ? value.theme : DEFAULT_THEME, THEMES, "theme");
  requireEntries(value.entries);
  // Validate before filtering: omission must not disguise an invalid input.
  const entries = value.entries.map((entry) => normalizeEntry(entry, false))
    .filter((entry) => includePrivate || cards.get(entry.cardId).renderer !== "deal");
  if (!entries.length) throw new Error("This desk has no shareable views.");
  return { version: SHARED_DESK_VERSION, name, entries, palette, theme };
}

/** Base64url encodes UTF-8, rather than the Latin-1 strings accepted by btoa. */
export function encodeSharedDesk(snapshot) {
  const normalized = validateSnapshot(snapshot);
  const bytes = new TextEncoder().encode(JSON.stringify(normalized));
  // Check the encoded size before constructing a potentially oversized token.
  if (Math.ceil(bytes.length * 4 / 3) > MAX_SHARED_DESK_TOKEN_LENGTH) {
    throw new RangeError("Shared desk link is too large.");
  }
  return encodeBytes(bytes);
}

export function decodeSharedDesk(token) {
  if (typeof token !== "string") throw new TypeError(INVALID_LINK);
  if (token.length > MAX_SHARED_DESK_TOKEN_LENGTH) {
    throw new RangeError("Shared desk link is too large.");
  }
  if (!token || !/^[A-Za-z0-9_-]+$/.test(token) || token.length % 4 === 1) {
    throw new TypeError(INVALID_LINK);
  }
  let value;
  try {
    const binary = atob(token.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    // Reject alternate encodings with nonzero padding bits and invalid UTF-8.
    if (encodeBytes(bytes) !== token) throw new TypeError(INVALID_LINK);
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    value = JSON.parse(text);
  } catch {
    throw new TypeError(INVALID_LINK);
  }
  return validateSnapshot(value);
}

export function sharedDeskUrl(snapshot, baseUrl) {
  const url = httpUrl(baseUrl);
  url.username = "";
  url.password = "";
  url.search = "?view=gallery";
  url.hash = `desk=${encodeSharedDesk(snapshot)}`;
  return url.href;
}

export function readSharedDeskUrl(href) {
  try {
    const url = httpUrl(href);
    if (url.hash !== "#desk" && !url.hash.startsWith("#desk=")) {
      return { snapshot: null, error: null };
    }
    return { snapshot: decodeSharedDesk(url.hash.slice(6)), error: null };
  } catch {
    return { snapshot: null, error: INVALID_LINK };
  }
}

function validateSnapshot(value) {
  requireKeys(value, snapshotKeys, snapshotKeys);
  if (value.version !== SHARED_DESK_VERSION) {
    throw new TypeError("Unsupported shared desk version.");
  }
  const name = normalizeName(value.name);
  const palette = enumValue(value.palette, paletteIds(), "palette");
  const theme = enumValue(value.theme, THEMES, "theme");
  if (name !== value.name || palette !== value.palette || theme !== value.theme) {
    throw new TypeError(INVALID_LINK);
  }
  requireEntries(value.entries);
  return {
    version: SHARED_DESK_VERSION,
    name,
    entries: value.entries.map((entry) => normalizeEntry(entry, true)),
    palette,
    theme,
  };
}

function normalizeEntry(value, strict) {
  requireKeys(value, entryKeys, entryKeys);
  const card = cards.get(value.cardId);
  if (!card) throw new TypeError("Unknown shared desk card type.");
  const name = normalizeName(value.name);
  const state = normalizeState(card, value.state, strict);
  if (strict && name !== value.name) throw new TypeError(INVALID_LINK);
  return { cardId: card.id, name, state };
}

function normalizeState(card, value, strict) {
  const canonicalKeys = cardStateParamIds(card);
  // normalizeCardState includes these known, redundant fields. Accept them
  // during creation only; links always contain the canonical document fields.
  const extraKeys = card.stateKind === "deal"
    ? ["layers", "scale", "range"]
    : card.primaryParam && card.primaryParam !== "gpu" ? ["gpu"] : [];
  requireKeys(value, strict ? canonicalKeys : [...canonicalKeys, ...extraKeys], strict ? canonicalKeys : []);
  const input = {};
  const layerIds = card.layers.map((layer) => layer.id);
  const primaryIds = card.layers.filter((layer) => layer.primary !== false).map((layer) => layer.id);
  const primaryKey = card.primaryParam || "gpu";
  for (const [key, item] of Object.entries(value)) {
    const option = card.stateOptions?.find((candidate) => candidate.id === key);
    if (option) input[key] = optionValue(item, option);
    else if (key === "layers") {
      if (!Array.isArray(item) || !item.length || item.length > layerIds.length || !isDenseArray(item)) {
        throw new TypeError("Invalid shared desk layers.");
      }
      input.layers = item.map((layer) => enumValue(layer, layerIds, "layer"));
      if (new Set(input.layers).size !== input.layers.length) {
        throw new TypeError("Invalid shared desk layers.");
      }
    } else if (key === primaryKey || key === "gpu") {
      input[key] = enumValue(item, primaryIds, key);
    } else if (key === "scale") {
      input.scale = enumValue(item, card.visualizations.map(({ id }) => id), key);
    } else if (key === "range") input.range = enumValue(item, card.ranges, key);
    else if (key === "palette") input.palette = enumValue(item, paletteIds(), key);
    else if (key === "theme") input.theme = enumValue(item, THEMES, key);
  }
  const normalized = normalizeCardVisualization(card.id, input);
  if (strict) {
    if (canonicalKeys.some((key) => JSON.stringify(value[key]) !== JSON.stringify(normalized[key]))) {
      throw new TypeError("Shared desk chart state is not canonical.");
    }
  } else {
    // Redundant fields must agree; never silently lose a distinct configuration.
    for (const key of extraKeys) {
      if (!Object.hasOwn(input, key)) continue;
      const expected = key === "gpu" ? normalized[primaryKey]
        : key === "layers" ? [normalized.gpu] : card.defaults[key];
      if (JSON.stringify(input[key]) !== JSON.stringify(expected)) {
        throw new TypeError("Shared desk chart state is inconsistent.");
      }
    }
  }
  return normalized;
}

function optionValue(value, option) {
  if (option.type === "integer" || option.type === "decimal") {
    if (typeof value !== "number" || !Number.isFinite(value) ||
      value < option.min || value > option.max ||
      (option.type === "integer" && !Number.isInteger(value)) ||
      (option.type === "decimal" && Number(value.toFixed(option.precision ?? 2)) !== value)) {
      throw new TypeError(`Invalid shared desk ${option.id}.`);
    }
    return value;
  }
  if (option.type === "month") {
    if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value) ||
      value < option.min || value > option.max) {
      throw new TypeError(`Invalid shared desk ${option.id}.`);
    }
    return value;
  }
  return enumValue(value, option.values, option.id);
}

function enumValue(value, values, field) {
  if (typeof value !== "string" || value.length > 64) {
    throw new TypeError(`Invalid shared desk ${field}.`);
  }
  const match = values.find((candidate) => candidate.toLowerCase() === value.toLowerCase());
  if (match === undefined) throw new TypeError(`Invalid shared desk ${field}.`);
  return match;
}

function normalizeName(value) {
  if (typeof value !== "string") throw new TypeError("A shared desk name is required.");
  if (value.length > MAX_SHARED_DESK_NAME_LENGTH) {
    throw new RangeError(`Shared desk names can contain at most ${MAX_SHARED_DESK_NAME_LENGTH} characters.`);
  }
  if (!value || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ||
    [...value].some((character) => {
      const code = character.codePointAt(0);
      return code >= 0xd800 && code <= 0xdfff;
    })) throw new TypeError("A shared desk name is required.");
  const name = normalizeCardDocumentName(value);
  if (!name) throw new TypeError("A shared desk name is required.");
  return name;
}

function requireEntries(entries) {
  if (!Array.isArray(entries)) throw new TypeError("Shared desk views must be an array.");
  if (entries.length > MAX_SHARED_DESK_ENTRIES) {
    throw new RangeError("A shared desk can contain at most 32 views.");
  }
  if (!entries.length) throw new Error("This desk has no shareable views.");
  // Sparse arrays would otherwise serialize unvalidated null entries.
  if (!isDenseArray(entries)) throw new TypeError(INVALID_LINK);
}

function isDenseArray(value) {
  return Array.isArray(value) &&
    Reflect.ownKeys(value).length === value.length + 1 &&
    Array.from({ length: value.length }, (_, index) =>
      Object.getOwnPropertyDescriptor(value, index)).every((descriptor) =>
      descriptor && Object.hasOwn(descriptor, "value") && descriptor.enumerable);
}

function requireKeys(value, allowed, required) {
  if (value === null || typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).some((key) => !allowed.includes(key)) ||
    required.some((key) => !Object.hasOwn(value, key))) {
    throw new TypeError(INVALID_LINK);
  }
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!Object.hasOwn(descriptor, "value") || !descriptor.enumerable) throw new TypeError(INVALID_LINK);
  }
}

function encodeBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function httpUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new TypeError(INVALID_LINK);
  return url;
}
