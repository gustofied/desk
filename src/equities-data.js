export const EQUITIES_TICKERS = Object.freeze([
  "MSFT", "AMZN", "GOOGL", "ORCL", "CRWV", "NBIS", "NVDA", "AMD", "TSM",
]);

export const EQUITIES_PRICE_BASIS = "split-dividend-adjusted-close";
export const EODHD_DOCUMENTATION_URL =
  "https://eodhd.com/financial-apis/api-for-historical-data-and-volumes";
const DAY_SECONDS = 24 * 60 * 60;

function sourceMetadata(status) {
  return {
    id: "eodhd",
    name: "EODHD",
    url: EODHD_DOCUMENTATION_URL,
    status,
    code: status === "unavailable" ? "missing-api-token" : null,
    message: status === "unavailable"
      ? "Historical prices are unavailable. Configure EODHD_API_TOKEN and refresh the data."
      : "Daily historical prices supplied by EODHD.",
    licenseUrl: "https://eodhd.com/financial-apis/terms-conditions",
    publicDisplayRights: "not-confirmed",
    notice: "EODHD describes its prices as indicative. API access does not establish redistribution or public-display rights.",
  };
}

export function createUnavailableEquitiesSource() {
  return {
    version: 1,
    asOf: null,
    retrievedAt: null,
    requestedRange: null,
    source: sourceMetadata("unavailable"),
    priceBasis: EQUITIES_PRICE_BASIS,
    priceBasisLabel: "Split- and dividend-adjusted close",
    currency: "USD",
    timestampUnit: "seconds",
    columns: ["timestamp", "close"],
    series: Object.fromEntries(EQUITIES_TICKERS.map((ticker) => [ticker, []])),
  };
}

export function dateToEquitiesTimestamp(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Expected an equity trading date in YYYY-MM-DD format.");
  }
  const milliseconds = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 10) !== date) {
    throw new Error("Invalid equity trading date.");
  }
  return milliseconds / 1000;
}

export function equitiesDateRange(now = new Date()) {
  const to = now.toISOString().slice(0, 10);
  const from = new Date((dateToEquitiesTimestamp(to) - 365 * DAY_SECONDS) * 1000)
    .toISOString().slice(0, 10);
  return { from, to };
}

export function normalizeEodhdHistory(records, { ticker, from, to }) {
  if (!EQUITIES_TICKERS.includes(ticker)) throw new Error("Unknown equity ticker.");
  const start = dateToEquitiesTimestamp(from);
  const end = dateToEquitiesTimestamp(to);
  if (start > end) throw new Error("Equities date range is reversed.");
  if (!Array.isArray(records) || !records.length) {
    throw new Error(`${ticker}: EODHD did not return a nonempty history array.`);
  }
  const timestamps = new Set();
  const points = records.map((record) => {
    const timestamp = dateToEquitiesTimestamp(record?.date);
    // Never substitute raw close: that would silently mix adjustment bases.
    const close = record.adjusted_close;
    if (typeof close !== "number" || !Number.isFinite(close) || close <= 0) {
      throw new Error(`${ticker}: EODHD returned an invalid adjusted close.`);
    }
    if (timestamp < start || timestamp > end || timestamps.has(timestamp)) {
      throw new Error(`${ticker}: EODHD returned duplicate or out-of-range dates.`);
    }
    timestamps.add(timestamp);
    return [timestamp, close];
  }).sort((left, right) => left[0] - right[0]);
  return points;
}

export function createEquitiesSource(histories, { from, to, retrievedAt }) {
  const snapshot = createUnavailableEquitiesSource();
  snapshot.series = Object.fromEntries(EQUITIES_TICKERS.map((ticker) => [
    ticker,
    normalizeEodhdHistory(histories[ticker], { ticker, from, to }),
  ]));
  snapshot.asOf = Math.max(...Object.values(snapshot.series).map((points) => points.at(-1)[0]));
  snapshot.retrievedAt = retrievedAt;
  snapshot.requestedRange = { from, to };
  snapshot.source = sourceMetadata("ready");
  validateEquitiesSource(snapshot);
  return snapshot;
}

export function validateEquitiesSource(snapshot) {
  if (snapshot?.version !== 1 || snapshot.timestampUnit !== "seconds" ||
      snapshot.currency !== "USD" || snapshot.priceBasis !== EQUITIES_PRICE_BASIS ||
      !["ready", "unavailable"].includes(snapshot.source?.status)) {
    throw new Error("Unsupported equities source contract.");
  }
  const actualTickers = Object.keys(snapshot.series || {}).sort();
  if (actualTickers.join(",") !== [...EQUITIES_TICKERS].sort().join(",")) {
    throw new Error("Equities source must contain all nine configured tickers.");
  }
  const available = snapshot.source.status === "ready";
  let latest = null;
  for (const ticker of EQUITIES_TICKERS) {
    const points = snapshot.series[ticker];
    if (!Array.isArray(points) || (available ? !points.length : points.length > 0)) {
      throw new Error(`${ticker}: history does not match its source availability.`);
    }
    let previous = -Infinity;
    for (const point of points) {
      if (!Array.isArray(point) || point.length !== 2 ||
          !Number.isSafeInteger(point[0]) || point[0] <= 0 ||
          point[0] % DAY_SECONDS !== 0 || point[0] <= previous ||
          typeof point[1] !== "number" || !Number.isFinite(point[1]) || point[1] <= 0) {
        throw new Error(`${ticker}: malformed daily historical price.`);
      }
      previous = point[0];
      latest = latest === null ? point[0] : Math.max(latest, point[0]);
    }
  }
  if (snapshot.asOf !== latest) throw new Error("Equities asOf must match the latest observation.");
  if (available) {
    if (typeof snapshot.retrievedAt !== "string" || !Number.isFinite(Date.parse(snapshot.retrievedAt))) {
      throw new Error("Equities source is missing its retrieval time.");
    }
    const start = dateToEquitiesTimestamp(snapshot.requestedRange?.from);
    const end = dateToEquitiesTimestamp(snapshot.requestedRange?.to);
    if (start > end) throw new Error("Equities date range is reversed.");
    for (const ticker of EQUITIES_TICKERS) {
      const points = snapshot.series[ticker];
      if (points[0][0] < start || points.at(-1)[0] > end) {
        throw new Error(`${ticker}: history extends beyond the requested range.`);
      }
      // All nine names predate the requested one-year window. Reject a truncated
      // subscription response or stale provider series instead of installing it.
      if (points[0][0] - start > 7 * DAY_SECONDS || end - points.at(-1)[0] > 7 * DAY_SECONDS ||
          (end - start >= 300 * DAY_SECONDS && points.length < 200)) {
        throw new Error(`${ticker}: history does not cover the requested year.`);
      }
    }
  } else if (snapshot.retrievedAt !== null || snapshot.requestedRange !== null ||
             !snapshot.source.message) {
    throw new Error("Unavailable equities must have no retrieval time and include an explanation.");
  }
  return snapshot;
}
