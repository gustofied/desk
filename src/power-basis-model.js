const EXPECTED_COLUMNS = Object.freeze([
  "timestamp",
  "realTime",
  "dayAhead",
  "basis",
]);
const RANGE_SECONDS = Object.freeze({
  "1d": 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60,
  "90d": 90 * 24 * 60 * 60,
  "1y": 365 * 24 * 60 * 60,
  all: null,
});
const ENERGY_FACTOR = 0.00153;
const ENERGY_ASSUMPTIONS = Object.freeze({
  system: "NVIDIA DGX H100",
  systemPowerKw: 10.2,
  gpuCount: 8,
  pue: 1.2,
  powerBasis: "full-system maximum",
});
const ENERGY_NOTICE = "Energy-only sensitivity at assumed full-system maximum; not measured consumption, delivered electricity cost, or compute margin.";

export function createPowerBasisModel(
  payload,
  card,
  {
    locationId = card?.defaults?.layer,
    range = card?.defaults?.range || "1d",
    mode = "price",
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
  const normalizedMode = mode === "energy" ? "energy" : mode === "basis" ? "basis" : "price";
  const isEnergy = normalizedMode === "energy";
  const priceKind = typeof payload.dataset?.kind === "string" ? payload.dataset.kind : "unknown";
  const unit = isEnergy ? "USD per GPU-hour" : "USD per MWh";
  const precision = isEnergy ? 4 : 2;
  const energy = isEnergy ? Object.freeze({
    kind: "estimate",
    unit,
    precision,
    factor: ENERGY_FACTOR,
    assumptions: ENERGY_ASSUMPTIONS,
    notice: ENERGY_NOTICE,
    provenance: Object.freeze({
      priceKind,
      priceUnit: "USD per MWh",
      hardwareSourceUrl: "https://docs.nvidia.com/dgx/dgxh100-user-guide/introduction-to-dgxh100.html",
    }),
  }) : null;
  const rangeSeconds = RANGE_SECONDS[normalizedRange];
  const ranged = rangeSeconds === null ? history
    : history.filter(row => row.timestamp >= current.timestamp - rangeSeconds);
  const rows = Object.freeze(isEnergy ? ranged.map(row => Object.freeze({
    ...row,
    realTime: row.realTime * ENERGY_FACTOR,
    dayAhead: row.dayAhead * ENERGY_FACTOR,
    basis: row.basis * ENERGY_FACTOR,
    rawPrice: Object.freeze({ realTime: row.realTime, dayAhead: row.dayAhead, basis: row.basis }),
  })) : [...ranged]);
  const latest = rows.at(-1);

  return Object.freeze({
    version: 1,
    cardId: card.id,
    sourceCardId: payload.cardId,
    revision: payload.revision,
    asOf: payload.asOf,
    range: normalizedRange,
    mode: normalizedMode,
    kind: isEnergy ? "estimate" : priceKind,
    unit,
    precision,
    energy,
    provenance: Object.freeze({
      kind: priceKind,
      notice: ["showcase", "scenario", "demo"].includes(priceKind)
        ? "Demo power prices, not observed market prices or delivered data-center electricity costs."
        : "Wholesale power prices, not delivered data-center electricity costs.",
    }),
    location,
    rows,
    latest,
    ariaLabel: createAriaLabel(location, latest, normalizedRange, energy),
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
      const intervalMinutes = value.intervalMinutes;
      if (currency !== "USD" || unit !== "USD per MWh") {
        throw new TypeError(`Power location ${id} has an unsupported price unit`);
      }
      if (intervalMinutes !== 60) {
        throw new TypeError(`Power location ${id} has an invalid interval`);
      }
      const timezone = requiredString(value.timezone, `Power location ${id} timezone`);
      try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }); }
      catch { throw new TypeError(`Power location ${id} has an invalid timezone`); }

      return Object.freeze({
        id,
        label: requiredString(value.label, `Power location ${id} label`),
        market: requiredString(value.market, `Power location ${id} market`),
        location: requiredString(
          value.location,
          `Power location ${id} location`,
        ),
        timezone,
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
      const [timestamp, realTime, dayAhead, basis] = point;
      if (
        !Number.isSafeInteger(timestamp) ||
        !Number.isFinite(new Date(timestamp * 1000).getTime()) ||
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
  return normalized !== "all" && Array.isArray(card?.ranges) && !card.ranges.includes(normalized)
    ? fallback
    : normalized;
}

function createAriaLabel(location, latest, range, energy) {
  const duration = { all: "all history", "1d": "one day", "7d": "seven days", "90d": "ninety days", "1y": "one year" }[range];
  const precision = energy ? 4 : 2;
  const unit = energy ? "GPU-hour" : "megawatt-hour";
  return (
    `${location.label} ${energy ? "H100 power cost estimate" : "power prices"} over ${duration}. ` +
    `Real time ${formatPrice(latest.realTime, precision, unit)}, ` +
    `day ahead ${formatPrice(latest.dayAhead, precision, unit)}, ` +
    `spread ${formatSignedPrice(latest.basis, precision, unit)}.` +
    (energy ? ` Assumes a 10.2 kilowatt full-system maximum across eight GPUs and PUE 1.2. ${energy.notice}` : "")
  );
}

function formatPrice(value, precision, unit) {
  return `${value < 0 ? "minus " : ""}$${Math.abs(value).toFixed(precision)} per ${unit}`;
}

function formatSignedPrice(value, precision, unit) {
  const direction = value > 0 ? "plus " : value < 0 ? "minus " : "";
  return `${direction}$${Math.abs(value).toFixed(precision)} per ${unit}`;
}

function requiredString(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
}
