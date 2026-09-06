import { createHash } from "node:crypto";
import { createSandboxCostModel } from "../src/sandbox-cost-model.js";

// The compact checked-in snapshot contains summary statistics and actual date
// buckets, not synthesized ticks or the upstream's bulky individual replicates.
export function buildSandboxRuntime(source, card) {
  if (source?.version !== 1 || source.cardId !== "sandbox-cost" || card?.id !== "sandbox-cost") {
    throw new Error("A sandbox-cost v1 source and card definition are required");
  }
  if (!Array.isArray(source.providers) || !Array.isArray(card.layers)) {
    throw new Error("Sandbox providers and registered layers are required");
  }
  const ids = card.layers.map(layer => layer.id);
  const sourceIds = source.providers.map(provider => provider.id);
  if (ids.length !== 6 || new Set(ids).size !== 6 || sourceIds.length !== ids.length ||
      new Set(sourceIds).size !== ids.length || sourceIds.some(id => !ids.includes(id))) {
    throw new Error("Sandbox source must include exactly the six registered providers");
  }
  const dataset = structuredClone(source.dataset);
  if (!Array.isArray(dataset?.runs) || !dataset.runs.length) throw new Error("Sandbox source runs are required");
  const runs = new Map();
  for (const run of dataset.runs) {
    if (typeof run.id !== "string" || !run.id || runs.has(run.id) ||
        !Number.isSafeInteger(run.time) || run.time < 100_000_000_000 || run.time > source.asOf ||
        typeof run.methodologyId !== "string" || !run.methodologyId ||
        typeof run.sourceRunSha !== "string" || !/^[a-f0-9]{40}$/.test(run.sourceRunSha)) {
      throw new Error("Sandbox run provenance is invalid or duplicated");
    }
    const url = new URL(run.sourceUrl);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("Sandbox run source must be a public HTTPS URL");
    runs.set(run.id, run);
  }
  const providers = source.providers.map(provider => {
    const latestRun = runs.get(provider.runId);
    if (!latestRun || latestRun.time !== provider.asOf || latestRun.methodologyId !== provider.methodologyId) {
      throw new Error(`Sandbox ${provider.id} latest run provenance does not match`);
    }
    if (!Array.isArray(provider.history)) throw new Error(`Sandbox ${provider.id} history is required`);
    const history = provider.history.map(point => {
      if (!Array.isArray(point.runIds) || !point.runIds.length) throw new Error("Sandbox history source run IDs are required");
      const pointRuns = point.runIds.map(id => {
        const run = runs.get(id);
        if (!run || Math.floor(run.time / 86_400_000) * 86_400_000 !== point.time) {
          throw new Error(`Sandbox ${provider.id} history source run/date does not match`);
        }
        return run;
      });
      const methodologyIds = [...new Set(pointRuns.map(run => run.methodologyId))].sort();
      return { time: point.time, value: point.value,
        methodologyId: methodologyIds.length === 1 ? methodologyIds[0] : null,
        methodologyIds, runIds: [...point.runIds], sourceUrls: pointRuns.map(run => run.sourceUrl) };
    });
    return { ...structuredClone(provider), sourceUrl: latestRun.sourceUrl, history };
  });
  const historyRows = providers.flatMap(provider => provider.history);
  const coverage = dataset.coverage;
  if (coverage?.providerCount !== providers.length || coverage.historyObservationCount !== historyRows.length ||
      coverage.latestJobCount !== providers.reduce((count, provider) => count + provider.sampleCount, 0) ||
      coverage.calendarDateCount !== new Set(historyRows.map(point => point.time)).size ||
      coverage.sourceBatchCount !== runs.size ||
      coverage.methodologyCount !== new Set(dataset.runs.map(run => run.methodologyId)).size) {
    throw new Error("Sandbox coverage must match the preserved observations and provenance");
  }
  dataset.start = Math.min(...historyRows.map(point => point.time));
  dataset.end = source.asOf;
  dataset.observationCount = historyRows.length;
  dataset.source = { name: source.sourceLabel, url: source.sourceUrl };
  const runtime = {
    version: 2, cardId: card.id, asOf: source.asOf,
    timestampUnit: source.timestampUnit, sourceUrl: source.sourceUrl, sourceLabel: source.sourceLabel,
    dataset, providers,
  };
  // Validate the same millisecond, distribution, gap, and provenance contract
  // consumed by the browser before writing any public runtime file.
  createSandboxCostModel(runtime, card, { range: "all" });
  runtime.revision = createHash("sha256").update(JSON.stringify(runtime)).digest("hex").slice(0, 12);
  return runtime;
}
