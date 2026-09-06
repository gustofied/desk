const DAY_MS = 24 * 60 * 60 * 1000;

export function hasCrossMarketLayers(definition, layerIds) {
  if (!Array.isArray(definition?.layers) || !Array.isArray(layerIds)) return false;
  const selected = new Set(layerIds);
  return definition.layers.some(layer => selected.has(layer.id) &&
    layer.sourceCardId && layer.sourceCardId !== definition.id);
}

// Compare recorded daily observations, never hourly samples against daily closes.
// Every selected market shares its calendar, range endpoint and return baseline.
export function createCrossMarketSeries(index, definition, normalized, {
  milliseconds = null, zoomWindow = null,
} = {}) {
  if (!(index instanceof Map) || !Array.isArray(definition?.layers) ||
      !normalized?.gpu || !Array.isArray(normalized.layers)) return [];
  if (milliseconds !== null && (!Number.isFinite(milliseconds) || milliseconds < 0)) return [];

  const layerIds = [...new Set([normalized.gpu, ...normalized.layers])];
  const candidates = [];
  for (const layerId of layerIds) {
    const layer = definition.layers.find(candidate => candidate.id === layerId);
    if (!layer) return [];
    const sourceId = layer.sourceCardId || definition.sourceCardId || definition.id;
    const sourceRows = index.get(sourceId)?.layers?.get(layerId);
    const daily = latestDailyObservations(sourceRows);
    if (!daily?.size) return [];
    candidates.push({ layer, primary: layerId === normalized.gpu, daily });
  }

  const dates = [...candidates[0].daily.keys()]
    .filter(date => candidates.every(candidate => candidate.daily.has(date)))
    .sort((left, right) => left - right);
  if (dates.length < 2) return [];
  const commonEnd = dates.at(-1);
  const rangeDates = milliseconds
    ? dates.filter(date => date >= commonEnd - milliseconds)
    : dates;
  if (rangeDates.length < 2) return [];

  let visibleDates = rangeDates;
  if (zoomWindow !== null) {
    if (!Array.isArray(zoomWindow) || zoomWindow.length !== 2) return [];
    const [start, end] = zoomWindow.map(value => +value);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return [];
    visibleDates = rangeDates.filter(date => date >= start && date <= end);
    if (visibleDates.length < 2) return [];
  }

  const result = candidates.map(({ layer, primary, daily }) => {
    const base = daily.get(rangeDates[0]).value;
    return {
      layer, primary,
      rows: visibleDates.map(date => {
        const observed = daily.get(date);
        const plotValue = observed.value / base * 100;
        return {
          ...observed,
          observedAt: new Date(+observed.date),
          date: new Date(date),
          plotValue,
          plotLower: plotValue,
          plotUpper: plotValue,
        };
      }),
    };
  });
  return result.every(candidate => candidate.rows.every(row => Number.isFinite(row.plotValue)))
    ? result : [];
}

function latestDailyObservations(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const daily = new Map();
  for (const row of rows) {
    if (!(row?.date instanceof Date) || !Number.isFinite(+row.date) ||
        !Number.isFinite(row.value) || row.value <= 0) return null;
    const date = Math.floor(+row.date / DAY_MS) * DAY_MS;
    const previous = daily.get(date);
    if (!previous || +row.date >= +previous.date) daily.set(date, row);
  }
  return daily;
}
