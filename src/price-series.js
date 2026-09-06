// Keep independently sourced price histories isolated, including their clocks.
// A newer equities close must never change a GPU chart's visible date range.
export function createPriceSeriesIndex(payloads, definitions) {
  const index = new Map();
  for (const definition of definitions) {
    const sourceId = definition.sourceCardId || definition.id;
    if (index.has(sourceId)) continue;
    const payload = payloads.get(sourceId);
    if (!payload?.series || Array.isArray(payload.series)) continue;
    const layers = new Map(Object.entries(payload.series).map(([layerId, points]) => [
      layerId, normalizePricePoints(points, layerId),
    ]));
    const end = Math.max(...Array.from(layers.values()).map(rows => +rows.at(-1)?.date || 0));
    index.set(sourceId, { layers, end });
  }
  return index;
}

export function normalizePricePoints(points, layerId) {
  if (!Array.isArray(points)) return [];
  const byDate = new Map();
  for (const point of points) {
    if (!Array.isArray(point) || point[0] == null || point[1] == null) continue;
    const timestamp = Number(point[0]);
    const value = Number(point[1]);
    const date = new Date(timestamp * 1000);
    if (!Number.isFinite(value) || !Number.isFinite(timestamp) || Number.isNaN(+date)) continue;
    const lower = point[2] == null ? value : Number(point[2]);
    const upper = point[3] == null ? value : Number(point[3]);
    byDate.set(timestamp, {
      layerId, date, value,
      lower: Number.isFinite(lower) ? lower : value,
      upper: Number.isFinite(upper) ? upper : value,
    });
  }
  return Array.from(byDate.values()).sort((left, right) => left.date - right.date);
}

export function priceRowsForRange(index, definition, layerId, milliseconds) {
  const source = index.get(definition.sourceCardId || definition.id);
  const rows = source?.layers.get(layerId) || [];
  if (!milliseconds || !rows.length) return rows;
  return rows.filter(row => +row.date >= source.end - milliseconds);
}

// Comparing returns requires a shared starting session, not a different IPO or
// suspended-trading date for each line. Intersect dates; never fill missing closes.
export function alignIndexedPriceSeries(series) {
  if (series.length < 2) return series;
  let dates = new Set(series[0].rows.map(row => +row.date));
  for (const candidate of series.slice(1)) {
    const available = new Set(candidate.rows.map(row => +row.date));
    dates = new Set([...dates].filter(date => available.has(date)));
  }
  if (!dates.size) return [];
  return series.map(candidate => {
    const rows = candidate.rows.filter(row => dates.has(+row.date));
    const base = rows[0].value;
    return { ...candidate, rows: rows.map(row => ({
      ...row,
      plotValue: row.value / base * 100,
      plotLower: row.lower / base * 100,
      plotUpper: row.upper / base * 100,
    })) };
  });
}
