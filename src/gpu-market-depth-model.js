/**
 * Creates the read model for a one-sided GPU supply curve and its daily history.
 *
 * Compact payload contract:
 * {
 *   version: 2,
 *   cardId, revision, asOf, instrument, targetNodes,
 *   priceLevels: number[],
 *   columns: ["timestamp", "benchmarkPrice", "providerCount", "offerCount",
 *     "cumulativeNodes"],
 *   snapshots: [timestamp, benchmarkPrice, providerCount, offerCount,
 *     cumulativeNodes[]][]
 * }
 */
export function createGpuMarketDepthModel(
  payload,
  card,
  {
    targetNodes =
      card?.defaults?.targetNodes ??
      card?.defaults?.target ??
      payload?.targetNodes,
  } = {},
) {
  assertPayload(payload);
  assertCard(card, payload.cardId);

  const normalizedTarget = positiveInteger(targetNodes, "Target nodes");
  const instrument = normalizeInstrument(payload.instrument);
  const priceLevels = normalizePriceLevels(payload.priceLevels);
  const snapshots = normalizeSnapshots(payload.snapshots, priceLevels);
  const history = Object.freeze(
    snapshots.map((snapshot) =>
      createSnapshotModel(
        snapshot,
        priceLevels,
        normalizedTarget,
        instrument.nodeGpuCount,
      )
    ),
  );
  const current = history.at(-1);

  if (payload.asOf !== current.timestamp) {
    throw new TypeError("Market depth as-of time must match the latest snapshot");
  }
  assertDataset(payload.dataset, snapshots);

  const maxCapacity = Math.max(
    normalizedTarget,
    ...history.map((snapshot) => snapshot.totalAvailableNodes),
  );
  const maxShelfNodes = Math.max(
    0,
    ...history.flatMap((snapshot) =>
      snapshot.buckets.map((bucket) => bucket.incrementalNodes)
    ),
  );

  return Object.freeze({
    version: 2,
    cardId: card.id,
    sourceCardId: payload.cardId,
    revision: payload.revision,
    asOf: current.timestamp,
    title: card.title || `${instrument.gpuLabel} availability`,
    instrument,
    targetNodes: normalizedTarget,
    priceLevels,
    priceDomain: Object.freeze([priceLevels[0], priceLevels.at(-1)]),
    capacityDomain: Object.freeze([0, maxCapacity]),
    shelfDomain: Object.freeze([0, maxShelfNodes]),
    historyDomain: Object.freeze([history[0].timestamp, current.timestamp]),
    current,
    history,
  });
}

function assertPayload(payload) {
  const expectedColumns = [
    "timestamp",
    "benchmarkPrice",
    "providerCount",
    "offerCount",
    "cumulativeNodes",
  ];
  if (
    payload?.version !== 2 ||
    typeof payload?.cardId !== "string" ||
    !payload.cardId.trim() ||
    typeof payload?.revision !== "string" ||
    !payload.revision.trim() ||
    !Number.isInteger(payload?.asOf) ||
    payload.asOf <= 0 ||
    !Array.isArray(payload?.priceLevels) ||
    !Array.isArray(payload?.snapshots) ||
    payload.snapshots.length < 2 ||
    !Array.isArray(payload?.columns) ||
    payload.columns.length !== expectedColumns.length ||
    payload.columns.some((column, index) => column !== expectedColumns[index])
  ) {
    throw new TypeError("Unsupported GPU market depth payload");
  }
}

function assertCard(card, payloadCardId) {
  if (!card?.id || card.renderer !== "cumulative-depth") {
    throw new TypeError("A cumulative market depth card definition is required");
  }
  const expectedSource = card.sourceCardId || card.id;
  if (payloadCardId !== expectedSource) {
    throw new TypeError(`Expected ${expectedSource} data for ${card.id}`);
  }
}

function assertDataset(dataset, snapshots) {
  if (!dataset || typeof dataset !== "object" || Array.isArray(dataset)) {
    throw new TypeError("Market depth dataset metadata is required");
  }
  if (
    dataset.cadence !== "daily" ||
    dataset.cadenceSeconds !== 24 * 60 * 60 ||
    dataset.start !== snapshots[0].timestamp ||
    dataset.end !== snapshots.at(-1).timestamp ||
    dataset.observationCount !== snapshots.length
  ) {
    throw new TypeError("Market depth dataset metadata does not match its history");
  }
}

function normalizeInstrument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Market depth instrument is required");
  }

  const gpuLabel = requiredString(
    value.gpuLabel || value.gpu,
    "Instrument GPU label",
  );
  const gpuType = requiredString(
    value.gpuType || value.gpu,
    "Instrument GPU type",
  );
  const region = requiredString(value.region, "Instrument region");
  const interconnect = requiredString(
    value.interconnect,
    "Instrument interconnect",
  );
  const currency = requiredString(value.currency, "Instrument currency");
  const priceUnit = requiredString(value.priceUnit, "Instrument price unit");
  const capacityUnit = requiredString(
    value.capacityUnit,
    "Instrument capacity unit",
  );

  return Object.freeze({
    gpu: requiredString(value.gpu || gpuLabel, "Instrument GPU"),
    gpuLabel,
    gpuType,
    region,
    regionLabel: optionalString(value.regionLabel),
    socket: optionalString(value.socket),
    nodeGpuCount: positiveInteger(
      value.nodeGpuCount,
      "Instrument node GPU count",
    ),
    interconnect,
    security: optionalString(value.security),
    rentalType: optionalString(value.rentalType),
    termDays: positiveInteger(value.termDays, "Instrument term days"),
    startWithinDays: nonnegativeInteger(
      value.startWithinDays,
      "Instrument start window",
    ),
    currency,
    priceUnit,
    capacityUnit,
  });
}

function normalizePriceLevels(values) {
  if (!Array.isArray(values) || values.length < 2) {
    throw new TypeError("At least two market depth price levels are required");
  }
  const levels = values.map((value, index) => {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
      throw new TypeError(`Invalid market depth price at index ${index}`);
    }
    if (index > 0 && number <= Number(values[index - 1])) {
      throw new TypeError("Market depth prices must be strictly increasing");
    }
    return number;
  });
  return Object.freeze(levels);
}

function normalizeSnapshots(rows, priceLevels) {
  let previousTimestamp = 0;
  const snapshots = rows.map((row, index) => {
    if (!Array.isArray(row) || row.length !== 5) {
      throw new TypeError(`Invalid market depth snapshot at index ${index}`);
    }
    const timestamp = Number(row[0]);
    const benchmarkPrice = Number(row[1]);
    const providerCount = Number(row[2]);
    const offerCount = Number(row[3]);
    const cumulativeNodes = row[4];

    if (!Number.isInteger(timestamp) || timestamp <= previousTimestamp) {
      throw new TypeError("Market depth timestamps must be strictly increasing");
    }
    if (
      previousTimestamp &&
      timestamp - previousTimestamp !== 24 * 60 * 60
    ) {
      throw new TypeError("Market depth history must use a daily cadence");
    }
    if (
      !Number.isFinite(benchmarkPrice) ||
      benchmarkPrice < priceLevels[0] ||
      benchmarkPrice > priceLevels.at(-1)
    ) {
      throw new TypeError(`Invalid market depth benchmark at index ${index}`);
    }
    if (
      !Number.isInteger(providerCount) ||
      providerCount <= 0 ||
      !Number.isInteger(offerCount) ||
      offerCount < providerCount
    ) {
      throw new TypeError(`Invalid market depth coverage at index ${index}`);
    }
    if (
      !Array.isArray(cumulativeNodes) ||
      cumulativeNodes.length !== priceLevels.length
    ) {
      throw new TypeError(`Invalid market depth curve at index ${index}`);
    }

    let previousCapacity = 0;
    const capacity = cumulativeNodes.map((value, bucketIndex) => {
      const number = Number(value);
      if (!Number.isInteger(number) || number < previousCapacity) {
        throw new TypeError(
          `Market depth capacity must be cumulative at snapshot ${index}, bucket ${bucketIndex}`,
        );
      }
      previousCapacity = number;
      return number;
    });
    previousTimestamp = timestamp;

    return Object.freeze({
      timestamp,
      benchmarkPrice,
      providerCount,
      offerCount,
      cumulativeNodes: Object.freeze(capacity),
    });
  });
  return Object.freeze(snapshots);
}

function createSnapshotModel(snapshot, priceLevels, targetNodes, nodeGpuCount) {
  let previousCapacity = 0;
  const sourceBuckets = priceLevels.map((price, index) => {
    const cumulativeNodes = snapshot.cumulativeNodes[index];
    const incrementalNodes = cumulativeNodes - previousCapacity;
    previousCapacity = cumulativeNodes;
    return Object.freeze({
      id: `price-${String(price).replace(".", "-")}`,
      price,
      incrementalNodes,
      cumulativeNodes,
      cumulativeGpus: cumulativeNodes * nodeGpuCount,
    });
  });
  const totalAvailableNodes = sourceBuckets.at(-1).cumulativeNodes;
  const buckets = Object.freeze(
    sourceBuckets.map((bucket) =>
      Object.freeze({
        ...bucket,
        shelfNodes: bucket.incrementalNodes,
        shelfShare:
          totalAvailableNodes > 0
            ? bucket.incrementalNodes / totalAvailableNodes
            : 0,
        isClearingShelf:
          bucket.cumulativeNodes >= targetNodes &&
          bucket.cumulativeNodes - bucket.incrementalNodes < targetNodes,
      })
    ),
  );
  const benchmarkBucket = [...buckets]
    .reverse()
    .find((bucket) => bucket.price <= snapshot.benchmarkPrice);
  const clearingBucket = buckets.find(
    (bucket) => bucket.cumulativeNodes >= targetNodes,
  );
  const capacityAtBenchmark = benchmarkBucket?.cumulativeNodes || 0;
  const clearingPrice = clearingBucket?.price ?? null;
  const clearingBasis =
    clearingPrice === null ? null : clearingPrice - snapshot.benchmarkPrice;

  return Object.freeze({
    timestamp: snapshot.timestamp,
    benchmarkPrice: snapshot.benchmarkPrice,
    providerCount: snapshot.providerCount,
    offerCount: snapshot.offerCount,
    buckets,
    totalAvailableNodes,
    capacityAtBenchmark,
    gpusAtBenchmark: capacityAtBenchmark * nodeGpuCount,
    shortfallNodes: Math.max(0, targetNodes - capacityAtBenchmark),
    benchmarkCoverage: capacityAtBenchmark / targetNodes,
    clearingPrice,
    clearingBasis,
    clearingBasisPct:
      clearingBasis === null ? null : clearingBasis / snapshot.benchmarkPrice,
    targetReached: Boolean(clearingBucket),
  });
}

function requiredString(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
}

function optionalString(value) {
  const normalized = String(value || "").trim();
  return normalized || "";
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return number;
}

function nonnegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new TypeError(`${label} must be a nonnegative integer`);
  }
  return number;
}
