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

export function spreadLineLabels(entries, minimum, maximum, gap) {
  const positions = entries
    .map((entry) => ({ ...entry, labelY: entry.lineY }))
    .sort((left, right) => left.lineY - right.lineY);
  positions.forEach((entry, index) => {
    entry.labelY = Math.max(
      minimum,
      entry.lineY,
      index ? positions[index - 1].labelY + gap : minimum,
    );
  });
  const overflow = (positions.at(-1)?.labelY ?? maximum) - maximum;
  if (overflow > 0) {
    positions.forEach((entry) => {
      entry.labelY -= overflow;
    });
  }
  for (let index = positions.length - 2; index >= 0; index -= 1) {
    positions[index].labelY = Math.min(
      positions[index].labelY,
      positions[index + 1].labelY - gap,
    );
  }
  const underflow = minimum - (positions[0]?.labelY ?? minimum);
  if (underflow > 0) {
    positions.forEach((entry) => {
      entry.labelY += underflow;
    });
  }
  return positions;
}
