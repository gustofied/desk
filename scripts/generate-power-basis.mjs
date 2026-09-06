import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
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
const HISTORY_DAYS = 365;
const HISTORY_HOURS = HISTORY_DAYS * 24;
const LEGACY_HOURS = 90 * 24;
const AS_OF = new Date("2026-08-29T16:00:00.000Z");
const STARTED_AT = new Date(AS_OF.getTime() - HISTORY_DAYS * DAY_MS);
const LEGACY_STARTED_AT = new Date(AS_OF.getTime() - LEGACY_HOURS * HOUR_MS);
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
const LOCATIONS = Object.freeze([
  LOCATION,
  Object.freeze({ ...LOCATION, id: "PJM-DOMINION", label: "PJM Dominion",
    location: "Dominion Zone (DOM)", settlement_point: "DOM" }),
  Object.freeze({ ...LOCATION, id: "ERCOT-NORTH", label: "ERCOT North",
    market: "ERCOT", location: "North Load Zone (LZ_NORTH)",
    settlement_point: "LZ_NORTH", timezone: "America/Chicago" }),
]);

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
  Object.freeze({ hour: LEGACY_HOURS - 42, width: 2.4, basis: -13 }),
  Object.freeze({ hour: LEGACY_HOURS - 5, width: 2.8, basis: 19 }),
]);

export function createPowerBasisSource() {
  const series = Object.fromEntries(LOCATIONS.map(location => [location.id, createAnnualSeries(location)]));
  // Keep the original 90-day demo exactly stable, including its current strip price.
  series[LOCATION.id] = [
    ...series[LOCATION.id].slice(0, HISTORY_HOURS - LEGACY_HOURS),
    ...createLegacyWestSeries(),
  ];
  const payload = {
    version: 1,
    contract: "desk_showcase_power_basis",
    id: "power-basis",
    label: "Power basis",
    as_of: AS_OF.toISOString(),
    cadence: "hourly",
    locations: LOCATIONS.map(location => ({ ...location })),
    series,
    observation_window: {
      started_at: STARTED_AT.toISOString(),
      ended_at: AS_OF.toISOString(),
      observation_count: HISTORY_HOURS + 1,
    },
    dataset: {
      kind: "showcase",
      label: "Demo",
      notice: "Deterministic demo prices, not observed PJM or ERCOT market data. Wholesale benchmarks are not delivered data-center electricity costs.",
      generator: "desk-power-basis",
      generator_version: 2,
      seed: "desk-power-basis-v2",
      aggregation: "Hourly demonstration values; ERCOT real-time values illustrate an hourly average, not a native settlement interval.",
    },
  };
  validatePayload(payload);
  payload.revision = createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 12);
  return payload;
}

const clockFormatters = new Map();
export function powerLocalTime(date, timezone) {
  if (!clockFormatters.has(timezone)) {
    clockFormatters.set(timezone, new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, hour: "2-digit", hourCycle: "h23",
      weekday: "short", month: "2-digit", day: "2-digit",
    }));
  }
  const parts = Object.fromEntries(clockFormatters.get(timezone).formatToParts(date)
    .filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return { hour: Number(parts.hour), month: Number(parts.month), day: Number(parts.day), weekday: parts.weekday };
}

function createAnnualSeries(location) {
  const texas = location.id === "ERCOT-NORTH";
  const dominion = location.id === "PJM-DOMINION";
  const random = mulberry32(texas ? 0x45_52_43 : dominion ? 0x44_4f_4d : 0x50_57_32);
  let dayAheadNoise = 0;
  let basisNoise = 0;
  const hoursFrom = (date) => (Date.parse(date) - STARTED_AT.getTime()) / HOUR_MS;
  const winterStress = hoursFrom("2026-01-26T23:00:00.000Z");
  const summerStress = hoursFrom("2026-08-13T23:00:00.000Z");
  const negativeEvent = hoursFrom(texas ? "2026-04-12T18:00:00.000Z" : "2026-03-22T07:00:00.000Z");
  return Array.from({ length: HISTORY_HOURS + 1 }, (_, hour) => {
    const observedAt = new Date(STARTED_AT.getTime() + hour * HOUR_MS);
    const clock = powerLocalTime(observedAt, location.timezone);
    const yearDay = (Date.UTC(2026, clock.month - 1, clock.day) - Date.UTC(2026, 0, 1)) / DAY_MS;
    const summer = gaussian(yearDay, 205, 46);
    const winter = gaussian(yearDay, 18, 27) + gaussian(yearDay, 383, 27);
    const weekend = ["Sat", "Sun"].includes(clock.weekday) ? -4.5 : 0;
    const morning = gaussian(clock.hour, 8, 2.2) * (dominion ? 8 : 5);
    const evening = gaussian(clock.hour, texas ? 18 : 17, 2.7) * (texas ? 28 : dominion ? 18 : 13);
    const overnight = gaussian(clock.hour, 3, 3) * (texas ? -9 : -5);
    const solar = texas ? gaussian(clock.hour, 12.5, 2.4) * -19 * (0.55 + summer * 0.45) : 0;
    dayAheadNoise = dayAheadNoise * 0.94 + centeredRandom(random) * (texas ? 2.2 : 1.2);
    const plannedStress = gaussian(hour, winterStress, 30) * (texas ? 45 : dominion ? 32 : 22) +
      gaussian(hour, summerStress, 27) * (texas ? 35 : dominion ? 24 : 15);
    const dayAhead = clamp((texas ? 25 : dominion ? 37 : 30) +
      summer * (texas ? 19 : dominion ? 14 : 8) + winter * (dominion ? 20 : 12) +
      weekend + morning + evening + overnight + solar + plannedStress +
      Math.sin(hour / 24 * Math.PI * 2 / 11) * 3 + dayAheadNoise -
      gaussian(hour, negativeEvent, 9) * (texas ? 30 : 8), -35, 220);
    basisNoise = basisNoise * 0.79 + centeredRandom(random) * (texas ? 6.8 : dominion ? 4 : 2.6);
    const stress = gaussian(hour, winterStress, 3) * (texas ? 230 : dominion ? 115 : 65) +
      gaussian(hour, summerStress, 2.3) * (texas ? 390 : dominion ? 95 : 45);
    const basis = basisNoise + stress - gaussian(hour, negativeEvent, 2.8) * (texas ? 95 : dominion ? 76 : 64) +
      gaussian(clock.hour, 18, 2.4) * Math.sin(hour / 24 * Math.PI * 2 / 4.7) * (texas ? 13 : 5);
    return { observed_at: observedAt.toISOString(),
      real_time_price: round(clamp(dayAhead + basis, -85, texas ? 650 : 350)),
      day_ahead_price: round(dayAhead) };
  });
}

function createLegacyWestSeries() {
  const random = mulberry32(0x50_4a_4d);
  let dayAheadNoise = 0;
  let basisNoise = 0;

  return Array.from({ length: LEGACY_HOURS + 1 }, (_, hour) => {
    const observedAt = new Date(LEGACY_STARTED_AT.getTime() + hour * HOUR_MS);
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
  if (
    value.version !== 1 ||
    value.contract !== "desk_showcase_power_basis" ||
    value.id !== "power-basis" ||
    value.as_of !== AS_OF.toISOString() ||
    value.cadence !== "hourly" ||
    value.locations.length !== LOCATIONS.length ||
    Object.keys(value.series).length !== LOCATIONS.length
  ) {
    throw new Error("Power-basis source contract is invalid");
  }

  for (const location of LOCATIONS) {
    const rows = value.series[location.id];
    if (!Array.isArray(rows) || rows.length !== HISTORY_HOURS + 1) {
      throw new Error(`Invalid power-basis history for ${location.id}`);
    }
    rows.forEach((row, index) => {
      const expected = new Date(STARTED_AT.getTime() + index * HOUR_MS).toISOString();
      if (row.observed_at !== expected || !Number.isFinite(row.real_time_price) || !Number.isFinite(row.day_ahead_price)) {
        throw new Error(`Invalid power-basis observation for ${location.id} at index ${index}`);
      }
    });
  }

  if (
    value.observation_window.started_at !== STARTED_AT.toISOString() ||
    value.observation_window.ended_at !== AS_OF.toISOString() ||
    value.observation_window.observation_count !== HISTORY_HOURS + 1 ||
    value.observation_window.ended_at !== value.as_of ||
    value.dataset.kind !== "showcase" ||
    value.dataset.generator !== "desk-power-basis" ||
    value.dataset.generator_version !== 2 ||
    value.dataset.seed !== "desk-power-basis-v2"
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const payload = createPowerBasisSource();
  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Generated ${payload.observation_window.observation_count} hourly demo observations per location ` +
    `for ${payload.locations.length} power markets through ${payload.as_of} (${payload.revision}).`);
}
