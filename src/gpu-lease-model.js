const DEFAULTS = Object.freeze({ cost: 100000000, term: 36, apr: 10, residual: 30000000 });

// Equal end-of-month payments plus the sale at the end of the final month.
// Inputs describe one lease; they do not select a market-price feed.
export function createGpuLeaseModel(payload, state = {}) {
  const cost = number(state.cost, DEFAULTS.cost, 1, 1e12);
  const term = Math.round(number(state.term, DEFAULTS.term, 1, 120));
  const apr = number(state.apr, DEFAULTS.apr, 0, 100);
  const residual = number(state.residual, Math.min(DEFAULTS.residual, cost), 0, cost);
  const monthlyRate = apr / 1200;
  const annuity = monthlyRate > 0
    ? -Math.expm1(-term * Math.log1p(monthlyRate)) / monthlyRate
    : term;

  // This form avoids subtracting nearly equal discounted amounts when the
  // residual equals the equipment cost or the interest rate approaches zero.
  const monthlyPayment = (cost - residual) / annuity + residual * monthlyRate;
  const paymentWithoutResidual = cost / annuity;
  const totalPayments = monthlyPayment * term;
  const totalReceipts = totalPayments + residual;

  return Object.freeze({
    cost, term, apr, residual,
    monthlyPayment, totalPayments, totalReceipts,
    // The squares divide nominal receipts, not the original equipment cost.
    residualShare: residual / totalReceipts * 100,
    residualPercent: residual / cost * 100,
    financingCost: Math.max(0, totalReceipts - cost),
    paymentWithoutResidual,
    monthlySaving: Math.max(0, paymentWithoutResidual - monthlyPayment),
  });
}

function number(value, fallback, minimum, maximum) {
  const parsed = typeof value === 'number' ? value
    : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}
