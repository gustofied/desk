import { scaleLinear } from 'd3';

const GPUS = ['H100', 'H200', 'B200', 'B300'];
const DEFAULTS = Object.freeze({
  side: 'buyer', gpu: 'H100', delivery: '2026-10', hours: 500000, revenue: 1500000,
  costs: 0, rate: 2.5, coverage: 100, basis: 0,
});

// This is a manual scenario. Delivery and GPU describe the contract;
// they do not select a price feed or change the entered economics.
export function createGpuHedgeModel(payload, state = {}) {
  const input = { ...DEFAULTS, ...state };
  const side = input.side === 'seller' ? 'seller' : DEFAULTS.side;
  const gpu = GPUS.includes(input.gpu) ? input.gpu : DEFAULTS.gpu;
  const delivery = /^\d{4}-(0[1-9]|1[0-2])$/.test(input.delivery)
    ? input.delivery : DEFAULTS.delivery;
  const hours = number(input.hours, DEFAULTS.hours, 0);
  const revenue = number(input.revenue, DEFAULTS.revenue, 0);
  const costs = number(input.costs, DEFAULTS.costs, 0);
  const rate = number(input.rate, DEFAULTS.rate, 0);
  const coverage = number(input.coverage, DEFAULTS.coverage, 0, 100);
  const basis = number(input.basis, DEFAULTS.basis, -1e12);
  const hedgedHours = hours * coverage / 100;
  const profitAt = settlement => {
    const index = number(settlement, rate, -1e12);
    if (side === 'seller') {
      const unhedged = hours * (index + basis) - costs;
      const hedgePnl = hedgedHours * (rate - index);
      // Equivalent to unhedged + hedgePnl, without cancellation at full coverage.
      const hedged = hours * basis - costs + hedgedHours * rate + (hours - hedgedHours) * index;
      return { unhedged, hedged, hedgePnl, margin: null };
    }
    const unhedged = revenue - costs - hours * (index + basis);
    const hedgePnl = hedgedHours * (index - rate);
    // The equivalent net-cost form avoids cancellation at 100% coverage.
    const hedged = revenue - costs - hours * basis - hedgedHours * rate - (hours - hedgedHours) * index;
    return { unhedged, hedged, hedgePnl, margin: revenue > 0 ? hedged / revenue * 100 : null };
  };
  const headline = profitAt(rate);
  const physicalBreakEven = hours > 0 ? (side === 'seller' ? costs : revenue - costs) / hours - basis : null;
  const breakEven = side === 'seller' && !(physicalBreakEven > 0) ? null : physicalBreakEven;
  // Seller proceeds can break even far below the hedge price; keep its scenario
  // range near the entered price instead of stretching to negligible costs.
  const anchors = [rate, ...(side === 'buyer' && breakEven > 0 ? [breakEven] : [])];
  const padding = Math.max(rate * 0.28, (Math.max(...anchors) - Math.min(...anchors)) * 0.15, 0.2);
  const domain = scaleLinear().domain([
    Math.max(0, Math.min(...anchors) - padding),
    Math.max(...anchors) + padding / 2,
  ]).nice(8).domain();
  return Object.freeze({
    side, gpu, delivery, hours, revenue, costs, rate, coverage, basis,
    hedgedHours, exposedHours: hours - hedgedHours,
    headlineProfit: headline.hedged, margin: headline.margin,
    breakEven, domain: Object.freeze(domain), profitAt,
  });
}

function number(value, fallback, minimum, maximum = 1e12) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}
