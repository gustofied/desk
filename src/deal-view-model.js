const DEFAULT_STAGE = "execute";
const STAGE_IDS = Object.freeze(["spec", "diligence", "execute"]);

export const DEAL_041_PAYLOAD = Object.freeze({
  version: 1,
  id: "041",
  type: "Reserved capacity",
  side: "buy",
  asset: "B200",
  quantity: 256,
  nodes: 32,
  region: "US East",
  fabric: "InfiniBand",
  service: "Dedicated bare metal",
  tenancy: "dedicated",
  termMonths: 24,
  rfs: "2026-10",
  currentStage: DEFAULT_STAGE,
  quote: Object.freeze({
    value: 3.65,
    currency: "USD",
    unit: "GPU-hour",
    prepayPercent: 20,
  }),
  quoteHistory: Object.freeze([
    Object.freeze([1787415000, 4.25, 3.10]),
    Object.freeze([1787500800, 4.25, 3.20]),
    Object.freeze([1787587200, 4.05, 3.20]),
    Object.freeze([1787673600, 4.05, 3.35]),
    Object.freeze([1787760000, 3.90, 3.35]),
    Object.freeze([1787846400, 3.90, 3.50]),
    Object.freeze([1787932800, 3.75, 3.60]),
    Object.freeze([1787998500, 3.65, 3.65]),
  ]),
  eventLog: createFallbackEventLog(),
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
      copy: "Seller quote: $3.65 / GPU-hour with 20% prepay. Technical and commercial checks complete.",
      compactCopy: "Quote checked",
      owner: "Technical + commercial",
      status: "Quote normalized",
    }),
    Object.freeze({
      id: "execute",
      label: "Execution",
      copy: "Finalize the quote and execute the Compute Services Agreement with the seller.",
      compactCopy: "Finalize agreement",
      owner: "Buyer + seller",
      status: "Awaiting sign-off",
    }),
  ]),
  parties: 4,
  events: 18,
  nextAction: "Review service terms",
  nextOwner: "Buyer",
  workflow: Object.freeze({
    stage: "out-for-signing",
    status: "terms-review",
    nextAction: "Review service terms",
    nextOwner: "Buyer",
  }),
});

function createFallbackEventLog() {
  const rows = [
    ["mandate-opened", "2026-08-20T09:10:00.000Z", "spec", "Buyer", "Mandate opened", "done"],
    ["capacity-set", "2026-08-20T09:18:00.000Z", "spec", "Buyer", "256 × B200", "done"],
    ["fabric-set", "2026-08-20T09:26:00.000Z", "spec", "Buyer", "US East, InfiniBand", "done"],
    ["term-set", "2026-08-20T09:34:00.000Z", "spec", "Buyer", "24 months, Oct RFS", "done"],
    ["rfq-sent", "2026-08-21T10:05:00.000Z", "spec", "Broker", "RFQ sent", "done"],
    ["ask-opened", "2026-08-22T16:00:00.000Z", "diligence", "Seller", "Ask $4.25", "done"],
    ["bid-opened", "2026-08-22T16:10:00.000Z", "diligence", "Buyer", "Bid $3.10", "done"],
    ["bid-320", "2026-08-23T16:00:00.000Z", "diligence", "Buyer", "Bid $3.20", "done"],
    ["ask-405", "2026-08-24T16:00:00.000Z", "diligence", "Seller", "Ask $4.05", "done"],
    ["bid-335", "2026-08-25T16:00:00.000Z", "diligence", "Buyer", "Bid $3.35", "done"],
    ["ask-390", "2026-08-26T16:00:00.000Z", "diligence", "Seller", "Ask $3.90", "done"],
    ["bid-350", "2026-08-27T16:00:00.000Z", "diligence", "Buyer", "Bid $3.50", "done"],
    ["ask-375", "2026-08-28T10:00:00.000Z", "diligence", "Seller", "Ask $3.75", "done"],
    ["bid-360", "2026-08-28T16:00:00.000Z", "diligence", "Buyer", "Bid $3.60", "done"],
    ["price-agreed", "2026-08-29T10:15:00.000Z", "diligence", "Buyer and seller", "$3.65 agreed", "done", 3.65],
    ["capacity-verified", "2026-08-29T11:05:00.000Z", "diligence", "Seller", "Capacity verified", "done"],
    ["agreement-sent", "2026-08-29T12:20:00.000Z", "execute", "Broker", "Draft agreement sent", "done"],
    ["service-terms-open", "2026-08-29T16:00:00.000Z", "execute", "Buyer", "Service terms under review", "current"],
  ];
  return Object.freeze(
    rows.map(([id, observedAt, stage, actor, label, status, valueUsdGpuHour]) =>
      Object.freeze({
        id,
        observedAt,
        stage,
        actor,
        label,
        status,
        ...(Number.isFinite(valueUsdGpuHour) ? { valueUsdGpuHour } : {}),
      }),
    ),
  );
}

/**
 * Normalizes a transaction record into the small, stable model consumed by the
 * Deal view presentation. `marketPayload` may be a GPU history payload or a Map
 * containing that payload under `gpu-index`.
 */
export function createDealViewModel(
  dealPayload,
  { kind = "deal", marketPayload = null, overrides = {} } = {},
) {
  assertDealPayload(dealPayload);

  const viewKind = kind === "quote" ? "quote" : "deal";

  const id = cleanText(dealPayload.id ?? dealPayload.dealId, "Deal id");
  const side = normalizeSide(dealPayload.side ?? dealPayload.direction);
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
  const sourceTerms = dealPayload.terms ?? {};
  const region = optionalText(dealPayload.region ?? sourceTerms.region);
  const fabric = optionalText(
    dealPayload.fabric ??
      dealPayload.interconnect ??
      sourceTerms.fabric ??
      sourceTerms.interconnect,
  );
  const service = optionalText(dealPayload.service ?? sourceTerms.service);
  const tenancy = normalizeTenancy(
    dealPayload.tenancy ?? sourceTerms.tenancy,
    service,
  );
  const termMonths = optionalPositiveInteger(
    dealPayload.termMonths ??
      dealPayload.term_months ??
      sourceTerms.termMonths ??
      sourceTerms.term_months,
    "Deal term",
  );
  const sourceQuoteValue = finiteNonNegative(
    dealPayload.quote?.value ?? dealPayload.quote?.amount,
    "Quote value",
  );
  const quote = normalizeQuote({
    ...dealPayload.quote,
    value: overrides.quote ?? dealPayload.quote?.value ?? dealPayload.quote?.amount,
  });
  const quantityFormatted = formatCompactNumber(quantity);
  const nodesFormatted = formatCompactNumber(nodes);
  const rfs = formatRfs(overrides.rfs ?? dealPayload.rfs);
  const termLabel =
    termMonths === null
      ? null
      : `${formatCompactNumber(termMonths)} ${termMonths === 1 ? "month" : "months"}`;
  const quoteHistory = normalizeQuoteHistory(
    dealPayload.quoteHistory ?? dealPayload.quote_history,
    quote.value,
    sourceQuoteValue,
  );
  const stages = applyDealTermsToStages(
    normalizeStages(dealPayload.stages),
    quote,
  );
  const eventLog = applyDealStateToEvents(
    normalizeEventLog(dealPayload.eventLog ?? dealPayload.event_log),
    {
      asset,
      quantityFormatted,
      region,
      fabric,
      termLabel,
      rfs,
      quote,
      sourceQuoteValue,
    },
  );
  const requestedStage = String(
    dealPayload.currentStage ??
      dealPayload.current_stage ??
      dealPayload.stage ??
      DEFAULT_STAGE,
  ).toLowerCase();
  const activeStage = stages.some((candidate) => candidate.id === requestedStage)
    ? requestedStage
    : stages[0].id;
  const activeStageIndex = stages.findIndex(
    (candidate) => candidate.id === activeStage,
  );
  const activeStageModel = stages[activeStageIndex];
  const latestRevision = quoteHistory.at(-1);
  const quoteStatus =
    latestRevision?.buyerBid === latestRevision?.sellerAsk ? "Agreed" : "Open";
  const market = createMarketContext(
    marketPayload ?? dealPayload.marketPayload ?? dealPayload.market,
    asset,
    quote.value,
  );
  const workflow = normalizeWorkflow(dealPayload, activeStageModel);
  const statusLabel =
    viewKind === "quote"
      ? quoteStatus
      : workflow.hasExplicitStatus
        ? workflow.statusLabel
        : activeStageModel.label;
  const ariaLabels = Object.freeze(
    Object.fromEntries(
      stages.map((stageModel) => [
        stageModel.id,
        createAriaLabel({
          kind: viewKind,
          id,
          type: dealPayload.type ?? "Capacity",
          quantity,
          asset,
          quote,
          rfs,
          activeStage: stageModel.id,
        }),
      ]),
    ),
  );

  return Object.freeze({
    version: 1,
    viewKind,
    id,
    label: `${viewKind === "quote" ? "Quote" : "Deal"} ${id}`,
    statusLabel,
    type: cleanText(dealPayload.type ?? "Capacity", "Deal type"),
    side,
    sideLabel: side === "buy" ? "Buy" : "Sell",
    asset,
    quantity,
    quantityFormatted,
    capacityLabel: `${quantityFormatted} GPUs`,
    nodes,
    nodesLabel: `${nodesFormatted} ${nodes === 1 ? "node" : "nodes"}`,
    region,
    fabric,
    service,
    tenancy,
    tenancyLabel: tenancy ? titleCase(tenancy) : null,
    termMonths,
    termLabel,
    rateLabel: quote.rateLabel,
    prepayLabel: quote.prepayLabel,
    title: `${quantity} × ${asset}`,
    subtitle: `${nodes} ${nodes === 1 ? "node" : "nodes"}`,
    rfs,
    rfsLabel: rfs,
    quote,
    quoteHistory,
    eventLog,
    activeStage,
    stages,
    activeStageIndex,
    activeStageModel,
    parties: nonNegativeInteger(dealPayload.parties, "Deal parties"),
    events: eventLog.length || nonNegativeInteger(dealPayload.events, "Deal events"),
    workflowStage: workflow.stage,
    workflowStageLabel: workflow.stageLabel,
    workflowStatus: workflow.status,
    workflowStatusLabel: workflow.statusLabel,
    nextAction: workflow.nextAction,
    nextOwner: workflow.nextOwner,
    market,
    ariaLabel: ariaLabels[activeStage],
    ariaLabels,
  });
}

function normalizeWorkflow(dealPayload, activeStageModel) {
  const source = dealPayload.workflow ?? {};
  const rawStage = optionalText(
    source.stage ?? source.pipelineStage ?? source.pipeline_stage,
  );
  const rawStatus = optionalText(source.status);
  const stage = rawStage ? slugify(rawStage) : activeStageModel.id;
  const status = rawStatus ? slugify(rawStatus) : null;
  const nextAction = cleanText(
    source.nextAction ??
      source.next_action ??
      dealPayload.nextAction ??
      dealPayload.next_action,
    "Next action",
  );
  const nextOwner = optionalText(
    source.nextOwner ??
      source.next_owner ??
      dealPayload.nextOwner ??
      dealPayload.next_owner,
  );

  return Object.freeze({
    stage,
    stageLabel: rawStage ? labelFromSlug(stage) : activeStageModel.label,
    status,
    statusLabel: rawStatus ? labelFromSlug(status) : activeStageModel.status,
    hasExplicitStatus: Boolean(rawStatus),
    nextAction,
    nextOwner,
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
              "Technical and commercial checks complete.",
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
  const currency = cleanText(value.currency ?? "USD", "Quote currency");
  const unit = cleanText(value.unit ?? "GPU-hour", "Quote unit");
  const formatted = formatUsd(amount);
  const unitLabel = unit.toLowerCase() === "gpu-hour" ? "GPU hour" : unit;

  return Object.freeze({
    value: amount,
    formatted,
    currency,
    unit,
    unitLabel,
    rateLabel: `${formatted} / ${unitLabel}`,
    prepayPercent: prepay,
    prepayLabel: `${formatCompactNumber(prepay)}% prepay`,
  });
}

function normalizeQuoteHistory(value, currentQuote, sourceQuote = currentQuote) {
  if (!Array.isArray(value)) return Object.freeze([]);

  const scale = sourceQuote > 0 ? currentQuote / sourceQuote : 1;
  const points = value
    .map((point) => {
      const timestamp = quoteHistoryTimestamp(
        Array.isArray(point)
          ? point[0]
          : point?.timestamp ?? point?.observedAt ?? point?.observed_at,
      );
      const sellerAsk = Number(
        Array.isArray(point)
          ? point[1]
          : point?.sellerAsk ??
              point?.seller_ask_usd_gpu_hour ??
              point?.value ??
              point?.quote,
      );
      const buyerBidValue = Array.isArray(point)
        ? point[2]
        : point?.buyerBid ?? point?.buyer_bid_usd_gpu_hour;
      const buyerBid = buyerBidValue === undefined || buyerBidValue === null
        ? null
        : Number(buyerBidValue);
      if (
        !Number.isFinite(timestamp) ||
        !Number.isFinite(sellerAsk) ||
        sellerAsk < 0 ||
        (buyerBid !== null &&
          (!Number.isFinite(buyerBid) || buyerBid < 0 || buyerBid > sellerAsk))
      ) {
        return null;
      }
      return { timestamp, sellerAsk, buyerBid };
    })
    .filter(Boolean)
    .sort((left, right) => left.timestamp - right.timestamp)
    .map((point) =>
      Object.freeze({
        ...point,
        sellerAsk: roundUsd(point.sellerAsk * scale),
        buyerBid:
          point.buyerBid === null ? null : roundUsd(point.buyerBid * scale),
      }),
    );

  if (
    points.length &&
    (points.at(-1).sellerAsk !== currentQuote ||
      (points.at(-1).buyerBid !== null &&
        points.at(-1).buyerBid !== currentQuote))
  ) {
    const latest = points.at(-1);
    points[points.length - 1] = Object.freeze({
      ...latest,
      sellerAsk: currentQuote,
      buyerBid: latest.buyerBid === null ? null : currentQuote,
    });
  }
  return Object.freeze(points);
}

function applyDealStateToEvents(
  events,
  {
    asset,
    quantityFormatted,
    region,
    fabric,
    termLabel,
    rfs,
    quote,
    sourceQuoteValue,
  },
) {
  const scale = sourceQuoteValue > 0 ? quote.value / sourceQuoteValue : 1;
  return Object.freeze(
    events.map((event) => {
      let label = event.label;
      let valueUsdGpuHour = event.valueUsdGpuHour;

      if (event.id === "capacity-set") {
        label = `${quantityFormatted} ${asset}`;
      } else if (event.id === "fabric-set") {
        label = [region, fabric].filter(Boolean).join(", ");
      } else if (event.id === "term-set") {
        label = [termLabel, `${rfs} RFS`].filter(Boolean).join(", ");
      } else if (event.id === "price-agreed") {
        label = `${quote.formatted} agreed`;
        valueUsdGpuHour = quote.value;
      } else {
        const priceLabel = label.match(/^(Bid|Ask)\s+\$([\d.]+)$/i);
        if (priceLabel) {
          label = `${priceLabel[1]} ${formatUsd(Number(priceLabel[2]) * scale)}`;
        }
      }

      return Object.freeze({
        ...event,
        label,
        ...(valueUsdGpuHour === undefined
          ? {}
          : { valueUsdGpuHour: roundUsd(valueUsdGpuHour) }),
      });
    }),
  );
}

function normalizeEventLog(value) {
  if (!Array.isArray(value)) return Object.freeze([]);

  const ids = new Set();
  const statuses = new Set(["done", "current", "next"]);
  const events = value
    .map((event) => {
      const id = String(event?.id || "").trim();
      const timestamp = quoteHistoryTimestamp(
        event?.timestamp ?? event?.observedAt ?? event?.observed_at,
      );
      const stage = String(event?.stage || "").trim().toLowerCase();
      const status = String(event?.status || "done").trim().toLowerCase();
      const rawValue = event?.valueUsdGpuHour ?? event?.value_usd_gpu_hour;
      const valueUsdGpuHour = rawValue === undefined ? null : Number(rawValue);
      if (
        !id ||
        ids.has(id) ||
        !Number.isFinite(timestamp) ||
        !STAGE_IDS.includes(stage) ||
        !statuses.has(status) ||
        (valueUsdGpuHour !== null &&
          (!Number.isFinite(valueUsdGpuHour) || valueUsdGpuHour < 0))
      ) {
        return null;
      }
      ids.add(id);
      return Object.freeze({
        id,
        timestamp,
        stage,
        actor: cleanText(event.actor, "Event actor"),
        label: cleanText(event.label ?? event.action, "Event label"),
        status,
        ...(valueUsdGpuHour === null ? {} : { valueUsdGpuHour }),
      });
    })
    .filter(Boolean)
    .sort((left, right) => left.timestamp - right.timestamp);

  return Object.freeze(events);
}

function quoteHistoryTimestamp(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric > 10_000_000_000 ? Math.round(numeric / 1000) : numeric;
  }
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? Math.round(parsed / 1000) : NaN;
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
  const basisFormatted = formatSignedUsd(basis);
  const basisPercentFormatted =
    basisPercent === null ? null : formatSignedPercent(basisPercent);

  return Object.freeze({
    asset,
    benchmark: observation.value,
    benchmarkFormatted: formatUsd(observation.value),
    quote: quoteValue,
    quoteFormatted: formatUsd(quoteValue),
    basis,
    basisFormatted,
    basisPercent,
    basisPercentFormatted,
    benchmarkLabel: `${formatUsd(observation.value)} market`,
    basisDirection: basis > 0 ? "above" : basis < 0 ? "below" : "at",
    basisLabel:
      basisPercentFormatted === null
        ? `${basisFormatted} vs market`
        : `${basisFormatted} (${basisPercentFormatted}) vs market`,
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

function createAriaLabel({
  kind,
  id,
  type,
  quantity,
  asset,
  quote,
  rfs,
  activeStage,
}) {
  const stageLabel = activeStage === "execute"
    ? "Execution"
    : titleCase(activeStage);
  if (kind === "quote") {
    return (
      `Quote ${id}, ${quantity} ${asset}, agreed at ${quote.formatted} ` +
      "per GPU hour."
    );
  }
  return (
    `Deal ${id}, ${type}, ${quantity} ${asset}, quote ${quote.formatted} ` +
    `per GPU hour, ready for service ${rfs}, ${stageLabel} stage.`
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

function roundUsd(value) {
  return Number(Number(value).toFixed(2));
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

function optionalText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeSide(value) {
  const side = String(value ?? "buy").trim().toLowerCase();
  if (side !== "buy" && side !== "sell") {
    throw new TypeError("Deal side must be buy or sell");
  }
  return side;
}

function normalizeTenancy(value, service) {
  const explicit = optionalText(value);
  if (explicit) return slugify(explicit);
  return /\bdedicated\b/i.test(service || "") ? "dedicated" : null;
}

function optionalPositiveInteger(value, label) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }
  return positiveInteger(value, label);
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function labelFromSlug(value) {
  return titleCase(String(value || "").replace(/-/g, " "));
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
