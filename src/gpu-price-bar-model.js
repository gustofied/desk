const USD_PER_GPU_HOUR = "usd-hour";

export const GPU_PRICE_BAR_ORDERS = Object.freeze([
  "price-desc",
  "price-asc",
  "registry",
]);

/**
 * Builds a categorical snapshot from the compact GPU history payload.
 *
 * The model deliberately keeps the source observations intact: the bar value
 * is the most recent benchmark observation and lower/upper are that row's
 * provider-floor interquartile bounds. No interpolation or synthetic score is
 * introduced here.
 */
export function createGpuPriceBarModel(
  payload,
  card,
  {
    layerIds = card?.defaults?.layers,
    order = card?.defaults?.order || "price-desc",
  } = {},
) {
  assertPayload(payload);
  assertCard(card);
  if (card.sourceCardId && payload.cardId !== card.sourceCardId) {
    throw new TypeError(
      `Expected ${card.sourceCardId} data for ${card.id}`,
    );
  }

  const requestedLayers = selectedLayerIds(layerIds, card);
  const bars = requestedLayers.map((layerId) => {
    const layer = card.layers.find((candidate) => candidate.id === layerId);
    const observation = latestObservation(payload.series[layerId], layerId);

    return Object.freeze({
      id: layer.id,
      label: layer.shortLabel || layer.label,
      value: observation.value,
      lower: observation.lower,
      upper: observation.upper,
      observedAt: observation.timestamp,
    });
  });

  const orderedBars = orderBars(bars, order);
  const asOf = Math.max(...orderedBars.map((bar) => bar.observedAt));

  return Object.freeze({
    version: 1,
    cardId: card.id,
    sourceCardId: payload.cardId,
    revision: payload.revision,
    asOf,
    order: normalizeOrder(order),
    unit: USD_PER_GPU_HOUR,
    unitLabel: "USD per GPU-hour",
    bars: Object.freeze(
      orderedBars.map((bar, index) =>
        Object.freeze({ ...bar, rank: index + 1 }),
      ),
    ),
  });
}

function assertPayload(payload) {
  if (
    !Number.isInteger(payload?.version) ||
    typeof payload?.series !== "object" ||
    payload.series === null
  ) {
    throw new TypeError("Unsupported GPU price history payload");
  }
  if (typeof payload.revision !== "string" || !payload.revision.trim()) {
    throw new TypeError("GPU price history revision is required");
  }
}

function assertCard(card) {
  if (!card?.id || !Array.isArray(card.layers) || !card.layers.length) {
    throw new TypeError("A GPU price bar card definition is required");
  }
  if (card.layers.some((layer) => layer.unit !== USD_PER_GPU_HOUR)) {
    throw new TypeError("GPU price bars require USD per GPU-hour layers");
  }
}

function selectedLayerIds(layerIds, card) {
  const allowed = new Set(card.layers.map((layer) => layer.id));
  const requested = Array.isArray(layerIds)
    ? layerIds
    : layerIds instanceof Set
      ? Array.from(layerIds)
      : String(layerIds || "").split(",");
  const unique = requested
    .map((layerId) => String(layerId).trim().toUpperCase())
    .filter(
      (layerId, index, values) =>
        allowed.has(layerId) && values.indexOf(layerId) === index,
    );

  if (unique.length) return unique;
  return card.layers.map((layer) => layer.id);
}

function latestObservation(points, layerId) {
  if (!Array.isArray(points)) {
    throw new TypeError(`Missing GPU price history for ${layerId}`);
  }

  let latest = null;
  for (const point of points) {
    const observation = normalizeObservation(point);
    if (
      observation &&
      (!latest || observation.timestamp > latest.timestamp)
    ) {
      latest = observation;
    }
  }

  if (!latest) {
    throw new TypeError(`Missing usable GPU price observations for ${layerId}`);
  }
  return latest;
}

function normalizeObservation(point) {
  if (!Array.isArray(point)) return null;
  const timestamp = Number(point[0]);
  const value = Number(point[1]);
  const lower = Number(point[2]);
  const upper = Number(point[3]);
  if (
    !Number.isInteger(timestamp) ||
    !Number.isFinite(value) ||
    !Number.isFinite(lower) ||
    !Number.isFinite(upper) ||
    value < 0 ||
    lower < 0 ||
    upper < 0 ||
    lower > value ||
    value > upper
  ) {
    return null;
  }
  return { timestamp, value, lower, upper };
}

function orderBars(bars, order) {
  const normalizedOrder = normalizeOrder(order);
  if (normalizedOrder === "registry") return [...bars];

  const direction = normalizedOrder === "price-asc" ? 1 : -1;
  return [...bars].sort(
    (left, right) =>
      direction * (left.value - right.value) ||
      left.label.localeCompare(right.label),
  );
}

function normalizeOrder(order) {
  return GPU_PRICE_BAR_ORDERS.includes(order) ? order : "price-desc";
}
