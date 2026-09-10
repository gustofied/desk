import { createSharedDesk, sharedDeskUrl } from './shared-desk.js';
import { QUOTE_DESK_STORY } from './quote-desk-story-model.js';

// Shared desks encode a temporary catalog in the URL. Only chart definitions
// transfer: the selected provider and 14-day rental are not registry states.
export function walkthroughDeskUrl(baseUrl) {
  const { quote, hedge } = QUOTE_DESK_STORY;
  const appearance = { palette: 'sage', theme: 'dark', colormap: 'current' };
  const gpu = { gpu: quote.gpu, layers: [quote.gpu] };
  const snapshot = createSharedDesk({
    name: 'H100 request',
    palette: appearance.palette,
    theme: appearance.theme,
    entries: [
      {
        cardId: 'gpu-price-snapshot', name: 'H100 prices',
        state: { ...gpu, ...appearance, range: '1d', scale: 'price' },
      },
      {
        cardId: 'forward-prices', name: 'Forward prices',
        state: { ...gpu, ...appearance, range: 'now', scale: 'price' },
      },
      {
        cardId: 'gpu-hedge', name: 'Hedge coverage',
        state: {
          ...gpu, ...appearance, range: 'now', scale: 'coverage', side: 'buyer',
          hours: quote.gpuHours, rate: hedge.hedgeRateCents / 100, coverage: 50,
          revenue: 0, costs: 0, basis: 0, delivery: hedge.referenceMonth,
        },
      },
    ],
  });
  return sharedDeskUrl(snapshot, new URL('../', baseUrl).href);
}
