import {
  cardStateParamIds,
  getCardDefinition,
  parseLayerIds,
  serializeLayerIds,
} from "./card-registry.js";

export function cardUrl(cardId, view, stateParams = {}) {
  const card = getCardDefinition(cardId);
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("card", card.id);
  url.searchParams.set("view", view);

  for (const name of cardStateParamIds(card)) {
    const value = normalizedStateValue(name, stateParams[name], card);
    if (value !== "") url.searchParams.set(name, value);
  }

  url.hash = card.hash;
  return url;
}

export function cardPermalink(cardId, stateParams = {}) {
  return cardUrl(cardId, "monitor", stateParams);
}

export function replaceCardLocation(cardId, view, stateParams = {}) {
  const url = cardUrl(cardId, view, stateParams);
  window.history.replaceState({}, "", url);
  return url;
}

export function normalizeLegacyCardPresentation() {
  const params = new URL(window.location.href).searchParams;
  if (params.get("present") !== "card") return;

  const card = getCardDefinition(params.get("card"));
  if (params.get("card") !== card.id) return;

  const state = Object.fromEntries(
    cardStateParamIds(card).map((name) => [name, params.get(name)]),
  );
  window.history.replaceState({}, "", cardUrl(card.id, "monitor", state));
}

normalizeLegacyCardPresentation();

export function normalizeCardHash() {
  const url = new URL(window.location.href);
  const card = getCardDefinition(url.searchParams.get("card"));
  if (url.searchParams.get("card") !== card.id) return;
  if (url.hash === `#${card.hash}`) return;

  url.hash = card.hash;
  window.history.replaceState({}, "", url);
  window.requestAnimationFrame(() => {
    document.getElementById(card.hash)?.scrollIntoView({ block: "start" });
  });
}

normalizeCardHash();

function normalizedStateValue(name, value, card) {
  if (name === "layers") {
    if (value === null || value === undefined || value === "") return "";
    return serializeLayerIds(
      parseLayerIds(Array.isArray(value) ? value.join(",") : value, card),
      card,
    );
  }
  return value === null || value === undefined ? "" : String(value);
}
