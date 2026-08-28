export const INDEX_BASELINE = 100;

export function chartYDomain(values, { scale = "price" } = {}) {
  const finiteValues = values.filter(Number.isFinite);
  if (scale === "index") finiteValues.push(INDEX_BASELINE);
  if (!finiteValues.length) {
    return scale === "index" ? [99, 101] : [0, 1];
  }

  const minimum = Math.min(...finiteValues);
  const maximum = Math.max(...finiteValues);
  const magnitude = Math.max(Math.abs(minimum), Math.abs(maximum), 1);
  const minimumSpread = scale === "index" ? 0.5 : 0.08;
  const spread = Math.max(maximum - minimum, magnitude * 0.02, minimumSpread);
  const padding = spread * (scale === "index" ? 0.08 : 0.12);
  const lower = minimum - padding;

  return [scale === "price" ? Math.max(0, lower) : lower, maximum + padding];
}

export function comparisonStrokeOpacity(theme = "light") {
  return theme === "dark" ? 0.4 : 0.65;
}
