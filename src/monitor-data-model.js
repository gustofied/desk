import { SITE_ORIGIN } from "./card-registry.js";

export function createMonitorDataModel({
  card,
  cardState,
  series = [],
  barModel = null,
  depthModel = null,
}) {
  if (!card?.dataAdapter || !card?.dataTable?.file) return null;

  if (card.dataAdapter === "series") {
    return createPriceHistoryModel(card, cardState, series);
  }
  if (card.dataAdapter === "snapshot") {
    return createPriceSnapshotModel(card, barModel);
  }
  if (card.dataAdapter === "depth") {
    return createMarketDepthDataModel(card, cardState, depthModel);
  }
  return null;
}

function createPriceHistoryModel(card, state, series) {
  const selected = series.filter((candidate) => candidate?.rows?.length);
  if (!selected.length) return null;
  if (state.scale === "spread") {
    return createPriceSpreadModel(card, state, selected);
  }
  const instruments = selected.map(
    (candidate) => candidate.layer.shortLabel || candidate.layer.label,
  );
  const queryInstruments = selected.map((candidate) => candidate.layer.id);
  const rowCount = selected.reduce(
    (total, candidate) => total + candidate.rows.length,
    0,
  );
  const firstDate = new Date(
    Math.min(...selected.map((candidate) => candidate.rows[0].date.getTime())),
  );
  const latestDate = new Date(
    Math.max(...selected.map((candidate) => candidate.rows.at(-1).date.getTime())),
  );
  const endpoint = publicDatasetUrl(card);
  const range = String(state.range).toUpperCase();
  const seriesLabel = instruments.join(" + ");

  return finalizeModel(card, {
    summary: `${seriesLabel} ${range}`,
    breadcrumbs: ["Desk", card.dataTable.label, seriesLabel, range],
    rowCount,
    asOf: latestDate,
    endpoint,
    command: syncCommand(card.dataTable.id, {
      series: instruments,
      range: state.range,
    }),
    sql: state.scale === "index"
      ? priceIndexSql(card, endpoint, queryInstruments, firstDate)
      : priceSql(card, endpoint, queryInstruments, firstDate),
  });
}

function createPriceSpreadModel(card, state, series) {
  const primaryId = state.gpu;
  const requestedLayerIds = Array.isArray(state.layers)
    ? state.layers
    : String(state.layers || "").split(",");
  const gpuLayerIds = requestedLayerIds.filter((layerId) =>
    card.layers.some(
      (layer) => layer.id === layerId && layer.unit === "usd-hour",
    ),
  );
  const comparisonId = gpuLayerIds.find((layerId) => layerId !== primaryId);
  if (!comparisonId || gpuLayerIds.length !== 2) return null;

  const spreadSeries = series.find(
    (candidate) => candidate.members && candidate.rows?.length,
  ) || series[0];
  if (!spreadSeries?.rows?.length) return null;

  const primary = card.layers.find((layer) => layer.id === primaryId);
  const comparison = card.layers.find((layer) => layer.id === comparisonId);
  if (!primary || !comparison) return null;

  const primaryLabel = primary.shortLabel || primary.label;
  const comparisonLabel = comparison.shortLabel || comparison.label;
  const pairLabel = `${primaryLabel} − ${comparisonLabel}`;
  const firstDate = spreadSeries.rows[0].date;
  const latestDate = spreadSeries.rows.at(-1).date;
  const endpoint = publicDatasetUrl(card);
  const range = String(state.range).toUpperCase();

  return finalizeModel(card, {
    summary: `${pairLabel} ${range}`,
    breadcrumbs: ["Desk", card.dataTable.label, pairLabel, range],
    rowCount: spreadSeries.rows.length,
    asOf: latestDate,
    endpoint,
    command: syncCommand(card.dataTable.id, {
      series: [primaryId, comparisonId],
      range: state.range,
    }),
    sql: priceSpreadSql(
      card,
      endpoint,
      primaryId,
      comparisonId,
      firstDate,
    ),
  });
}

function createPriceSnapshotModel(card, model) {
  if (!model?.bars?.length) return null;
  const endpoint = publicDatasetUrl(card);
  const asOf = new Date(model.asOf * 1000);
  const instruments = model.bars.map((bar) => bar.id);
  const acceleratorLabel = model.bars.length === 1 ? "accelerator" : "accelerators";
  return finalizeModel(card, {
    summary: `${model.bars.length} ${acceleratorLabel}`,
    breadcrumbs: ["Desk", card.dataTable.label, "Snapshot"],
    rowCount: model.bars.length,
    asOf,
    endpoint,
    command: syncCommand(card.dataTable.id, { series: instruments }),
    sql: snapshotSql(card, endpoint, instruments),
  });
}

function createMarketDepthDataModel(card, state, model) {
  if (!model?.current) return null;
  const endpoint = publicDatasetUrl(card);
  const history = state.scale === "history";
  const mode = history ? "History" : "Now";
  const asOf = new Date(model.asOf * 1000);

  return finalizeModel(card, {
    summary: `${model.instrument.gpuLabel} ${model.targetNodes} nodes ${mode}`,
    breadcrumbs: [
      "Desk",
      card.dataTable.label,
      `${model.targetNodes} nodes`,
      mode,
    ],
    rowCount: history ? model.history.length : model.current.buckets.length,
    asOf,
    endpoint,
    command: syncCommand(card.dataTable.id, {
      view: history ? "history" : "now",
      target: model.targetNodes,
    }),
    sql: history
      ? depthHistorySql(card, endpoint, model.targetNodes)
      : depthNowSql(card, endpoint),
  });
}

function finalizeModel(card, values) {
  const key = JSON.stringify([
    card.id,
    values.summary,
    values.rowCount,
    values.asOf instanceof Date ? values.asOf.getTime() : values.asOf,
    values.endpoint,
    values.command,
    values.sql,
  ]);
  return Object.freeze({
    key,
    id: card.dataTable.id,
    label: card.dataTable.label,
    summary: values.summary,
    breadcrumbs: Object.freeze([...values.breadcrumbs]),
    rowCount: values.rowCount,
    asOf: values.asOf,
    endpoint: values.endpoint,
    command: values.command,
    sql: values.sql,
  });
}

function publicDatasetUrl(card) {
  return new URL(card.dataTable.file.replace(/^\//, ""), `${SITE_ORIGIN}/`).toString();
}

function syncCommand(dataset, options = {}) {
  const lines = ["desk \\", "  data sync \\", `  ${dataset}`];
  const flags = Object.entries(options)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([name, value]) => {
      const rendered = Array.isArray(value) ? value.join(",") : value;
      return `  --${name}=${rendered}`;
    });
  if (!flags.length) return lines.join("\n");
  lines[lines.length - 1] += " \\";
  return [...lines, ...flags.map((flag, index) => (
    index === flags.length - 1 ? flag : `${flag} \\`
  ))].join("\n");
}

function priceSql(card, url, instruments, firstDate) {
  const table = dataFusionTableName(card);
  return `${dataFusionSource(table, url)}

WITH prices AS (
  SELECT to_timestamp(observed_at) AS observed_at,
         instrument, value, lower, upper
  FROM ${table}
)
SELECT observed_at, instrument,
       value AS price_usd_gpu_hour, lower, upper
FROM prices
WHERE instrument IN (${sqlList(instruments)})
  AND observed_at >= to_timestamp('${formatSqlTimestamp(firstDate)}')
ORDER BY observed_at DESC, instrument;`;
}

function priceIndexSql(card, url, instruments, firstDate) {
  const table = dataFusionTableName(card);
  return `${dataFusionSource(table, url)}

WITH prices AS (
  SELECT to_timestamp(observed_at) AS observed_at,
         instrument, value, lower, upper
  FROM ${table}
  WHERE instrument IN (${sqlList(instruments)})
), indexed AS (
  SELECT *, first_value(value) OVER (
    PARTITION BY instrument ORDER BY observed_at
  ) AS base_value
  FROM prices
  WHERE observed_at >= to_timestamp('${formatSqlTimestamp(firstDate)}')
)
SELECT observed_at, instrument,
       round(100 * value / base_value, 2) AS index,
       round(100 * lower / base_value, 2) AS lower,
       round(100 * upper / base_value, 2) AS upper
FROM indexed
ORDER BY observed_at DESC, instrument;`;
}

function priceSpreadSql(
  card,
  url,
  primaryInstrument,
  comparisonInstrument,
  firstDate,
) {
  const table = dataFusionTableName(card);
  const primary = sqlValue(primaryInstrument);
  const comparison = sqlValue(comparisonInstrument);
  return `${dataFusionSource(table, url)}

WITH prices AS (
  SELECT to_timestamp(observed_at) AS observed_at,
         instrument, value
  FROM ${table}
  WHERE instrument IN (${primary}, ${comparison})
    AND to_timestamp(observed_at) >= to_timestamp('${formatSqlTimestamp(firstDate)}')
), paired AS (
  SELECT primary_price.observed_at,
         primary_price.value AS primary_value,
         comparison_price.value AS comparison_value
  FROM prices AS primary_price
  INNER JOIN prices AS comparison_price
    ON primary_price.observed_at = comparison_price.observed_at
  WHERE primary_price.instrument = ${primary}
    AND comparison_price.instrument = ${comparison}
), based AS (
  SELECT *,
         first_value(primary_value) OVER (
           ORDER BY observed_at
         ) AS primary_base,
         first_value(comparison_value) OVER (
           ORDER BY observed_at
         ) AS comparison_base
  FROM paired
)
SELECT observed_at,
       ${primary} AS primary_instrument,
       ${comparison} AS comparison_instrument,
       primary_value AS primary_price_usd_gpu_hour,
       comparison_value AS comparison_price_usd_gpu_hour,
       round(100 * (primary_value / nullif(primary_base, 0) - 1), 2)
         AS primary_return_pct,
       round(100 * (comparison_value / nullif(comparison_base, 0) - 1), 2)
         AS comparison_return_pct,
       round(100 * (
         primary_value / nullif(primary_base, 0) -
         comparison_value / nullif(comparison_base, 0)
       ), 2) AS return_spread_points
FROM based
ORDER BY observed_at DESC;`;
}

function snapshotSql(card, url, instruments) {
  const table = dataFusionTableName(card);
  return `${dataFusionSource(table, url)}

SELECT instrument,
       value AS price_usd_gpu_hour, lower, upper,
       to_timestamp(observed_at) AS observed_at
FROM ${table}
WHERE instrument IN (${sqlList(instruments)})
ORDER BY value DESC;`;
}

function depthNowSql(card, url) {
  const table = dataFusionTableName(card);
  return `${dataFusionSource(table, url)}

WITH depth AS (
  SELECT to_timestamp(observed_at) AS observed_at,
         price_usd_gpu_hour,
         incremental_nodes,
         cumulative_nodes
  FROM ${table}
)
SELECT price_usd_gpu_hour,
       incremental_nodes, cumulative_nodes
FROM depth
WHERE observed_at = (
  SELECT max(observed_at) FROM depth
)
ORDER BY price_usd_gpu_hour;`;
}

function depthHistorySql(card, url, targetNodes) {
  const table = dataFusionTableName(card);
  return `${dataFusionSource(table, url)}

WITH depth AS (
  SELECT to_timestamp(observed_at) AS observed_at,
         benchmark_price_usd_gpu_hour,
         price_usd_gpu_hour,
         cumulative_nodes,
         provider_count,
         offer_count
  FROM ${table}
)
SELECT observed_at,
       max(benchmark_price_usd_gpu_hour) AS benchmark_price,
       max(cumulative_nodes) FILTER (
         WHERE price_usd_gpu_hour <= benchmark_price_usd_gpu_hour
       ) AS capacity_at_reference,
       min(price_usd_gpu_hour) FILTER (
         WHERE cumulative_nodes >= ${targetNodes}
       ) AS clearing_price,
       max(provider_count) AS providers,
       max(offer_count) AS offers
FROM depth
GROUP BY observed_at
ORDER BY observed_at DESC;`;
}

function dataFusionSource(table, url) {
  return `CREATE EXTERNAL TABLE IF NOT EXISTS ${table}
STORED AS JSON
OPTIONS ('format.newline_delimited' 'false')
LOCATION '${url}';`;
}

function dataFusionTableName(card) {
  return `desk_${card.dataTable.id.replaceAll("-", "_")}`;
}

function sqlList(values) {
  return values.map(sqlValue).join(", ");
}

function sqlValue(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function formatSqlTimestamp(date) {
  return date.toISOString();
}
