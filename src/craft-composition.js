import {
  cardStateParamIds,
  getCardDefinition,
  getLayerDefinition,
} from "./card-registry.js";
import { normalizeCardVisualization } from "./card-document.js";

export function createComposition(cardId, preferences = {}) {
  const card = getCardDefinition(cardId);
  return normalizeCardVisualization(card.id, {
    ...card.defaults,
    palette: preferences.palette || card.defaults.palette,
    theme: preferences.theme || card.defaults.theme,
    range: preferences.range || card.defaults.range,
  });
}

export function setPrimaryLayer(cardId, cardState, layerId) {
  const card = getCardDefinition(cardId);
  const layer = getLayerDefinition(card, layerId);
  const current = normalizeCardVisualization(card.id, cardState);
  const primaryParam = card.primaryParam || "gpu";
  const currentPrimary = current[primaryParam] || current.gpu;
  if (!layer || layer.primary === false) return current;

  if (
    current.scale === "spread" &&
    layer.unit === "usd-hour" &&
    card.allowComparisons !== false &&
    layer.allowComparisons !== false
  ) {
    const comparisonId = current.layers.includes(layer.id)
      ? current.layers.find((currentLayerId) => currentLayerId !== layer.id)
      : currentPrimary;
    return normalizeCardVisualization(card.id, {
      ...current,
      [primaryParam]: layer.id,
      layers: comparisonId ? [layer.id, comparisonId] : [layer.id],
    });
  }

  return normalizeCardVisualization(card.id, {
    ...current,
    [primaryParam]: layer.id,
    layers:
      card.allowComparisons === false || layer.allowComparisons === false
        ? [layer.id]
        : [...new Set([...current.layers, layer.id])],
  });
}

export function toggleCompositionLayer(cardId, cardState, layerId) {
  const card = getCardDefinition(cardId);
  const layer = getLayerDefinition(card, layerId);
  const current = normalizeCardVisualization(card.id, cardState);
  const primaryParam = card.primaryParam || "gpu";
  const currentPrimary = current[primaryParam] || current.gpu;
  if (
    !layer ||
    layer.id === currentPrimary ||
    card.allowComparisons === false ||
    layer.allowComparisons === false
  ) {
    return current;
  }

  const layers = new Set(current.layers);
  const adding = !layers.has(layer.id);
  if (
    adding &&
    current.scale === "spread" &&
    layer.unit === "usd-hour"
  ) {
    return normalizeCardVisualization(card.id, {
      ...current,
      layers: [currentPrimary, layer.id],
    });
  }
  if (adding) layers.add(layer.id);
  else layers.delete(layer.id);

  return normalizeCardVisualization(card.id, {
    ...current,
    layers: [...layers],
    scale: adding && layer.unit === "index" ? "index" : current.scale,
  });
}

export function setCompositionScale(cardId, cardState, scale) {
  const card = getCardDefinition(cardId);
  const current = normalizeCardVisualization(card.id, cardState);
  if (!card.visualizations.some((view) => view.id === scale)) return current;

  const layers = current.layers.filter((layerId) =>
    getLayerDefinition(card, layerId)?.views.includes(scale),
  );
  if (
    scale === "spread" &&
    (layers.length !== 2 ||
      layers.some(
        (layerId) => getLayerDefinition(card, layerId)?.unit !== "usd-hour",
      ))
  ) {
    return current;
  }
  return normalizeCardVisualization(card.id, {
    ...current,
    layers,
    scale,
  });
}

export function compositionKey(cardId, cardState) {
  const card = getCardDefinition(cardId);
  const state = normalizeCardVisualization(card.id, cardState);
  return JSON.stringify(
    cardStateParamIds(card).map((paramId) => [paramId, state[paramId]]),
  );
}
