import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getCardDefinition,
  GPU_LAYERS,
} from "../src/card-registry.js";
import { createGpuMarketDepthModel } from "../src/gpu-market-depth-model.js";

const HOUR_SECONDS = 60 * 60;
const DAY_SECONDS = 24 * HOUR_SECONDS;
const buildOptions = parseBuildOptions(process.argv.slice(2));
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const priceCard = getCardDefinition("gpu-index");
const depthCard = getCardDefinition("gpu-market-depth");
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
const dealSourceFile = join(projectRoot, dealCard.sourceFile);
const dealSource = await readJson(dealSourceFile);
const dealRuntime = buildDealRuntime(dealSource, dealSourceFile);

// Keep the build contract tied to the browser model instead of allowing the
// source and renderer to drift apart unnoticed.
createGpuMarketDepthModel(depthRuntime, depthCard, {
  targetNodes: depthRuntime.targetNodes,
});

const dataManifest = {
  version: 1,
  asOf: Math.max(priceRuntime.asOf, depthRuntime.asOf, dealRuntime.asOf),
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
    [dealCard.id]: {
      file: dealCard.dataFile,
      revision: dealRuntime.revision,
      asOf: dealRuntime.asOf,
    },
  },
};
dataManifest.revision = revisionFor(dataManifest);

if (buildOptions.check) {
  console.log(
    `Validated ${priceCard.id} (${priceRuntime.revision}) and ` +
      `${depthCard.id} (${depthRuntime.revision}) and ` +
      `${dealCard.id} (${dealRuntime.revision}) source contracts.`,
  );
} else {
  await Promise.all([
    writeJson(join(projectRoot, priceCard.dataFile), priceRuntime),
    writeJson(join(projectRoot, depthCard.dataFile), depthRuntime),
    writeJson(join(projectRoot, dealCard.dataFile), dealRuntime),
    writeJson(join(projectRoot, "data", "manifest.json"), dataManifest),
  ]);
  console.log(
    `Built ${priceCard.dataFile} (${priceRuntime.revision}), ` +
      `${depthCard.dataFile} (${depthRuntime.revision}), ` +
      `${dealCard.dataFile} (${dealRuntime.revision}), and data/manifest.json ` +
      `(${dataManifest.revision}).`,
  );
}

function buildDealRuntime(source, sourceFile) {
  validateDealSource(source, sourceFile);
  const asOf = timestampSeconds(source.as_of, `${sourceFile} as_of`);
  timestampSeconds(source.rfs, `${sourceFile} rfs`);
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
