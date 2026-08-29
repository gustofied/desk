import {
  getCardDefinition,
  getLayerDefinition,
  normalizeCardState,
} from "./card-registry.js";

export function createComposition(cardId, preferences = {}) {
  const card = getCardDefinition(cardId);
  return normalizeCardState(card.id, {
    ...card.defaults,
    palette: preferences.palette || card.defaults.palette,
    theme: preferences.theme || card.defaults.theme,
    range: preferences.range || card.defaults.range,
  });
}

export function setPrimaryLayer(cardId, cardState, layerId) {
  const card = getCardDefinition(cardId);
  const layer = getLayerDefinition(card, layerId);
  if (layer?.unit !== "usd-hour") return normalizeCardState(card.id, cardState);

  const current = normalizeCardState(card.id, cardState);
  return normalizeCardState(card.id, {
    ...current,
    gpu: layer.id,
    layers: [...new Set([...current.layers, layer.id])],
  });
}

export function toggleCompositionLayer(cardId, cardState, layerId) {
  const card = getCardDefinition(cardId);
  const layer = getLayerDefinition(card, layerId);
  const current = normalizeCardState(card.id, cardState);
  if (!layer || layer.id === current.gpu) return current;

  const layers = new Set(current.layers);
  const adding = !layers.has(layer.id);
  if (adding) layers.add(layer.id);
  else layers.delete(layer.id);

  return normalizeCardState(card.id, {
    ...current,
    layers: [...layers],
    scale: adding && layer.unit === "index" ? "index" : current.scale,
  });
}

export function setCompositionScale(cardId, cardState, scale) {
  const card = getCardDefinition(cardId);
  const current = normalizeCardState(card.id, cardState);
  if (!card.visualizations.some((view) => view.id === scale)) return current;

  const layers = current.layers.filter((layerId) =>
    getLayerDefinition(card, layerId)?.views.includes(scale),
  );
  return normalizeCardState(card.id, {
    ...current,
    layers,
    scale,
  });
}

export function compositionKey(cardId, cardState) {
  const state = normalizeCardState(cardId, cardState);
  return JSON.stringify([
    state.gpu,
    state.layers,
    state.scale,
    state.range,
    state.palette,
    state.theme,
  ]);
}
