// Fictional offers for the standalone walkthrough, never executable quotes.
const DAY_MS = 86_400_000;
const INITIAL_START = '2026-10-05';
const ALTERNATE_START = '2026-10-08';
const DURATION_DAYS = 14;
const GPU_COUNT = 256;
const GPUS_PER_NODE = 8;

export const QUOTE_REQUEST = Object.freeze({
  kind: 'illustrative',
  gpu: 'H100',
  variant: 'SXM 80GB',
  gpuCount: GPU_COUNT,
  gpusPerNode: GPUS_PER_NODE,
  nodeCount: GPU_COUNT / GPUS_PER_NODE,
  region: 'US East',
  network: 'InfiniBand',
  durationDays: DURATION_DAYS,
  initialStart: INITIAL_START,
  alternateStart: ALTERNATE_START,
  gpuHours: GPU_COUNT * DURATION_DAYS * 24,
  currency: 'USD',
  rateUnit: 'USD/GPU-hour',
});

export const QUOTE_OFFERS = Object.freeze([
  Object.freeze({
    id: 'ashburn-01',
    label: 'Ashburn 01',
    availableGpus: 512,
    ratesCents: Object.freeze({ [INITIAL_START]: 268, [ALTERNATE_START]: 262 }),
  }),
  Object.freeze({
    id: 'ashburn-02',
    label: 'Ashburn 02',
    availableGpus: 512,
    ratesCents: Object.freeze({ [INITIAL_START]: 282, [ALTERNATE_START]: 246 }),
  }),
  Object.freeze({
    id: 'newark-01',
    label: 'Newark 01',
    availableGpus: 384,
    ratesCents: Object.freeze({ [INITIAL_START]: 274, [ALTERNATE_START]: 269 }),
  }),
]);

function validateStart(startDate) {
  if (startDate !== INITIAL_START && startDate !== ALTERNATE_START) {
    throw new RangeError('Choose a supported illustrative start date.');
  }
}

export function quoteFor(offerId, startDate = INITIAL_START) {
  validateStart(startDate);
  const offer = QUOTE_OFFERS.find(item => item.id === offerId);
  if (!offer) throw new RangeError('Unknown illustrative offer.');

  const startsAt = `${startDate}T00:00:00.000Z`;
  const endsAt = new Date(Date.parse(startsAt) + DURATION_DAYS * DAY_MS).toISOString();
  const rateCents = offer.ratesCents[startDate];
  // Cents per GPU-hour × GPUs × hours. Keep all price arithmetic integral.
  const totalCents = rateCents * QUOTE_REQUEST.gpuHours;
  if (!Number.isSafeInteger(totalCents)) throw new RangeError('Quote total is out of range.');

  return Object.freeze({
    ...QUOTE_REQUEST,
    ...offer,
    startDate,
    endDate: endsAt.slice(0, 10),
    startsAt,
    endsAt,
    endExclusive: true,
    rateCents,
    rateUsd: rateCents / 100,
    totalCents,
    totalUsd: totalCents / 100,
  });
}

export function rankedQuotes(startDate = INITIAL_START) {
  validateStart(startDate);
  return Object.freeze(QUOTE_OFFERS
    .map(offer => quoteFor(offer.id, startDate))
    .sort((a, b) => a.totalCents - b.totalCents || a.id.localeCompare(b.id)));
}

// Accepts dollars, not cents. Pass fraction-digit options for hourly prices.
export function formatUsd(value, options = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError('A finite USD amount is required.');
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    ...options,
  }).format(value);
}
