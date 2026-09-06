import { getCardDefinition } from "./card-registry.js";
import { createGpuPriceBarModel } from "./gpu-price-bar-model.js";
import { createPowerBasisModel } from "./power-basis-model.js";

const gpuCard = getCardDefinition("gpu-price-snapshot");
const powerCard = getCardDefinition("power-basis");

/**
 * A snapshot of source observations, independent of the selected workspace.
 * No clock, polling, interpolation, or price-change signal is introduced here.
 */
export function createMarketStripModel({ gpuPayload, powerPayload } = {}) {
  const items = Object.freeze([
    ...gpuItems(gpuPayload),
    ...powerItems(powerPayload),
  ]);
  const kinds = new Set(items.map((item) => item.kind));
  return Object.freeze({
    items,
    // Revision-only changes must not look like new prices or observations.
    key: JSON.stringify(items),
    kind: kinds.size > 1 ? "mixed" : items[0]?.kind || "unknown",
    observationLabel: observationLabel(items),
  });
}

function gpuItems(payload) {
  try {
    // Runtime rows are numeric. Do not let permissive model coercion turn
    // missing values (such as null) into a fabricated zero-dollar quote.
    const series = Object.fromEntries(gpuCard.layers.map(({ id }) => [
      id,
      Array.isArray(payload?.series?.[id])
        ? payload.series[id].filter(validNumericObservation)
        : [],
    ]));
    const model = createGpuPriceBarModel({ ...payload, series }, gpuCard, {
      order: "registry",
    });
    const kind = provenanceKind(payload);
    return model.bars.map((bar) => Object.freeze({
      id: bar.id,
      label: bar.label,
      value: bar.value,
      unit: model.unitLabel,
      observedAt: new Date(bar.observedAt * 1000).toISOString(),
      kind,
    }));
  } catch {
    return [];
  }
}

function powerItems(payload) {
  try {
    const series = payload?.series?.["PJM-WEST"];
    if (!Array.isArray(series) || !series.every(validNumericObservation)) {
      return [];
    }
    const model = createPowerBasisModel(payload, powerCard, {
      locationId: "PJM-WEST",
      range: "1d",
    });
    return [Object.freeze({
      id: "PJM-WEST-RT",
      label: `${model.location.label} RT`,
      value: model.latest.realTime,
      unit: model.location.unit,
      observedAt: new Date(model.latest.timestamp * 1000).toISOString(),
      kind: provenanceKind(payload),
    })];
  } catch {
    return [];
  }
}

function validNumericObservation(point) {
  return Array.isArray(point) && point.length === 4 &&
    point.every((value) => typeof value === "number" && Number.isFinite(value)) &&
    Number.isSafeInteger(point[0]) && point[0] > 0 &&
    Number.isFinite(new Date(point[0] * 1000).getTime());
}

function provenanceKind(payload) {
  const kind = payload?.dataset?.kind;
  if (kind === "scenario" || kind === "showcase") return "scenario";
  return kind === "observed" || kind === "mixed" ? kind : "unknown";
}

export function observationLabel(items) {
  if (!items.length) return "";
  const times = items.map((item) => item.observedAt)
    .sort((left, right) => Date.parse(left) - Date.parse(right));
  const first = formatObservationTime(times[0]);
  const last = formatObservationTime(times.at(-1));
  return times[0] === times.at(-1)
    ? `As of ${first}`
    : `Observations ${first} – ${last}`;
}

function formatObservationTime(iso) {
  return `${iso.replace(/\.000Z$/, "").replace("T", " ").replace(/:00$/, "")} UTC`;
}
