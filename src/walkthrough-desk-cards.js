import { getCardDefinition } from './card-registry.js';
import { createDealViewModel } from './deal-view-model.js';
import { mountDealView } from './deal-view-presentation.js';
import { createGpuPriceBarModel } from './gpu-price-bar-model.js';
import { renderGpuPriceBarSvg } from './gpu-price-bar-presentation.js';
import { createForwardPricesModel } from './forward-prices-model.js';
import { renderForwardPricesSvg } from './forward-prices-presentation.js';
import { createGpuHedgeModel } from './gpu-hedge-model.js';
import { renderGpuCoverageSvg } from './gpu-coverage-presentation.js';
import { QUOTE_DESK_STORY } from './quote-desk-story-model.js';
import { formatUsd } from './quote-story-model.js';

const DEFAULT_PALETTE = Object.freeze({
  theme: 'light', paper: '#fefefd', line: '#84908a',
  text: '#4e5e66', secondary: '#4e5e66', area: '#4e5e66',
});
const seconds = date => Date.parse(`${date}T00:00:00.000Z`) / 1000;
const cents = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

// Only adapts fictional walkthrough data. The cards use the same model and
// presentation modules as the real Desk catalog; nothing loads or saves a desk.
export function renderWalkthroughDeskCards({ palette = {} } = {}) {
  const colors = Object.freeze({ ...DEFAULT_PALETTE, ...palette });
  const { quote, history, forwards, hedge } = QUOTE_DESK_STORY;
  const quoteModel = createQuoteTicket(quote);
  const priceModel = createGpuPriceBarModel({
    version: 1,
    cardId: 'gpu-index',
    revision: 'walkthrough-illustrative-v1',
    series: {
      // No provider range is supplied by this example: each observation is a
      // single reference, so its lower and upper values equal that reference.
      [quote.gpu]: history.points.map(point => {
        const value = point.rateCents / 100;
        return [seconds(point.date), value, value, value];
      }),
    },
  }, getCardDefinition('gpu-price-snapshot'), { layerIds: [quote.gpu] });
  const latestForward = forwards.points.map(point => point.rateCents / 100);
  const forwardModel = createForwardPricesModel({
    dataset: {
      kind: 'illustrative', region: quote.region,
      term: 'Monthly reference', quantity: quote.gpuCount,
    },
    deliveries: forwards.points.map(point => seconds(`${point.month}-01`)),
    observations: history.points.slice(-2).map(point => seconds(point.date)),
    surfaces: {
      // The shared curve renderer also shows an earlier quote date. Its prior
      // curve is an explicit example assumption, eight cents above the latest.
      [quote.gpu]: [forwards.points.map(point => (point.rateCents + 8) / 100), latestForward],
    },
  }, { gpu: quote.gpu, range: 'now', colormap: 'current' });
  const coverageModel = createGpuHedgeModel(null, {
    side: 'buyer', gpu: quote.gpu, delivery: hedge.referenceMonth,
    hours: quote.gpuHours, rate: hedge.hedgeRateCents / 100,
    coverage: 50, revenue: 0, costs: 0, basis: 0,
  });
  const options = { colors, compact: true, gallery: true };
  const cards = Object.freeze([
    Object.freeze({
      id: 'quote', title: 'Quote', model: quoteModel,
      mount: host => mountDealView(host, quoteModel, {
        variant: 'static', palette: colors, reducedMotion: true,
        revealMotion: false, interactive: false,
      }),
    }),
    Object.freeze({
      id: 'prices', title: 'H100 prices', model: priceModel,
      svg: renderGpuPriceBarSvg(priceModel, { ...options, title: 'H100 prices' }),
    }),
    Object.freeze({
      id: 'forwards', title: 'Forward prices', model: forwardModel,
      svg: renderForwardPricesSvg(forwardModel, { ...options, title: 'Forward prices' }),
    }),
    Object.freeze({
      id: 'coverage', title: 'Hedge coverage', model: coverageModel,
      svg: renderGpuCoverageSvg(coverageModel, { ...options, title: 'Hedge coverage' }),
    }),
  ]);
  return Object.freeze({
    cards,
    summary: `Illustrative Desk cards for ${quote.label}. Quote for ${quote.gpuCount} ${quote.gpu} GPUs in ${quote.region}, ${quote.startDate} to ${quote.endDate} exclusive, ${quote.gpuHours.toLocaleString('en-US')} GPU-hours, ${formatUsd(quote.rateUsd, cents)} per GPU-hour and ${formatUsd(quote.totalUsd, cents)} total. The example H100 price reference is ${formatUsd(priceModel.bars[0].value, cents)} on ${history.points.at(-1).date}. Assumed forwards: ${forwards.points.map(point => `${point.label} ${formatUsd(point.rateCents / 100, cents)}`).join(', ')} per GPU-hour; the earlier example curve is eight cents higher. Hedge coverage shows an assumed 50%, ${coverageModel.hedgedHours.toLocaleString('en-US')} hedged and ${coverageModel.exposedHours.toLocaleString('en-US')} exposed GPU-hours, at ${formatUsd(coverageModel.rate, cents)} per GPU-hour. Coverage is a separate hypothetical floating-cost scenario, not an extra hedge on the fixed rental quote. Nothing booked or saved to your actual Desk.`,
  });
}

function createQuoteTicket(quote) {
  const stages = [
    { id: 'spec', label: 'RFQ', copy: 'Illustrative rental request.', owner: 'Buyer', status: 'Open' },
    { id: 'diligence', label: 'Quote', copy: 'Illustrative provider quote; nothing booked.', owner: 'Buyer', status: 'Open' },
    { id: 'execute', label: 'Booking', copy: 'No booking has been made.', owner: 'Buyer', status: 'Not booked' },
  ];
  // The quote renderer depicts a completed bid/ask negotiation. This selected
  // offer has no negotiation history, so the shared deal renderer's ticket
  // branch is the truthful representation of its quoted rate and capacity.
  const normalized = createDealViewModel({
    id: quote.id, label: quote.label, type: 'Illustrative rental quote',
    side: 'buy', asset: quote.gpu, quantity: quote.gpuCount, nodes: quote.nodeCount,
    region: quote.region, fabric: quote.network, service: 'Dedicated GPU rental',
    tenancy: 'dedicated', rfs: quote.startDate.slice(0, 7),
    quote: { value: quote.rateUsd, currency: quote.currency, unit: 'GPU-hour', prepayPercent: 0 },
    quoteHistory: [], eventLog: [], stages, currentStage: 'spec', parties: 0, events: 0,
    workflow: { stage: 'spec', status: 'open', nextAction: 'Review illustrative quote', nextOwner: 'Buyer' },
  }, { kind: 'deal', viewName: quote.label });
  // The normalizer assumes agreed commercial terms in its diligence copy.
  // Keep the walkthrough's explicit unbooked copy and presentation status.
  return Object.freeze({
    ...normalized,
    statusLabel: 'QUOTE', priceStatusLabel: 'QUOTE',
    stages: Object.freeze(normalized.stages.map(stage => Object.freeze({
      ...stage, copy: stages.find(candidate => candidate.id === stage.id).copy,
    }))),
  });
}
