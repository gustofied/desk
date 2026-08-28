const DAY_MS = 24 * 60 * 60 * 1000;
const GPU_INDEX_ID = "gpu-index";
const GPU_INDEX_SLUG = "gpu-price-index";
const GPU_INDEX_DATA_FILE = "data/gpu-price-index.json";

export const SITE_ORIGIN = "https://desk.adamsioud.com";
export const PUBLISHED_CARD_VERSION = "v4";

export const PALETTES = Object.freeze([
  Object.freeze({ id: "azure", label: "Soft Azure", accent: "#91aecb" }),
  Object.freeze({ id: "linen", label: "Soft Linen", accent: "#efede4" }),
  Object.freeze({ id: "sage", label: "Sage Green", accent: "#b7d07b" }),
  Object.freeze({ id: "sand", label: "Warm Sand", accent: "#f3c888" }),
]);

export const THEMES = Object.freeze(["light", "dark"]);

export const RANGES = Object.freeze({
  "1d": Object.freeze({
    id: "1d",
    milliseconds: DAY_MS,
    label: "1D",
    longLabel: "1 day",
  }),
  "7d": Object.freeze({
    id: "7d",
    milliseconds: 7 * DAY_MS,
    label: "7D",
    longLabel: "7 days",
  }),
  all: Object.freeze({
    id: "all",
    milliseconds: null,
    label: "ALL",
    longLabel: "all history",
  }),
});

export const GPU_LAYERS = Object.freeze([
  Object.freeze({
    id: "H100",
    label: "H100",
    unit: "usd-hour",
    views: Object.freeze(["price", "index"]),
    strokeOpacity: 0.74,
    strokeDasharray: "6 4",
  }),
  Object.freeze({
    id: "H200",
    label: "H200",
    unit: "usd-hour",
    views: Object.freeze(["price", "index"]),
    strokeOpacity: 0.78,
    strokeDasharray: "10 4",
  }),
  Object.freeze({
    id: "B200",
    label: "B200",
    unit: "usd-hour",
    views: Object.freeze(["price", "index"]),
    strokeOpacity: 0.62,
    strokeDasharray: "2 3",
  }),
  Object.freeze({
    id: "B300",
    label: "B300",
    unit: "usd-hour",
    views: Object.freeze(["price", "index"]),
    strokeOpacity: 0.48,
    strokeDasharray: "8 4",
  }),
  Object.freeze({
    id: "TOKEN",
    label: "Token Index",
    unit: "index",
    views: Object.freeze(["index"]),
    strokeOpacity: 0.72,
    strokeDasharray: "1 4",
  }),
]);

export const CARD_REGISTRY = Object.freeze([
  Object.freeze({
    id: GPU_INDEX_ID,
    slug: GPU_INDEX_SLUG,
    hash: "gpu-benchmark-card",
    title: "Compute Prices",
    description: "Hourly accelerator prices and Token Index.",
    sourceDir: "api/dashboard-snapshots/gpu-benchmark",
    dataFile: GPU_INDEX_DATA_FILE,
    dataUrl: `./${GPU_INDEX_DATA_FILE}`,
    sharePath: `/cards/${GPU_INDEX_SLUG}`,
    previewImageDir: `assets/social/${GPU_INDEX_ID}`,
    previewPageDir: `cards/${GPU_INDEX_SLUG}`,
    defaults: Object.freeze({
      layer: "H200",
      layers: Object.freeze(["H200"]),
      range: "7d",
      scale: "price",
      palette: "azure",
      theme: "light",
    }),
    layers: GPU_LAYERS,
    visualizations: Object.freeze([
      Object.freeze({ id: "price", label: "Price", unit: "usd-hour" }),
      Object.freeze({ id: "index", label: "Index", unit: "index" }),
    ]),
  }),
]);

const cardsById = new Map(CARD_REGISTRY.map((card) => [card.id, card]));

export function getCardDefinition(cardId = "gpu-index") {
  return cardsById.get(cardId) || CARD_REGISTRY[0];
}

export function getLayerDefinition(card, layerId) {
  return card?.layers?.find((layer) => layer.id === layerId) || null;
}

export function paletteIds() {
  return PALETTES.map((palette) => palette.id);
}

export function parseLayerIds(
  value,
  card = getCardDefinition(),
  fallback = card.defaults.layers,
) {
  const allowed = new Set(card.layers.map((layer) => layer.id));
  const values = String(value || "")
    .split(",")
    .map((layer) => layer.trim().toUpperCase())
    .filter(
      (layer, index, entries) =>
        allowed.has(layer) && entries.indexOf(layer) === index,
    );
  return values.length ? values : [...fallback];
}

export function serializeLayerIds(layerIds, card = getCardDefinition()) {
  const selected = new Set(layerIds);
  return card.layers
    .map((layer) => layer.id)
    .filter((layerId) => selected.has(layerId))
    .join(",");
}

export function normalizeCardState(cardId, stateParams = {}) {
  const card = getCardDefinition(cardId);
  const primaryLayers = card.layers.filter((layer) => layer.unit === "usd-hour");
  const requestedGpu = String(stateParams.gpu || "").toUpperCase();
  const gpu = primaryLayers.some((layer) => layer.id === requestedGpu)
    ? requestedGpu
    : card.defaults.layer;
  const requestedLayers = parseLayerIds(
    layerStateValue(stateParams.layers),
    card,
    [gpu],
  );
  const requestedScale = card.visualizations.some(
    (visualization) => visualization.id === stateParams.scale,
  )
    ? stateParams.scale
    : card.defaults.scale;
  const requiresIndex = requestedLayers.some(
    (layerId) => getLayerDefinition(card, layerId)?.unit === "index",
  );
  const scale = requiresIndex ? "index" : requestedScale;
  const compatibleLayers = new Set(
    requestedLayers.filter((layerId) =>
      getLayerDefinition(card, layerId)?.views.includes(scale),
    ),
  );
  compatibleLayers.add(gpu);
  const layers = card.layers
    .map((layer) => layer.id)
    .filter((layerId) => compatibleLayers.has(layerId));
  const requestedRange = String(stateParams.range || "").toLowerCase();
  const range = RANGES[requestedRange]
    ? requestedRange
    : card.defaults.range;
  const requestedPalette = String(stateParams.palette || "").toLowerCase();
  const palette = paletteIds().includes(requestedPalette)
    ? requestedPalette
    : card.defaults.palette;
  const requestedTheme = String(stateParams.theme || "").toLowerCase();
  const theme = THEMES.includes(requestedTheme)
    ? requestedTheme
    : card.defaults.theme;

  return {
    gpu,
    layers,
    scale,
    range,
    palette,
    theme,
  };
}

export function publishedCardSharePath(cardId, stateParams) {
  const card = getCardDefinition(cardId);
  const state = normalizeCardState(card.id, stateParams);
  const layers = state.layers.map(pathSegment).join("~");

  return (
    `${card.sharePath}/published/` +
    `${pathSegment(state.gpu)}/${pathSegment(state.scale)}/${layers}/` +
    `${pathSegment(state.range)}/${pathSegment(state.palette)}/` +
    `${pathSegment(state.theme)}/`
  );
}

export function publishedCardPreviewPath(cardId, stateParams, revision) {
  const card = getCardDefinition(cardId);
  const state = normalizeCardState(card.id, stateParams);
  const dataRevision = publishedRevisionSegment(revision);
  const layers = state.layers.map(pathSegment).join("~");

  return (
    `/${card.previewImageDir}/published/${PUBLISHED_CARD_VERSION}/${dataRevision}/` +
    `${pathSegment(state.gpu)}/${pathSegment(state.scale)}/${layers}/` +
    `${pathSegment(state.range)}/` +
    `${pathSegment(state.palette)}-${pathSegment(state.theme)}.png`
  );
}

function layerStateValue(value) {
  if (Array.isArray(value) || value instanceof Set) {
    return Array.from(value).join(",");
  }
  return value;
}

function pathSegment(value) {
  return encodeURIComponent(String(value).toLowerCase());
}

function publishedRevisionSegment(revision) {
  const value = String(revision || "").trim();
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(value)) {
    throw new TypeError("A valid card data revision is required");
  }
  return encodeURIComponent(value.toLowerCase());
}
