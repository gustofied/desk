const DEFAULT_STAGE = "diligence";
const STAGE_IDS = Object.freeze(["spec", "diligence", "execute"]);

export const DEAL_041_PAYLOAD = Object.freeze({
  version: 1,
  id: "041",
  type: "Reserved capacity",
  asset: "B200",
  quantity: 256,
  nodes: 32,
  rfs: "2026-10",
  currentStage: DEFAULT_STAGE,
  quote: Object.freeze({
    value: 3.65,
    currency: "USD",
    unit: "GPU-hour",
    prepayPercent: 20,
  }),
  stages: Object.freeze([
    Object.freeze({
      id: "spec",
      label: "Spec",
      copy: "US East / InfiniBand / dedicated bare metal / 24-month reserved term.",
      compactCopy: "Reserved capacity",
      owner: "Buyer mandate",
      status: "RFQ open",
    }),
    Object.freeze({
      id: "diligence",
      label: "Diligence",
      copy: "Seller quote: $3.65 / GPU-hour with 20% prepay. Capacity and topology checked.",
      compactCopy: "Quote checked",
      owner: "Technical + commercial",
      status: "Quote normalized",
    }),
    Object.freeze({
      id: "execute",
      label: "Execute",
      copy: "Finalize the quote and execute the Compute Services Agreement with the provider.",
      compactCopy: "Finalize agreement",
      owner: "Buyer + provider",
      status: "Awaiting sign-off",
    }),
  ]),
  parties: 4,
  events: 18,
  nextAction: "Resolve SLA",
});

/**
 * Normalizes a transaction record into the small, stable model consumed by the
 * Deal view presentation. `marketPayload` may be a GPU history payload or a Map
 * containing that payload under `gpu-index`.
 */
export function createDealViewModel(
  dealPayload,
  { stage, marketPayload = null, overrides = {} } = {},
) {
  assertDealPayload(dealPayload);

  const id = cleanText(dealPayload.id ?? dealPayload.dealId, "Deal id");
  const asset = cleanText(
    overrides.gpu ?? dealPayload.asset ?? dealPayload.gpu ?? dealPayload.product,
    "Deal asset",
  ).toUpperCase();
  const quantity = positiveInteger(
    overrides.quantity ?? dealPayload.quantity ?? dealPayload.gpuCount,
    "Deal quantity",
  );
  const nodes = positiveInteger(
    overrides.quantity === undefined
      ? dealPayload.nodes ?? dealPayload.nodeCount
      : Math.ceil(quantity / 8),
    "Deal nodes",
  );
  const quote = normalizeQuote({
    ...dealPayload.quote,
    value: overrides.quote ?? dealPayload.quote?.value ?? dealPayload.quote?.amount,
  });
  const stages = applyDealTermsToStages(
    normalizeStages(dealPayload.stages),
    quote,
  );
  const requestedStage = String(
    stage ?? dealPayload.currentStage ?? dealPayload.stage ?? DEFAULT_STAGE,
  ).toLowerCase();
  const activeStage = stages.some((candidate) => candidate.id === requestedStage)
    ? requestedStage
    : stages[0].id;
  const market = createMarketContext(
    marketPayload ?? dealPayload.marketPayload ?? dealPayload.market,
    asset,
    quote.value,
  );
  const ariaLabels = Object.freeze(
    Object.fromEntries(
      stages.map((stageModel) => [
        stageModel.id,
        createAriaLabel({
          id,
          type: dealPayload.type ?? "Capacity",
          quantity,
          asset,
          quote,
          activeStage: stageModel.id,
          market,
        }),
      ]),
    ),
  );

  return Object.freeze({
    version: 1,
    id,
    label: `Deal ${id}`,
    type: cleanText(dealPayload.type ?? "Capacity", "Deal type"),
    asset,
    quantity,
    nodes,
    title: `${quantity} × ${asset}`,
    subtitle: `${nodes} ${nodes === 1 ? "node" : "nodes"}`,
    rfs: formatRfs(overrides.rfs ?? dealPayload.rfs),
    quote,
    activeStage,
    stages,
    activeStageIndex: stages.findIndex(
      (candidate) => candidate.id === activeStage,
    ),
    parties: nonNegativeInteger(dealPayload.parties, "Deal parties"),
    events: nonNegativeInteger(dealPayload.events, "Deal events"),
    nextAction: cleanText(dealPayload.nextAction, "Next action"),
    market,
    ariaLabel: ariaLabels[activeStage],
    ariaLabels,
  });
}

function applyDealTermsToStages(stages, quote) {
  return Object.freeze(
    stages.map((stage) =>
      stage.id === "diligence"
        ? Object.freeze({
            ...stage,
            copy:
              `Seller quote ${quote.formatted} per GPU hour with ` +
              `${formatCompactNumber(quote.prepayPercent)}% prepay. ` +
              "Capacity and topology checked.",
          })
        : stage,
    ),
  );
}

function assertDealPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("A Deal view payload is required");
  }
}

function normalizeQuote(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("A deal quote is required");
  }
  const amount = finiteNonNegative(value.value ?? value.amount, "Quote value");
  const prepay = finiteNonNegative(
    value.prepayPercent ?? value.prepay ?? 0,
    "Quote prepay",
  );

  return Object.freeze({
    value: amount,
    formatted: formatUsd(amount),
    currency: cleanText(value.currency ?? "USD", "Quote currency"),
    unit: cleanText(value.unit ?? "GPU-hour", "Quote unit"),
    prepayPercent: prepay,
  });
}

function normalizeStages(value) {
  if (!Array.isArray(value) || !value.length) {
    throw new TypeError("Deal stages are required");
  }

  const byId = new Map();
  for (const candidate of value) {
    const id = String(candidate?.id || "").trim().toLowerCase();
    if (!STAGE_IDS.includes(id) || byId.has(id)) continue;
    byId.set(
      id,
      Object.freeze({
        id,
        label: cleanText(candidate.label ?? titleCase(id), "Stage label"),
        copy: cleanText(candidate.copy, "Stage copy"),
        compactCopy: cleanText(
          candidate.compactCopy ?? candidate.mobileCopy ?? candidate.copy,
          "Compact stage copy",
        ),
        owner: cleanText(candidate.owner, "Stage owner"),
        status: cleanText(candidate.status, "Stage status"),
      }),
    );
  }

  const stages = STAGE_IDS.map((id) => byId.get(id)).filter(Boolean);
  if (stages.length !== STAGE_IDS.length) {
    throw new TypeError("Deal stages must include spec, diligence, and execute");
  }
  return Object.freeze(stages);
}

function createMarketContext(marketPayload, asset, quoteValue) {
  const payload = unwrapMarketPayload(marketPayload);
  if (!payload) return null;

  const explicitValue = Number(
    payload.benchmark ?? payload.referencePrice ?? payload.value,
  );
  const explicitTimestamp = Number(payload.asOf ?? payload.observedAt);
  const observation = Number.isFinite(explicitValue)
    ? {
        value: explicitValue,
        timestamp: Number.isFinite(explicitTimestamp) ? explicitTimestamp : null,
        lower: finiteOrNull(payload.lower),
        upper: finiteOrNull(payload.upper),
      }
    : latestObservation(payload.series?.[asset]);
  if (!observation) return null;

  const basis = quoteValue - observation.value;
  const basisPercent = observation.value
    ? (basis / observation.value) * 100
    : null;

  return Object.freeze({
    asset,
    benchmark: observation.value,
    benchmarkFormatted: formatUsd(observation.value),
    quote: quoteValue,
    quoteFormatted: formatUsd(quoteValue),
    basis,
    basisFormatted: formatSignedUsd(basis),
    basisPercent,
    basisPercentFormatted:
      basisPercent === null ? null : formatSignedPercent(basisPercent),
    lower: observation.lower,
    upper: observation.upper,
    observedAt: normalizeTimestamp(observation.timestamp),
  });
}

function unwrapMarketPayload(value) {
  if (!value) return null;
  if (typeof value.get === "function") {
    return (
      value.get("gpu-index") ||
      value.get("gpu-price-index") ||
      Array.from(value.values?.() || [])[0] ||
      null
    );
  }
  return value;
}

function latestObservation(points) {
  if (!Array.isArray(points)) return null;
  let latest = null;

  for (const point of points) {
    const normalized = normalizeObservation(point);
    if (
      normalized &&
      (!latest ||
        normalized.timestamp === null ||
        latest.timestamp === null ||
        normalized.timestamp > latest.timestamp)
    ) {
      latest = normalized;
    }
  }
  return latest;
}

function normalizeObservation(point) {
  if (Array.isArray(point)) {
    const timestamp = Number(point[0]);
    const value = Number(point[1]);
    if (!Number.isFinite(value)) return null;
    return {
      timestamp: Number.isFinite(timestamp) ? timestamp : null,
      value,
      lower: finiteOrNull(point[2]),
      upper: finiteOrNull(point[3]),
    };
  }
  if (!point || typeof point !== "object") return null;
  const value = Number(point.value ?? point.price);
  if (!Number.isFinite(value)) return null;
  return {
    timestamp: finiteOrNull(point.timestamp ?? point.observedAt),
    value,
    lower: finiteOrNull(point.lower),
    upper: finiteOrNull(point.upper),
  };
}

function formatRfs(value) {
  const raw = cleanText(value, "Deal RFS");
  const match = raw.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (!match) return raw.toUpperCase();
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
    .format(date)
    .toUpperCase();
}

function createAriaLabel({ id, type, quantity, asset, quote, activeStage, market }) {
  const context = market
    ? ` ${asset} benchmark ${market.benchmarkFormatted}, basis ${market.basisFormatted}.`
    : "";
  return (
    `Deal ${id}, ${type}, ${quantity} ${asset}, quote ${quote.formatted} ` +
    `per GPU hour, ${titleCase(activeStage)} stage.${context}`
  );
}

function formatCompactNumber(value) {
  return Number(value).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}

function normalizeTimestamp(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return null;
  return timestamp > 10_000_000_000 ? Math.round(timestamp / 1000) : timestamp;
}

function formatUsd(value) {
  return `$${Number(value).toFixed(2)}`;
}

function formatSignedUsd(value) {
  const number = Number(value);
  const sign = number > 0 ? "+" : number < 0 ? "−" : "";
  return `${sign}$${Math.abs(number).toFixed(2)}`;
}

function formatSignedPercent(value) {
  const number = Number(value);
  const sign = number > 0 ? "+" : number < 0 ? "−" : "";
  return `${sign}${Math.abs(number).toFixed(1)}%`;
}

function cleanText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new TypeError(`${label} is required`);
  return text;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return number;
}

function nonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  return number;
}

function finiteNonNegative(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new TypeError(`${label} must be a non-negative number`);
  }
  return number;
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function titleCase(value) {
  const text = String(value || "");
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : "";
}
