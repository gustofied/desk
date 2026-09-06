const DAY_MS = 24 * 60 * 60 * 1000;
const RANGES = new Set(["now", "7d", "all"]);

// Latest observations describe individual jobs. History describes provider
// batches grouped by UTC date: these are deliberately never joined together.
export function createSandboxCostModel(payload, card, {
  range = "now", primaryId, layerIds,
} = {}) {
  if (payload?.version !== 2 || payload.cardId !== "sandbox-cost" || card?.id !== "sandbox-cost") {
    throw new Error("A sandbox-cost v2 runtime and card definition are required");
  }
  const asOf = timestamp(payload.asOf, "asOf");
  if (payload.timestampUnit !== "milliseconds" || payload.dataset?.kind !== "observed" ||
      payload.dataset.currency !== "USD" || payload.dataset.costBasis !== "public_rate_card_unmetered") {
    throw new Error("Sandbox costs require observed, unmetered USD estimates with millisecond timestamps");
  }
  const sourceUrl = publicUrl(payload.sourceUrl, "source URL");
  const sourceLabel = text(payload.sourceLabel, "source label");
  if (!Array.isArray(payload.providers) || !payload.providers.length) {
    throw new Error("Sandbox providers are required");
  }
  const registeredIds = new Set(card.layers?.map(layer => layer.id));
  const seen = new Set();
  const allProviders = payload.providers.map(provider => {
    const id = text(provider.id, "provider ID");
    if (!registeredIds.has(id) || seen.has(id)) throw new Error(`Invalid or duplicate sandbox provider ${id}`);
    seen.add(id);
    const label = text(provider.label, `${id} label`);
    const providerAsOf = timestamp(provider.asOf, `${id} asOf`);
    if (providerAsOf > asOf) throw new Error(`${id} asOf is after the snapshot`);
    validateBands(provider, `${id} cost`);
    validateBands(provider.runtime, `${id} runtime`);
    if (provider.runtime.unit !== "seconds" || provider.runtime.basis !== "sum_of_ten_task_samples_with_same_replicate_index") {
      throw new Error(`${id} must retain its measured job runtime basis`);
    }
    if (!Number.isSafeInteger(provider.sampleCount) || provider.sampleCount <= 0) {
      throw new Error(`${id} sampleCount must be a positive integer`);
    }
    text(provider.methodologyId, `${id} latest methodology`);
    text(provider.runId, `${id} latest run`);
    if (!Array.isArray(provider.history)) throw new Error(`${id} history is required`);
    let previousTime = 0;
    const history = provider.history.map(point => {
      const time = timestamp(point.time, `${id} history time`);
      if (time % DAY_MS !== 0 || time <= previousTime || time > asOf) {
        throw new Error(`${id} history must be increasing UTC date keys within the snapshot`);
      }
      const value = nonnegative(point.value, `${id} history value`);
      const methodologyIds = distinctTexts(point.methodologyIds, `${id} history methodologies`);
      const methodologyId = methodologyIds.length === 1 ? methodologyIds[0] : null;
      if (point.methodologyId !== methodologyId) {
        throw new Error(`${id} history must distinguish single and mixed methodologies`);
      }
      const runIds = distinctTexts(point.runIds, `${id} history runs`);
      if (!Array.isArray(point.sourceUrls) || point.sourceUrls.length !== runIds.length) {
        throw new Error(`${id} history needs one source URL per run`);
      }
      const sourceUrls = point.sourceUrls.map(url => publicUrl(url, `${id} history source URL`));
      const gapBefore = previousTime > 0 && time - previousTime > DAY_MS;
      previousTime = time;
      return { time, value, methodologyId, methodologyIds, runIds, sourceUrls, gapBefore };
    });
    return { ...provider, id, label, asOf: providerAsOf,
      runtime: { ...provider.runtime }, pricing: { ...provider.pricing }, history };
  }).sort((a, b) => a.median - b.median || a.id.localeCompare(b.id));
  if (Math.max(...allProviders.map(provider => provider.asOf)) !== asOf) {
    throw new Error("Sandbox asOf must match the latest provider observation");
  }
  const selectedPrimaryId = seen.has(primaryId) ? primaryId
    : seen.has(card.defaults?.layer) ? card.defaults.layer : allProviders[0].id;
  const selectedIds = Array.isArray(layerIds)
    ? new Set(layerIds.filter(id => seen.has(id))) : new Set(seen);
  selectedIds.add(selectedPrimaryId);
  const normalizedRange = RANGES.has(range) ? range : "now";
  const historyTimes = allProviders.flatMap(provider => provider.history.map(point => point.time));
  const historyEnd = historyTimes.length ? Math.max(...historyTimes) : asOf;
  // Seven calendar dates including the last observed date, never seven invented rows.
  const cutoff = normalizedRange === "7d" ? historyEnd - 6 * DAY_MS : -Infinity;
  const providers = allProviders.filter(provider => selectedIds.has(provider.id)).map(provider => ({
    ...provider, history: provider.history.filter(point => point.time >= cutoff),
  }));
  const rowTimes = normalizedRange === "now" ? [asOf]
    : [...new Set(providers.flatMap(provider => provider.history.map(point => point.time)))].sort((a, b) => a - b);
  const primary = providers.find(provider => provider.id === selectedPrimaryId);
  return {
    range: normalizedRange, asOf, start: rowTimes[0] ?? null, end: rowTimes.at(-1) ?? null,
    providers, primary, latest: primary, rows: rowTimes.map(time => ({ time })),
    sourceUrl, sourceLabel, unit: payload.dataset.unit, dataset: structuredClone(payload.dataset),
  };
}

function validateBands(value, name) {
  if (!value || typeof value !== "object") throw new Error(`${name} distribution is required`);
  const values = ["minimum", "p25", "median", "p75", "maximum"].map(key => nonnegative(value[key], `${name} ${key}`));
  if (values.some((number, index) => index > 0 && number < values[index - 1])) {
    throw new Error(`${name} distribution must satisfy minimum <= p25 <= median <= p75 <= maximum`);
  }
}

function nonnegative(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and nonnegative`);
  return value;
}

function timestamp(value, name) {
  if (!Number.isSafeInteger(value) || value < 100_000_000_000 || !Number.isFinite(new Date(value).getTime())) {
    throw new Error(`${name} must be a millisecond timestamp`);
  }
  return value;
}

function text(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value;
}

function distinctTexts(values, name) {
  if (!Array.isArray(values) || !values.length) throw new Error(`${name} are required`);
  values.forEach(value => text(value, name));
  if (new Set(values).size !== values.length) throw new Error(`${name} must be distinct`);
  return [...values];
}

function publicUrl(value, name) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must be a public HTTPS URL`); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error(`${name} must be a public HTTPS URL`);
  return url.href;
}
