import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputFile = join(
  projectRoot,
  "api",
  "dashboard-snapshots",
  "power-basis.json",
);

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const HISTORY_DAYS = 90;
const HISTORY_HOURS = HISTORY_DAYS * 24;
const AS_OF = new Date("2026-08-29T16:00:00.000Z");
const STARTED_AT = new Date(AS_OF.getTime() - HISTORY_DAYS * DAY_MS);
const LOCATION = Object.freeze({
  id: "PJM-WEST",
  label: "PJM West",
  market: "PJM",
  location: "Western Hub",
  timezone: "America/New_York",
  currency: "USD",
  unit: "USD per MWh",
  interval_minutes: 60,
});

const WEATHER_EVENTS = Object.freeze([
  Object.freeze({ centerDay: 12.5, widthDays: 3.8, price: 8.5 }),
  Object.freeze({ centerDay: 35.2, widthDays: 4.6, price: 14.8 }),
  Object.freeze({ centerDay: 58.6, widthDays: 5.2, price: 20.5 }),
  Object.freeze({ centerDay: 80.8, widthDays: 3.7, price: 12.2 }),
]);

const REAL_TIME_EVENTS = Object.freeze([
  Object.freeze({ hour: 16 * 24 + 22, width: 1.8, basis: 31 }),
  Object.freeze({ hour: 36 * 24 + 19, width: 2.6, basis: -17 }),
  Object.freeze({ hour: 57 * 24 + 21, width: 2.1, basis: 48 }),
  Object.freeze({ hour: 72 * 24 + 23, width: 3.2, basis: 27 }),
  Object.freeze({ hour: HISTORY_HOURS - 42, width: 2.4, basis: -13 }),
  Object.freeze({ hour: HISTORY_HOURS - 5, width: 2.8, basis: 19 }),
]);

const series = createSeries();
const payload = {
  version: 1,
  contract: "desk_showcase_power_basis",
  id: "power-basis",
  label: "Power basis",
  as_of: AS_OF.toISOString(),
  cadence: "hourly",
  locations: [LOCATION],
  series: {
    [LOCATION.id]: series,
  },
  observation_window: {
    started_at: STARTED_AT.toISOString(),
    ended_at: AS_OF.toISOString(),
    observation_count: series.length,
  },
  dataset: {
    kind: "showcase",
    generator: "desk-power-basis",
    generator_version: 1,
    seed: "desk-power-basis-v1",
  },
};

validatePayload(payload);
payload.revision = createHash("sha256")
  .update(JSON.stringify(payload))
  .digest("hex")
  .slice(0, 12);

await mkdir(dirname(outputFile), { recursive: true });
await writeFile(outputFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

console.log(
  `Generated ${series.length} hourly PJM West observations through ` +
    `${AS_OF.toISOString()} (${payload.revision}).`,
);

function createSeries() {
  const random = mulberry32(0x50_4a_4d);
  let dayAheadNoise = 0;
  let basisNoise = 0;

  return Array.from({ length: HISTORY_HOURS + 1 }, (_, hour) => {
    const observedAt = new Date(STARTED_AT.getTime() + hour * HOUR_MS);
    const localDate = new Date(observedAt.getTime() - 4 * HOUR_MS);
    const localHour = localDate.getUTCHours();
    const weekday = localDate.getUTCDay();
    const day = hour / 24;
    const weekendDiscount = weekday === 0 || weekday === 6 ? -4.8 : 0;
    const morningLoad = gaussian(localHour, 8.5, 2.4) * 5.4;
    const eveningLoad = gaussian(localHour, 17.2, 3.2) * 13.5;
    const overnightDip = gaussian(localHour, 3.5, 3.1) * -5.2;
    const summerTrend = day * 0.055;
    const weather = WEATHER_EVENTS.reduce(
      (total, event) =>
        total + gaussian(day, event.centerDay, event.widthDays) * event.price,
      0,
    );

    dayAheadNoise = dayAheadNoise * 0.94 + centeredRandom(random) * 1.2;
    const dayAhead = clamp(
      31.5 +
        summerTrend +
        weekendDiscount +
        morningLoad +
        eveningLoad +
        overnightDip +
        weather +
        Math.sin(day * Math.PI * 2 / 9 + 0.35) * 1.8 +
        dayAheadNoise,
      -10,
      125,
    );

    basisNoise = basisNoise * 0.82 + centeredRandom(random) * 2.65;
    const loadError =
      gaussian(localHour, 18, 2.5) *
      (1.1 + weather / 13) *
      Math.sin(day * Math.PI * 2 / 5.5 + 1.1);
    const eventBasis = REAL_TIME_EVENTS.reduce(
      (total, event) =>
        total + gaussian(hour, event.hour, event.width) * event.basis,
      0,
    );
    const basis = basisNoise + loadError + eventBasis;
    const realTime = clamp(dayAhead + basis, -25, 225);

    return {
      observed_at: observedAt.toISOString(),
      real_time_price: round(realTime),
      day_ahead_price: round(dayAhead),
    };
  });
}

function validatePayload(value) {
  const rows = value.series[LOCATION.id];
  if (
    value.version !== 1 ||
    value.contract !== "desk_showcase_power_basis" ||
    value.id !== "power-basis" ||
    value.as_of !== AS_OF.toISOString() ||
    value.cadence !== "hourly" ||
    value.locations.length !== 1 ||
    value.locations[0] !== LOCATION ||
    !Array.isArray(rows) ||
    rows.length !== HISTORY_HOURS + 1
  ) {
    throw new Error("Power-basis source contract is invalid");
  }

  rows.forEach((row, index) => {
    const expected = new Date(STARTED_AT.getTime() + index * HOUR_MS).toISOString();
    if (
      row.observed_at !== expected ||
      !Number.isFinite(row.real_time_price) ||
      !Number.isFinite(row.day_ahead_price)
    ) {
      throw new Error(`Invalid power-basis observation at index ${index}`);
    }
  });

  if (
    value.observation_window.started_at !== rows[0].observed_at ||
    value.observation_window.ended_at !== rows.at(-1).observed_at ||
    value.observation_window.observation_count !== rows.length ||
    value.observation_window.ended_at !== value.as_of ||
    value.dataset.kind !== "showcase" ||
    value.dataset.generator !== "desk-power-basis" ||
    value.dataset.generator_version !== 1 ||
    value.dataset.seed !== "desk-power-basis-v1"
  ) {
    throw new Error("Power-basis dataset metadata is inconsistent");
  }
}

function gaussian(value, center, width) {
  const distance = (value - center) / width;
  return Math.exp(-0.5 * distance * distance);
}

function centeredRandom(random) {
  return random() + random() - 1;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function mulberry32(seed) {
  return function random() {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
