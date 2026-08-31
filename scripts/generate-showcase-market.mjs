import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const gpuRoot = join(
  projectRoot,
  "api",
  "dashboard-snapshots",
  "gpu-benchmark",
);
const tokenFile = join(
  projectRoot,
  "api",
  "dashboard-snapshots",
  "token-price-index.json",
);

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const HISTORY_DAYS = 90;
const AS_OF = new Date("2026-08-29T16:00:00.000Z");
const STARTED_AT = new Date(AS_OF.getTime() - HISTORY_DAYS * DAY_MS);
const RUN_ID = "desk-showcase-20260829T160000-c0ffee42";

const marketNoise = createAutoregressiveNoise(
  HISTORY_DAYS * 24 + 1,
  mulberry32(0xdecafbad),
  0.985,
);

const GPU_SERIES = Object.freeze([
  Object.freeze({
    id: "H100",
    file: "h100.json",
    start: 2.96,
    latest: 2.67,
    trend: -0.2,
    volatility: 0.026,
    wave: 0.025,
    phase: 0.2,
    bandLower: 0.045,
    bandUpper: 0.065,
    providers: [15, 19],
    offers: [72, 106],
    seed: 0x100100,
    events: [
      { kind: "pulse", start: 17, end: 29, width: 1.7, amount: 0.08 },
      { kind: "step", day: 46, width: 2.2, amount: -0.09 },
      { kind: "pulse", start: 78, end: 86, width: 1.2, amount: 0.055 },
    ],
  }),
  Object.freeze({
    id: "H200",
    file: "h200.json",
    start: 4.24,
    latest: 3.89,
    trend: -0.24,
    volatility: 0.038,
    wave: 0.04,
    phase: 1.1,
    bandLower: 0.06,
    bandUpper: 0.08,
    providers: [11, 16],
    offers: [48, 82],
    seed: 0x200200,
    events: [
      { kind: "pulse", start: 22, end: 36, width: 1.7, amount: 0.19 },
      { kind: "step", day: 55, width: 2.4, amount: -0.17 },
      { kind: "pulse", start: 83, end: 89, width: 0.9, amount: 0.105 },
    ],
  }),
  Object.freeze({
    id: "B200",
    file: "b200.json",
    start: 4.62,
    latest: 5.58,
    trend: 0.24,
    volatility: 0.085,
    wave: 0.08,
    phase: 2.4,
    bandLower: 0.075,
    bandUpper: 0.12,
    providers: [7, 12],
    offers: [24, 51],
    seed: 0xb20020,
    events: [
      { kind: "step", day: 30, width: 2.8, amount: 0.28 },
      { kind: "pulse", start: 51, end: 71, width: 1.3, amount: 0.82 },
      { kind: "step", day: 76, width: 2.2, amount: 0.2 },
    ],
  }),
  Object.freeze({
    id: "B300",
    file: "b300.json",
    start: 8.12,
    latest: 7.34,
    trend: -0.55,
    volatility: 0.11,
    wave: 0.1,
    phase: 3.1,
    bandLower: 0.09,
    bandUpper: 0.13,
    providers: [5, 9],
    offers: [16, 36],
    seed: 0xb30030,
    events: [
      { kind: "pulse", start: 40, end: 56, width: 1.5, amount: 0.48 },
      { kind: "step", day: 64, width: 2.8, amount: -0.22 },
      { kind: "pulse", start: 82, end: 89, width: 1, amount: 0.16 },
    ],
  }),
]);

for (const definition of GPU_SERIES) {
  const target = join(gpuRoot, definition.file);
  const series = createGpuSeries(definition);
  const payload = updateSnapshot(definition, series);
  await writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

await writeFile(
  tokenFile,
  `${JSON.stringify(createTokenPriceIndex(), null, 2)}\n`,
  "utf8",
);

console.log(
  `Generated ${GPU_SERIES.length} accelerator histories and the Token Price Index through ${AS_OF.toISOString()}.`,
);

function createGpuSeries(definition) {
  const count = HISTORY_DAYS * 24 + 1;
  const personalNoise = createAutoregressiveNoise(
    count,
    mulberry32(definition.seed),
    definition.id.startsWith("B") ? 0.965 : 0.975,
  );
  const rawValues = Array.from({ length: count }, (_, index) => {
    const progress = index / (count - 1);
    const day = progress * HISTORY_DAYS;
    const seasonal =
      Math.sin(progress * Math.PI * 5.2 + definition.phase) * definition.wave +
      Math.sin(progress * Math.PI * 17 + definition.phase * 0.7) *
        definition.wave *
        0.22;
    const eventMove = definition.events.reduce(
      (total, event) => total + eventValue(event, day),
      0,
    );
    return (
      definition.start +
      definition.trend * progress +
      marketNoise[index] * definition.volatility * 0.42 +
      personalNoise[index] * definition.volatility +
      seasonal +
      eventMove
    );
  });

  const finalAdjustment = definition.latest - rawValues.at(-1);
  const values = rawValues.map((value, index) => {
    const progress = index / (count - 1);
    return value + finalAdjustment * smootherStep(progress);
  });

  return values.map((value, index) => {
    const progress = index / (count - 1);
    const date = new Date(STARTED_AT.getTime() + index * HOUR_MS);
    const spreadPulse =
      1 + Math.abs(personalNoise[index]) * 0.08 +
      (definition.id === "B200" ? pulse(index / 24, 50, 72, 1.8) * 0.34 : 0);
    const lower = value * (1 - definition.bandLower * spreadPulse);
    const upper = value * (1 + definition.bandUpper * spreadPulse);
    const providerCount = Math.round(
      lerp(definition.providers[0], definition.providers[1], progress) +
        Math.sin(progress * Math.PI * 7 + definition.phase) * 0.7,
    );
    const offerCount = Math.round(
      lerp(definition.offers[0], definition.offers[1], progress) +
        Math.sin(progress * Math.PI * 11 + definition.phase) * 2.4,
    );

    return {
      lower: round(lower),
      observed_at: date.toISOString(),
      offer_count: Math.max(providerCount, offerCount),
      provider_count: Math.max(1, providerCount),
      run_id: RUN_ID,
      upper: round(upper),
      value: round(value),
    };
  });
}

function updateSnapshot(definition, series) {
  const first = series[0];
  const latest = series.at(-1);
  const providerNames = Array.from(
    { length: latest.provider_count },
    (_, index) => `provider-${String(index + 1).padStart(2, "0")}`,
  );
  const exportedAt = new Date(AS_OF.getTime() + 5 * 60 * 1000).toISOString();

  return {
    contract: "desk_showcase_card",
    card_type: "gpu_benchmark",
    card_id: `gpu-benchmark:${definition.id.toLowerCase()}`,
    as_of: latest.observed_at,
    status: "observed",
    unit: "USD per GPU-hour",
    headline: {
      label: `${definition.id} rental benchmark`,
      lower: latest.lower,
      upper: latest.upper,
      value: latest.value,
    },
    band: {
      kind: "provider_price_range",
      lower_field: "lower",
      upper_field: "upper",
    },
    manifest: {
      contract: "desk_showcase_market",
      exported_at: exportedAt,
      methodology: "showcase_market_curve",
      observed_at: latest.observed_at,
      observed_date: latest.observed_at.slice(0, 10),
      provider_scope: providerNames,
      run_id: RUN_ID,
    },
    coverage: {
      observation_count: series.length,
      offer_count: latest.offer_count,
      provider_count: latest.provider_count,
      providers: providerNames,
    },
    observation_window: {
      started_at: first.observed_at,
      ended_at: latest.observed_at,
    },
    series,
    sources: providerNames.map((provider) => ({
      label: provider,
      role: "included provider",
    })),
    data: {
      family_id: definition.id,
      current: {
        benchmark_family_id: definition.id,
        benchmark_usd_gpu_hr: latest.value,
        calculated_at: latest.observed_at,
        floor_usd_gpu_hr: round(latest.lower * 0.82),
        gold_run_id: RUN_ID,
        included_offer_count: latest.offer_count,
        latest_observed_at: latest.observed_at,
        offer_count: latest.offer_count,
        provider_count: latest.provider_count,
        provider_floor_median_usd_gpu_hr: latest.value,
        provider_floor_p25_usd_gpu_hr: latest.lower,
        provider_floor_p75_usd_gpu_hr: latest.upper,
      },
    },
    methodology: {
      id: "showcase_market_curve",
    },
    drilldown_ref: `gpu-benchmark/${definition.id.toLowerCase()}.json`,
  };
}

function createTokenPriceIndex() {
  const anchors = [
    [0, 1.9],
    [7, 1.94],
    [14, 2.02],
    [21, 2.08],
    [28, 2.12],
    [35, 2.16],
    [42, 2.2],
    [49, 2.31],
    [56, 2.44],
    [63, 2.36],
    [70, 2.28],
    [77, 2.31],
    [84, 2.35],
    [90, 2.34],
  ];
  const count = HISTORY_DAYS * 24 + 1;
  const series = Array.from({ length: count }, (_, index) => {
    const day = index / 24;
    const value = interpolateAnchors(anchors, day);
    const date = new Date(STARTED_AT.getTime() + index * HOUR_MS);
    return {
      observed_at: date.toISOString(),
      value: round(value),
      lower: round(value),
      upper: round(value),
    };
  });

  return {
    version: 1,
    contract: "desk_showcase_series",
    id: "TOKEN",
    label: "Token Price Index",
    short_label: "TPI",
    unit: "USD per million tokens",
    cadence: "hourly",
    as_of: AS_OF.toISOString(),
    methodology: {
      id: "geometric_mean_blended_inference_price",
      input_output_mix: "3:1",
      base_currency: "USD",
    },
    series,
  };
}

function interpolateAnchors(anchors, day) {
  const nextIndex = anchors.findIndex(([anchorDay]) => anchorDay >= day);
  if (nextIndex <= 0) return anchors[0][1];
  const [rightDay, rightValue] = anchors[nextIndex];
  const [leftDay, leftValue] = anchors[nextIndex - 1];
  const progress = smootherStep((day - leftDay) / (rightDay - leftDay));
  return lerp(leftValue, rightValue, progress);
}

function eventValue(event, day) {
  if (event.kind === "step") {
    return event.amount * sigmoid((day - event.day) / event.width);
  }
  return event.amount * pulse(day, event.start, event.end, event.width);
}

function pulse(value, start, end, width) {
  return (
    sigmoid((value - start) / width) - sigmoid((value - end) / width)
  );
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function smootherStep(value) {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * clamped * (clamped * (clamped * 6 - 15) + 10);
}

function createAutoregressiveNoise(length, random, persistence) {
  const values = [];
  let state = 0;
  const innovationScale = Math.sqrt(1 - persistence * persistence);
  for (let index = 0; index < length; index += 1) {
    const innovation =
      (random() + random() + random() + random() - 2) * innovationScale;
    state = state * persistence + innovation;
    values.push(state);
  }
  return values;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function lerp(start, end, progress) {
  return start + (end - start) * progress;
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
