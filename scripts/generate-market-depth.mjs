import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputFile = join(
  projectRoot,
  "api",
  "dashboard-snapshots",
  "gpu-market-depth.json",
);

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const HISTORY_DAYS = 90;
const HISTORY_HOURS = HISTORY_DAYS * 24;
const AS_OF = new Date("2026-08-29T16:00:00.000Z");
const STARTED_AT = new Date(AS_OF.getTime() - HISTORY_DAYS * DAY_MS);
const PRICE_LEVELS = Object.freeze([
  2.75,
  2.875,
  3,
  3.125,
  3.25,
  3.375,
  3.5,
  3.625,
  3.75,
  3.875,
  4,
  4.125,
  4.25,
  4.375,
  4.5,
  4.625,
  4.75,
  4.875,
  5,
]);

const SERIES_ANCHORS = Object.freeze([
  Object.freeze({
    hour: 0,
    benchmarkPrice: 3.45,
    providerCount: 11,
    offerCount: 42,
  }),
  Object.freeze({
    hour: HISTORY_HOURS - 7 * 24,
    benchmarkPrice: 3.47,
    providerCount: 13,
    offerCount: 54,
  }),
  Object.freeze({
    hour: HISTORY_HOURS - 24,
    benchmarkPrice: 3.49,
    providerCount: 14,
    offerCount: 60,
  }),
  Object.freeze({
    hour: HISTORY_HOURS,
    benchmarkPrice: 3.5,
    providerCount: 15,
    offerCount: 64,
  }),
]);

const RECENT_DEPTH_MILESTONES = Object.freeze([
  Object.freeze({
    offsetHours: 7 * 24,
    cumulativeNodes: Object.freeze([
      12, 22, 40, 46, 58, 66, 80, 92, 112, 132, 160, 180, 216, 252,
      304, 340, 408, 476, 560,
    ]),
  }),
  Object.freeze({
    offsetHours: 24,
    cumulativeNodes: Object.freeze([
      10, 18, 36, 40, 50, 58, 72, 82, 98, 116, 144, 162, 198, 226,
      280, 312, 380, 448, 528,
    ]),
  }),
  Object.freeze({
    offsetHours: 0,
    cumulativeNodes: Object.freeze([
      8, 14, 32, 36, 44, 48, 64, 70, 88, 100, 128, 140, 180, 204,
      256, 280, 344, 400, 512,
    ]),
  }),
]);

const DEPTH_HISTORY_ANCHORS = Object.freeze([
  Object.freeze({
    hour: 0,
    cumulativeNodes: Object.freeze([
      14, 24, 42, 50, 62, 74, 88, 102, 122, 144, 172, 198, 238, 274,
      326, 368, 438, 508, 592,
    ]),
  }),
  Object.freeze({
    hour: HISTORY_HOURS - 60 * 24,
    cumulativeNodes: Object.freeze([
      9, 17, 31, 38, 49, 57, 69, 80, 98, 118, 150, 170, 210, 240,
      296, 330, 402, 472, 552,
    ]),
  }),
  Object.freeze({
    hour: HISTORY_HOURS - 30 * 24,
    cumulativeNodes: Object.freeze([
      16, 28, 48, 58, 72, 84, 100, 116, 140, 164, 196, 222, 264,
      306, 364, 410, 486, 560, 648,
    ]),
  }),
  Object.freeze({
    hour: HISTORY_HOURS - 14 * 24,
    cumulativeNodes: Object.freeze([
      13, 24, 43, 50, 63, 72, 87, 101, 123, 144, 176, 198, 238, 276,
      334, 372, 446, 518, 604,
    ]),
  }),
  ...RECENT_DEPTH_MILESTONES.map((anchor) =>
    Object.freeze({
      hour: HISTORY_HOURS - anchor.offsetHours,
      cumulativeNodes: anchor.cumulativeNodes,
    }),
  ),
]);

const series = Array.from(
  { length: HISTORY_HOURS + 1 },
  (_, hour) => createObservation(hour),
);
const depthHistory = Array.from(
  { length: HISTORY_DAYS + 1 },
  (_, day) => createDepthObservation(day * 24),
);
const payload = {
  version: 2,
  contract: "desk_showcase_market_depth",
  id: "h100-us-8gpu-ib-30d",
  label: "H100 US 8-GPU InfiniBand 30-day",
  as_of: AS_OF.toISOString(),
  cadence: "hourly",
  horizon_days: HISTORY_DAYS,
  instrument: {
    accelerator_model: "H100",
    region: "US",
    gpu_count_per_node: 8,
    interconnect: "InfiniBand",
    commitment_days: 30,
    price_unit: "USD per GPU-hour",
    depth_unit: "8-GPU nodes",
  },
  dataset: {
    kind: "showcase",
    generator: "desk-market-depth",
    generator_version: 4,
    seed: "desk-market-depth-v4",
  },
  observation_window: {
    started_at: STARTED_AT.toISOString(),
    ended_at: AS_OF.toISOString(),
    observation_count: series.length,
  },
  depth_history_window: {
    started_at: STARTED_AT.toISOString(),
    ended_at: AS_OF.toISOString(),
    observation_count: depthHistory.length,
    cadence: "daily",
  },
  price_levels: PRICE_LEVELS,
  depth_history: depthHistory,
  series,
};

validatePayload(payload);
payload.revision = createHash("sha256")
  .update(JSON.stringify(payload))
  .digest("hex")
  .slice(0, 12);

await writeFile(outputFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

console.log(
  `Generated ${series.length} hourly market-depth observations through ${AS_OF.toISOString()} (${payload.revision}).`,
);

function createObservation(hour) {
  const segment = findSegment(hour);
  const span = segment.right.hour - segment.left.hour;
  const progress = span === 0 ? 0 : (hour - segment.left.hour) / span;
  const taper = Math.sin(Math.PI * progress);
  const slowWave = Math.sin((hour / (24 * 8.5)) * Math.PI * 2 + 0.7);
  const fastWave = Math.sin((hour / (24 * 2.75)) * Math.PI * 2 + 2.1);
  const benchmarkPrice =
    lerp(segment.left.benchmarkPrice, segment.right.benchmarkPrice, progress) +
    taper * (slowWave * 0.018 + fastWave * 0.006);
  const providerCount = Math.round(
    lerp(segment.left.providerCount, segment.right.providerCount, progress) +
      taper * Math.sin((hour / (24 * 6)) * Math.PI * 2 + 1.2) * 0.7,
  );
  const offerCount = Math.round(
    lerp(segment.left.offerCount, segment.right.offerCount, progress) +
      taper *
        (Math.sin((hour / (24 * 4.5)) * Math.PI * 2 + 0.3) * 2.4 +
          Math.sin((hour / (24 * 11)) * Math.PI * 2 + 1.8) * 1.2),
  );

  const normalizedProviderCount = Math.max(1, providerCount);
  return {
    observed_at: new Date(STARTED_AT.getTime() + hour * HOUR_MS).toISOString(),
    benchmark_price_usd_gpu_hr: round(benchmarkPrice, 4),
    provider_count: normalizedProviderCount,
    offer_count: Math.max(normalizedProviderCount, offerCount),
  };
}

function createDepthObservation(hour) {
  const segment = findDepthSegment(hour);
  const span = segment.right.hour - segment.left.hour;
  const progress = span === 0 ? 0 : (hour - segment.left.hour) / span;
  const taper = Math.sin(Math.PI * progress);
  const observation = series[hour];
  let previousCapacity = 0;
  const cumulativeNodes = PRICE_LEVELS.map((_, index) => {
    const base = lerp(
      segment.left.cumulativeNodes[index],
      segment.right.cumulativeNodes[index],
      progress,
    );
    const slowWave = Math.sin(hour / (24 * 4.75) + index * 0.57 + 0.4);
    const fastWave = Math.sin(hour / (24 * 1.9) + index * 0.31 + 1.7);
    const shelfScale = 1.5 + index * 0.34;
    const capacity = Math.max(
      previousCapacity,
      Math.round(base + taper * shelfScale * (slowWave * 0.72 + fastWave * 0.28)),
    );
    previousCapacity = capacity;
    return capacity;
  });

  return {
    observed_at: observation.observed_at,
    benchmark_price_usd_gpu_hr: observation.benchmark_price_usd_gpu_hr,
    provider_count: observation.provider_count,
    offer_count: observation.offer_count,
    curve: PRICE_LEVELS.map((price, index) => ({
      price_usd_gpu_hr: price,
      cumulative_nodes: cumulativeNodes[index],
    })),
  };
}

function findDepthSegment(hour) {
  for (let index = 1; index < DEPTH_HISTORY_ANCHORS.length; index += 1) {
    if (hour <= DEPTH_HISTORY_ANCHORS[index].hour) {
      return {
        left: DEPTH_HISTORY_ANCHORS[index - 1],
        right: DEPTH_HISTORY_ANCHORS[index],
      };
    }
  }
  return {
    left: DEPTH_HISTORY_ANCHORS.at(-2),
    right: DEPTH_HISTORY_ANCHORS.at(-1),
  };
}

function findSegment(hour) {
  for (let index = 1; index < SERIES_ANCHORS.length; index += 1) {
    if (hour <= SERIES_ANCHORS[index].hour) {
      return {
        left: SERIES_ANCHORS[index - 1],
        right: SERIES_ANCHORS[index],
      };
    }
  }
  return {
    left: SERIES_ANCHORS.at(-2),
    right: SERIES_ANCHORS.at(-1),
  };
}

function validatePayload(value) {
  if (
    value.price_levels.length !== PRICE_LEVELS.length ||
    value.price_levels.some(
      (price, index) =>
        price !== PRICE_LEVELS[index] ||
        (index > 0 && price <= value.price_levels[index - 1]),
    )
  ) {
    throw new Error("Market-depth price levels are invalid");
  }
  if (value.series.length !== HISTORY_HOURS + 1) {
    throw new Error("Market-depth history must contain 90 days of hourly data");
  }
  if (
    value.series[0].observed_at !== STARTED_AT.toISOString() ||
    value.series.at(-1).observed_at !== AS_OF.toISOString()
  ) {
    throw new Error("Market-depth observation window is invalid");
  }
  if (
    value.series[0].benchmark_price_usd_gpu_hr !== 3.45 ||
    value.series.at(-1).benchmark_price_usd_gpu_hr !== 3.5
  ) {
    throw new Error("Market-depth benchmark anchors are invalid");
  }

  value.series.forEach((observation, index) => {
    if (
      !Number.isFinite(observation.benchmark_price_usd_gpu_hr) ||
      !Number.isInteger(observation.provider_count) ||
      !Number.isInteger(observation.offer_count) ||
      observation.provider_count < 1 ||
      observation.offer_count < observation.provider_count
    ) {
      throw new Error(`Invalid market-depth observation at index ${index}`);
    }
    if (index > 0) {
      const elapsed =
        new Date(observation.observed_at).getTime() -
        new Date(value.series[index - 1].observed_at).getTime();
      if (elapsed !== HOUR_MS) {
        throw new Error(`Market-depth observation ${index} is not hourly`);
      }
    }
  });

  if (
    value.depth_history_window?.cadence !== "daily" ||
    value.depth_history_window?.started_at !== STARTED_AT.toISOString() ||
    value.depth_history_window?.ended_at !== AS_OF.toISOString() ||
    value.depth_history_window?.observation_count !== HISTORY_DAYS + 1 ||
    value.depth_history.length !== HISTORY_DAYS + 1
  ) {
    throw new Error("Market-depth daily history window is invalid");
  }
  value.depth_history.forEach((depth, index) => {
    const expectedTimestamp = new Date(
      STARTED_AT.getTime() + index * DAY_MS,
    ).toISOString();
    const observation = value.series[index * 24];
    if (
      depth.observed_at !== expectedTimestamp ||
      depth.benchmark_price_usd_gpu_hr !==
        observation.benchmark_price_usd_gpu_hr ||
      depth.provider_count !== observation.provider_count ||
      depth.offer_count !== observation.offer_count
    ) {
      throw new Error(`Market-depth daily observation ${index} is misaligned`);
    }
    validateCurve(depth.curve, `daily observation ${index}`);
  });

  RECENT_DEPTH_MILESTONES.forEach((milestone) => {
    const index = HISTORY_DAYS - milestone.offsetHours / 24;
    const curve = value.depth_history[index]?.curve;
    if (
      !curve ||
      curve.some(
        (point, bucketIndex) =>
          point.cumulative_nodes !== milestone.cumulativeNodes[bucketIndex],
      )
    ) {
      throw new Error(`Market-depth daily milestone ${index} is inconsistent`);
    }
  });
}

function validateCurve(curve, label) {
  if (!Array.isArray(curve) || curve.length !== PRICE_LEVELS.length) {
    throw new Error(`Market-depth ${label} has the wrong price levels`);
  }
  curve.forEach((point, index) => {
    if (
      point.price_usd_gpu_hr !== PRICE_LEVELS[index] ||
      !Number.isInteger(point.cumulative_nodes) ||
      point.cumulative_nodes < 0 ||
      (index > 0 &&
        point.cumulative_nodes < curve[index - 1].cumulative_nodes)
    ) {
      throw new Error(`Market-depth ${label} is not cumulative`);
    }
  });
}

function lerp(start, end, progress) {
  return start + (end - start) * progress;
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
