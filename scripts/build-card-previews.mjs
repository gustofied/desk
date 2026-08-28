import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as d3 from "d3";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const siteOrigin = "https://desk.adamsioud.com";
const families = ["H100", "H200", "B200", "B300"];
const palettes = {
  azure: "#91aecb",
  linen: "#efede4",
  sage: "#b7d07b",
  sand: "#f3c888",
};
const themes = ["light", "dark"];
const ranges = {
  "1d": { milliseconds: 24 * 60 * 60 * 1000, label: "1 day", badge: "1D" },
  "7d": { milliseconds: 7 * 24 * 60 * 60 * 1000, label: "7 days", badge: "7D" },
  all: { milliseconds: null, label: "all history", badge: "ALL" },
};
const imageRoot = join(root, "assets", "social", "gpu-index");
const pageRoot = join(root, "cards", "gpu-price-index");

await rm(imageRoot, { recursive: true, force: true });
await rm(pageRoot, { recursive: true, force: true });

const cards = await Promise.all(
  families.map(async (family) => {
    const file = join(
      root,
      "api",
      "dashboard-snapshots",
      "gpu-benchmark",
      `${family.toLowerCase()}.json`,
    );
    const payload = JSON.parse(await readFile(file, "utf8"));
    const rows = payload.series
      .map((row) => ({
        date: new Date(row.observed_at),
        value: Number(row.value),
      }))
      .filter((row) => Number.isFinite(row.value) && !Number.isNaN(row.date.getTime()))
      .sort((left, right) => left.date - right.date);
    return { family, rows };
  }),
);

const latestDate = new Date(
  Math.max(...cards.flatMap((card) => card.rows.map((row) => row.date.getTime()))),
);

for (const card of cards) {
  for (const [rangeId, range] of Object.entries(ranges)) {
    const rows = range.milliseconds
      ? card.rows.filter(
          (row) => row.date >= new Date(latestDate.getTime() - range.milliseconds),
        )
      : card.rows;
    const latest = card.rows.at(-1);
    if (!rows.length || !latest) continue;

    for (const [paletteId, accent] of Object.entries(palettes)) {
      for (const theme of themes) {
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
        await sharp(
          Buffer.from(renderCardImage(card.family, range, rows, latest, accent, theme)),
        )
          .png({ compressionLevel: 9, palette: true })
          .toFile(imagePath);
        await writeFile(
          pagePath,
          renderSharePage(
            card.family,
            rangeId,
            range,
            latest,
            paletteId,
            theme,
          ),
          "utf8",
        );
      }
    }
  }
}

function renderCardImage(family, range, rows, latest, accent, theme) {
  const colors = themeColors(accent, theme);
  const chart = { x: 0, y: 174, width: 1200, height: 370 };
  const { line, area } = chartPaths(rows, chart, 630);

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
      <rect width="1200" height="630" fill="${colors.paper}"/>
      <text x="40" y="54" fill="${colors.line}" font-family="Geist, sans-serif" font-size="24" font-weight="600" letter-spacing="0.25">${family}</text>
      <text x="1160" y="54" fill="${colors.line}" font-family="Geist Mono, monospace" font-size="24" font-weight="600" text-anchor="end" letter-spacing="1">${range.badge}</text>
      <text x="40" y="138" fill="${colors.line}" font-family="Geist, sans-serif" font-size="64" font-weight="500" letter-spacing="-2">${formatUsd(latest.value)}</text>
      <path d="${area}" fill="${colors.line}" fill-opacity="0.055"/>
      <path d="${line}" fill="none" stroke="${colors.line}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
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
) {
  const slug = family.toLowerCase();
  const pageUrl = `${siteOrigin}/cards/gpu-price-index/${slug}/${rangeId}/${palette}/${theme}/`;
  const imageUrl = `${siteOrigin}/assets/social/gpu-index/${slug}/${rangeId}/${palette}-${theme}.png`;
  const title = `${family} GPU Price Index`;
  const description = `${formatUsd(latest.value)} per GPU hour over ${range.label}`;
  const imageAlt = `${title} card showing ${description.toLowerCase()}.`;
  const destination = `/?card=gpu-index&view=card&gpu=${family}&range=${rangeId}&palette=${palette}&theme=${theme}#gpu-benchmark-card`;
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
    <a href="${destination}">Open ${title}</a>
  </body>
</html>
`;
}

function formatUsd(value) {
  if (value >= 100) return `$${value.toFixed(0)}`;
  if (value >= 10) return `$${value.toFixed(1)}`;
  return `$${value.toFixed(2)}`;
}
