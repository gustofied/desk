const EXPECTED_COLUMNS = Object.freeze([
  "timestamp",
  "realTime",
  "dayAhead",
  "basis",
]);
const RANGE_SECONDS = Object.freeze({
  "1d": 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60,
  all: null,
});

export function createPowerBasisModel(
  payload,
  card,
  {
    locationId = card?.defaults?.layer,
    range = card?.defaults?.range || "1d",
  } = {},
) {
  assertPayload(payload);
  assertCard(card, payload.cardId);

  const locations = normalizeLocations(payload.locations);
  const location = locations.find((candidate) => candidate.id === locationId);
  if (!location) {
    throw new TypeError(`Unknown power location ${String(locationId || "")}`);
  }

  const history = normalizeSeries(payload.series[location.id], location.id);
  const current = history.at(-1);
  if (payload.asOf !== current.timestamp) {
    throw new TypeError("Power-basis as-of time must match the latest observation");
  }
  assertDataset(payload.dataset, history);

  const normalizedRange = normalizeRange(range, card);
  const rangeSeconds = RANGE_SECONDS[normalizedRange];
  const rows = Object.freeze(
    rangeSeconds === null
      ? [...history]
      : history.filter(
          (row) => row.timestamp >= current.timestamp - rangeSeconds,
        ),
  );
  const latest = rows.at(-1);

  return Object.freeze({
    version: 1,
    cardId: card.id,
    sourceCardId: payload.cardId,
    revision: payload.revision,
    asOf: payload.asOf,
    range: normalizedRange,
    location,
    rows,
    latest,
    ariaLabel: createAriaLabel(location, latest, normalizedRange),
  });
}

function assertPayload(payload) {
  if (
    payload?.version !== 1 ||
    typeof payload?.cardId !== "string" ||
    !payload.cardId.trim() ||
    typeof payload?.revision !== "string" ||
    !payload.revision.trim() ||
    !Number.isInteger(payload?.asOf) ||
    payload.asOf <= 0 ||
    !Array.isArray(payload?.columns) ||
    payload.columns.length !== EXPECTED_COLUMNS.length ||
    payload.columns.some(
      (column, index) => column !== EXPECTED_COLUMNS[index],
    ) ||
    !Array.isArray(payload?.locations) ||
    !payload.locations.length ||
    !payload.series ||
    typeof payload.series !== "object" ||
    Array.isArray(payload.series)
  ) {
    throw new TypeError("Unsupported power-basis payload");
  }
}

function assertCard(card, payloadCardId) {
  if (!card?.id || card.renderer !== "power-basis") {
    throw new TypeError("A power-basis card definition is required");
  }
  const expectedSource = card.sourceCardId || card.id;
  if (payloadCardId !== expectedSource) {
    throw new TypeError(`Expected ${expectedSource} data for ${card.id}`);
  }
}

function normalizeLocations(values) {
  const ids = new Set();
  return Object.freeze(
    values.map((value, index) => {
      const id = requiredString(value?.id, `Power location ${index} id`);
      if (ids.has(id)) throw new TypeError(`Duplicate power location ${id}`);
      ids.add(id);

      const currency = requiredString(
        value.currency,
        `Power location ${id} currency`,
      );
      const unit = requiredString(value.unit, `Power location ${id} unit`);
      const intervalMinutes = Number(value.intervalMinutes);
      if (currency !== "USD" || unit !== "USD per MWh") {
        throw new TypeError(`Power location ${id} has an unsupported price unit`);
      }
      if (!Number.isInteger(intervalMinutes) || intervalMinutes <= 0) {
        throw new TypeError(`Power location ${id} has an invalid interval`);
      }

      return Object.freeze({
        id,
        label: requiredString(value.label, `Power location ${id} label`),
        market: requiredString(value.market, `Power location ${id} market`),
        location: requiredString(
          value.location,
          `Power location ${id} location`,
        ),
        timezone: requiredString(
          value.timezone,
          `Power location ${id} timezone`,
        ),
        currency,
        unit,
        intervalMinutes,
      });
    }),
  );
}

function normalizeSeries(points, locationId) {
  if (!Array.isArray(points) || points.length < 2) {
    throw new TypeError(`Missing power-basis history for ${locationId}`);
  }

  let previousTimestamp = 0;
  return Object.freeze(
    points.map((point, index) => {
      if (!Array.isArray(point) || point.length !== EXPECTED_COLUMNS.length) {
        throw new TypeError(
          `Invalid power-basis observation for ${locationId} at index ${index}`,
        );
      }
      const timestamp = Number(point[0]);
      const realTime = Number(point[1]);
      const dayAhead = Number(point[2]);
      const basis = Number(point[3]);
      if (
        !Number.isInteger(timestamp) ||
        timestamp <= previousTimestamp ||
        (previousTimestamp && timestamp - previousTimestamp !== 60 * 60) ||
        !Number.isFinite(realTime) ||
        !Number.isFinite(dayAhead) ||
        !Number.isFinite(basis) ||
        Math.abs(realTime - dayAhead - basis) > 0.000_001
      ) {
        throw new TypeError(
          `Invalid power-basis observation for ${locationId} at index ${index}`,
        );
      }
      previousTimestamp = timestamp;
      return Object.freeze({
        date: new Date(timestamp * 1000),
        timestamp,
        realTime,
        dayAhead,
        basis,
      });
    }),
  );
}

function assertDataset(dataset, rows) {
  if (dataset === undefined) return;
  if (!dataset || typeof dataset !== "object" || Array.isArray(dataset)) {
    throw new TypeError("Power-basis dataset metadata is invalid");
  }
  if (
    dataset.cadence !== "hourly" ||
    dataset.cadenceSeconds !== 60 * 60 ||
    dataset.start !== rows[0].timestamp ||
    dataset.end !== rows.at(-1).timestamp ||
    dataset.observationCount !== rows.length
  ) {
    throw new TypeError("Power-basis dataset metadata does not match its history");
  }
}

function normalizeRange(range, card) {
  const fallback = Object.hasOwn(RANGE_SECONDS, card?.defaults?.range)
    ? card.defaults.range
    : "1d";
  const normalized = Object.hasOwn(RANGE_SECONDS, range) ? range : fallback;
  return Array.isArray(card?.ranges) && !card.ranges.includes(normalized)
    ? fallback
    : normalized;
}

function createAriaLabel(location, latest, range) {
  const duration =
    range === "all" ? "all history" : range === "1d" ? "one day" : "seven days";
  return (
    `${location.label} power prices over ${duration}. ` +
    `Real time ${formatPrice(latest.realTime)}, ` +
    `day ahead ${formatPrice(latest.dayAhead)}, ` +
    `spread ${formatSignedPrice(latest.basis)}.`
  );
}

function formatPrice(value) {
  return `${value < 0 ? "minus " : ""}$${Math.abs(value).toFixed(2)} per megawatt-hour`;
}

function formatSignedPrice(value) {
  const direction = value > 0 ? "plus " : value < 0 ? "minus " : "";
  return `${direction}$${Math.abs(value).toFixed(2)} per megawatt-hour`;
}

function requiredString(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
}
