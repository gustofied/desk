import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { availableParallelism } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as d3 from "d3";
import {
  getCardDefinition,
  normalizeCardState,
  PALETTES,
  PUBLISHED_CARD_VERSION,
  publishedCardPreviewPath,
  publishedCardSharePath,
  RANGES,
  SITE_ORIGIN,
  THEMES,
} from "../src/card-registry.js";
import { shareRangeLabel } from "../src/share-range-label.js";
import {
  chartYDomain,
  comparisonStrokeOpacity,
  INDEX_BASELINE,
  spreadLineLabels,
} from "../src/chart-domain.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(join(root, ".cache", "fontconfig"), { recursive: true });
process.env.FONTCONFIG_FILE = join(root, "scripts", "fontconfig.xml");
const { default: sharp } = await import("sharp");
const cardDefinition = getCardDefinition("gpu-index");
const gpuLayers = cardDefinition.layers.filter(
  (layer) => layer.unit === "usd-hour",
);
const palettes = Object.fromEntries(
  PALETTES.map((palette) => [palette.id, palette.accent]),
);
const imageRoot = join(root, cardDefinition.previewImageDir);
const pageRoot = join(root, cardDefinition.previewPageDir);
const manifestPath = join(root, ".cache", "generated-card-files.json");
const runtimeData = JSON.parse(
  await readFile(join(root, cardDefinition.dataFile), "utf8"),
);
const generatedFiles = [];
const workerCount = Math.max(
  1,
  Math.min(8, typeof availableParallelism === "function" ? availableParallelism() : 4),
);

const seriesByLayer = new Map(
  cardDefinition.layers.map((layer) => [
    layer.id,
    (runtimeData.series?.[layer.id] || []).map((point) => ({
      date: new Date(Number(point[0]) * 1000),
      value: Number(point[1]),
    })),
  ]),
);
const cards = gpuLayers.map((layer) => ({
  family: layer.id,
  rows: seriesByLayer.get(layer.id) || [],
}));
const latestDate = new Date(
  Math.max(
    ...Array.from(seriesByLayer.values()).flatMap((rows) =>
      rows.map((row) => row.date.getTime()),
    ),
  ),
);

await installWebFonts();
await generateLegacyPreviews();
const publishedCount = await generatePublishedPreviews();
await generateDefaultPreview();

generatedFiles.sort();
await retireOldGeneratedFiles(generatedFiles);
await Promise.all([
  pruneEmptyDirectories(imageRoot),
  pruneEmptyDirectories(pageRoot),
]);
await mkdir(dirname(manifestPath), { recursive: true });
await writeFile(
  manifestPath,
  `${JSON.stringify({ revision: runtimeData.revision, files: generatedFiles }, null, 2)}\n`,
  "utf8",
);

console.log(
  `Built ${publishedCount} exact card previews with ${workerCount} workers.`,
);

async function installWebFonts() {
  const packageFontRoot = join(root, "node_modules", "geist", "dist", "fonts");
  const publicFontRoot = join(root, "assets", "fonts");
  await mkdir(publicFontRoot, { recursive: true });
  await Promise.all([
    copyFile(
      join(packageFontRoot, "geist-sans", "Geist-Variable.woff2"),
      join(publicFontRoot, "Geist-Variable.woff2"),
    ),
    copyFile(
      join(packageFontRoot, "geist-mono", "GeistMono-Variable.woff2"),
      join(publicFontRoot, "GeistMono-Variable.woff2"),
    ),
  ]);
}

async function generateLegacyPreviews() {
  for (const card of cards) {
    for (const [rangeId, range] of Object.entries(RANGES)) {
      const rows = rowsForRange(card.rows, rangeId);
      const latest = card.rows.at(-1);
      if (!rows.length || !latest) continue;

      for (const [paletteId, accent] of Object.entries(palettes)) {
        for (const theme of THEMES) {
          const imagePath = join(
            imageRoot,
            card.family.toLowerCase(),
            rangeId,
            `${paletteId}-${theme}.png`,
          );
          const pagePath = join(
            pageRoot,
            card.family.toLowerCase(),
            rangeId,
            paletteId,
            theme,
            "index.html",
          );
          await mkdir(dirname(imagePath), { recursive: true });
          await mkdir(dirname(pagePath), { recursive: true });
          const previewImage = await encodeLegacyPreview(
            renderLegacyCardImage(
              card.family,
              range,
              rows,
              latest,
              accent,
              theme,
            ),
          );
          const previewRevision = imageRevision(previewImage);
          await writeFile(imagePath, previewImage);
          await writeFile(
            pagePath,
            renderLegacySharePage(
              card.family,
              rangeId,
              range,
              latest,
              paletteId,
              theme,
              previewRevision,
            ),
            "utf8",
          );
          track(imagePath, pagePath);
        }
      }
    }
  }
}

async function generatePublishedPreviews() {
  const states = publishedStates();
  await runWithConcurrency(states, workerCount, async (state) => {
    const model = previewModel(state);
    const pageHref = publishedCardSharePath(
      cardDefinition.id,
      state,
    );
    const imageHref = publishedCardPreviewPath(
      cardDefinition.id,
      state,
      runtimeData.revision,
    );
    const pagePath = join(root, pageHref, "index.html");
    const imagePath = join(root, imageHref);
    const previewImage = await encodePreview(renderPublishedCardImage(model));
    const previewRevision = imageRevision(previewImage);

    await mkdir(dirname(imagePath), { recursive: true });
    await mkdir(dirname(pagePath), { recursive: true });
    await Promise.all([
      writeFile(imagePath, previewImage),
      writeFile(
        pagePath,
        renderPublishedSharePage(
          model,
          pageHref,
          imageHref,
          previewRevision,
        ),
        "utf8",
      ),
    ]);
    track(imagePath, pagePath);
  });

  return states.length;
}

async function generateDefaultPreview() {
  const deskPreviewPath = join(imageRoot, "desk-comparison.png");
  await mkdir(dirname(deskPreviewPath), { recursive: true });
  await writeFile(
    deskPreviewPath,
    await encodeLegacyPreview(renderDefaultComparisonImage()),
  );
  track(deskPreviewPath);
}

function publishedStates() {
  const statesByPath = new Map();
  for (const primary of gpuLayers) {
    for (const visualization of cardDefinition.visualizations) {
      const scale = visualization.id;
      if (!primary.views.includes(scale)) continue;
      const optionalLayers = cardDefinition.layers.filter(
        (layer) =>
          layer.id !== primary.id &&
          layer.views.includes(scale),
      );
      for (let mask = 0; mask < 2 ** optionalLayers.length; mask += 1) {
        const layers = [
          primary.id,
          ...optionalLayers
            .filter((_, index) => mask & (1 << index))
            .map((layer) => layer.id),
        ];
        for (const range of Object.keys(RANGES)) {
          for (const palette of Object.keys(palettes)) {
            for (const theme of THEMES) {
              const state = normalizeCardState(cardDefinition.id, {
                gpu: primary.id,
                layers,
                scale,
                range,
                palette,
                theme,
              });
              const pageHref = publishedCardSharePath(
                cardDefinition.id,
                state,
              );
              if (statesByPath.has(pageHref)) {
                throw new Error(`Duplicate published card route: ${pageHref}`);
              }
              statesByPath.set(pageHref, state);
            }
          }
        }
      }
    }
  }
  return Array.from(statesByPath.values());
}

function previewModel(state) {
  const normalized = normalizeCardState(cardDefinition.id, state);
  const series = normalized.layers.map((layerId) => {
    const layer = cardDefinition.layers.find((item) => item.id === layerId);
    const sourceRows = rowsForRange(seriesByLayer.get(layerId) || [], normalized.range);
    if (!layer || !sourceRows.length) {
      throw new Error(`Missing preview data for ${layerId} ${normalized.range}`);
    }
    const baseValue = sourceRows[0].value || 1;
    return {
      layer,
      primary: layerId === normalized.gpu,
      rows: sourceRows.map((row) => ({
        ...row,
        plotValue:
          normalized.scale === "index"
            ? (row.value / baseValue) * 100
            : row.value,
      })),
    };
  });
  const primary =
    series.find((candidate) => candidate.primary) || series[0];
  const latest = primary?.rows.at(-1);
  if (!primary || !latest) {
    throw new Error(`Missing primary preview data for ${normalized.gpu}`);
  }

  return {
    ...normalized,
    colors: themeColors(palettes[normalized.palette], normalized.theme),
    series,
    primary,
    headline:
      normalized.scale === "index"
        ? formatIndexChange(latest.plotValue)
        : formatUsd(latest.plotValue),
    primaryTitle: primary.layer.shortLabel || primary.layer.label,
    comparisonTitle: series
      .filter((candidate) => !candidate.primary)
      .map(({ layer }) => layer.shortLabel || layer.label)
      .join(", "),
    rangeLabel: shareRangeLabel(primary.rows, normalized.range),
  };
}

function renderPublishedCardImage(model) {
  const hasComparisons = model.comparisonTitle.length > 0;
  const chart = {
    x: 0,
    y: 174,
    width: hasComparisons ? 1040 : 1200,
    height: 430,
  };
  const allRows = model.series.flatMap((candidate) => candidate.rows);
  const { line, area, baselineY, y } = layeredChartPaths(
    allRows,
    model.primary.rows,
    chart,
    model.scale,
  );
  const layerMarkup = [...model.series]
    .sort((left, right) => Number(left.primary) - Number(right.primary))
    .map((candidate) => {
      const strokeWidth = candidate.primary ? 3.5 : 2;
      const strokeOpacity = candidate.primary
        ? 1
        : comparisonStrokeOpacity(model.theme);
      const dash = candidate.primary
        ? ""
        : candidate.layer.strokeDasharray || "";
      const underlay = candidate.primary
        ? `<path d="${line(candidate.rows)}" fill="none" stroke="${model.colors.paper}" stroke-opacity="0.94" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round"/>`
        : "";
      const color = candidate.primary ? model.colors.line : model.colors.secondary;
      return `${underlay}<path d="${line(candidate.rows)}" fill="none" stroke="${color}" stroke-opacity="${strokeOpacity}" stroke-width="${strokeWidth}" stroke-dasharray="${dash}" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join("");
  const areaMarkup =
    model.scale === "index" || model.series.length === 1
      ? `<path d="${area}" fill="${model.colors.secondary}" fill-opacity="${model.scale === "index" ? "0.09" : "0.055"}"/>`
      : "";
  const baselineMarkup =
    model.scale === "index"
      ? `<line x1="${chart.x}" x2="${chart.x + chart.width}" y1="${baselineY}" y2="${baselineY}" stroke="${model.colors.line}" stroke-opacity="0.12" stroke-width="1" stroke-dasharray="2 8"/>`
      : "";
  const endpointLabels = hasComparisons
    ? endpointLabelMarkup(model.series, model.colors, chart, y)
    : "";

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
      <rect width="1200" height="630" fill="${model.colors.paper}"/>
      <text x="40" y="54" fill="${model.colors.line}" font-family="Geist, Avenir Next, sans-serif" font-size="34" font-weight="600" letter-spacing="0.25">${escapeXml(model.primaryTitle)}</text>
      <text x="1160" y="54" fill="${model.colors.line}" font-family="Geist Mono, monospace" font-size="32" font-weight="600" text-anchor="end" letter-spacing="1">${escapeXml(model.rangeLabel)}</text>
      <text x="40" y="138" fill="${model.colors.line}" font-family="Geist, Avenir Next, sans-serif" font-size="82" font-weight="500" letter-spacing="-2">${escapeXml(model.headline)}</text>
      ${areaMarkup}
      ${baselineMarkup}
      ${layerMarkup}
      ${endpointLabels}
    </svg>`;
}

function renderPublishedSharePage(
  model,
  pageHref,
  imageHref,
  previewRevision,
) {
  const pageUrl = `${SITE_ORIGIN}${pageHref}?v=${PUBLISHED_CARD_VERSION}-${runtimeData.revision}`;
  const imageUrl = `${SITE_ORIGIN}${imageHref}?v=${previewRevision}`;
  const rangeDescription = RANGES[model.range]?.longLabel || model.range;
  const cardTitle = model.comparisonTitle
    ? `${model.primaryTitle} with ${model.comparisonTitle}`
    : model.primaryTitle;
  const title = `${cardTitle} ${model.rangeLabel}`;
  const description =
    model.scale === "index"
      ? `${model.primaryTitle} ${model.headline} over ${rangeDescription}`
      : `${model.headline} per GPU hour over ${rangeDescription}`;
  const imageAlt = `${cardTitle} card showing ${description}`;
  const destinationParams = new URLSearchParams({
    card: cardDefinition.id,
    view: "card",
    gpu: model.gpu,
    layers: model.layers.join(","),
    scale: model.scale,
    range: model.range,
    palette: model.palette,
    theme: model.theme,
  });
  const destination = `/?${destinationParams.toString()}#${cardDefinition.hash}`;
  const destinationHref = escapeHtml(destination);
  const redirectScript = JSON.stringify(destination).replaceAll("<", "\\u003c");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="${escapeHtml(description)}">
    <meta name="theme-color" content="${model.colors.paper}">
    <link rel="canonical" href="${pageUrl}">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Desk">
    <meta property="og:url" content="${pageUrl}">
    <meta property="og:image" content="${imageUrl}">
    <meta property="og:image:secure_url" content="${imageUrl}">
    <meta property="og:image:type" content="image/png">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="${escapeHtml(imageAlt)}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(title)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    <meta name="twitter:image" content="${imageUrl}">
    <meta name="twitter:image:alt" content="${escapeHtml(imageAlt)}">
    <title>${escapeHtml(title)} | Desk</title>
    <script>
      const target = new URL(${redirectScript}, window.location.origin);
      window.location.replace(target);
    </script>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: ${model.colors.paper}; color: ${model.colors.line}; font: 500 16px/24px Geist, system-ui, sans-serif; }
      a { color: inherit; text-underline-offset: 0.2em; }
    </style>
  </head>
  <body>
    <a href="${destinationHref}">Open card</a>
  </body>
</html>
`;
}

function renderLegacyCardImage(family, range, rows, latest, accent, theme) {
  const colors = themeColors(accent, theme);
  const chart = { x: 0, y: 174, width: 1200, height: 430 };
  const { line, area } = chartPaths(rows, chart);

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
      <rect width="1200" height="630" fill="${colors.paper}"/>
      <text x="40" y="54" fill="${colors.line}" font-family="Geist, sans-serif" font-size="24" font-weight="600" letter-spacing="0.25">${family}</text>
      <text x="1160" y="54" fill="${colors.line}" font-family="Geist Mono, monospace" font-size="24" font-weight="600" text-anchor="end" letter-spacing="1">${range.label}</text>
      <text x="40" y="138" fill="${colors.line}" font-family="Geist, sans-serif" font-size="64" font-weight="500" letter-spacing="-2">${formatUsd(latest.value)}</text>
      <path d="${area}" fill="${colors.secondary}" fill-opacity="0.055"/>
      <path d="${line}" fill="none" stroke="${colors.line}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
}

function renderDefaultComparisonImage() {
  const colors = themeColors(palettes.sage, "dark");
  const startDate = new Date(latestDate.getTime() - RANGES["7d"].milliseconds);
  const layerIds = ["H100", "H200", "TOKEN"];
  const series = layerIds.map((layerId) => {
    const rows = (seriesByLayer.get(layerId) || []).filter(
      (row) => row.date >= startDate,
    );
    const base = rows[0]?.value || 1;
    return {
      layerId,
      layer: cardDefinition.layers.find((item) => item.id === layerId),
      primary: layerId === "H200",
      rows: rows.map((row) => ({
        ...row,
        plotValue: (row.value / base) * 100,
      })),
    };
  });
  const primary = series.find((item) => item.layerId === "H200");
  const latest = primary?.rows.at(-1);
  const allRows = series.flatMap((item) => item.rows);
  const chart = { x: 0, y: 174, width: 1040, height: 430 };
  const { line, area, baselineY, y } = layeredChartPaths(
    allRows,
    primary?.rows || [],
    chart,
    "index",
  );
  const layerMarkup = [...series]
    .sort(
      (left, right) =>
        Number(left.layerId === "H200") - Number(right.layerId === "H200"),
    )
    .map(({ layerId, rows }) => {
      const layer = cardDefinition.layers.find((item) => item.id === layerId);
      const primaryLayer = layerId === "H200";
      const underlay = primaryLayer
        ? `<path d="${line(rows)}" fill="none" stroke="${colors.paper}" stroke-opacity="0.94" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round"/>`
        : "";
      return `${underlay}<path d="${line(rows)}" fill="none" stroke="${primaryLayer ? colors.line : colors.secondary}" stroke-opacity="${primaryLayer ? 1 : comparisonStrokeOpacity(colors.theme)}" stroke-width="${primaryLayer ? 3.5 : 2}" stroke-dasharray="${primaryLayer ? "" : layer.strokeDasharray || ""}" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join("");
  const endpointLabels = endpointLabelMarkup(series, colors, chart, y);

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
      <rect width="1200" height="630" fill="${colors.paper}"/>
      <text x="40" y="54" fill="${colors.line}" font-family="Geist, sans-serif" font-size="34" font-weight="600" letter-spacing="0.25">H200</text>
      <text x="1160" y="54" fill="${colors.line}" font-family="Geist Mono, monospace" font-size="32" font-weight="600" text-anchor="end" letter-spacing="1">7D</text>
      <text x="40" y="138" fill="${colors.line}" font-family="Geist, sans-serif" font-size="82" font-weight="500" letter-spacing="-2">${formatIndexChange(latest?.plotValue)}</text>
      <path d="${area}" fill="${colors.secondary}" fill-opacity="0.09"/>
      <line x1="${chart.x}" x2="${chart.x + chart.width}" y1="${baselineY}" y2="${baselineY}" stroke="${colors.line}" stroke-opacity="0.12" stroke-width="1" stroke-dasharray="2 8"/>
      ${layerMarkup}
      ${endpointLabels}
    </svg>`;
}

function endpointLabelMarkup(series, colors, chart, y) {
  const opacity = comparisonStrokeOpacity(colors.theme);
  const labelPositions = spreadLineLabels(
    series
      .filter((candidate) => !candidate.primary)
      .map((candidate) => ({
        candidate,
        lineY: y(candidate.rows.at(-1).plotValue),
      })),
    chart.y + 12,
    chart.y + chart.height - 12,
    26,
  );
  const chartRight = chart.x + chart.width;
  return labelPositions
    .map(({ candidate, lineY, labelY }) => {
      const layer = candidate.layer;
      const label = layer.shortLabel || layer.label;
      return (
        `<path d="M${chartRight - 4},${lineY}H${chartRight + 4}` +
        `V${labelY}H${chartRight + 12}" fill="none" ` +
        `stroke="${colors.secondary}" stroke-opacity="${opacity}" ` +
        `stroke-width="1.5" stroke-dasharray="${layer.strokeDasharray || ""}"/>` +
        `<text x="${chartRight + 20}" y="${labelY + 6}" ` +
        `fill="${colors.secondary}" fill-opacity="${opacity}" ` +
        `font-family="Geist Mono, monospace" font-size="18" font-weight="500" ` +
        `letter-spacing="0.3">${escapeXml(label)}</text>`
      );
    })
    .join("");
}

function layeredChartPaths(allRows, primaryRows, chart, scale) {
  let start = d3.min(allRows, (row) => row.date);
  let end = d3.max(allRows, (row) => row.date);
  if (+start === +end) {
    start = new Date(+start - 30 * 60 * 1000);
    end = new Date(+end + 30 * 60 * 1000);
  }
  const x = d3
    .scaleTime()
    .domain([start, end])
    .range([chart.x, chart.x + chart.width]);
  const y = d3
    .scaleLinear()
    .domain(
      chartYDomain(
        allRows.map((row) => row.plotValue),
        { scale },
      ),
    )
    .range([chart.y + chart.height, chart.y]);
  const line = d3
    .line()
    .x((row) => x(row.date))
    .y((row) => y(row.plotValue))
    .curve(d3.curveMonotoneX);
  const area = d3
    .area()
    .x((row) => x(row.date))
    .y0(scale === "index" ? y(INDEX_BASELINE) : chart.y + chart.height)
    .y1((row) => y(row.plotValue))
    .curve(d3.curveMonotoneX)(primaryRows);
  return {
    line,
    area,
    baselineY: scale === "index" ? y(INDEX_BASELINE) : null,
    y,
  };
}

function chartPaths(rows, chart) {
  let start = d3.min(rows, (row) => row.date);
  let end = d3.max(rows, (row) => row.date);
  if (+start === +end) {
    start = new Date(+start - 30 * 60 * 1000);
    end = new Date(+end + 30 * 60 * 1000);
  }
  const x = d3
    .scaleTime()
    .domain([start, end])
    .range([chart.x, chart.x + chart.width]);
  const y = d3
    .scaleLinear()
    .domain(chartYDomain(rows.map((row) => row.value), { scale: "price" }))
    .range([chart.y + chart.height, chart.y]);
  return {
    line: d3
      .line()
      .x((row) => x(row.date))
      .y((row) => y(row.value))
      .curve(d3.curveMonotoneX)(rows),
    area: d3
      .area()
      .x((row) => x(row.date))
      .y0(chart.y + chart.height)
      .y1((row) => y(row.value))
      .curve(d3.curveMonotoneX)(rows),
  };
}

function rowsForRange(rows, rangeId) {
  const milliseconds = RANGES[rangeId]?.milliseconds;
  if (!milliseconds) return rows;
  const cutoff = new Date(latestDate.getTime() - milliseconds);
  return rows.filter((row) => row.date >= cutoff);
}

function themeColors(accent, theme) {
  if (theme === "dark") {
    const line = mixHex(accent, "#ffffff", 0.88);
    return {
      accent,
      theme,
      paper: mixHex(accent, "#171717", 0.03),
      line,
      secondary: mixHex(accent, "#ffffff", 0.28),
    };
  }
  const line = mixHex(accent, "#102635", 0.52);
  return {
    accent,
    theme,
    paper: mixHex(accent, "#ffffff", 0.05),
    line,
    secondary: mixHex(accent, "#102635", 0.28),
  };
}

function mixHex(first, second, firstWeight) {
  const left = hexChannels(first);
  const right = hexChannels(second);
  const mixed = left.map((channel, index) =>
    Math.round(channel * firstWeight + right[index] * (1 - firstWeight)),
  );
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function hexChannels(value) {
  const hex = value.replace("#", "");
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

function renderLegacySharePage(
  family,
  rangeId,
  range,
  latest,
  palette,
  theme,
  previewRevision,
) {
  const slug = family.toLowerCase();
  const pageUrl = `${SITE_ORIGIN}${cardDefinition.sharePath}/${slug}/${rangeId}/${palette}/${theme}/`;
  const imageUrl = `${SITE_ORIGIN}/${cardDefinition.previewImageDir}/${slug}/${rangeId}/${palette}-${theme}.png?v=${previewRevision}`;
  const title = `${family} GPU Price Index`;
  const description = `${formatUsd(latest.value)} per GPU hour over ${range.longLabel}`;
  const imageAlt = `${title} card showing ${description.toLowerCase()}.`;
  const destination =
    `/?card=${cardDefinition.id}&view=card&gpu=${family}` +
    `&layers=${family}&scale=price&range=${rangeId}` +
    `&palette=${palette}&theme=${theme}#${cardDefinition.hash}`;
  const destinationHref = escapeHtml(destination);
  const colors = themeColors(palettes[palette], theme);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="${description}">
    <meta name="theme-color" content="${colors.paper}">
    <link rel="canonical" href="${pageUrl}">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Desk">
    <meta property="og:url" content="${pageUrl}">
    <meta property="og:image" content="${imageUrl}">
    <meta property="og:image:secure_url" content="${imageUrl}">
    <meta property="og:image:type" content="image/png">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="${imageAlt}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${title}">
    <meta name="twitter:description" content="${description}">
    <meta name="twitter:image" content="${imageUrl}">
    <meta name="twitter:image:alt" content="${imageAlt}">
    <title>${title} | Desk</title>
    <script>window.location.replace("${destination}");</script>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: ${colors.paper}; color: ${colors.line}; font: 500 16px/24px Geist, system-ui, sans-serif; }
      a { color: inherit; text-underline-offset: 0.2em; }
    </style>
  </head>
  <body>
    <a href="${destinationHref}">Open ${title}</a>
  </body>
</html>
`;
}

function formatUsd(value) {
  if (value >= 100) return `$${value.toFixed(0)}`;
  if (value >= 10) return `$${value.toFixed(1)}`;
  return `$${value.toFixed(2)}`;
}

function formatIndexChange(value) {
  const change = Number(value) - 100;
  if (!Number.isFinite(change)) return "pending";
  const rounded = Math.abs(change) < 0.05 ? 0 : change;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}%`;
}

function imageRevision(buffer) {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 12);
}

function encodePreview(svg) {
  return sharp(Buffer.from(svg))
    .png({ compressionLevel: 9, effort: 4, palette: true })
    .toBuffer();
}

function encodeLegacyPreview(svg) {
  return sharp(Buffer.from(svg))
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
}

function track(...paths) {
  generatedFiles.push(...paths.map((path) => relative(root, path)));
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function escapeHtml(value) {
  return escapeXml(value);
}

async function runWithConcurrency(items, concurrency, task) {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        await task(items[index], index);
      }
    },
  );
  await Promise.all(workers);
}

async function retireOldGeneratedFiles(nextFiles) {
  let previousFiles = [];
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    previousFiles = Array.isArray(manifest?.files) ? manifest.files : [];
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const next = new Set(nextFiles);
  const allowedRoots = [resolve(imageRoot), resolve(pageRoot)];
  for (const file of previousFiles) {
    if (next.has(file)) continue;
    const target = resolve(root, file);
    if (!allowedRoots.some((allowedRoot) => target.startsWith(`${allowedRoot}/`))) {
      throw new Error(`Refusing to remove generated file outside card roots: ${file}`);
    }
    try {
      await unlink(target);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

async function pruneEmptyDirectories(rootDirectory) {
  const walk = async (directory, keepDirectory = false) => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }

    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => walk(join(directory, entry.name))),
    );
    const remaining = await readdir(directory);
    if (!keepDirectory && remaining.length === 0) {
      await rmdir(directory);
      return true;
    }
    return false;
  };

  await walk(rootDirectory, true);
}
