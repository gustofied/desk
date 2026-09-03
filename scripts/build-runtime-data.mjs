import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getCardDefinition,
  GPU_LAYERS,
} from "../src/card-registry.js";
import { createGpuMarketDepthModel } from "../src/gpu-market-depth-model.js";
import { createPowerBasisModel } from "../src/power-basis-model.js";

const HOUR_SECONDS = 60 * 60;
const DAY_SECONDS = 24 * HOUR_SECONDS;
const buildOptions = parseBuildOptions(process.argv.slice(2));
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const priceCard = getCardDefinition("gpu-index");
const priceSnapshotCard = getCardDefinition("gpu-price-snapshot");
const depthCard = getCardDefinition("gpu-market-depth");
const powerCard = getCardDefinition("power-basis");
const dealCard = getCardDefinition("deal-view");
const gpuLayers = GPU_LAYERS.filter((layer) => layer.unit === "usd-hour");
const tokenLayer = GPU_LAYERS.find((layer) => layer.id === "TOKEN");

const gpuSources = new Map();
for (const layer of gpuLayers) {
  const sourceFile = join(
    projectRoot,
    priceCard.sourceDir,
    `${layer.id.toLowerCase()}.json`,
  );
  const payload = await readJson(sourceFile);
  validateGpuSource(payload, layer, sourceFile);
  const points = compactSeries(payload.series, sourceFile);
  gpuSources.set(layer.id, { payload, points, sourceFile });
}

assertAlignedSeries(
  Array.from(gpuSources, ([id, source]) => [id, source.points]),
);

const tokenSource = await readTokenSeries(tokenLayer);
const priceSeries = Object.fromEntries([
  ...gpuLayers.map((layer) => [layer.id, gpuSources.get(layer.id).points]),
  [tokenLayer.id, tokenSource.points],
]);
const priceBounds = seriesBounds(Object.values(priceSeries));
const priceRuntime = {
  version: 2,
  cardId: priceCard.id,
  asOf: priceBounds.end,
  dataset: runtimeProvenance(
    [...gpuSources.values()].map((source) => source.payload),
    tokenSource.payload,
    priceBounds,
  ),
  columns: ["timestamp", "value", "lower", "upper"],
  series: priceSeries,
};
priceRuntime.revision = revisionFor(priceRuntime);

const depthSourceFile = join(projectRoot, depthCard.sourceFile);
const depthSource = await readJson(depthSourceFile);
const depthRuntime = buildMarketDepthRuntime(depthSource, depthSourceFile);
const powerSourceFile = join(projectRoot, powerCard.sourceFile);
const powerSource = await readJson(powerSourceFile);
const powerRuntime = buildPowerBasisRuntime(powerSource, powerSourceFile);
const dealSourceFile = join(projectRoot, dealCard.sourceFile);
const dealSource = await readJson(dealSourceFile);
const dealRuntime = buildDealRuntime(dealSource, dealSourceFile);

// Keep the build contract tied to the browser model instead of allowing the
// source and renderer to drift apart unnoticed.
createGpuMarketDepthModel(depthRuntime, depthCard, {
  targetNodes: depthRuntime.targetNodes,
});
createPowerBasisModel(powerRuntime, powerCard, {
  locationId: powerCard.defaults.layer,
  range: "all",
});

const computePriceRows = buildComputePriceRows(priceRuntime, priceCard);
const acceleratorPriceRows = buildAcceleratorPriceRows(
  computePriceRows,
  gpuLayers,
);
const marketDepthRows = buildMarketDepthRows(depthRuntime);
const powerPriceRows = buildPowerPriceRows(powerRuntime);
const publicDataExports = [
  buildPublicDataExport(priceCard.dataTable, computePriceRows, {
    asOf: priceRuntime.asOf,
    cadence: priceRuntime.dataset.cadence,
    kind: priceRuntime.dataset.kind,
  }),
  buildPublicDataExport(priceSnapshotCard.dataTable, acceleratorPriceRows, {
    asOf: priceRuntime.asOf,
    cadence: "snapshot",
    kind: priceRuntime.dataset.kind,
  }),
  buildPublicDataExport(depthCard.dataTable, marketDepthRows, {
    asOf: depthRuntime.asOf,
    cadence: depthRuntime.dataset.cadence,
    kind: depthRuntime.dataset.kind,
  }),
  buildPublicDataExport(powerCard.dataTable, powerPriceRows, {
    asOf: powerRuntime.asOf,
    cadence: powerRuntime.dataset.cadence,
    kind: powerRuntime.dataset.kind,
  }),
];

const dataManifest = {
  version: 1,
  asOf: Math.max(
    priceRuntime.asOf,
    depthRuntime.asOf,
    powerRuntime.asOf,
    dealRuntime.asOf,
  ),
  cards: {
    [priceCard.id]: {
      file: priceCard.dataFile,
      revision: priceRuntime.revision,
      asOf: priceRuntime.asOf,
    },
    [depthCard.id]: {
      file: depthCard.dataFile,
      revision: depthRuntime.revision,
      asOf: depthRuntime.asOf,
    },
    [powerCard.id]: {
      file: powerCard.dataFile,
      revision: powerRuntime.revision,
      asOf: powerRuntime.asOf,
    },
    [dealCard.id]: {
      file: dealCard.dataFile,
      revision: dealRuntime.revision,
      asOf: dealRuntime.asOf,
    },
  },
  exports: Object.fromEntries(
    publicDataExports.map((dataExport) => [
      dataExport.id,
      dataExport.manifest,
    ]),
  ),
};
dataManifest.revision = revisionFor(dataManifest);

if (buildOptions.check) {
  console.log(
    `Validated ${priceCard.id} (${priceRuntime.revision}) and ` +
      `${depthCard.id} (${depthRuntime.revision}) and ` +
      `${powerCard.id} (${powerRuntime.revision}) and ` +
      `${dealCard.id} (${dealRuntime.revision}) source contracts, plus ` +
      `${publicDataExports.length} public data exports.`,
  );
} else {
  await Promise.all([
    writeJson(join(projectRoot, priceCard.dataFile), priceRuntime),
    writeJson(join(projectRoot, depthCard.dataFile), depthRuntime),
    writeJson(join(projectRoot, powerCard.dataFile), powerRuntime),
    writeJson(join(projectRoot, dealCard.dataFile), dealRuntime),
    writeJson(join(projectRoot, "data", "manifest.json"), dataManifest),
    ...publicDataExports.map((dataExport) =>
      writeJson(join(projectRoot, dataExport.file), dataExport.records),
    ),
  ]);
  console.log(
    `Built ${priceCard.dataFile} (${priceRuntime.revision}), ` +
      `${depthCard.dataFile} (${depthRuntime.revision}), ` +
      `${powerCard.dataFile} (${powerRuntime.revision}), ` +
      `${dealCard.dataFile} (${dealRuntime.revision}), and data/manifest.json ` +
      `(${dataManifest.revision}), plus ${publicDataExports.length} public ` +
      "data exports.",
  );
}

function buildComputePriceRows(runtime, card) {
  const rows = card.layers.flatMap((layer) => {
    const points = runtime.series[layer.id];
    if (!Array.isArray(points) || !points.length) {
      throw new Error(`Missing normalized observations for ${layer.id}`);
    }
    const unit = layer.unit === "usd-hour"
      ? "USD per GPU-hour"
      : "USD per million tokens";
    return points.map((point) => ({
      observed_at: isoTimestamp(point[0], `${layer.id} observation`),
      instrument: layer.id,
      value: point[1],
      lower: point[2],
      upper: point[3],
      unit,
    }));
  });
  assertUniqueRows(
    rows,
    (row) => `${row.observed_at}\u0000${row.instrument}`,
    "compute prices",
  );
  return rows;
}

function buildAcceleratorPriceRows(computePriceRows, layers) {
  const latestByInstrument = new Map();
  for (const row of computePriceRows) {
    if (layers.some((layer) => layer.id === row.instrument)) {
      latestByInstrument.set(row.instrument, row);
    }
  }
  const rows = layers.map((layer) => {
    const row = latestByInstrument.get(layer.id);
    if (!row) throw new Error(`Missing accelerator snapshot for ${layer.id}`);
    return { ...row };
  });
  return rows.sort(
    (left, right) =>
      right.value - left.value || left.instrument.localeCompare(right.instrument),
  );
}

function buildMarketDepthRows(runtime) {
  const instrument = runtime.instrument;
  const rows = runtime.snapshots.flatMap((snapshot) => {
    let previousNodes = 0;
    return runtime.priceLevels.map((price, index) => {
      const cumulativeNodes = snapshot[4][index];
      const incrementalNodes = cumulativeNodes - previousNodes;
      previousNodes = cumulativeNodes;
      return {
        observed_at: isoTimestamp(snapshot[0], "market depth observation"),
        instrument: instrument.gpu,
        region: instrument.region,
        node_gpu_count: instrument.nodeGpuCount,
        interconnect: instrument.interconnect,
        term_days: instrument.termDays,
        benchmark_price_usd_gpu_hour: snapshot[1],
        provider_count: snapshot[2],
        offer_count: snapshot[3],
        price_usd_gpu_hour: price,
        incremental_nodes: incrementalNodes,
        cumulative_nodes: cumulativeNodes,
        cumulative_gpus: cumulativeNodes * instrument.nodeGpuCount,
        price_unit: instrument.priceUnit,
        capacity_unit: instrument.capacityUnit,
      };
    });
  });
  assertUniqueRows(
    rows,
    (row) => `${row.observed_at}\u0000${row.price_usd_gpu_hour}`,
    "market depth",
  );
  return rows;
}

function buildPowerPriceRows(runtime) {
  const locations = new Map(
    runtime.locations.map((location) => [location.id, location]),
  );
  const rows = Object.entries(runtime.series).flatMap(([locationId, series]) => {
    const location = locations.get(locationId);
    if (!location) throw new Error(`Missing power location ${locationId}`);
    return series.map((point) => ({
      observed_at: isoTimestamp(point[0], `${locationId} power observation`),
      instrument: location.id,
      market: location.market,
      location: location.location,
      real_time_price_usd_mwh: point[1],
      day_ahead_price_usd_mwh: point[2],
      basis_usd_mwh: point[3],
      currency: location.currency,
      unit: location.unit,
      interval_minutes: location.intervalMinutes,
    }));
  });
  assertUniqueRows(
    rows,
    (row) => `${row.observed_at}\u0000${row.instrument}`,
    "power prices",
  );
  return rows;
}

function buildPublicDataExport(table, records, { asOf, cadence, kind }) {
  if (
    !table?.id ||
    !table?.file
  ) {
    throw new Error("A public data table needs an id and file");
  }
  validateFlatRecords(records, table.id);
  const revision = revisionFor(records);
  return {
    id: table.id,
    file: table.file,
    records,
    manifest: {
      file: table.file,
      schemaVersion: 1,
      format: "json",
      kind,
      cadence,
      rows: records.length,
      asOf,
      columns: Object.keys(records[0]),
      revision,
    },
  };
}

function validateFlatRecords(records, label) {
  if (!Array.isArray(records) || !records.length) {
    throw new Error(`${label} export needs at least one row`);
  }
  const columns = Object.keys(records[0]);
  for (const [index, record] of records.entries()) {
    const keys = Object.keys(record);
    if (
      keys.length !== columns.length ||
      keys.some((key, columnIndex) => key !== columns[columnIndex])
    ) {
      throw new Error(`${label} row ${index} does not match its columns`);
    }
    for (const [key, value] of Object.entries(record)) {
      if (
        value === undefined ||
        (typeof value === "number" && !Number.isFinite(value)) ||
        (typeof value === "object" && value !== null)
      ) {
        throw new Error(`${label} row ${index} has an invalid ${key}`);
      }
    }
  }
}

function assertUniqueRows(rows, keyFor, label) {
  const keys = new Set();
  for (const row of rows) {
    const key = keyFor(row);
    if (keys.has(key)) throw new Error(`${label} export has a duplicate row`);
    keys.add(key);
  }
}

function isoTimestamp(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} timestamp is invalid`);
  }
  return new Date(value * 1000).toISOString();
}

function buildPowerBasisRuntime(source, sourceFile) {
  validatePowerBasisSource(source, sourceFile);
  const locations = source.locations.map((location) => ({
    id: location.id,
    label: location.label,
    market: location.market,
    location: location.location,
    timezone: location.timezone,
    currency: location.currency,
    unit: location.unit,
    intervalMinutes: location.interval_minutes,
  }));
  const series = Object.fromEntries(
    locations.map((location) => [
      location.id,
      source.series[location.id].map((row) => {
        const realTime = round(row.real_time_price);
        const dayAhead = round(row.day_ahead_price);
        return [
          timestampSeconds(
            row.observed_at,
            `${sourceFile} ${location.id} observation`,
          ),
          realTime,
          dayAhead,
          round(realTime - dayAhead),
        ];
      }),
    ]),
  );
  const asOf = timestampSeconds(source.as_of, `${sourceFile} as_of`);
  const start = timestampSeconds(
    source.observation_window.started_at,
    `${sourceFile} observation start`,
  );
  const end = timestampSeconds(
    source.observation_window.ended_at,
    `${sourceFile} observation end`,
  );
  const runtime = {
    version: 1,
    cardId: powerCard.id,
    asOf,
    columns: ["timestamp", "realTime", "dayAhead", "basis"],
    locations,
    series,
    dataset: {
      kind: provenanceKind([source]),
      sourceId: source.id,
      cadence: source.cadence,
      cadenceSeconds: cadenceSecondsFor(source.cadence),
      start,
      end,
      observationCount: source.observation_window.observation_count,
    },
  };
  runtime.revision = revisionFor(runtime);
  return runtime;
}

function validatePowerBasisSource(source, sourceFile) {
  if (
    source?.version !== 1 ||
    source?.contract !== "desk_showcase_power_basis" ||
    source?.id !== "power-basis" ||
    source?.cadence !== "hourly" ||
    !Array.isArray(source?.locations) ||
    !source.locations.length ||
    !source.series ||
    typeof source.series !== "object" ||
    Array.isArray(source.series) ||
    !source.observation_window
  ) {
    throw new Error(`Unsupported power-basis data in ${sourceFile}`);
  }

  const ids = new Set();
  let commonStart = null;
  let commonEnd = null;
  let commonCount = null;
  for (const location of source.locations) {
    if (
      typeof location?.id !== "string" ||
      !location.id.trim() ||
      ids.has(location.id) ||
      !location.label ||
      !location.market ||
      !location.location ||
      !location.timezone ||
      location.currency !== "USD" ||
      location.unit !== "USD per MWh" ||
      location.interval_minutes !== 60
    ) {
      throw new Error(`${sourceFile} has an invalid power location`);
    }
    ids.add(location.id);
    const rows = source.series[location.id];
    if (!Array.isArray(rows) || rows.length < 2) {
      throw new Error(`${sourceFile} is missing ${location.id} observations`);
    }
    let previousTimestamp = 0;
    for (const [index, row] of rows.entries()) {
      const timestamp = timestampSeconds(
        row?.observed_at,
        `${sourceFile} ${location.id} observation ${index}`,
      );
      if (
        timestamp <= previousTimestamp ||
        (previousTimestamp && timestamp - previousTimestamp !== HOUR_SECONDS) ||
        !Number.isFinite(Number(row?.real_time_price)) ||
        !Number.isFinite(Number(row?.day_ahead_price))
      ) {
        throw new Error(`${sourceFile} has an invalid ${location.id} observation ${index}`);
      }
      previousTimestamp = timestamp;
    }
    const start = timestampSeconds(
      rows[0].observed_at,
      `${sourceFile} ${location.id} first observation`,
    );
    const end = timestampSeconds(
      rows.at(-1).observed_at,
      `${sourceFile} ${location.id} last observation`,
    );
    commonStart ??= start;
    commonEnd ??= end;
    commonCount ??= rows.length;
    if (start !== commonStart || end !== commonEnd || rows.length !== commonCount) {
      throw new Error(`${sourceFile} power locations must align`);
    }
  }

  const declaredStart = timestampSeconds(
    source.observation_window.started_at,
    `${sourceFile} observation start`,
  );
  const declaredEnd = timestampSeconds(
    source.observation_window.ended_at,
    `${sourceFile} observation end`,
  );
  if (
    declaredStart !== commonStart ||
    declaredEnd !== commonEnd ||
    source.observation_window.observation_count !== commonCount ||
    timestampSeconds(source.as_of, `${sourceFile} as_of`) !== commonEnd
  ) {
    throw new Error(`${sourceFile} observation window does not match its data`);
  }
}

function buildDealRuntime(source, sourceFile) {
  validateDealSource(source, sourceFile);
  const asOf = timestampSeconds(source.as_of, `${sourceFile} as_of`);
  timestampSeconds(source.rfs, `${sourceFile} rfs`);
  const quoteHistory = source.quote_history.map((point, index) => [
    timestampSeconds(
      point.observed_at,
      `${sourceFile} quote_history[${index}].observed_at`,
    ),
    round(finiteNumber(point.seller_ask_usd_gpu_hour ?? point.value)),
    round(finiteNumber(point.buyer_bid_usd_gpu_hour)),
  ]);
  assertStrictlyIncreasing(quoteHistory, `${sourceFile} quote_history`);
  const runtime = {
    version: 1,
    cardId: dealCard.id,
    asOf,
    id: source.id.replace(/^deal-/, ""),
    type: source.kind === "reserved-capacity"
      ? "Reserved capacity"
      : source.kind,
    label: source.label,
    asset: source.capacity.accelerator_model,
    quantity: source.capacity.gpu_count,
    nodes: source.capacity.node_count,
    rfs: source.rfs.slice(0, 7),
    quote: {
      value: source.terms.quote_usd_gpu_hour,
      currency: "USD",
      unit: "GPU-hour",
      prepayPercent: source.terms.prepay_percent,
    },
    quoteHistory,
    currentStage: source.current_stage,
    parties: source.parties,
    events: source.events,
    nextAction: source.next_action,
    stages: source.stages.map((stage) => ({
      id: stage.id,
      label: stage.label,
      copy: stage.summary,
      compactCopy:
        stage.id === "diligence"
          ? "Quote checked"
          : stage.id === "execute"
            ? "Finalize agreement"
            : "Reserved capacity",
      owner: stage.source,
      status: stage.status,
    })),
  };
  runtime.revision = revisionFor(runtime);
  return runtime;
}

function validateDealSource(source, sourceFile) {
  const stageIds = new Set(["spec", "diligence", "execute"]);
  if (
    source?.version !== 1 ||
    source?.contract !== "desk_deal_view" ||
    source?.id !== "deal-041" ||
    source?.capacity?.accelerator_model !== "B200" ||
    !Number.isFinite(Number(source?.capacity?.gpu_count)) ||
    !Number.isFinite(Number(source?.capacity?.node_count)) ||
    !Number.isFinite(Number(source?.terms?.quote_usd_gpu_hour)) ||
    !Array.isArray(source?.quote_history) ||
    source.quote_history.length < 2 ||
    source.quote_history.some(
      (point) =>
        !Number.isFinite(Date.parse(point?.observed_at)) ||
        !Number.isFinite(
          Number(point?.seller_ask_usd_gpu_hour ?? point?.value),
        ) ||
        !Number.isFinite(Number(point?.buyer_bid_usd_gpu_hour)) ||
        Number(point?.seller_ask_usd_gpu_hour ?? point?.value) < 0 ||
        Number(point?.buyer_bid_usd_gpu_hour) < 0 ||
        Number(point?.buyer_bid_usd_gpu_hour) >
          Number(point?.seller_ask_usd_gpu_hour ?? point?.value),
    ) ||
    Number(
      source.quote_history.at(-1)?.seller_ask_usd_gpu_hour ??
        source.quote_history.at(-1)?.value,
    ) !== Number(source.terms.quote_usd_gpu_hour) ||
    Number(source.quote_history.at(-1)?.buyer_bid_usd_gpu_hour) !==
      Number(source.terms.quote_usd_gpu_hour) ||
    !Array.isArray(source?.stages) ||
    source.stages.length !== stageIds.size ||
    source.stages.some((stage) => !stageIds.has(stage?.id)) ||
    !stageIds.has(source?.current_stage)
  ) {
    throw new Error(`Unsupported deal data in ${sourceFile}`);
  }
}

function validateGpuSource(payload, layer, sourceFile) {
  if (
    !new Set(["compute_bazaar_card", "desk_showcase_card"]).has(
      payload?.contract,
    ) ||
    payload?.card_type !== "gpu_benchmark" ||
    payload?.card_id !== `gpu-benchmark:${layer.id.toLowerCase()}` ||
    payload?.data?.family_id !== layer.id ||
    payload?.unit !== "USD per GPU-hour"
  ) {
    throw new Error(`Unsupported market data in ${sourceFile}`);
  }
}

function compactSeries(rows, sourceFile) {
  const points = (Array.isArray(rows) ? rows : [])
    .map(compactPoint)
    .filter(Boolean)
    .sort((left, right) => left[0] - right[0]);
  if (!points.length) throw new Error(`No usable observations in ${sourceFile}`);
  assertStrictlyIncreasing(points, sourceFile);
  if (points.some((point) => point[2] > point[1] || point[1] > point[3])) {
    throw new Error(`Invalid price range in ${sourceFile}`);
  }
  return points;
}

function compactPoint(row) {
  const timestamp = Math.round(new Date(row?.observed_at).getTime() / 1000);
  const value = finiteNumber(row?.value);
  if (!Number.isFinite(timestamp) || !Number.isFinite(value)) return null;

  const lower = finiteNumber(row?.lower, value);
  const upper = finiteNumber(row?.upper, value);
  return [timestamp, round(value), round(lower), round(upper)];
}

async function readTokenSeries(layer) {
  if (!layer?.sourceFile) throw new Error("Token Price Index source is missing");
  const sourceFile = join(projectRoot, layer.sourceFile);
  const payload = await readJson(sourceFile);
  if (
    payload?.contract !== "desk_showcase_series" ||
    payload?.id !== layer.id ||
    payload?.unit !== "USD per million tokens"
  ) {
    throw new Error(`Unsupported token price data in ${sourceFile}`);
  }
  const points = compactSeries(payload.series, sourceFile);
  const cadenceSeconds = cadenceSecondsFor(payload.cadence);
  if (cadenceSeconds) assertRegularCadence(points, layer.id, cadenceSeconds);
  return { payload, points, sourceFile };
}

function assertAlignedSeries(entries) {
  const [referenceId, reference] = entries[0] || [];
  if (!reference?.length) throw new Error("A reference market series is required");
  for (const [seriesId, points] of entries) {
    if (points.length !== reference.length) {
      throw new Error(`${seriesId} does not align with ${referenceId}`);
    }
    for (let index = 0; index < points.length; index += 1) {
      if (points[index][0] !== reference[index][0]) {
        throw new Error(`${seriesId} timestamp ${index} does not align`);
      }
    }
  }
}

function assertStrictlyIncreasing(points, label) {
  for (let index = 1; index < points.length; index += 1) {
    if (points[index][0] <= points[index - 1][0]) {
      throw new Error(`${label} timestamps must be strictly increasing`);
    }
  }
}

function assertRegularCadence(points, label, cadenceSeconds) {
  for (let index = 1; index < points.length; index += 1) {
    if (points[index][0] - points[index - 1][0] !== cadenceSeconds) {
      throw new Error(`${label} must use its declared cadence`);
    }
  }
}

function buildMarketDepthRuntime(source, sourceFile) {
  validateMarketDepthSource(source, sourceFile);
  const priceLevels = source.price_levels.map(Number);
  const snapshots = source.depth_history.map((observation, index) => [
    timestampSeconds(
      observation.observed_at,
      `${sourceFile} depth history ${index}`,
    ),
    observation.benchmark_price_usd_gpu_hr,
    observation.provider_count,
    observation.offer_count,
    observation.curve.map((point) => point.cumulative_nodes),
  ]);
  const asOf = timestampSeconds(source.as_of, `${sourceFile} as_of`);
  if (snapshots.at(-1)?.[0] !== asOf) {
    throw new Error(`${sourceFile} needs a current market-depth observation`);
  }

  const sourceStart = timestampSeconds(
    source.observation_window.started_at,
    `${sourceFile} observation start`,
  );
  const sourceEnd = timestampSeconds(
    source.observation_window.ended_at,
    `${sourceFile} observation end`,
  );
  const historyStart = timestampSeconds(
    source.depth_history_window.started_at,
    `${sourceFile} depth history start`,
  );
  const historyEnd = timestampSeconds(
    source.depth_history_window.ended_at,
    `${sourceFile} depth history end`,
  );
  const sourceInstrument = source.instrument;
  const runtime = {
    version: 2,
    cardId: depthCard.id,
    asOf,
    instrument: {
      gpu: sourceInstrument.accelerator_model,
      gpuLabel: sourceInstrument.accelerator_model,
      gpuType: sourceInstrument.accelerator_type || "GPU",
      region: sourceInstrument.region,
      regionLabel: regionLabel(sourceInstrument.region),
      socket: sourceInstrument.socket || "",
      nodeGpuCount: sourceInstrument.gpu_count_per_node,
      interconnect: sourceInstrument.interconnect,
      security: sourceInstrument.security || "",
      rentalType: sourceInstrument.rental_type || "",
      termDays: sourceInstrument.commitment_days,
      startWithinDays:
        sourceInstrument.start_within_days ??
        sourceInstrument.commitment_days,
      currency: currencyFromUnit(sourceInstrument.price_unit),
      priceUnit: sourceInstrument.price_unit,
      capacityUnit: sourceInstrument.depth_unit,
    },
    targetNodes: Number(depthCard.defaults.target || 128),
    priceLevels,
    columns: [
      "timestamp",
      "benchmarkPrice",
      "providerCount",
      "offerCount",
      "cumulativeNodes",
    ],
    snapshots,
    dataset: {
      kind: provenanceKind([source]),
      sourceId: source.id,
      sourceRevision: source.revision,
      cadence: source.depth_history_window.cadence,
      cadenceSeconds: cadenceSecondsFor(source.depth_history_window.cadence),
      start: historyStart,
      end: historyEnd,
      observationCount: source.depth_history_window.observation_count,
      sourceCadence: source.cadence,
      sourceCadenceSeconds: cadenceSecondsFor(source.cadence),
      sourceStart,
      sourceEnd,
      sourceObservationCount: source.observation_window.observation_count,
    },
  };
  runtime.revision = revisionFor(runtime);
  return runtime;
}

function validateMarketDepthSource(source, sourceFile) {
  if (
    source?.version !== 2 ||
    !new Set(["desk_showcase_market_depth", "desk_market_depth"]).has(
      source?.contract,
    ) ||
    typeof source?.id !== "string" ||
    !source.id.trim() ||
    !source.instrument ||
    !Array.isArray(source.price_levels) ||
    source.price_levels.length < 2 ||
    !Array.isArray(source.series) ||
    !source.series.length ||
    !source.observation_window ||
    !Array.isArray(source.depth_history) ||
    source.depth_history.length < 2 ||
    !source.depth_history_window
  ) {
    throw new Error(`Unsupported market-depth data in ${sourceFile}`);
  }

  const priceLevels = source.price_levels.map((value) => Number(value));
  priceLevels.forEach((price, index) => {
    if (
      !Number.isFinite(price) ||
      price <= 0 ||
      (index > 0 && price <= priceLevels[index - 1])
    ) {
      throw new Error(`${sourceFile} has invalid market-depth price levels`);
    }
  });

  let previousSeriesTimestamp = 0;
  const observations = new Map();
  if (source.cadence !== "hourly") {
    throw new Error(`${sourceFile} must declare an hourly source cadence`);
  }
  source.series.forEach((row, index) => {
    const timestamp = timestampSeconds(
      row?.observed_at,
      `${sourceFile} observation ${index}`,
    );
    if (timestamp <= previousSeriesTimestamp) {
      throw new Error(`${sourceFile} observations must be strictly increasing`);
    }
    if (
      previousSeriesTimestamp &&
      timestamp - previousSeriesTimestamp !== HOUR_SECONDS
    ) {
      throw new Error(`${sourceFile} observations must use an hourly cadence`);
    }
    if (
      !Number.isFinite(row?.benchmark_price_usd_gpu_hr) ||
      !Number.isInteger(row?.provider_count) ||
      !Number.isInteger(row?.offer_count) ||
      row.benchmark_price_usd_gpu_hr < priceLevels[0] ||
      row.benchmark_price_usd_gpu_hr > priceLevels.at(-1) ||
      row.provider_count <= 0 ||
      row.offer_count < row.provider_count
    ) {
      throw new Error(`${sourceFile} has invalid observation ${index}`);
    }
    observations.set(timestamp, row);
    previousSeriesTimestamp = timestamp;
  });

  const start = timestampSeconds(
    source.observation_window.started_at,
    `${sourceFile} observation start`,
  );
  const end = timestampSeconds(
    source.observation_window.ended_at,
    `${sourceFile} observation end`,
  );
  if (
    start !== observations.keys().next().value ||
    end !== previousSeriesTimestamp ||
    source.observation_window.observation_count !== observations.size ||
    timestampSeconds(source.as_of, `${sourceFile} as_of`) !== end
  ) {
    throw new Error(`${sourceFile} observation window does not match its history`);
  }

  const historyStart = timestampSeconds(
    source.depth_history_window.started_at,
    `${sourceFile} depth history start`,
  );
  const historyEnd = timestampSeconds(
    source.depth_history_window.ended_at,
    `${sourceFile} depth history end`,
  );
  const depthObservations = new Map();
  let previousDepthTimestamp = 0;
  source.depth_history.forEach((row, index) => {
    const timestamp = timestampSeconds(
      row?.observed_at,
      `${sourceFile} depth history ${index}`,
    );
    const matchingObservation = observations.get(timestamp);
    if (
      timestamp <= previousDepthTimestamp ||
      (previousDepthTimestamp && timestamp - previousDepthTimestamp !== DAY_SECONDS)
    ) {
      throw new Error(`${sourceFile} depth history must use a daily cadence`);
    }
    if (
      !matchingObservation ||
      row.benchmark_price_usd_gpu_hr !==
        matchingObservation.benchmark_price_usd_gpu_hr ||
      row.provider_count !== matchingObservation.provider_count ||
      row.offer_count !== matchingObservation.offer_count
    ) {
      throw new Error(`${sourceFile} depth history ${index} is misaligned`);
    }
    validateDepthCurve(
      row.curve,
      priceLevels,
      `${sourceFile} depth history ${index}`,
    );
    depthObservations.set(timestamp, row);
    previousDepthTimestamp = timestamp;
  });
  if (
    source.depth_history_window.cadence !== "daily" ||
    historyStart !== depthObservations.keys().next().value ||
    historyStart !== start ||
    historyEnd !== previousDepthTimestamp ||
    source.depth_history_window.observation_count !== depthObservations.size ||
    historyEnd !== end
  ) {
    throw new Error(`${sourceFile} depth history window does not match its data`);
  }

  const sourceRevision = source.revision;
  if (typeof sourceRevision !== "string" || !sourceRevision.trim()) {
    throw new Error(`${sourceFile} needs a source revision`);
  }
  const sourceWithoutRevision = { ...source };
  delete sourceWithoutRevision.revision;
  if (revisionFor(sourceWithoutRevision) !== sourceRevision) {
    throw new Error(`${sourceFile} source revision does not match its content`);
  }
}

function validateDepthCurve(curve, priceLevels, label) {
  if (!Array.isArray(curve) || curve.length !== priceLevels.length) {
    throw new Error(`${label} has an invalid curve`);
  }
  let previousCapacity = 0;
  curve.forEach((point, bucketIndex) => {
    if (
      point?.price_usd_gpu_hr !== priceLevels[bucketIndex] ||
      !Number.isInteger(point?.cumulative_nodes) ||
      point.cumulative_nodes < previousCapacity
    ) {
      throw new Error(`${label} is not cumulative at bucket ${bucketIndex}`);
    }
    previousCapacity = point.cumulative_nodes;
  });
}

function runtimeProvenance(gpuPayloads, tokenPayload, bounds) {
  const gpuContracts = unique(gpuPayloads.map((payload) => payload.contract));
  const gpuRunIds = unique(
    gpuPayloads.map((payload) => payload.manifest?.run_id).filter(Boolean),
  );
  const gpuObservedAt = unique(
    gpuPayloads.map((payload) => payload.manifest?.observed_at).filter(Boolean),
  );
  const cadenceSeconds = commonRegularCadence([
    ...gpuPayloads.map((payload) => payload.series),
    tokenPayload.series,
  ]);
  return {
    kind: provenanceKind([...gpuPayloads, tokenPayload]),
    cadence: cadenceSeconds === HOUR_SECONDS ? "hourly" : "mixed",
    cadenceSeconds,
    spanDays: round((bounds.end - bounds.start) / DAY_SECONDS),
    start: bounds.start,
    end: bounds.end,
    sources: [
      {
        id: "gpu-benchmark",
        contracts: gpuContracts,
        runIds: gpuRunIds,
        observedAt: gpuObservedAt,
      },
      {
        id: tokenPayload.id,
        contract: tokenPayload.contract,
        observedAt: tokenPayload.as_of,
        methodology: tokenPayload.methodology || "",
      },
    ],
  };
}

function provenanceKind(payloads) {
  const contracts = payloads.map((payload) => String(payload?.contract || ""));
  if (contracts.every((contract) => contract.includes("showcase"))) {
    return "scenario";
  }
  if (contracts.some((contract) => contract.includes("showcase"))) {
    return "mixed";
  }
  return "observed";
}

function commonRegularCadence(seriesCollections) {
  const cadences = unique(
    seriesCollections.map((rows) => {
      if (!Array.isArray(rows) || rows.length < 2) return 0;
      const first = timestampSeconds(rows[0]?.observed_at, "series cadence");
      const second = timestampSeconds(rows[1]?.observed_at, "series cadence");
      const cadence = second - first;
      for (let index = 2; index < rows.length; index += 1) {
        const current = timestampSeconds(
          rows[index]?.observed_at,
          "series cadence",
        );
        const previous = timestampSeconds(
          rows[index - 1]?.observed_at,
          "series cadence",
        );
        if (current - previous !== cadence) return 0;
      }
      return cadence;
    }),
  );
  return cadences.length === 1 ? cadences[0] : 0;
}

function seriesBounds(seriesCollections) {
  return {
    start: Math.min(...seriesCollections.map((points) => points[0][0])),
    end: Math.max(...seriesCollections.map((points) => points.at(-1)[0])),
  };
}

function cadenceSecondsFor(value) {
  if (value === "hourly") return HOUR_SECONDS;
  if (value === "daily") return DAY_SECONDS;
  return 0;
}

function currencyFromUnit(value) {
  const currency = String(value || "").trim().split(/\s+/)[0];
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error(`Could not derive a currency from ${JSON.stringify(value)}`);
  }
  return currency;
}

function regionLabel(value) {
  return value === "US" ? "United States" : String(value || "");
}

function timestampSeconds(value, label) {
  const milliseconds = new Date(value).getTime();
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} is invalid`);
  return Math.round(milliseconds / 1000);
}

function finiteNumber(value, fallback = NaN) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function unique(values) {
  return [...new Set(values)];
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function revisionFor(value) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 12);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value), "utf8");
}

function parseBuildOptions(args) {
  const options = { check: false };
  for (const argument of args) {
    if (argument === "--check") options.check = true;
    else throw new Error(`Unknown build data option: ${argument}`);
  }
  return options;
}
