import {
  CARD_REGISTRY,
  normalizeCardState,
  PALETTES,
  publishedCardSharePath,
  THEMES,
} from "./card-registry.js";

export const CATALOG_SHARE_CARD_IDS = Object.freeze([
  "equities", "sandbox-cost", "quote-view", "deal-view", "forward-prices", "gpu-hedge", "gpu-lease",
]);

const cards = new Map(CARD_REGISTRY
  .filter(card => CATALOG_SHARE_CARD_IDS.includes(card.id))
  .map(card => [card.id, card]));
const cache = new Map();
const emptyStates = Object.freeze([]);

// A finite build contract: vary the presentation of registered compositions,
// never advertise an arbitrary custom state as a generated preview.
export function catalogShareStates(cardId) {
  return catalog(cardId)?.states || emptyStates;
}

export function supportsCatalogShareState(cardId, state = {}) {
  const generated = catalog(cardId);
  if (!generated || !state || typeof state !== "object") return false;
  try {
    return generated.paths.has(publishedCardSharePath(cardId, state));
  } catch {
    return false;
  }
}

function catalog(cardId) {
  const card = cards.get(cardId);
  if (!card) return null;
  if (cache.has(cardId)) return cache.get(cardId);

  const statesByPath = new Map();
  const seeds = [card.defaults, ...(card.catalogPresets || []).map(preset => preset.state || {})];
  for (const seed of seeds) {
    const composition = normalizeCardState(cardId, seed);
    // Private terms are indivisible preset states, not a Cartesian product of
    // every supported capacity, rate and service month.
    const primaries = card.stateKind === "deal"
      ? [composition.gpu]
      : card.layers.filter(layer => layer.primary !== false && composition.layers.includes(layer.id))
        .map(layer => layer.id);
    for (const primary of primaries) {
      for (const range of card.ranges) {
        for (const visualization of card.visualizations) {
          for (const palette of PALETTES) {
            for (const theme of THEMES) {
              const normalized = normalizeCardState(cardId, {
                ...composition,
                gpu: primary,
                [card.primaryParam || "gpu"]: primary,
                range,
                scale: visualization.id,
                palette: palette.id,
                theme,
              });
              const styles = cardId === "equities" && normalized.scale === "index" && normalized.layers.some(
                id => card.layers.find(layer => layer.id === id)?.sourceCardId === "gpu-index",
              ) ? ["lines", "bars"] : [undefined];
              for (const style of styles) {
                const variant = style ? { ...normalized, style } : normalized;
                const path = publishedCardSharePath(cardId, variant);
                if (!statesByPath.has(path)) {
                  statesByPath.set(path, Object.freeze({
                    ...variant,
                    layers: Object.freeze([...variant.layers]),
                  }));
                }
              }
            }
          }
        }
      }
    }
  }

  const result = {
    states: Object.freeze([...statesByPath.values()]),
    paths: new Set(statesByPath.keys()),
  };
  cache.set(cardId, result);
  return result;
}
