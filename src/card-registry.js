const DAY_MS = 24 * 60 * 60 * 1000;
const GPU_INDEX_ID = "gpu-index";
const GPU_INDEX_SLUG = "gpu-price-index";
const GPU_INDEX_DATA_FILE = "data/gpu-price-index.json";
const GPU_INDEX_DATA_EPOCH = "showcase-v1";
const GPU_PRICE_SNAPSHOT_ID = "gpu-price-snapshot";
const GPU_PRICE_SNAPSHOT_SLUG = "gpu-price-snapshot";
const GPU_MARKET_DEPTH_ID = "gpu-market-depth";
const GPU_MARKET_DEPTH_SLUG = "gpu-market-depth";
const GPU_MARKET_DEPTH_DATA_FILE = "data/gpu-market-depth.json";
const DEAL_VIEW_ID = "deal-view";
const DEAL_VIEW_SLUG = "deal-041";
const DEAL_VIEW_DATA_FILE = "data/deal-041.json";

export const SITE_ORIGIN = "https://desk.adamsioud.com";
export const PUBLISHED_CARD_VERSION = "v15";

export const PALETTES = Object.freeze([
  Object.freeze({ id: "azure", label: "Soft Azure", accent: "#91aecb" }),
  Object.freeze({ id: "linen", label: "Soft Linen", accent: "#efede4" }),
  Object.freeze({ id: "sage", label: "Sage Green", accent: "#b7d07b" }),
  Object.freeze({ id: "sand", label: "Warm Sand", accent: "#f3c888" }),
]);

export const THEMES = Object.freeze(["light", "dark"]);

export const RANGES = Object.freeze({
  now: Object.freeze({
    id: "now",
    milliseconds: 0,
    label: "CURRENT",
    longLabel: "current profile",
  }),
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
    label: "Token Price Index",
    shortLabel: "TPI",
    unit: "index",
    sourceFile: "api/dashboard-snapshots/token-price-index.json",
    views: Object.freeze(["index"]),
    strokeOpacity: 0.72,
    strokeDasharray: "1 4",
  }),
]);

export const GPU_PRICE_LAYERS = Object.freeze(
  GPU_LAYERS.filter((layer) => layer.unit === "usd-hour"),
);

export const GPU_MARKET_DEPTH_LAYERS = Object.freeze([
  Object.freeze({
    id: "H100",
    label: "H100 depth",
    shortLabel: "H100 depth",
    unit: "nodes",
    primary: true,
    views: Object.freeze(["depth", "history"]),
  }),
]);

export const CARD_REGISTRY = Object.freeze([
  Object.freeze({
    id: GPU_INDEX_ID,
    slug: GPU_INDEX_SLUG,
    hash: "gpu-benchmark-card",
    renderer: "line",
    title: "Compute Prices",
    description: "Accelerator rental prices and token expenditure.",
    sourceDir: "api/dashboard-snapshots/gpu-benchmark",
    dataFile: GPU_INDEX_DATA_FILE,
    dataUrl: `./${GPU_INDEX_DATA_FILE}?dataset=${GPU_INDEX_DATA_EPOCH}`,
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
    ranges: Object.freeze(["1d", "7d", "all"]),
    allowComparisons: true,
    layers: GPU_LAYERS,
    catalogPresets: Object.freeze(
      GPU_PRICE_LAYERS.map((layer) =>
        Object.freeze({
          id: layer.id.toLowerCase(),
          label: layer.label,
          state: Object.freeze({
            gpu: layer.id,
            layers: Object.freeze([layer.id]),
            scale: "price",
            range: "7d",
          }),
        }),
      ),
    ),
    visualizations: Object.freeze([
      Object.freeze({ id: "price", label: "Price", unit: "usd-hour" }),
      Object.freeze({ id: "index", label: "Index", unit: "index" }),
    ]),
  }),
  Object.freeze({
    id: GPU_PRICE_SNAPSHOT_ID,
    slug: GPU_PRICE_SNAPSHOT_SLUG,
    hash: "gpu-benchmark-card",
    renderer: "categorical-bar",
    title: "Accelerator prices",
    description: "Current hourly benchmark price by GPU.",
    sourceCardId: GPU_INDEX_ID,
    sourceDir: "api/dashboard-snapshots/gpu-benchmark",
    dataFile: GPU_INDEX_DATA_FILE,
    dataUrl: `./${GPU_INDEX_DATA_FILE}?dataset=${GPU_INDEX_DATA_EPOCH}`,
    sharePath: `/cards/${GPU_PRICE_SNAPSHOT_SLUG}`,
    previewImageDir: `assets/social/${GPU_PRICE_SNAPSHOT_ID}`,
    previewPageDir: `cards/${GPU_PRICE_SNAPSHOT_SLUG}`,
    defaults: Object.freeze({
      layer: "H200",
      layers: Object.freeze(GPU_PRICE_LAYERS.map((layer) => layer.id)),
      range: "1d",
      scale: "price",
      palette: "azure",
      theme: "light",
      order: "price-desc",
    }),
    ranges: Object.freeze(["1d"]),
    allowComparisons: true,
    layers: GPU_PRICE_LAYERS,
    catalogPresets: Object.freeze([
      Object.freeze({ id: "prices", label: "Accelerator prices" }),
    ]),
    visualizations: Object.freeze([
      Object.freeze({ id: "price", label: "Price", unit: "usd-hour" }),
    ]),
  }),
  Object.freeze({
    id: GPU_MARKET_DEPTH_ID,
    slug: GPU_MARKET_DEPTH_SLUG,
    hash: "gpu-benchmark-card",
    renderer: "cumulative-depth",
    title: "H100 depth",
    description: "Qualifying H100 capacity available across hourly prices.",
    sourceFile: "api/dashboard-snapshots/gpu-market-depth.json",
    dataFile: GPU_MARKET_DEPTH_DATA_FILE,
    dataUrl: `./${GPU_MARKET_DEPTH_DATA_FILE}`,
    sharePath: `/cards/${GPU_MARKET_DEPTH_SLUG}`,
    previewImageDir: `assets/social/${GPU_MARKET_DEPTH_ID}`,
    previewPageDir: `cards/${GPU_MARKET_DEPTH_SLUG}`,
    defaults: Object.freeze({
      layer: "H100",
      layers: Object.freeze(["H100"]),
      range: "now",
      scale: "depth",
      target: "128",
      palette: "azure",
      theme: "light",
    }),
    ranges: Object.freeze(["now"]),
    allowComparisons: false,
    layers: GPU_MARKET_DEPTH_LAYERS,
    stateOptions: Object.freeze([
      Object.freeze({
        id: "target",
        label: "Target",
        values: Object.freeze(["64", "128", "256"]),
        suffix: " nodes",
        default: "128",
      }),
    ]),
    catalogPresets: Object.freeze([
      Object.freeze({ id: "h100-us", label: "H100 depth" }),
    ]),
    visualizations: Object.freeze([
      Object.freeze({ id: "depth", label: "Now", unit: "nodes" }),
      Object.freeze({ id: "history", label: "History", unit: "nodes" }),
    ]),
  }),
  Object.freeze({
    id: DEAL_VIEW_ID,
    slug: DEAL_VIEW_SLUG,
    hash: "gpu-benchmark-card",
    renderer: "deal",
    stateKind: "deal",
    publishable: false,
    title: "Deal 041",
    description: "Reserved B200 capacity moving from mandate to execution.",
    sourceFile: "api/dashboard-snapshots/deal-041.json",
    dataFile: DEAL_VIEW_DATA_FILE,
    dataUrl: `./${DEAL_VIEW_DATA_FILE}`,
    sharePath: `/cards/${DEAL_VIEW_SLUG}`,
    defaults: Object.freeze({
      layer: "B200",
      layers: Object.freeze(["B200"]),
      range: "7d",
      scale: "price",
      gpu: "B200",
      quantity: 256,
      quote: 3.65,
      rfs: "2026-10",
      stage: "diligence",
      palette: "azure",
      theme: "light",
    }),
    ranges: Object.freeze(["7d"]),
    allowComparisons: false,
    layers: Object.freeze([
      Object.freeze({
        id: "B200",
        label: "B200",
        unit: "usd-hour",
        views: Object.freeze(["price"]),
      }),
    ]),
    stateOptions: Object.freeze([
      Object.freeze({
        id: "gpu",
        label: "GPU",
        values: Object.freeze(["H100", "H200", "B200", "B300"]),
        default: "B200",
      }),
      Object.freeze({
        id: "quantity",
        label: "GPUs",
        type: "integer",
        min: 8,
        max: 4096,
        default: 256,
      }),
      Object.freeze({
        id: "quote",
        label: "Quote",
        type: "decimal",
        min: 0.1,
        max: 100,
        precision: 2,
        default: 3.65,
      }),
      Object.freeze({
        id: "rfs",
        label: "RFS",
        type: "month",
        min: "2026-01",
        max: "2035-12",
        default: "2026-10",
      }),
      Object.freeze({
        id: "stage",
        label: "Stage",
        values: Object.freeze(["spec", "diligence", "execute"]),
        valueLabels: Object.freeze({
          spec: "Spec",
          diligence: "Diligence",
          execute: "Execute",
        }),
        default: "diligence",
      }),
    ]),
    catalogPresets: Object.freeze([
      Object.freeze({
        id: "deal-041",
        label: "Deal 041",
        state: Object.freeze({ stage: "diligence" }),
      }),
    ]),
    visualizations: Object.freeze([
      Object.freeze({ id: "price", label: "Market reference", unit: "usd-hour" }),
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

export function cardStateParamIds(card = getCardDefinition()) {
  if (card.stateKind === "deal") {
    return [
      ...(card.stateOptions || []).map((option) => option.id),
      "palette",
      "theme",
    ];
  }
  return [
    "gpu",
    "layers",
    "scale",
    "range",
    "palette",
    "theme",
    ...(card.stateOptions || []).map((option) => option.id),
  ];
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
  if (card.stateKind === "deal") {
    return normalizeDealState(card, stateParams);
  }
  const requestedRangeId = String(stateParams.range || "").toLowerCase();
  const legacyDepthHistory =
    card.id === GPU_MARKET_DEPTH_ID &&
    (requestedRangeId === "1d" || requestedRangeId === "7d");
  const primaryLayers = card.layers.filter((layer) => layer.primary !== false);
  const requestedGpu = String(stateParams.gpu || "").toUpperCase();
  const gpu = primaryLayers.some((layer) => layer.id === requestedGpu)
    ? requestedGpu
    : card.defaults.layer;
  const fallbackLayers = stateParams.gpu
    ? [gpu]
    : card.defaults.layers;
  const requestedLayers = parseLayerIds(
    layerStateValue(stateParams.layers),
    card,
    fallbackLayers,
  );
  const requestedScaleId = legacyDepthHistory
    ? "history"
    : String(stateParams.scale || "").toLowerCase();
  const requestedScale = card.visualizations.some(
    (visualization) => visualization.id === requestedScaleId,
  )
    ? requestedScaleId
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
  const normalizedLayers = card.layers
    .map((layer) => layer.id)
    .filter((layerId) => compatibleLayers.has(layerId));
  const layers = card.allowComparisons === false ? [gpu] : normalizedLayers;
  const requestedRange = legacyDepthHistory ? "now" : requestedRangeId;
  const allowedRanges = card.ranges || Object.keys(RANGES);
  const range = allowedRanges.includes(requestedRange)
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

  const options = Object.fromEntries(
    (card.stateOptions || []).map((option) => {
      const requested = String(stateParams[option.id] || "").toLowerCase();
      const fallback = String(
        card.defaults[option.id] ?? option.default ?? option.values?.[0] ?? "",
      ).toLowerCase();
      return [
        option.id,
        option.values?.map(String).map((value) => value.toLowerCase()).includes(requested)
          ? requested
          : fallback,
      ];
    }),
  );

  return {
    gpu,
    layers,
    scale,
    range,
    palette,
    theme,
    ...options,
  };
}

function normalizeDealState(card, stateParams) {
  const requestedPalette = String(stateParams.palette || "").toLowerCase();
  const requestedTheme = String(stateParams.theme || "").toLowerCase();
  const options = Object.fromEntries(
    (card.stateOptions || []).map((option) => [
      option.id,
      normalizeDealOption(option, stateParams[option.id], card.defaults[option.id]),
    ]),
  );
  const gpu = String(options.gpu || card.defaults.gpu || card.defaults.layer).toUpperCase();

  return {
    gpu,
    layers: [gpu],
    scale: card.defaults.scale,
    range: card.defaults.range,
    palette: paletteIds().includes(requestedPalette)
      ? requestedPalette
      : card.defaults.palette,
    theme: THEMES.includes(requestedTheme)
      ? requestedTheme
      : card.defaults.theme,
    ...options,
  };
}

function normalizeDealOption(option, requestedValue, defaultValue) {
  const fallback = defaultValue ?? option.default ?? option.values?.[0] ?? "";

  if (option.type === "integer") {
    return normalizeBoundedNumber(requestedValue, fallback, option, true);
  }
  if (option.type === "decimal") {
    return normalizeBoundedNumber(requestedValue, fallback, option, false);
  }
  if (option.type === "month") {
    const requested = String(requestedValue || "").trim();
    const validMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(requested);
    const withinMinimum = !option.min || requested >= option.min;
    const withinMaximum = !option.max || requested <= option.max;
    return validMonth && withinMinimum && withinMaximum
      ? requested
      : String(fallback);
  }

  const requested = String(requestedValue || "").trim();
  const match = option.values?.find(
    (value) => String(value).toLowerCase() === requested.toLowerCase(),
  );
  return match ?? fallback;
}

function normalizeBoundedNumber(value, fallback, option, integer) {
  const hasValue =
    value !== null &&
    value !== undefined &&
    String(value).trim() !== "";
  const requested = hasValue ? Number(value) : Number.NaN;
  const fallbackNumber = Number(fallback);
  const finite = Number.isFinite(requested) ? requested : fallbackNumber;
  const bounded = Math.min(
    Number(option.max ?? Number.POSITIVE_INFINITY),
    Math.max(Number(option.min ?? Number.NEGATIVE_INFINITY), finite),
  );
  if (integer) return Math.round(bounded);
  const precision = Math.max(0, Math.min(6, Number(option.precision ?? 2)));
  return Number(bounded.toFixed(precision));
}

export function publishedCardSharePath(cardId, stateParams) {
  const card = getCardDefinition(cardId);
  const state = normalizeCardState(card.id, stateParams);
  const layers = state.layers.map(pathSegment).join("~");
  const optionPath = publishedOptionPath(card, state);

  const base = (
    `${card.sharePath}/published/` +
    `${pathSegment(state.gpu)}/${pathSegment(state.scale)}/${layers}/` +
    `${pathSegment(state.range)}/${pathSegment(state.palette)}/` +
    `${pathSegment(state.theme)}/`
  );
  return optionPath ? `${base}${optionPath}/` : base;
}

export function publishedCardPreviewPath(cardId, stateParams, revision) {
  const card = getCardDefinition(cardId);
  const state = normalizeCardState(card.id, stateParams);
  const dataRevision = publishedRevisionSegment(revision);
  const layers = state.layers.map(pathSegment).join("~");
  const optionPath = publishedOptionPath(card, state);
  const optionSuffix = optionPath ? `--${optionPath}` : "";

  return (
    `/${card.previewImageDir}/published/${PUBLISHED_CARD_VERSION}/${dataRevision}/` +
    `${pathSegment(state.gpu)}/${pathSegment(state.scale)}/${layers}/` +
    `${pathSegment(state.range)}/` +
    `${pathSegment(state.palette)}-${pathSegment(state.theme)}${optionSuffix}.png`
  );
}

function publishedOptionPath(card, state) {
  return (card.stateOptions || [])
    .map((option) => `${pathSegment(option.id)}-${pathSegment(state[option.id])}`)
    .join("~");
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
