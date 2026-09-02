const GPU_PRICE_UNIT = "usd-hour";
const SPREAD_UNIT = "percentage-points";

/**
 * Derives the signed price-change spread between two GPU price series.
 *
 * Both changes are measured from the first timestamp present in both series. A
 * zoom window is applied only after the full overlapping series is derived so
 * zooming never changes the comparison baseline.
 */
export function createGpuSpreadSeries(
  primarySeries,
  comparisonSeries,
  { zoomWindow = null } = {},
) {
  assertGpuPriceSeries(primarySeries, "primary");
  assertGpuPriceSeries(comparisonSeries, "comparison");

  if (primarySeries.layer.id === comparisonSeries.layer.id) {
    throw new TypeError("A GPU spread requires two distinct price series");
  }

  const primaryLabel = layerLabel(primarySeries.layer);
  const comparisonLabel = layerLabel(comparisonSeries.layer);
  const label = `${primaryLabel} − ${comparisonLabel}`;
  const layer = Object.freeze({
    id: `${primarySeries.layer.id}-${comparisonSeries.layer.id}-spread`,
    label,
    shortLabel: label,
    unit: SPREAD_UNIT,
    views: Object.freeze(["spread"]),
  });
  const members = Object.freeze([primarySeries, comparisonSeries]);
  const intersections = intersectRows(primarySeries.rows, comparisonSeries.rows);
  const base = intersections.find(
    ({ primaryValue, comparisonValue }) =>
      primaryValue > 0 && comparisonValue > 0,
  );

  if (!base) {
    return Object.freeze({
      layer,
      primary: true,
      rows: Object.freeze([]),
      members,
      latest: null,
    });
  }

  const derivedRows = intersections
    .filter(({ date }) => date >= base.date)
    .map(({ date, primaryValue, comparisonValue }) => {
      const primaryReturn = (primaryValue / base.primaryValue - 1) * 100;
      const comparisonReturn =
        (comparisonValue / base.comparisonValue - 1) * 100;
      return Object.freeze({
        date,
        plotValue: primaryReturn - comparisonReturn,
        primaryReturn,
        comparisonReturn,
        primaryValue,
        comparisonValue,
      });
    });
  const bounds = zoomBounds(zoomWindow);
  const rows = Object.freeze(
    bounds
      ? derivedRows.filter(
          ({ date }) => date.getTime() >= bounds[0] && date.getTime() <= bounds[1],
        )
      : derivedRows,
  );

  return Object.freeze({
    layer,
    primary: true,
    rows,
    members,
    latest: rows.at(-1) || null,
  });
}

function assertGpuPriceSeries(series, role) {
  if (
    !series?.layer?.id ||
    series.layer.unit !== GPU_PRICE_UNIT ||
    !Array.isArray(series.rows)
  ) {
    throw new TypeError(
      `The ${role} GPU spread member must be a USD per GPU-hour series`,
    );
  }
}

function layerLabel(layer) {
  return layer.shortLabel || layer.label || layer.id;
}

function intersectRows(primaryRows, comparisonRows) {
  const comparisonByTime = new Map();
  for (const row of comparisonRows) {
    const timestamp = rowTimestamp(row);
    const value = Number(row?.value);
    if (
      timestamp !== null &&
      Number.isFinite(value) &&
      !comparisonByTime.has(timestamp)
    ) {
      comparisonByTime.set(timestamp, value);
    }
  }

  const intersections = [];
  const seen = new Set();
  for (const row of primaryRows) {
    const timestamp = rowTimestamp(row);
    const primaryValue = Number(row?.value);
    const comparisonValue = comparisonByTime.get(timestamp);
    if (
      timestamp === null ||
      seen.has(timestamp) ||
      !Number.isFinite(primaryValue) ||
      !Number.isFinite(comparisonValue)
    ) {
      continue;
    }
    seen.add(timestamp);
    intersections.push({
      date: new Date(timestamp),
      primaryValue,
      comparisonValue,
    });
  }

  return intersections.sort((left, right) => left.date - right.date);
}

function rowTimestamp(row) {
  const timestamp = row?.date instanceof Date
    ? row.date.getTime()
    : new Date(row?.date).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function zoomBounds(zoomWindow) {
  if (!Array.isArray(zoomWindow) || zoomWindow.length !== 2) return null;
  const timestamps = zoomWindow.map((value) =>
    value instanceof Date ? value.getTime() : new Date(value).getTime(),
  );
  if (!timestamps.every(Number.isFinite)) return null;
  return timestamps[0] <= timestamps[1]
    ? timestamps
    : [timestamps[1], timestamps[0]];
}
