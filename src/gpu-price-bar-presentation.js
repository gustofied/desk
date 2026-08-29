const SVG_WIDTH = 1200;
const SVG_HEIGHT = 630;
const COMPACT_SVG_HEIGHT = 675;

export function renderGpuPriceBarSvg(model, options = {}) {
  const { inner, ariaLabel } = gpuPriceBarMarkup(model, options);
  const height = options.compact ? COMPACT_SVG_HEIGHT : SVG_HEIGHT;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" ` +
    `height="${height}" viewBox="0 0 ${SVG_WIDTH} ${height}" ` +
    `role="img" aria-label="${escapeXml(ariaLabel)}">${inner}</svg>`
  );
}

export function paintGpuPriceBarChart(
  svgNode,
  model,
  { reducedMotion = false, interactive = true, ...options } = {},
) {
  if (!svgNode) return;
  const { inner, ariaLabel } = gpuPriceBarMarkup(model, options);
  const height = options.compact ? COMPACT_SVG_HEIGHT : SVG_HEIGHT;
  svgNode.setAttribute("viewBox", `0 0 ${SVG_WIDTH} ${height}`);
  svgNode.setAttribute("role", "img");
  svgNode.setAttribute("aria-label", ariaLabel);
  svgNode.innerHTML = inner;

  if (interactive) {
    const rows = Array.from(svgNode.querySelectorAll("[data-price-bar-row]"));
    rows.forEach((row) => {
      row.setAttribute("tabindex", "0");
      row.setAttribute("role", "graphics-symbol");
      row.setAttribute("aria-label", row.dataset.ariaLabel || "GPU price");
      row.addEventListener("pointerenter", () => row.dataset.active = "true");
      row.addEventListener("pointerleave", () => delete row.dataset.active);
      row.addEventListener("focus", () => row.dataset.active = "true");
      row.addEventListener("blur", () => delete row.dataset.active);
    });
  }

  if (reducedMotion) return;
  svgNode.querySelectorAll("[data-price-bar-value]").forEach((bar, index) => {
    bar.animate(
      [
        { transform: "scaleX(0)", opacity: 0.4 },
        { transform: "scaleX(1)", opacity: 1 },
      ],
      {
        delay: index * 40,
        duration: 320,
        easing: "cubic-bezier(0.23, 1, 0.32, 1)",
        fill: "both",
      },
    );
  });
}

export function gpuPriceBarMarkup(
  model,
  {
    colors,
    title = "Accelerator prices",
    primaryId = null,
    compact = false,
  } = {},
) {
  assertModel(model);
  const palette = normalizeColors(colors);
  const bars = model.bars;
  const maxValue = Math.max(...bars.map((bar) => bar.value), 1);
  const chart = {
    x: compact ? 216 : 240,
    width: compact ? 744 : 704,
  };
  const { top, rowStep } = rowLayout(bars.length, compact);
  const barHeight = compact ? 32 : 24;
  const bandHeight = 32;
  const trackHeight = 8;
  const canvasHeight = compact ? COMPACT_SVG_HEIGHT : SVG_HEIGHT;
  const dateLabel = formatObservedDate(model.asOf);
  const titleSize = compact ? 36 : 30;
  const labelSize = compact ? 30 : 24;
  const priceSize = 36;

  const rowMarkup = bars
    .map((bar, index) => {
      const y = top + index * rowStep;
      const valueX = chart.x + scale(bar.value, maxValue, chart.width);
      const lowerX = chart.x + scale(bar.lower, maxValue, chart.width);
      const upperX = chart.x + scale(bar.upper, maxValue, chart.width);
      const valueWidth = Math.max(2, valueX - chart.x);
      const bandWidth = Math.max(0, upperX - lowerX);
      const selected = !primaryId || bar.id === primaryId;
      const rangeLabel = `${formatUsd(bar.lower)} to ${formatUsd(bar.upper)}`;
      const ariaLabel =
        `${bar.label}, ${formatUsd(bar.value)} per GPU hour, ` +
        `observed range ${rangeLabel}`;
      const rangeMarkup = compact
        ? ""
        : `<text class="gpu-price-bar__range" x="40" y="${y + 32}" fill="${palette.muted}"
            font-family="Geist Mono, monospace" font-size="12" font-weight="500"
            letter-spacing="0.5" opacity="0" aria-hidden="true">${escapeXml(rangeLabel)}</text>`;
      const rangeBandMarkup = compact
        ? ""
        : `${bandWidth > 2
          ? `<rect x="${lowerX}" y="${y - bandHeight / 2}" width="${bandWidth}" height="${bandHeight}"
            fill="${palette.band}"/>`
          : ""}${bar.upper > maxValue
          ? `<path d="M ${chart.x + chart.width + 4} ${y - 12} L ${chart.x + chart.width + 16} ${y} L ${chart.x + chart.width + 4} ${y + 12} Z"
            fill="${palette.secondary}" opacity="0.72"/>`
          : ""}`;

      return `
        <g class="gpu-price-bar__row" data-price-bar-row="" data-layer="${escapeXml(bar.id)}"
          data-aria-label="${escapeXml(ariaLabel)}">
          <rect class="gpu-price-bar__hit" x="24" y="${y - 52}" width="1152" height="96" fill="transparent"/>
          <text x="40" y="${y + 9}" fill="${palette.text}" font-family="Geist, sans-serif"
            font-size="${labelSize}" font-weight="600" letter-spacing="-0.5">${escapeXml(bar.label)}</text>
          ${rangeMarkup}
          <rect x="${chart.x}" y="${y - trackHeight / 2}" width="${chart.width}" height="${trackHeight}"
            fill="${palette.track}"/>
          ${rangeBandMarkup}
          <rect data-price-bar-value="" x="${chart.x}" y="${y - barHeight / 2}" width="${valueWidth}" height="${barHeight}"
            fill="${selected ? palette.line : palette.secondary}" style="transform-box:fill-box;transform-origin:left center"/>
          <line x1="${valueX}" x2="${valueX}" y1="${y - 20}" y2="${y + 20}"
            stroke="${selected ? palette.line : palette.secondary}" stroke-width="2"/>
          <text x="1160" y="${y + 12}" fill="${palette.text}" font-family="Geist Mono, monospace"
            font-size="${priceSize}" font-weight="600" text-anchor="end" letter-spacing="-1">${escapeXml(formatUsd(bar.value))}</text>
        </g>`;
    })
    .join("");

  const ariaLabel = `${title}. ${bars
    .map((bar) => `${bar.label} ${formatUsd(bar.value)}`)
    .join(", ")}. Observed ${dateLabel}.`;
  const inner = `
    <desc>${escapeXml(ariaLabel)}</desc>
    <rect width="${SVG_WIDTH}" height="${canvasHeight}" fill="${palette.paper}"/>
    <text x="40" y="56" fill="${palette.text}" font-family="Geist, sans-serif"
      font-size="${titleSize}" font-weight="600" letter-spacing="-0.5">${escapeXml(title)}</text>
    ${compact ? "" : `<text x="1160" y="54" fill="${palette.muted}" font-family="Geist Mono, monospace"
      font-size="14" font-weight="600" text-anchor="end" letter-spacing="1">USD / GPU HR</text>`}
    ${compact ? "" : `<line x1="40" x2="1160" y1="88" y2="88" stroke="${palette.rule}" stroke-width="1"/>`}
    ${rowMarkup}
    ${compact ? "" : `<text x="1160" y="606" fill="${palette.muted}" font-family="Geist Mono, monospace"
      font-size="14" font-weight="500" text-anchor="end" letter-spacing="0.5">${escapeXml(dateLabel)}</text>`}`;

  return {
    inner,
    ariaLabel,
  };
}

function normalizeColors(colors = {}) {
  const line = colors.line || "#315f82";
  const secondary = colors.secondary || "#91aecb";
  return {
    paper: colors.paper || "#ffffff",
    line,
    text: colors.text || line,
    secondary,
    muted: colors.muted || withOpacity(colors.text || line, 0.58),
    track: colors.track || withOpacity(line, 0.06),
    band: colors.band ||
      (colors.area ? withOpacity(colors.area, 0.22) : withOpacity(secondary, 0.2)),
    rule: colors.rule || withOpacity(line, 0.16),
  };
}

function withOpacity(hex, opacity) {
  const value = String(hex || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(value)) {
    const alpha = Math.round(opacity * 255)
      .toString(16)
      .padStart(2, "0");
    return `${value}${alpha}`;
  }
  return value;
}

function scale(value, maxValue, width) {
  return Math.max(0, Math.min(width, (Number(value) / maxValue) * width));
}

function rowLayout(count, compact) {
  const fourBarTop = compact ? 136 : 152;
  const fourBarStep = compact ? 144 : 108;
  const center = fourBarTop + (fourBarStep * 3) / 2;
  if (count <= 1) return { top: center, rowStep: 0 };

  const span = fourBarStep * 3;
  const rowStep = Math.min(compact ? 168 : 180, span / (count - 1));
  return {
    top: center - (rowStep * (count - 1)) / 2,
    rowStep,
  };
}

function formatUsd(value) {
  return `$${Number(value).toFixed(2)}`;
}

function formatObservedDate(timestamp) {
  const date = new Date(Number(timestamp) * 1000);
  if (Number.isNaN(date.getTime())) return "DATE UNAVAILABLE";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
    .format(date)
    .toUpperCase();
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function assertModel(model) {
  if (!model?.bars?.length || !Number.isFinite(Number(model.asOf))) {
    throw new TypeError("A GPU price bar model is required");
  }
}
