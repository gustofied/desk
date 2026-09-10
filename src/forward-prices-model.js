import { normalizeForwardColormap } from './forward-colormaps.js';

export function createForwardPricesModel(payload, state = {}) {
  const gpu = state.gpu || 'H100';
  const deliveries = payload?.deliveries;
  const observations = payload?.observations;
  const values = payload?.surfaces?.[gpu];
  const ordered = items => Array.isArray(items) && items.length >= 2 && items.every((v, i) => Number.isFinite(v) && (!i || v > items[i - 1]));
  if (!ordered(deliveries) || !ordered(observations) || !Array.isArray(values) || values.length !== observations.length ||
      values.some(row => !Array.isArray(row) || row.length !== deliveries.length || row.some(v => !Number.isFinite(v) || v <= 0)) || observations.at(-1) >= deliveries[0]) {
    throw new TypeError('Forward prices need an ordered quote-date × delivery-date grid.');
  }
  const latest = values.at(-1);
  const premium = latest.at(-1) - latest[0];
  return { gpu, deliveries, observations, values, latest, premium, range: state.range || 'all',
    colormap: normalizeForwardColormap(state.colormap),
    asOf: observations.at(-1), low: Math.min(...values.flat()), high: Math.max(...values.flat()),
    structure: latest.every((v, i) => !i || v >= latest[i - 1]) ? 'Contango' : latest.every((v, i) => !i || v <= latest[i - 1]) ? 'Backwardation' : 'Mixed',
    contract: payload.dataset,
  };
}
