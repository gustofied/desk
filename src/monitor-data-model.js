import { SITE_ORIGIN } from "./card-registry.js";

const MAX_PREVIEW_ROWS = 8;

export function createMonitorDataModel({
  card,
  cardState,
  series = [],
  barModel = null,
  depthModel = null,
  dealModel = null,
}) {
  if (!card?.dataAdapter || !card?.dataTable) return null;

  if (card.dataAdapter === "series") {
    return createPriceHistoryModel(card, cardState, series);
  }
  if (card.dataAdapter === "snapshot") {
    return createPriceSnapshotModel(card, barModel);
  }
  if (card.dataAdapter === "depth") {
    return createMarketDepthDataModel(card, cardState, depthModel);
  }
  if (card.dataAdapter === "deal") {
    return createDealDataModel(card, dealModel);
  }
  return null;
}

function createPriceHistoryModel(card, state, series) {
  const selected = series.filter((candidate) => candidate?.rows?.length);
  if (!selected.length) return null;
  const indexed = state.scale === "index";
  const rows = selected
    .flatMap((candidate) =>
      candidate.rows.map((row) => ({
        sort: row.date.getTime(),
        values: {
          observed_at: formatTableTime(row.date),
          instrument: candidate.layer.shortLabel || candidate.layer.label,
          value: indexed
            ? formatIndex(row.plotValue)
            : formatUsd(row.value),
          lower: indexed
            ? formatIndex(row.plotLower)
            : formatUsd(row.lower),
          upper: indexed
            ? formatIndex(row.plotUpper)
            : formatUsd(row.upper),
        },
      })),
    )
    .sort((left, right) => right.sort - left.sort)
    .slice(0, MAX_PREVIEW_ROWS)
    .map((row) => row.values);
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

  return finalizeModel(card, {
    summary: `${instruments.join(" + ")} ${String(state.range).toUpperCase()}`,
    rowCount,
    asOf: latestDate,
    columns: [
      column("observed_at", "Time"),
      column("instrument", "Series"),
      column("value", indexed ? "Index" : "Price", "numeric"),
      column("lower", "Low", "numeric"),
      column("upper", "High", "numeric"),
    ],
    rows,
    curl: downloadCommand(endpoint),
    sql: indexed
      ? priceIndexSql(endpoint, queryInstruments, firstDate)
      : priceSql(endpoint, queryInstruments, firstDate),
  });
}

function createPriceSnapshotModel(card, model) {
  if (!model?.bars?.length) return null;
  const endpoint = publicDatasetUrl(card);
  const asOf = new Date(model.asOf * 1000);
  const acceleratorCount = model.bars.length;
  return finalizeModel(card, {
    summary: `${acceleratorCount} ${acceleratorCount === 1 ? "accelerator" : "accelerators"}`,
    rowCount: acceleratorCount,
    asOf,
    columns: [
      column("instrument", "GPU"),
      column("value", "Price", "numeric"),
      column("lower", "Low", "numeric"),
      column("upper", "High", "numeric"),
    ],
    rows: model.bars.map((bar) => ({
      instrument: bar.label,
      value: formatUsd(bar.value),
      lower: formatUsd(bar.lower),
      upper: formatUsd(bar.upper),
    })),
    curl: downloadCommand(endpoint),
    sql: snapshotSql(endpoint),
  });
}

function createMarketDepthDataModel(card, state, model) {
  if (!model?.current) return null;
  const endpoint = publicDatasetUrl(card);
  const history = state.scale === "history";
  const current = model.current;
  const asOf = new Date(model.asOf * 1000);

  if (history) {
    return finalizeModel(card, {
      summary: `${model.instrument.gpuLabel} ${model.targetNodes} nodes History`,
      rowCount: model.history.length,
      asOf,
      columns: [
        column("observed_at", "Date"),
        column("benchmark", "Reference", "numeric"),
        column("available", "At ref", "numeric"),
        column("clearing", "Clearing", "numeric"),
        column("providers", "Providers", "numeric"),
        column("offers", "Offers", "numeric"),
      ],
      rows: model.history
        .slice(-MAX_PREVIEW_ROWS)
        .reverse()
        .map((snapshot) => ({
          observed_at: formatTableDate(new Date(snapshot.timestamp * 1000)),
          benchmark: formatUsd(snapshot.benchmarkPrice),
          available: formatInteger(snapshot.capacityAtBenchmark),
          clearing: snapshot.clearingPrice === null
            ? `>${formatUsd(model.priceDomain[1])}`
            : formatUsd(snapshot.clearingPrice),
          providers: formatInteger(snapshot.providerCount),
          offers: formatInteger(snapshot.offerCount),
        })),
      curl: downloadCommand(endpoint),
      sql: depthHistorySql(endpoint, model.targetNodes),
    });
  }

  return finalizeModel(card, {
    summary: `${model.instrument.gpuLabel} ${model.targetNodes} nodes Now`,
    rowCount: current.buckets.length,
    asOf,
    columns: [
      column("price", "Price", "numeric"),
      column("added", "Added", "numeric"),
      column("available", "Available", "numeric"),
    ],
    rows: current.buckets.map((bucket) => ({
      price: formatUsd(bucket.price),
      added: formatInteger(bucket.incrementalNodes),
      available: formatInteger(bucket.cumulativeNodes),
    })),
    curl: downloadCommand(endpoint),
    sql: depthNowSql(endpoint),
  });
}

function createDealDataModel(card, model) {
  if (!model) return null;
  return finalizeModel(card, {
    summary: `${model.label} ${model.asset}`,
    rowCount: 1,
    asOf: null,
    columns: [
      column("asset", "GPU"),
      column("quantity", "GPUs", "numeric"),
      column("nodes", "Nodes", "numeric"),
      column("quote", "Quote", "numeric"),
      column("stage", "Stage"),
      column("rfs", "RFS"),
    ],
    rows: [{
      asset: model.asset,
      quantity: formatInteger(model.quantity),
      nodes: formatInteger(model.nodes),
      quote: model.quote.formatted,
      stage: model.stages.find((stage) => stage.id === model.activeStage)?.label ||
        model.activeStage,
      rfs: model.rfs,
    }],
  });
}

function finalizeModel(card, values) {
  const modes = card.dataTable.modes || ["rows"];
  const key = JSON.stringify([
    card.id,
    values.summary,
    values.rowCount,
    values.asOf instanceof Date ? values.asOf.getTime() : values.asOf,
    values.columns,
    values.rows,
    values.curl,
    values.sql,
  ]);
  return Object.freeze({
    key,
    id: card.dataTable.id,
    label: card.dataTable.label,
    modes: Object.freeze([...modes]),
    summary: values.summary,
    rowCount: values.rowCount,
    asOf: values.asOf,
    columns: Object.freeze(values.columns),
    rows: Object.freeze(values.rows.map((row) => Object.freeze(row))),
    curl: values.curl || "",
    sql: values.sql || "",
  });
}

function column(key, label, align = "text") {
  return Object.freeze({ key, label, align });
}

function publicDatasetUrl(card) {
  return new URL(card.dataTable.file.replace(/^\//, ""), `${SITE_ORIGIN}/`).toString();
}

function downloadCommand(url) {
  const fileName = new URL(url).pathname.split("/").at(-1);
  return [
    "curl -fsSL \\",
    `  ${url} \\`,
    `  -o ${fileName}`,
  ].join("\n");
}

function priceSql(url, instruments, firstDate) {
  return `${sqlPrelude()}

WITH prices AS (
  SELECT cast(observed_at AS TIMESTAMPTZ) AS observed_at,
         instrument, value, lower, upper
  FROM read_json_auto('${url}')
)
SELECT observed_at, instrument,
       value AS price_usd_gpu_hour, lower, upper
FROM prices
WHERE instrument IN (${sqlList(instruments)})
  AND observed_at >= TIMESTAMPTZ '${formatSqlTimestamp(firstDate)}'
ORDER BY observed_at DESC, instrument;`;
}

function priceIndexSql(url, instruments, firstDate) {
  return `${sqlPrelude()}

WITH prices AS (
  SELECT cast(observed_at AS TIMESTAMPTZ) AS observed_at,
         instrument, value, lower, upper
  FROM read_json_auto('${url}')
  WHERE instrument IN (${sqlList(instruments)})
    AND cast(observed_at AS TIMESTAMPTZ) >=
        TIMESTAMPTZ '${formatSqlTimestamp(firstDate)}'
), indexed AS (
  SELECT *, first_value(value) OVER (
    PARTITION BY instrument ORDER BY observed_at
  ) AS base_value
  FROM prices
)
SELECT observed_at, instrument,
       round(100 * value / base_value, 2) AS index,
       round(100 * lower / base_value, 2) AS lower,
       round(100 * upper / base_value, 2) AS upper
FROM indexed
ORDER BY observed_at DESC, instrument;`;
}

function snapshotSql(url) {
  return `${sqlPrelude()}

SELECT instrument,
       value AS price_usd_gpu_hour, lower, upper, observed_at
FROM read_json_auto('${url}')
ORDER BY value DESC;`;
}

function depthNowSql(url) {
  return `${sqlPrelude()}

WITH depth AS (
  SELECT cast(observed_at AS TIMESTAMPTZ) AS observed_at,
         price_usd_gpu_hour,
         incremental_nodes,
         cumulative_nodes
  FROM read_json_auto('${url}')
)
SELECT price_usd_gpu_hour,
       incremental_nodes, cumulative_nodes
FROM depth
WHERE observed_at = (
  SELECT max(observed_at) FROM depth
)
ORDER BY price_usd_gpu_hour;`;
}

function depthHistorySql(url, targetNodes) {
  return `${sqlPrelude()}

WITH depth AS (
  SELECT cast(observed_at AS TIMESTAMPTZ) AS observed_at,
         benchmark_price_usd_gpu_hour,
         price_usd_gpu_hour,
         cumulative_nodes,
         provider_count,
         offer_count
  FROM read_json_auto('${url}')
)
SELECT observed_at,
       any_value(benchmark_price_usd_gpu_hour) AS benchmark_price,
       max(cumulative_nodes) FILTER (
         WHERE price_usd_gpu_hour <= benchmark_price_usd_gpu_hour
       ) AS capacity_at_reference,
       min(price_usd_gpu_hour) FILTER (
         WHERE cumulative_nodes >= ${targetNodes}
       ) AS clearing_price,
       any_value(provider_count) AS providers,
       any_value(offer_count) AS offers
FROM depth
GROUP BY observed_at
ORDER BY observed_at DESC;`;
}

function sqlPrelude() {
  return "INSTALL httpfs;\nLOAD httpfs;";
}

function sqlList(values) {
  return values.map((value) => `'${String(value).replaceAll("'", "''")}'`).join(", ");
}

function formatSqlTimestamp(date) {
  return date.toISOString();
}

function formatTableTime(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.day} ${values.month} ${values.hour}:${values.minute}`;
}

function formatTableDate(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
    year: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.day} ${values.month} ${values.year}`;
}

function formatUsd(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  if (number < 1) return `$${number.toFixed(3)}`;
  if (number < 10) return `$${number.toFixed(2)}`;
  return `$${number.toFixed(1)}`;
}

function formatIndex(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : "—";
}

function formatInteger(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(number)
    : "—";
}
