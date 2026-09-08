export function isComputeSeries(candidate) {
  return candidate.layer?.sourceCardId === "gpu-index";
}

export function comparisonBarOpacity(candidate, { theme = "light", active = false, label = false } = {}) {
  const stronger = candidate.layer?.id === "H100";
  // Keep the same neutral family; separate the series by strength, not hue.
  // Text stays stronger than the bars so the quieter series remains readable.
  if (label) return stronger ? 1 : theme === "dark" ? 0.8 : 0.9;
  const opacity = theme === "dark"
    ? stronger ? 0.84 : 0.42
    : stronger ? 0.9 : 0.48;
  return Math.min(1, opacity + (active ? 0.2 : 0));
}

// A shared date scale and baseline keep the bars directly comparable to the
// stock lines. Gaps stay gaps; each recorded day gets one grouped column.
export function comparisonBarSeries(series, { x, y, baseline = 100, minX = 0, maxX }) {
  const candidates = series.filter(isComputeSeries);
  if (!candidates.length || !(maxX > minX)) return [];
  const positions = [...new Set(candidates.flatMap(candidate => candidate.rows
    .filter(row => Number.isFinite(row.plotValue))
    .map(row => x(row.date)).filter(Number.isFinite)))].sort((a, b) => a - b);
  const steps = positions.slice(1).map((position, index) => position - positions[index]);
  const spacing = steps.length ? Math.min(...steps) : maxX - minX;
  const groupWidth = Math.min(32, spacing * 0.9, maxX - minX);
  const cells = new Map(positions.map((position, index) => [position, {
    left: index ? Math.max(minX, (positions[index - 1] + position) / 2) : minX,
    right: index < positions.length - 1 ? Math.min(maxX, (position + positions[index + 1]) / 2) : maxX,
  }]));
  const zero = y(baseline);
  if (!Number.isFinite(zero)) return [];
  const number = value => Math.round(value * 1000) / 1000;
  return candidates.map((candidate, index) => {
    const bars = candidate.rows.flatMap(row => {
      const position = x(row.date);
      const end = y(row.plotValue);
      if (!Number.isFinite(position) || !Number.isFinite(end) || !Number.isFinite(row.plotValue)) return [];
      const cell = cells.get(position);
      const width = Math.min(groupWidth, Math.max(0, cell.right - cell.left));
      if (!width) return [];
      const slot = width / candidates.length;
      const barWidth = slot * 0.94;
      const center = Math.max(cell.left + width / 2, Math.min(cell.right - width / 2, position));
      return [{
        date: row.date, value: row.plotValue,
        x: center - width / 2 + slot * index + (slot - barWidth) / 2,
        y: Math.min(zero, end), width: barWidth, height: Math.abs(end - zero),
      }];
    });
    const path = bars.filter(bar => bar.height > 0).map(bar =>
      `M${number(bar.x)},${number(bar.y)}h${number(bar.width)}v${number(bar.height)}h${number(-bar.width)}Z`
    ).join("");
    return { candidate, index, path, bars };
  });
}
