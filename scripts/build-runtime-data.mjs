import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getCardDefinition,
  GPU_LAYERS,
} from "../src/card-registry.js";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cardDefinition = getCardDefinition("gpu-index");
const sourceRoot = join(projectRoot, cardDefinition.sourceDir);
const outputFile = join(projectRoot, cardDefinition.dataFile);
const gpuLayers = GPU_LAYERS.filter((layer) => layer.unit === "usd-hour");
const tokenLayer = GPU_LAYERS.find((layer) => layer.id === "TOKEN");

const sourceSeries = new Map();
for (const layer of gpuLayers) {
  const sourceFile = join(sourceRoot, `${layer.id.toLowerCase()}.json`);
  const payload = JSON.parse(await readFile(sourceFile, "utf8"));
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

  const points = (Array.isArray(payload.series) ? payload.series : [])
    .map(compactPoint)
    .filter(Boolean)
    .sort((left, right) => left[0] - right[0]);
  if (!points.length) throw new Error(`No usable observations in ${sourceFile}`);
  sourceSeries.set(layer.id, points);
}

const tokenPoints = await readTokenSeries(tokenLayer);
assertAlignedSeries([...sourceSeries.entries(), ["TOKEN", tokenPoints]]);
const asOf = Math.max(
  ...Array.from(sourceSeries.values(), (points) => points.at(-1)[0]),
);
const runtimeData = {
  version: 2,
  cardId: cardDefinition.id,
  asOf,
  dataset: {
    kind: "showcase",
    id: "desk-market-2026-08",
    generator: "desk-showcase-market",
    generatorVersion: 1,
    seed: "desk-market-v1",
    scenario: "accelerator-rental-and-token-expenditure",
    cadence: "hourly",
    cadenceSeconds: 3600,
    horizonDays: 90,
    start: Math.min(
      ...Array.from(sourceSeries.values(), (points) => points[0][0]),
    ),
    end: asOf,
  },
  columns: ["timestamp", "value", "lower", "upper"],
  series: Object.fromEntries([
    ...gpuLayers.map((layer) => [layer.id, sourceSeries.get(layer.id)]),
    ["TOKEN", tokenPoints],
  ]),
};
runtimeData.revision = createHash("sha256")
  .update(JSON.stringify(runtimeData))
  .digest("hex")
  .slice(0, 12);

await mkdir(dirname(outputFile), { recursive: true });
await writeFile(outputFile, JSON.stringify(runtimeData), "utf8");

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
  const payload = JSON.parse(await readFile(sourceFile, "utf8"));
  if (
    payload?.contract !== "desk_showcase_series" ||
    payload?.id !== layer.id ||
    payload?.unit !== "USD per million tokens"
  ) {
    throw new Error(`Unsupported token price data in ${sourceFile}`);
  }
  const points = (Array.isArray(payload.series) ? payload.series : [])
    .map(compactPoint)
    .filter(Boolean)
    .sort((left, right) => left[0] - right[0]);
  if (!points.length) throw new Error(`No usable observations in ${sourceFile}`);
  if (points.some((point) => point[2] > point[1] || point[1] > point[3])) {
    throw new Error(`Invalid price range in ${sourceFile}`);
  }
  return points;
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
      if (index > 0 && points[index][0] - points[index - 1][0] !== 3600) {
        throw new Error(`${seriesId} must use an hourly cadence`);
      }
    }
  }
}

function finiteNumber(value, fallback = NaN) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
