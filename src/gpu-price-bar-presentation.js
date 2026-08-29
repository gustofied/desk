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
  {
    reducedMotion = false,
    interactive = true,
    decorative = false,
    ...options
  } = {},
) {
  if (!svgNode) return;
  const focusedLayer = svgNode.querySelector("[data-price-bar-row]:focus")
    ?.dataset.layer;
  const { inner, ariaLabel } = gpuPriceBarMarkup(model, options);
  const height = options.compact ? COMPACT_SVG_HEIGHT : SVG_HEIGHT;
  svgNode.setAttribute("viewBox", `0 0 ${SVG_WIDTH} ${height}`);
  if (decorative) {
    svgNode.setAttribute("aria-hidden", "true");
    svgNode.removeAttribute("role");
    svgNode.removeAttribute("aria-label");
  } else {
    svgNode.removeAttribute("aria-hidden");
    svgNode.setAttribute("role", interactive ? "group" : "img");
    svgNode.setAttribute("aria-label", ariaLabel);
  }
  svgNode.innerHTML = inner;

  if (interactive) {
    const rows = Array.from(svgNode.querySelectorAll("[data-price-bar-row]"));
    let activeIndex = Math.max(
      0,
      rows.findIndex((row) => row.dataset.layer === focusedLayer),
    );
    const focusRow = (index) => {
      const nextIndex = (index + rows.length) % rows.length;
      rows[activeIndex]?.setAttribute("tabindex", "-1");
      activeIndex = nextIndex;
      rows[activeIndex]?.setAttribute("tabindex", "0");
      rows[activeIndex]?.focus();
    };
    rows.forEach((row, index) => {
      row.setAttribute("tabindex", index === activeIndex ? "0" : "-1");
      row.setAttribute("role", "graphics-symbol");
      row.setAttribute("aria-label", row.dataset.ariaLabel || "GPU price");
      row.addEventListener("pointerenter", () => row.dataset.active = "true");
      row.addEventListener("pointerleave", () => delete row.dataset.active);
      row.addEventListener("focus", () => row.dataset.active = "true");
      row.addEventListener("blur", () => delete row.dataset.active);
      row.addEventListener("keydown", (event) => {
        if (event.key === "ArrowRight") {
          event.preventDefault();
          focusRow(activeIndex + 1);
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          focusRow(activeIndex - 1);
        } else if (event.key === "Home") {
          event.preventDefault();
          focusRow(0);
        } else if (event.key === "End") {
          event.preventDefault();
          focusRow(rows.length - 1);
        }
      });
    });
    if (focusedLayer) queueMicrotask(() => rows[activeIndex]?.focus());
  }

  if (reducedMotion) return;
  const priceRail = svgNode.querySelector("[data-price-ladder-rail]");
  priceRail?.animate(
    [
      { strokeDashoffset: 1, opacity: 0.42 },
      { strokeDashoffset: 0, opacity: 1 },
    ],
    {
      duration: 520,
      easing: "cubic-bezier(0.23, 1, 0.32, 1)",
      fill: "both",
    },
  );
  svgNode.querySelectorAll("[data-price-bar-row]").forEach((row, index) => {
    const endpoint = row.querySelector("[data-price-bar-marker]");
    const copy = row.querySelector("[data-price-ladder-copy]");
    endpoint?.animate(
      [
        { transform: "scale(0.4)", opacity: 0 },
        { transform: "scale(1)", opacity: 1 },
      ],
      {
        delay: 180 + index * 45,
        duration: 220,
        easing: "cubic-bezier(0.23, 1, 0.32, 1)",
        fill: "both",
      },
    );
    copy?.animate(
      [
        { transform: "translateY(5px)", opacity: 0 },
        { transform: "translateY(0)", opacity: 1 },
      ],
      {
        delay: 230 + index * 45,
        duration: 260,
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
    compact = false,
  } = {},
) {
  assertModel(model);
  const palette = normalizeColors(colors);
  const bars = model.bars;
  const canvasHeight = compact ? COMPACT_SVG_HEIGHT : SVG_HEIGHT;
  const railY = compact ? 350 : 326;
  const priceY = compact ? 276 : 250;
  const labelY = compact ? 430 : 402;
  const plotLeft = 40;
  const plotRight = 1160;
  const columnWidth = (plotRight - plotLeft) / bars.length;
  const railWidth = compact ? 3 : 2;
  const endpointRadius = compact ? 6 : 4;
  const endpointStroke = compact ? 3 : 2;
  const dateLabel = formatObservedDate(model.asOf);
  const labelSize = compact ? 30 : 20;
  const priceSize = 72;
  const points = bars.map((bar, index) => ({
    x: plotLeft + columnWidth * (index + 0.5),
    y: railY,
  }));

  const rowMarkup = bars
    .map((bar, index) => {
      const { x, y: valueY } = points[index];
      const rangeLabel = `${formatUsd(bar.lower)} to ${formatUsd(bar.upper)}`;
      const ariaLabel =
        `${bar.label}, ${formatUsd(bar.value)} per GPU hour, ` +
        `observed range ${rangeLabel}`;

      return `
        <g class="gpu-price-bar__row" data-price-bar-row="" data-layer="${escapeXml(bar.id)}"
          data-aria-label="${escapeXml(ariaLabel)}">
          <rect class="gpu-price-bar__hit" x="${plotLeft + columnWidth * index}" y="40"
            width="${columnWidth}" height="${canvasHeight - 80}" fill="transparent"/>
          <circle class="gpu-price-bar__halo" cx="${x}" cy="${valueY}" r="${compact ? 32 : 24}"
            fill="${palette.line}" opacity="0" aria-hidden="true"/>
          <circle class="gpu-price-bar__endpoint" data-price-bar-marker="" cx="${x}" cy="${valueY}"
            r="${endpointRadius}" fill="${palette.paper}" stroke="${palette.line}"
            stroke-width="${endpointStroke}"
            style="transform-box:fill-box;transform-origin:center"/>
          <g data-price-ladder-copy="">
            <text x="${x}" y="${priceY}" fill="${palette.line}" font-family="Geist, sans-serif"
              font-size="${priceSize}" font-weight="500" text-anchor="middle" letter-spacing="-2"
              style="font-variant-numeric:tabular-nums">${escapeXml(formatUsd(bar.value))}</text>
            <text x="${x}" y="${labelY}" fill="${palette.muted}" font-family="Geist Mono, monospace"
              font-size="${labelSize}" font-weight="600" text-anchor="middle" letter-spacing="1">${escapeXml(bar.label)}</text>
          </g>
        </g>`;
    })
    .join("");

  const ariaLabel = `${title}. ${bars
    .map((bar) => `${bar.label} ${formatUsd(bar.value)}`)
    .join(", ")} per GPU hour. Observed ${dateLabel}.`;
  const inner = `
    <desc>${escapeXml(ariaLabel)}</desc>
    <rect width="${SVG_WIDTH}" height="${canvasHeight}" fill="${palette.paper}"/>
    <line data-price-ladder-rail="" x1="${plotLeft}" x2="${plotRight}" y1="${railY}" y2="${railY}"
      stroke="${palette.line}" stroke-width="${railWidth}" stroke-opacity="0.28"
      stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="0"/>
    ${rowMarkup}`;

  return {
    inner,
    ariaLabel,
  };
}

function normalizeColors(colors = {}) {
  const line = colors.line || "#315f82";
  const text = colors.text || line;
  return {
    paper: colors.paper || "#ffffff",
    line,
    muted: colors.muted || withOpacity(text, 0.58),
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
