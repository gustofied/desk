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

const sourceSeries = new Map();
for (const layer of gpuLayers) {
  const sourceFile = join(sourceRoot, `${layer.id.toLowerCase()}.json`);
  const payload = JSON.parse(await readFile(sourceFile, "utf8"));
  if (
    payload?.contract !== "compute_bazaar_card" ||
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

const tokenPoints = createTokenIndex(
  sourceSeries.get("H100"),
  sourceSeries.get("H200"),
);
const asOf = Math.max(
  ...Array.from(sourceSeries.values(), (points) => points.at(-1)[0]),
);
const runtimeData = {
  version: 1,
  cardId: cardDefinition.id,
  asOf,
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

function createTokenIndex(h100Points = [], h200Points = []) {
  if (!h100Points.length || !h200Points.length) return [];
  const h100Start = h100Points[0][1];
  const h200Start = h200Points[0][1];
  let h100Index = 0;

  return h200Points.map((h200Point) => {
    while (
      h100Index + 1 < h100Points.length &&
      Math.abs(h100Points[h100Index + 1][0] - h200Point[0]) <=
        Math.abs(h100Points[h100Index][0] - h200Point[0])
    ) {
      h100Index += 1;
    }

    const h100Change = h100Points[h100Index][1] / h100Start;
    const h200Change = h200Point[1] / h200Start;
    const value = 100 * Math.sqrt(h100Change * h200Change);
    return [h200Point[0], round(value), round(value), round(value)];
  });
}

function finiteNumber(value, fallback = NaN) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
