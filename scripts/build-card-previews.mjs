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
import { createGpuPriceBarModel } from "../src/gpu-price-bar-model.js";
import { renderGpuPriceBarSvg } from "../src/gpu-price-bar-presentation.js";
import { createGpuMarketDepthModel } from "../src/gpu-market-depth-model.js";
import { renderGpuMarketDepthSvg } from "../src/gpu-market-depth-presentation.js";
import { createGpuSpreadSeries } from "../src/gpu-spread-model.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(join(root, ".cache", "fontconfig"), { recursive: true });
process.env.FONTCONFIG_FILE = join(root, "scripts", "fontconfig.xml");
const { default: sharp } = await import("sharp");
const cardDefinition = getCardDefinition("gpu-index");
const barCardDefinition = getCardDefinition("gpu-price-snapshot");
const depthCardDefinition = getCardDefinition("gpu-market-depth");
const gpuLayers = cardDefinition.layers.filter(
  (layer) => layer.unit === "usd-hour",
);
const palettes = Object.fromEntries(
  PALETTES.map((palette) => [palette.id, palette.accent]),
);
const imageRoot = join(root, cardDefinition.previewImageDir);
const pageRoot = join(root, cardDefinition.previewPageDir);
const barImageRoot = join(root, barCardDefinition.previewImageDir);
const barPageRoot = join(root, barCardDefinition.previewPageDir);
const depthImageRoot = join(root, depthCardDefinition.previewImageDir);
const depthPageRoot = join(root, depthCardDefinition.previewPageDir);
const generatedRoots = [
  imageRoot,
  pageRoot,
  barImageRoot,
  barPageRoot,
  depthImageRoot,
  depthPageRoot,
];
const manifestPath = join(root, ".cache", "generated-card-files.json");
const runtimeData = JSON.parse(
  await readFile(join(root, cardDefinition.dataFile), "utf8"),
);
const depthRuntimeData = JSON.parse(
  await readFile(join(root, depthCardDefinition.dataFile), "utf8"),
);
const depthTargets = Object.freeze(["64", "128", "256"]);
const depthViews = Object.freeze(
  depthCardDefinition.visualizations.map((visualization) => visualization.id),
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
const publishedLineCount = await generatePublishedPreviews();
const publishedBarCount = await generatePublishedBarPreviews();
const publishedDepthCount = await generatePublishedDepthPreviews();
await generateDefaultPreview();

generatedFiles.sort();
await retireOldGeneratedFiles(generatedFiles);
await Promise.all(generatedRoots.map(pruneEmptyDirectories));
await mkdir(dirname(manifestPath), { recursive: true });
await writeFile(
  manifestPath,
  `${JSON.stringify(
    {
      revision: runtimeData.revision,
      revisions: {
        prices: runtimeData.revision,
        marketDepth: depthRuntimeData.revision,
      },
      files: generatedFiles,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(
  `Built ${publishedLineCount + publishedBarCount + publishedDepthCount} exact view previews ` +
    `(${publishedLineCount} line, ${publishedBarCount} bar, ` +
    `${publishedDepthCount} depth) with ` +
    `${workerCount} workers.`,
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
    for (const rangeId of cardDefinition.ranges) {
      const range = RANGES[rangeId];
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

async function generatePublishedBarPreviews() {
  const states = publishedBarStates();
  await runWithConcurrency(states, workerCount, async (state) => {
    const model = barPreviewModel(state);
    const pageHref = publishedCardSharePath(barCardDefinition.id, state);
    const imageHref = publishedCardPreviewPath(
      barCardDefinition.id,
      state,
      runtimeData.revision,
    );
    const pagePath = join(root, pageHref, "index.html");
    const imagePath = join(root, imageHref);
    const svg = renderGpuPriceBarSvg(model, {
      colors: model.colors,
      title: barCardDefinition.title,
    });
    const previewImage = await encodePreview(svg);
    const previewRevision = imageRevision(previewImage);

    await mkdir(dirname(imagePath), { recursive: true });
    await mkdir(dirname(pagePath), { recursive: true });
    await Promise.all([
      writeFile(imagePath, previewImage),
      writeFile(
        pagePath,
        renderPublishedBarSharePage(
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

async function generatePublishedDepthPreviews() {
  const states = publishedDepthStates();
  await runWithConcurrency(states, workerCount, async (state) => {
    const model = depthPreviewModel(state);
    const pageHref = publishedCardSharePath(depthCardDefinition.id, state);
    const imageHref = publishedCardPreviewPath(
      depthCardDefinition.id,
      state,
      depthRuntimeData.revision,
    );
    const pagePath = join(root, pageHref, "index.html");
    const imagePath = join(root, imageHref);
    const previewImage = await encodePreview(
      renderGpuMarketDepthSvg(model, {
        colors: model.colors,
        title: depthCardDefinition.title,
        compact: false,
        artifact: true,
        view: model.scale === "history" ? "history" : "now",
      }),
    );
    const previewRevision = imageRevision(previewImage);

    await mkdir(dirname(imagePath), { recursive: true });
    await mkdir(dirname(pagePath), { recursive: true });
    const legacyPagePaths = model.scale === "history"
      ? ["1d", "7d"].map((range) =>
          join(root, legacyPublishedDepthSharePath(model, range), "index.html"),
        )
      : [];
    await Promise.all([
      writeFile(imagePath, previewImage),
      writeFile(
        pagePath,
        renderPublishedDepthSharePage(
          model,
          pageHref,
          imageHref,
          previewRevision,
        ),
        "utf8",
      ),
      ...legacyPagePaths.map(async (legacyPagePath) => {
        await mkdir(dirname(legacyPagePath), { recursive: true });
        await writeFile(
          legacyPagePath,
          renderPublishedDepthSharePage(
            model,
            pageHref,
            imageHref,
            previewRevision,
          ),
          "utf8",
        );
      }),
    ]);
    track(imagePath, pagePath, ...legacyPagePaths);
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
      if (scale === "spread") {
        for (const comparison of gpuLayers) {
          if (comparison.id === primary.id || !comparison.views.includes(scale)) {
            continue;
          }
          addPublishedLineStates(statesByPath, {
            primary,
            layers: [primary.id, comparison.id],
            scale,
          });
        }
        continue;
      }
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
        addPublishedLineStates(statesByPath, { primary, layers, scale });
      }
    }
  }
  return Array.from(statesByPath.values());
}

function addPublishedLineStates(
  statesByPath,
  { primary, layers, scale },
) {
  for (const range of cardDefinition.ranges) {
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
        const pageHref = publishedCardSharePath(cardDefinition.id, state);
        if (statesByPath.has(pageHref)) {
          throw new Error(`Duplicate published card route: ${pageHref}`);
        }
        statesByPath.set(pageHref, state);
      }
    }
  }
}

function publishedBarStates() {
  const statesByPath = new Map();
  for (const primary of barCardDefinition.layers) {
    const optionalLayers = barCardDefinition.layers.filter(
      (layer) => layer.id !== primary.id,
    );
    for (let mask = 0; mask < 2 ** optionalLayers.length; mask += 1) {
      const layers = [
        primary.id,
        ...optionalLayers
          .filter((_, index) => mask & (1 << index))
          .map((layer) => layer.id),
      ];
      for (const palette of Object.keys(palettes)) {
        for (const theme of THEMES) {
          const state = normalizeCardState(barCardDefinition.id, {
            gpu: primary.id,
            layers,
            scale: barCardDefinition.defaults.scale,
            range: barCardDefinition.defaults.range,
            palette,
            theme,
          });
          const pageHref = publishedCardSharePath(
            barCardDefinition.id,
            state,
          );
          if (statesByPath.has(pageHref)) {
            throw new Error(`Duplicate published bar card route: ${pageHref}`);
          }
          statesByPath.set(pageHref, state);
        }
      }
    }
  }
  return Array.from(statesByPath.values());
}

function publishedDepthStates() {
  const statesByPath = new Map();

  for (const scale of depthViews) {
    for (const target of depthTargets) {
      for (const palette of Object.keys(palettes)) {
        for (const theme of THEMES) {
          const state = normalizeCardState(depthCardDefinition.id, {
            gpu: depthCardDefinition.defaults.layer,
            layers: depthCardDefinition.defaults.layers,
            scale,
            range: depthCardDefinition.defaults.range,
            target,
            palette,
            theme,
          });
          const pageHref = publishedCardSharePath(
            depthCardDefinition.id,
            state,
          );
          if (statesByPath.has(pageHref)) {
            throw new Error(`Duplicate published depth card route: ${pageHref}`);
          }
          statesByPath.set(pageHref, state);
        }
      }
    }
  }

  return Array.from(statesByPath.values());
}

function previewModel(state) {
  const normalized = normalizeCardState(cardDefinition.id, state);
  const memberSeries = normalized.layers.map((layerId) => {
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
  if (normalized.scale === "spread") {
    return spreadPreviewModel(normalized, memberSeries);
  }
  const series = memberSeries;
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

function spreadPreviewModel(normalized, memberSeries) {
  const primaryMember = memberSeries.find((candidate) => candidate.primary);
  const comparisonMember = memberSeries.find((candidate) => !candidate.primary);
  if (!primaryMember || !comparisonMember || memberSeries.length !== 2) {
    throw new Error(
      `Spread previews require exactly two GPU series for ${normalized.gpu}`,
    );
  }
  if (
    primaryMember.layer.unit !== "usd-hour" ||
    comparisonMember.layer.unit !== "usd-hour"
  ) {
    throw new Error("Spread previews only support GPU price series");
  }

  const spread = createGpuSpreadSeries(primaryMember, comparisonMember);
  if (!spread?.rows?.length || !spread.latest) {
    throw new Error(
      `Missing overlapping spread data for ${primaryMember.layer.id} and ${comparisonMember.layer.id}`,
    );
  }

  const primaryLabel = primaryMember.layer.shortLabel || primaryMember.layer.label;
  const comparisonLabel =
    comparisonMember.layer.shortLabel || comparisonMember.layer.label;
  return {
    ...normalized,
    colors: themeColors(palettes[normalized.palette], normalized.theme),
    series: [spread],
    primary: spread,
    members: spread.members,
    headline: formatSpreadPoints(spread.latest.plotValue),
    primaryTitle: `${primaryLabel} − ${comparisonLabel}`,
    comparisonTitle: "",
    rangeLabel: shareRangeLabel(spread.rows, normalized.range),
  };
}

function barPreviewModel(state) {
  const normalized = normalizeCardState(barCardDefinition.id, state);
  const model = createGpuPriceBarModel(runtimeData, barCardDefinition, {
    layerIds: normalized.layers,
  });
  return {
    ...model,
    ...normalized,
    colors: themeColors(
      palettes[normalized.palette],
      normalized.theme,
    ),
  };
}

function depthPreviewModel(state) {
  const normalized = normalizeCardState(depthCardDefinition.id, state);
  const colors = themeColors(
    palettes[normalized.palette],
    normalized.theme,
  );
  const model = createGpuMarketDepthModel(
    depthRuntimeData,
    depthCardDefinition,
    {
      targetNodes: Number(normalized.target),
    },
  );
  return {
    ...model,
    ...normalized,
    colors,
  };
}

function renderPublishedCardImage(model) {
  if (model.scale === "spread") {
    return renderPublishedSpreadImage(model);
  }
  const hasComparisons = model.comparisonTitle.length > 0;
  const chart = {
    x: 0,
    y: 158,
    width: 1200,
    height: 446,
    areaBottom: 630,
  };
  const allRows = model.series.flatMap((candidate) => candidate.rows);
  const { line, area, baselineY, x, y } = layeredChartPaths(
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
      const color = candidate.primary ? model.colors.line : model.colors.secondary;
      return `<path d="${line(candidate.rows)}" fill="none" stroke="${color}" stroke-opacity="${strokeOpacity}" stroke-width="${strokeWidth}" stroke-dasharray="${dash}" stroke-linecap="round" stroke-linejoin="round"/>`;
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
    ? endpointLabelMarkup(model.series, model.colors, chart, x, y)
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

function renderPublishedSpreadImage(model) {
  const chart = {
    x: 0,
    y: 158,
    width: 1200,
    height: 446,
  };
  const { line, area, zeroY } = spreadChartPaths(model.primary.rows, chart);

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
      <rect width="1200" height="630" fill="${model.colors.paper}"/>
      <text x="40" y="54" fill="${model.colors.line}" font-family="Geist, Avenir Next, sans-serif" font-size="34" font-weight="600" letter-spacing="0.25">${escapeXml(model.primaryTitle)}</text>
      <text x="1160" y="54" fill="${model.colors.line}" font-family="Geist Mono, monospace" font-size="32" font-weight="600" text-anchor="end" letter-spacing="1">${escapeXml(model.rangeLabel)}</text>
      <text x="40" y="138" fill="${model.colors.line}" font-family="Geist, Avenir Next, sans-serif" font-size="82" font-weight="500" letter-spacing="-2">${escapeXml(model.headline)}</text>
      <path d="${area}" fill="${model.colors.area}" fill-opacity="0.12"/>
      <line x1="${chart.x}" x2="${chart.x + chart.width}" y1="${zeroY}" y2="${zeroY}" stroke="${model.colors.line}" stroke-opacity="0.12" stroke-width="1" stroke-dasharray="2 8"/>
      <path d="${line}" fill="none" stroke="${model.colors.line}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
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
    model.scale === "spread"
      ? `${model.primaryTitle} return spread ${model.headline} over ${rangeDescription}`
      : model.scale === "index"
      ? `${model.primaryTitle} ${model.headline} over ${rangeDescription}`
      : `${model.headline} per GPU hour over ${rangeDescription}`;
  const imageAlt = `${cardTitle} chart showing ${description}`;
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
    <a href="${destinationHref}">Open view</a>
  </body>
</html>
`;
}

function renderPublishedBarSharePage(
  model,
  pageHref,
  imageHref,
  previewRevision,
) {
  const pageUrl = `${SITE_ORIGIN}${pageHref}?v=${PUBLISHED_CARD_VERSION}-${runtimeData.revision}`;
  const imageUrl = `${SITE_ORIGIN}${imageHref}?v=${previewRevision}`;
  const primary = model.bars.find((bar) => bar.id === model.gpu);
  const labels = model.bars.map((bar) => bar.label).join(", ");
  const observed = formatSnapshotDate(model.asOf);
  const title = `${barCardDefinition.title}: ${labels}`;
  const description =
    `Latest observed USD per GPU-hour comparison for ${labels}; ` +
    `${primary?.label || model.gpu} highlighted. Observed ${observed}.`;
  const imageAlt =
    `Bar chart comparing ${model.bars
      .map((bar) => `${bar.label} ${formatUsd(bar.value)}`)
      .join(", ")}. ${primary?.label || model.gpu} highlighted.`;
  const destinationParams = new URLSearchParams({
    card: barCardDefinition.id,
    view: "card",
    gpu: model.gpu,
    layers: model.layers.join(","),
    scale: model.scale,
    range: model.range,
    palette: model.palette,
    theme: model.theme,
  });
  const destination = `/?${destinationParams.toString()}#${barCardDefinition.hash}`;
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
    <a href="${destinationHref}">Open view</a>
  </body>
</html>
`;
}

function renderPublishedDepthSharePage(
  model,
  pageHref,
  imageHref,
  previewRevision,
) {
  const pageUrl =
    `${SITE_ORIGIN}${pageHref}?v=` +
    `${PUBLISHED_CARD_VERSION}-${depthRuntimeData.revision}`;
  const imageUrl = `${SITE_ORIGIN}${imageHref}?v=${previewRevision}`;
  const region = model.instrument.regionLabel || model.instrument.region;
  const target = `${model.targetNodes} nodes`;
  const contract =
    `${region} ${model.instrument.nodeGpuCount}-GPU ` +
    `${model.instrument.interconnect}`;
  const benchmark =
    model.current.benchmarkPrice ?? model.current.referencePrice;
  const capacityAtBenchmark =
    model.current.capacityAtBenchmark ?? model.current.capacityAtReference;
  const basis = model.current.clearingPrice === null
    ? ""
    : formatSignedUsd(model.current.clearingPrice - benchmark);
  const clearing = model.current.clearingPrice === null
    ? `${target} exceed the visible capacity above ` +
      `${formatUsd(model.priceDomain[1])} per GPU hour.`
    : `${target} clearing price ${formatUsd(model.current.clearingPrice)} ` +
      `per GPU hour with ${basis} basis.`;
  const historyStart = model.history?.at(0)?.timestamp;
  const historyEnd = model.history?.at(-1)?.timestamp;
  const historySpan = historyStart && historyEnd
    ? `${formatSnapshotDate(historyStart)} to ${formatSnapshotDate(historyEnd)}`
    : "the available observation window";
  const isHistory = model.scale === "history";
  const title = isHistory
    ? `${model.instrument.gpuLabel} depth history: ${target}`
    : `${model.instrument.gpuLabel} depth: ${target}`;
  const description = isHistory
    ? `${contract}. ${model.history?.length || 0} daily observations from ${historySpan}. ` +
      `Latest clearing price for ${target}: ${
        model.current.clearingPrice === null
          ? `more than ${formatUsd(model.priceDomain[1])}`
          : formatUsd(model.current.clearingPrice)
      } per GPU hour${basis ? ` with ${basis} basis` : ""}.`
    : `${contract}. ${formatUsd(benchmark)} benchmark with ` +
      `${capacityAtBenchmark} nodes available. ${clearing}`;
  const imageAlt = isHistory
    ? `${model.instrument.gpuLabel} market depth history from ${historySpan} for a target of ${target}.`
    : `${model.instrument.gpuLabel} market depth profile showing a ` +
      `${formatUsd(benchmark)} benchmark. ${clearing}`;
  const destinationParams = new URLSearchParams({
    card: depthCardDefinition.id,
    view: "card",
    gpu: model.gpu,
    layers: model.layers.join(","),
    scale: model.scale,
    range: model.range,
    target: model.target,
    palette: model.palette,
    theme: model.theme,
  });
  const destination =
    `/?${destinationParams.toString()}#${depthCardDefinition.hash}`;
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
    <a href="${destinationHref}">Open view</a>
  </body>
</html>
`;
}

function legacyPublishedDepthSharePath(state, range) {
  const gpu = encodeURIComponent(String(state.gpu).toLowerCase());
  const layers = state.layers
    .map((layer) => encodeURIComponent(String(layer).toLowerCase()))
    .join("~");
  const palette = encodeURIComponent(String(state.palette).toLowerCase());
  const theme = encodeURIComponent(String(state.theme).toLowerCase());
  const target = encodeURIComponent(String(state.target).toLowerCase());
  return (
    `${depthCardDefinition.sharePath}/published/${gpu}/depth/${layers}/` +
    `${range}/${palette}/${theme}/target-${target}/`
  );
}

function renderLegacyCardImage(family, range, rows, latest, accent, theme) {
  const colors = themeColors(accent, theme);
  const chart = {
    x: 0,
    y: 158,
    width: 1200,
    height: 446,
    areaBottom: 630,
  };
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
  const chart = { x: 0, y: 158, width: 1200, height: 446 };
  const { line, area, baselineY, x, y } = layeredChartPaths(
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
      return `<path d="${line(rows)}" fill="none" stroke="${primaryLayer ? colors.line : colors.secondary}" stroke-opacity="${primaryLayer ? 1 : comparisonStrokeOpacity(colors.theme)}" stroke-width="${primaryLayer ? 3.5 : 2}" stroke-dasharray="${primaryLayer ? "" : layer.strokeDasharray || ""}" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join("");
  const endpointLabels = endpointLabelMarkup(series, colors, chart, x, y);

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

function endpointLabelMarkup(series, colors, chart, x, y) {
  const labelPositions = spreadLineLabels(
    series
      .map((candidate) => ({
        candidate,
        endpointX: x(candidate.rows.at(-1).date),
        lineY: y(candidate.rows.at(-1).plotValue),
      })),
    chart.y + 12,
    chart.y + chart.height - 12,
    26,
  );
  const chartRight = chart.x + chart.width;
  return labelPositions
    .map(({ candidate, endpointX, lineY, labelY }) => {
      const layer = candidate.layer;
      const label = layer.shortLabel || layer.label;
      const color = candidate.primary ? colors.line : colors.secondary;
      const opacity = candidate.primary
        ? 1
        : comparisonStrokeOpacity(colors.theme);
      return (
        `<path d="M${endpointX},${lineY}H${chartRight - 8}V${labelY}" fill="none" ` +
        `stroke="${color}" stroke-opacity="${opacity}" ` +
        `stroke-width="1.5" stroke-dasharray="${candidate.primary ? "" : layer.strokeDasharray || ""}"/>` +
        `<text x="${chartRight - 12}" y="${labelY + 6}" text-anchor="end" ` +
        `fill="${color}" fill-opacity="${opacity}" ` +
        `stroke="${colors.paper}" stroke-width="8" stroke-linejoin="round" ` +
        `style="paint-order:stroke fill" ` +
        `font-family="Geist Mono, monospace" font-size="18" font-weight="${candidate.primary ? 600 : 500}" ` +
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
    .y0(
      scale === "index"
        ? y(INDEX_BASELINE)
        : chart.areaBottom ?? chart.y + chart.height,
    )
    .y1((row) => y(row.plotValue))
    .curve(d3.curveMonotoneX)(primaryRows);
  return {
    line,
    area,
    baselineY: scale === "index" ? y(INDEX_BASELINE) : null,
    x,
    y,
  };
}

function spreadChartPaths(rows, chart) {
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
  const values = rows.map((row) => Number(row.plotValue)).filter(Number.isFinite);
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values);
  const magnitude = Math.max(Math.abs(minimum), Math.abs(maximum), 1);
  const spread = Math.max(maximum - minimum, magnitude * 0.02, 0.5);
  const padding = spread * 0.08;
  const y = d3
    .scaleLinear()
    .domain([minimum - padding, maximum + padding])
    .range([chart.y + chart.height, chart.y]);
  const curve = d3.curveMonotoneX;
  return {
    line: d3
      .line()
      .x((row) => x(row.date))
      .y((row) => y(row.plotValue))
      .curve(curve)(rows),
    area: d3
      .area()
      .x((row) => x(row.date))
      .y0(y(0))
      .y1((row) => y(row.plotValue))
      .curve(curve)(rows),
    zeroY: y(0),
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
      .y0(chart.areaBottom ?? chart.y + chart.height)
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
      text: mixHex(accent, "#ffffff", 0.72),
      secondary: mixHex(accent, "#ffffff", 0.28),
      area: mixHex(accent, "#ffffff", 0.28),
    };
  }
  const line = mixHex(accent, "#102635", 0.52);
  return {
    accent,
    theme,
    paper: mixHex(accent, "#ffffff", 0.05),
    line,
    text: mixHex(accent, "#102635", 0.28),
    secondary: mixHex(accent, "#102635", 0.28),
    area: mixHex(accent, "#102635", 0.28),
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
  const title = `${family} price`;
  const description = `${formatUsd(latest.value)} per GPU hour over ${range.longLabel}`;
  const imageAlt = `${title} chart showing ${description.toLowerCase()}.`;
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

function formatSignedUsd(value) {
  const amount = Number(value);
  const sign = amount > 0 ? "+" : amount < 0 ? "−" : "";
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

function formatIndexChange(value) {
  const change = Number(value) - 100;
  if (!Number.isFinite(change)) return "pending";
  const rounded = Math.abs(change) < 0.05 ? 0 : change;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}%`;
}

function formatSpreadPoints(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "pending";
  const rounded = Math.abs(amount) < 0.05 ? 0 : amount;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  return `${sign}${Math.abs(rounded).toFixed(1)} pts`;
}

function formatSnapshotDate(timestamp) {
  const date = new Date(Number(timestamp) * 1000);
  if (Number.isNaN(date.getTime())) return "an unavailable date";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
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
  const allowedRoots = generatedRoots.map((directory) => resolve(directory));
  for (const file of previousFiles) {
    if (next.has(file)) continue;
    if (isRetainedDepthPreview(file)) continue;
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

function isRetainedDepthPreview(file) {
  // Existing depth shares can still reference their versioned preview image.
  return String(file).startsWith(
    `${depthCardDefinition.previewImageDir}/published/v14/`,
  );
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
