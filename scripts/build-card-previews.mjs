import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as d3 from "d3";
import sharp from "sharp";
import {
  getCardDefinition,
  PALETTES,
  RANGES,
  SITE_ORIGIN,
  THEMES,
} from "../src/card-registry.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cardDefinition = getCardDefinition("gpu-index");
const families = cardDefinition.layers.filter(
  (layer) => layer.unit === "usd-hour",
);
const palettes = Object.fromEntries(
  PALETTES.map((palette) => [palette.id, palette.accent]),
);
const imageRoot = join(root, cardDefinition.previewImageDir);
const pageRoot = join(root, cardDefinition.previewPageDir);
const manifestPath = join(root, "data", "generated-card-files.json");
const runtimeData = JSON.parse(
  await readFile(join(root, cardDefinition.dataFile), "utf8"),
);
const generatedFiles = [];

const cards = families.map((family) => ({
  family: family.id,
  rows: (runtimeData.series?.[family.id] || []).map((point) => ({
    date: new Date(Number(point[0]) * 1000),
    value: Number(point[1]),
  })),
}));

const latestDate = new Date(
  Math.max(
    ...cards.flatMap((card) => card.rows.map((row) => row.date.getTime())),
  ),
);

for (const card of cards) {
  for (const [rangeId, range] of Object.entries(RANGES)) {
    const rows = range.milliseconds
      ? card.rows.filter(
          (row) => row.date >= new Date(latestDate.getTime() - range.milliseconds),
        )
      : card.rows;
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
        const previewSvg = renderCardImage(
          card.family,
          range,
          rows,
          latest,
          accent,
          theme,
        );
        const previewImage = await sharp(Buffer.from(previewSvg))
          .png({ compressionLevel: 9, palette: true })
          .toBuffer();
        const previewRevision = createHash("sha256")
          .update(previewImage)
          .digest("hex")
          .slice(0, 12);
        await writeFile(imagePath, previewImage);
        await writeFile(
          pagePath,
          renderSharePage(
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
        generatedFiles.push(relative(root, imagePath), relative(root, pagePath));
      }
    }
  }
}

const deskPreviewPath = join(imageRoot, "desk-comparison.png");
await mkdir(dirname(deskPreviewPath), { recursive: true });
await writeFile(
  deskPreviewPath,
  await sharp(Buffer.from(renderDeskComparisonImage()))
    .png({ compressionLevel: 9, palette: true })
    .toBuffer(),
);
generatedFiles.push(relative(root, deskPreviewPath));

await retireOldGeneratedFiles(generatedFiles);
await writeFile(
  manifestPath,
  `${JSON.stringify({ revision: runtimeData.revision, files: generatedFiles }, null, 2)}\n`,
  "utf8",
);

function renderCardImage(family, range, rows, latest, accent, theme) {
  const colors = themeColors(accent, theme);
  const chart = { x: 0, y: 174, width: 1200, height: 370 };
  const { line, area } = chartPaths(rows, chart, 630);

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
      <rect width="1200" height="630" fill="${colors.paper}"/>
      <text x="40" y="54" fill="${colors.line}" font-family="Geist, sans-serif" font-size="24" font-weight="600" letter-spacing="0.25">${family}</text>
      <text x="1160" y="54" fill="${colors.line}" font-family="Geist Mono, monospace" font-size="24" font-weight="600" text-anchor="end" letter-spacing="1">${range.label}</text>
      <text x="40" y="138" fill="${colors.line}" font-family="Geist, sans-serif" font-size="64" font-weight="500" letter-spacing="-2">${formatUsd(latest.value)}</text>
      <path d="${area}" fill="${colors.line}" fill-opacity="0.055"/>
      <path d="${line}" fill="none" stroke="${colors.line}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
}

function renderDeskComparisonImage() {
  const colors = themeColors(palettes.sage, "dark");
  const startDate = new Date(latestDate.getTime() - RANGES["7d"].milliseconds);
  const layerIds = ["H100", "H200", "TOKEN"];
  const series = layerIds.map((layerId) => {
    const rows = (runtimeData.series?.[layerId] || [])
      .map((point) => ({
        date: new Date(Number(point[0]) * 1000),
        value: Number(point[1]),
      }))
      .filter((row) => row.date >= startDate);
    const base = rows[0]?.value || 1;
    return {
      layerId,
      rows: rows.map((row) => ({
        ...row,
        value: (row.value / base) * 100,
      })),
    };
  });
  const primary = series.find((item) => item.layerId === "H200");
  const latest = primary?.rows.at(-1);
  const allRows = series.flatMap((item) => item.rows);
  const chart = { x: 0, y: 174, width: 1200, height: 370 };
  const minimum = d3.min(allRows, (row) => row.value) ?? 0;
  const maximum = d3.max(allRows, (row) => row.value) ?? minimum + 1;
  const spread = Math.max(maximum - minimum, maximum * 0.025, 0.12);
  const x = d3
    .scaleTime()
    .domain(d3.extent(allRows, (row) => row.date))
    .range([chart.x, chart.x + chart.width]);
  const y = d3
    .scaleLinear()
    .domain([Math.max(0, minimum - spread * 0.2), maximum + spread * 0.2])
    .range([chart.y + chart.height, chart.y]);
  const line = d3
    .line()
    .x((row) => x(row.date))
    .y((row) => y(row.value))
    .curve(d3.curveMonotoneX);
  const area = d3
    .area()
    .x((row) => x(row.date))
    .y0(630)
    .y1((row) => y(row.value))
    .curve(d3.curveMonotoneX);
  const layerMarkup = series
    .map(({ layerId, rows }) => {
      const layer = cardDefinition.layers.find((item) => item.id === layerId);
      const primaryLayer = layerId === "H200";
      return `<path d="${line(rows)}" fill="none" stroke="${colors.line}" stroke-opacity="${primaryLayer ? 1 : layer.strokeOpacity}" stroke-width="${primaryLayer ? 3.5 : 2.5}" stroke-dasharray="${primaryLayer ? "" : layer.strokeDasharray || ""}" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join("");

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
      <rect width="1200" height="630" fill="${colors.paper}"/>
      <text x="40" y="54" fill="${colors.line}" font-family="Geist, sans-serif" font-size="34" font-weight="600" letter-spacing="0.25">H100 + H200 + Sample token</text>
      <text x="1160" y="54" fill="${colors.line}" font-family="Geist Mono, monospace" font-size="32" font-weight="600" text-anchor="end" letter-spacing="1">7D INDEX</text>
      <text x="40" y="138" fill="${colors.line}" font-family="Geist, sans-serif" font-size="82" font-weight="500" letter-spacing="-2">${formatIndex(latest?.value)}</text>
      <path d="${area(primary?.rows || [])}" fill="${colors.line}" fill-opacity="0.055"/>
      ${layerMarkup}
    </svg>`;
}

function chartPaths(rows, chart, bottom) {
  let start = d3.min(rows, (row) => row.date);
  let end = d3.max(rows, (row) => row.date);
  if (+start === +end) {
    start = new Date(+start - 30 * 60 * 1000);
    end = new Date(+end + 30 * 60 * 1000);
  }
  const minimum = d3.min(rows, (row) => row.value) ?? 0;
  const maximum = d3.max(rows, (row) => row.value) ?? minimum + 1;
  const spread = Math.max(maximum - minimum, maximum * 0.025, 0.12);
  const x = d3
    .scaleTime()
    .domain([start, end])
    .range([chart.x, chart.x + chart.width]);
  const y = d3
    .scaleLinear()
    .domain([Math.max(0, minimum - spread * 0.2), maximum + spread * 0.2])
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
      .y0(bottom)
      .y1((row) => y(row.value))
      .curve(d3.curveMonotoneX)(rows),
  };
}

function themeColors(accent, theme) {
  if (theme === "dark") {
    return {
      paper: mixHex(accent, "#171717", 0.03),
      line: mixHex(accent, "#ffffff", 0.88),
    };
  }
  return {
    paper: mixHex(accent, "#ffffff", 0.05),
    line: mixHex(accent, "#102635", 0.52),
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

function renderSharePage(
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
  const destinationHref = destination.replaceAll("&", "&amp;");
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

function formatIndex(value) {
  return Number(value || 0).toFixed(1);
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
