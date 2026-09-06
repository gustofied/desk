import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { EQUITIES_PRICE_BASIS, EQUITIES_TICKERS } from "../src/equities-data.js";

export async function readEquitiesSource(projectRoot, sourceFile) {
  const cachedFile = join(projectRoot, ".cache", "equities-source.json");
  let text;
  try {
    text = await readFile(cachedFile, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return JSON.parse(await readFile(join(projectRoot, sourceFile), "utf8"));
  }
  // A damaged local feed is an actionable failure, including in --check mode.
  // Falling back here would conceal it behind the public unavailable placeholder.
  return JSON.parse(text);
}

// This conversion is deliberately separate from the GPU fixture pipeline:
// equities have trading-day gaps, independent listing dates, and no price bands.
export function buildEquitiesRuntime(source, card, {
  publicDisplayRights = process.env.EQUITIES_PUBLIC_DISPLAY_RIGHTS,
} = {}) {
  if (card?.id !== "equities" || !Array.isArray(card.layers) || !card.layers.length) {
    throw new Error("The equities card definition is required");
  }
  if (source?.version !== 1) throw new Error("Unsupported equities source version");
  const unit = source?.timestampUnit || "milliseconds";
  if (!["milliseconds", "seconds"].includes(unit)) {
    throw new Error("Equities timestampUnit must be milliseconds or seconds");
  }
  if (source.currency !== "USD") throw new Error("Equities prices must use USD");
  if (source.priceBasis !== EQUITIES_PRICE_BASIS) {
    throw new Error("Equities prices must use split- and dividend-adjusted close");
  }
  const provenance = normalizeSource(source.source);
  // An operator must explicitly confirm their license before a public build.
  // Never persist this deployment-only override back into the provider cache.
  if (publicDisplayRights === "confirmed") provenance.publicDisplayRights = "confirmed";
  const priceBasisLabel = requireText(source.priceBasisLabel, "price basis label");
  // Cross-market comparison layers keep their data in the originating runtime.
  const symbols = card.layers
    .filter(layer => !layer.sourceCardId || layer.sourceCardId === card.id)
    .map(layer => layer.id);
  if (symbols.length !== EQUITIES_TICKERS.length ||
      new Set(symbols).size !== EQUITIES_TICKERS.length ||
      symbols.some(symbol => !EQUITIES_TICKERS.includes(symbol))) {
    throw new Error("The equities card must register exactly the nine equity source symbols");
  }
  if (!source.series || typeof source.series !== "object" || Array.isArray(source.series) ||
      Object.keys(source.series).some(symbol => !symbols.includes(symbol))) {
    throw new Error("Equities series must contain only registered symbols");
  }
  const series = Object.fromEntries(symbols.map(symbol => {
    const rows = source.series[symbol];
    if (!Array.isArray(rows)) throw new Error(`Equities ${symbol} series is missing`);
    let previous = 0;
    const points = rows.map((row, index) => {
      if (!Array.isArray(row) || row.length !== 2 ||
          typeof row[1] !== "number" || !Number.isFinite(row[1]) || row[1] <= 0) {
        throw new Error(`Equities ${symbol} observation ${index} is invalid`);
      }
      const timestamp = unixSeconds(row[0], unit, `${symbol} observation ${index}`);
      if (timestamp <= previous) throw new Error(`Equities ${symbol} timestamps must be strictly increasing`);
      previous = timestamp;
      return [timestamp, row[1]];
    });
    return [symbol, points];
  }));
  const populated = Object.values(series).filter(points => points.length);
  const observationCount = populated.reduce((total, points) => total + points.length, 0);
  let asOf = null;
  let start = null;
  if (provenance.status === "unavailable") {
    if (observationCount || source.asOf !== null) {
      throw new Error("Unavailable equities data must have empty series and a null asOf");
    }
  } else {
    if (populated.length !== symbols.length) throw new Error("Ready equities data must include every registered symbol");
    asOf = unixSeconds(source.asOf, unit, "asOf");
    start = Math.min(...populated.map(points => points[0][0]));
    const latestObservation = Math.max(...populated.map(points => points.at(-1)[0]));
    if (asOf !== latestObservation) throw new Error("Equities asOf must match the latest observation");
  }
  const runtime = {
    version: 2,
    cardId: card.id,
    asOf,
    columns: ["timestamp", "value"],
    series,
    dataset: {
      kind: provenance.status === "ready" ? "observed" : "unavailable",
      status: provenance.status,
      source: provenance,
      priceBasis: source.priceBasis,
      priceBasisLabel,
      currency: "USD",
      unit: "USD per share",
      cadence: "daily",
      timestampUnit: "seconds",
      start,
      end: asOf,
      observationCount,
    },
  };
  runtime.revision = createHash("sha256").update(JSON.stringify(runtime)).digest("hex").slice(0, 12);
  return runtime;
}

export function assertEquitiesPublicDisplay(runtime) {
  if (runtime?.cardId !== "equities" || runtime.version !== 2 ||
      !runtime.series || typeof runtime.series !== "object" || Array.isArray(runtime.series)) {
    throw new Error("A valid equities runtime is required before publishing");
  }
  if (runtime.dataset?.status === "unavailable" && runtime.asOf === null &&
      Object.values(runtime.series).every(points => Array.isArray(points) && !points.length)) {
    return;
  }
  if (runtime.dataset?.status === "ready" &&
      runtime.dataset.source?.publicDisplayRights === "confirmed") {
    return;
  }
  throw new Error("Equities public-display rights must be confirmed before publishing observed prices");
}

function unixSeconds(value, unit, label) {
  const seconds = unit === "milliseconds" ? value / 1000 : value;
  if (typeof value !== "number" || !Number.isSafeInteger(seconds) || seconds <= 0 ||
      !Number.isFinite(new Date(seconds * 1000).getTime())) {
    throw new Error(`Equities ${label} timestamp is invalid`);
  }
  return seconds;
}

function normalizeSource(source) {
  if (!source || !["ready", "unavailable"].includes(source.status)) {
    throw new Error("Equities source must declare ready or unavailable status");
  }
  const name = requireText(source.name, "source name");
  const url = new URL(requireText(source.url, "source URL"));
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Equities source URL must be a public HTTP URL");
  }
  return {
    ...(source.id ? { id: requireText(source.id, "source id") } : {}),
    name,
    url: url.href,
    status: source.status,
    ...(source.code ? { code: requireText(source.code, "source status code") } : {}),
    ...(source.message ? { message: requireText(source.message, "source status message") } : {}),
    ...(source.licenseUrl ? { licenseUrl: publicUrl(source.licenseUrl, "source license URL") } : {}),
    ...(source.publicDisplayRights ? { publicDisplayRights: requireText(source.publicDisplayRights, "public display rights") } : {}),
    ...(source.notice ? { notice: requireText(source.notice, "source notice") } : {}),
  };
}

function publicUrl(value, label) {
  const url = new URL(requireText(value, label));
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error(`Equities ${label} must be a public HTTP URL`);
  }
  return url.href;
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Equities ${label} is required`);
  return value.trim();
}
