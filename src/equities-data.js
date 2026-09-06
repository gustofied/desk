export const EQUITIES_TICKERS = Object.freeze([
  "MSFT", "AMZN", "GOOGL", "ORCL", "CRWV", "NBIS", "NVDA", "AMD", "TSM",
]);
export const EQUITIES_PRICE_BASIS = "demo-close";
export const EQUITIES_DEMO_SEED = 0x44534b31;
export const EQUITIES_DEMO_WINDOW = Object.freeze({ from: "2025-09-04", to: "2026-09-04" });
export const EQUITIES_DEMO_ALGORITHM = "seeded-geometric-weekdays-v1";
export const EQUITIES_DEMO_SOURCE_URL = "https://github.com/gustofied/desk/blob/main/README.md";
export const EQUITIES_DEMO_NOTICE = "Synthetic sample prices, not actual market prices or investment information. Weekday dates do not represent an exchange calendar or actual listing history.";
const DAY_SECONDS = 86400;

// Illustration parameters chosen independently of market observations. They are
// deliberately not current quotes, forecasts, or estimates of these companies.
const PROFILES = Object.freeze([
  [380, 0.16, 0.011, 0.025],
  [165, 0.18, 0.015, 0.032],
  [150, 0.11, 0.013, 0.028],
  [140, 0.24, 0.019, 0.040],
  [75, 0.28, 0.031, 0.055],
  [50, 0.22, 0.034, 0.065],
  [110, 0.30, 0.025, 0.045],
  [125, -0.06, 0.024, 0.050],
  [155, 0.17, 0.018, 0.035],
]);

export function dateToEquitiesTimestamp(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Expected an equity sample date in YYYY-MM-DD format.");
  }
  const milliseconds = Date.parse(date + "T00:00:00.000Z");
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 10) !== date) {
    throw new Error("Invalid equity sample date.");
  }
  return milliseconds / 1000;
}

export function equitiesDemoDates() {
  const dates = [];
  const end = dateToEquitiesTimestamp(EQUITIES_DEMO_WINDOW.to);
  for (let time = dateToEquitiesTimestamp(EQUITIES_DEMO_WINDOW.from); time <= end; time += DAY_SECONDS) {
    const weekday = new Date(time * 1000).getUTCDay();
    if (weekday !== 0 && weekday !== 6) dates.push(time);
  }
  return dates;
}

export function createDemoEquitiesSource({ seed = EQUITIES_DEMO_SEED } = {}) {
  assertSeed(seed);
  const dates = equitiesDemoDates();
  const series = Object.fromEntries(EQUITIES_TICKERS.map((ticker, index) => {
    const [initial, trend, volatility, cycle] = PROFILES[index];
    const random = seededRandom((seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0);
    const phase = random() * Math.PI * 2;
    let price = initial;
    const points = dates.map((time, day) => {
      if (day) {
        // Shared illustrative cycles and provider-specific seeded shocks create
        // distinct paths, not a replay or transformation of a real price feed.
        const market = 0.0035 * Math.sin(day / 11) - 0.0025 * Math.cos(day / 23);
        const oscillation = cycle * (Math.sin(day / 17 + phase) - Math.sin((day - 1) / 17 + phase));
        const shock = (random() + random() + random() - 1.5) * volatility;
        price *= Math.exp(trend / (dates.length - 1) + market + oscillation + shock);
      }
      return [time, Math.round(price * 100) / 100];
    });
    return [ticker, points];
  }));
  const source = {
    version: 1,
    asOf: dates.at(-1),
    sampleWindow: { ...EQUITIES_DEMO_WINDOW },
    generation: {
      algorithm: EQUITIES_DEMO_ALGORITHM,
      seed,
      calendar: "UTC weekdays; exchange holidays are not modeled",
    },
    source: {
      id: "desk-demo",
      name: "Demo data",
      kind: "demo",
      status: "ready",
      url: EQUITIES_DEMO_SOURCE_URL,
      message: "Bundled synthetic daily prices.",
      notice: EQUITIES_DEMO_NOTICE,
    },
    priceBasis: EQUITIES_PRICE_BASIS,
    priceBasisLabel: "Daily close (demo)",
    currency: "USD",
    timestampUnit: "seconds",
    columns: ["timestamp", "close"],
    series,
  };
  return validateEquitiesSource(source);
}

export function validateEquitiesSource(snapshot) {
  if (snapshot?.version !== 1 || snapshot.timestampUnit !== "seconds" ||
      snapshot.currency !== "USD" || snapshot.priceBasis !== EQUITIES_PRICE_BASIS ||
      snapshot.priceBasisLabel !== "Daily close (demo)" ||
      snapshot.source?.id !== "desk-demo" || snapshot.source.name !== "Demo data" ||
      snapshot.source.kind !== "demo" || snapshot.source.status !== "ready" ||
      snapshot.source.notice !== EQUITIES_DEMO_NOTICE ||
      snapshot.source.url !== EQUITIES_DEMO_SOURCE_URL ||
      JSON.stringify(snapshot.columns) !== JSON.stringify(["timestamp", "close"])) {
    throw new Error("Equities require the bundled synthetic demo source contract.");
  }
  if (snapshot.sampleWindow?.from !== EQUITIES_DEMO_WINDOW.from ||
      snapshot.sampleWindow?.to !== EQUITIES_DEMO_WINDOW.to ||
      snapshot.generation?.algorithm !== EQUITIES_DEMO_ALGORITHM ||
      snapshot.generation?.calendar !== "UTC weekdays; exchange holidays are not modeled") {
    throw new Error("Equities demo requires its fixed sample window and generation provenance.");
  }
  assertSeed(snapshot.generation.seed);
  if (!snapshot.series || typeof snapshot.series !== "object" || Array.isArray(snapshot.series) ||
      Object.keys(snapshot.series).sort().join(",") !== [...EQUITIES_TICKERS].sort().join(",")) {
    throw new Error("Equities source must contain exactly the nine configured tickers.");
  }
  const dates = equitiesDemoDates();
  for (const ticker of EQUITIES_TICKERS) {
    const points = snapshot.series[ticker];
    if (!Array.isArray(points) || points.length !== dates.length) {
      throw new Error(ticker + ": demo history must cover every weekday in the sample year.");
    }
    points.forEach((point, index) => {
      if (!Array.isArray(point) || point.length !== 2 || point[0] !== dates[index] ||
          typeof point[1] !== "number" || !Number.isFinite(point[1]) || point[1] <= 0) {
        throw new Error(ticker + ": malformed daily demo price or sample date.");
      }
    });
  }
  if (snapshot.asOf !== dates.at(-1)) throw new Error("Equities asOf must match the fixed demo sample end.");
  return snapshot;
}

function assertSeed(seed) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("Equities demo seed must be an unsigned 32-bit integer.");
}

function seededRandom(seed) {
  let value = seed || 0x6d2b79f5;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 0x100000000;
  };
}
