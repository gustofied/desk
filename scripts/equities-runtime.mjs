import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { EQUITIES_PRICE_BASIS, EQUITIES_TICKERS, validateEquitiesSource } from "../src/equities-data.js";

// The committed demo is the only source. Private caches and environment-based
// provider configuration are intentionally never consulted.
export async function readEquitiesSource(projectRoot, sourceFile = "data/equities-source.json") {
  return validateEquitiesSource(JSON.parse(await readFile(join(projectRoot, sourceFile), "utf8")));
}

export function buildEquitiesRuntime(source, card) {
  if (card?.id !== "equities" || !Array.isArray(card.layers) || !card.layers.length) {
    throw new Error("The equities card definition is required");
  }
  // GPU comparison layers remain in the GPU runtime; this owns nine stocks only.
  const symbols = card.layers.filter(layer => !layer.sourceCardId || layer.sourceCardId === card.id)
    .map(layer => layer.id);
  if (symbols.length !== EQUITIES_TICKERS.length || new Set(symbols).size !== EQUITIES_TICKERS.length ||
      symbols.some(symbol => !EQUITIES_TICKERS.includes(symbol))) {
    throw new Error("The equities card must register exactly the nine equity source symbols");
  }
  validateEquitiesSource(source);
  const series = Object.fromEntries(symbols.map(symbol => [symbol, source.series[symbol].map(point => [...point])]));
  const runtime = {
    version: 2,
    cardId: card.id,
    asOf: source.asOf,
    columns: ["timestamp", "value"],
    series,
    dataset: {
      kind: "demo",
      label: "Demo",
      status: "ready",
      source: {
        id: source.source.id,
        name: source.source.name,
        kind: "demo",
        status: "ready",
        url: source.source.url,
        message: source.source.message,
        notice: source.source.notice,
      },
      priceBasis: EQUITIES_PRICE_BASIS,
      priceBasisLabel: source.priceBasisLabel,
      currency: "USD",
      unit: "USD per share",
      cadence: "daily",
      timestampUnit: "seconds",
      start: series[symbols[0]][0][0],
      end: source.asOf,
      observationCount: Object.values(series).reduce((sum, points) => sum + points.length, 0),
      sampleWindow: { ...source.sampleWindow },
      generation: { ...source.generation },
    },
  };
  runtime.revision = createHash("sha256").update(JSON.stringify(runtime)).digest("hex").slice(0, 12);
  return runtime;
}

// Retained as a small publication safety boundary: never accidentally ship a
// stale observed provider runtime after switching the product to bundled demos.
export function assertEquitiesPublicDisplay(runtime) {
  const dataset = runtime?.dataset;
  if (runtime?.version !== 2 || runtime.cardId !== "equities" ||
      dataset?.kind !== "demo" || dataset.status !== "ready" ||
      JSON.stringify(runtime.columns) !== JSON.stringify(["timestamp", "value"])) {
    throw new Error("Only a bundled demo equities runtime may be published.");
  }
  validateEquitiesSource({
    version: 1, asOf: runtime.asOf, series: runtime.series,
    timestampUnit: dataset.timestampUnit, currency: dataset.currency,
    priceBasis: dataset.priceBasis, priceBasisLabel: dataset.priceBasisLabel,
    columns: ["timestamp", "close"], source: dataset.source,
    sampleWindow: dataset.sampleWindow, generation: dataset.generation,
  });
  const counts = Object.values(runtime.series).reduce((sum, points) => sum + points.length, 0);
  if (dataset.start !== runtime.series[EQUITIES_TICKERS[0]][0][0] ||
      dataset.end !== runtime.asOf || dataset.observationCount !== counts) {
    throw new Error("Equities demo runtime coverage is inconsistent.");
  }
}
