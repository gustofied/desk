import { area as d3Area, curveMonotoneX, line as d3Line } from "d3";
import {
  viewArtifactHeaderLayout,
  viewArtifactHeaderMarkup,
} from "./view-artifact-header.js";
import {
  VIEW_EASE,
  VIEW_REVEAL_DURATION,
  VIEW_SUPPORT_DURATION,
} from "./view-motion.js";

const SVG_WIDTH = 1200;
const SVG_HEIGHT = 600;
const COMPACT_SVG_HEIGHT = 675;
const MAX_INTERACTION_COLUMNS = 180;

export function renderPowerBasisSvg(model, options = {}) {
  const { inner, ariaLabel, height } = powerBasisMarkup(model, options);
  const accessibility = options.decorative
    ? `aria-hidden="true"`
    : `role="img" aria-label="${escapeXml(ariaLabel)}"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" ` +
    `height="${height}" viewBox="0 0 ${SVG_WIDTH} ${height}" ` +
    `${accessibility}>${inner}</svg>`
  );
}

export function paintPowerBasisChart(
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
  const interactionTarget = svgNode.parentElement;
  const wasFocused =
    interactionTarget === interactionTarget?.ownerDocument.activeElement;
  const focusedTimestamp = interactionTarget?.dataset.powerBasisTimestamp;
  const { inner, ariaLabel, height } = powerBasisMarkup(model, options);
  const canInteract = interactive && !decorative && !options.minimal;

  resetPowerBasisNavigation(interactionTarget);
  svgNode.setAttribute("viewBox", `0 0 ${SVG_WIDTH} ${height}`);
  if (decorative || canInteract) {
    svgNode.setAttribute("aria-hidden", "true");
    svgNode.removeAttribute("role");
    svgNode.removeAttribute("aria-label");
  } else {
    svgNode.removeAttribute("aria-hidden");
    svgNode.setAttribute("role", "img");
    svgNode.setAttribute("aria-label", ariaLabel);
  }
  svgNode.innerHTML = inner;

  if (canInteract) {
    configurePowerBasisNavigation(
      svgNode,
      focusedTimestamp,
      ariaLabel,
      wasFocused,
    );
  }

  if (reducedMotion) return;
  svgNode.querySelector("[data-power-basis-area]")?.animate?.(
    [{ opacity: 0 }, { opacity: 1 }],
    {
      duration: VIEW_SUPPORT_DURATION,
      easing: VIEW_EASE,
      fill: "both",
    },
  );
  svgNode.querySelector('[data-power-basis-line="day-ahead"]')?.animate?.(
    [{ opacity: 0 }, { opacity: 1 }],
    {
      duration: VIEW_SUPPORT_DURATION,
      easing: VIEW_EASE,
      fill: "both",
    },
  );
  svgNode
    .querySelector(
      '[data-power-basis-line="real-time"], [data-power-basis-line="basis"]',
    )
    ?.animate?.(
      [
        { strokeDashoffset: 1, opacity: 0.18 },
        { strokeDashoffset: 0, opacity: 1 },
      ],
      {
        delay: 48,
        duration: VIEW_REVEAL_DURATION,
        easing: VIEW_EASE,
        fill: "both",
      },
    );
}

function powerBasisMarkup(
  model,
  {
    colors,
    title = model?.location?.label,
    mode = "price",
    compact = false,
    artifact = compact,
    minimal = false,
  } = {},
) {
  const normalized = normalizeModel(model);
  const palette = normalizeColors(colors);
  const chartMode = mode === "basis" ? "basis" : "price";
  const height = compact ? COMPACT_SVG_HEIGHT : SVG_HEIGHT;
  const showArtifactHeader = Boolean(artifact);
  const showReadout = !showArtifactHeader && !minimal;
  const headerLayout = viewArtifactHeaderLayout(title, { compact });
  const plotTop = showArtifactHeader
    ? headerLayout.plotTop
    : showReadout
      ? 48
      : 8;
  const plotBottom = showArtifactHeader ? height : height - 8;
  const plot = {
    left: 0,
    right: SVG_WIDTH,
    top: plotTop,
    bottom: plotBottom,
  };
  const firstTime = normalized.rows[0].time;
  const lastTime = normalized.rows.at(-1).time;
  const timeSpan = Math.max(1, lastTime - firstTime);
  const x = (row) =>
    plot.left + ((row.time - firstTime) / timeSpan) * (plot.right - plot.left);
  const values = chartMode === "basis"
    ? [0, ...normalized.rows.map((row) => row.basis)]
    : normalized.rows.flatMap((row) => [row.realTime, row.dayAhead]);
  const [domainMinimum, domainMaximum] = paddedDomain(values);
  const y = (value) =>
    plot.bottom -
    ((value - domainMinimum) / (domainMaximum - domainMinimum)) *
      (plot.bottom - plot.top);
  const line = d3Line()
    .x((row) => x(row))
    .y((row) => y(chartMode === "basis" ? row.basis : row.realTime))
    .curve(curveMonotoneX);
  const dayAheadLine = d3Line()
    .x((row) => x(row))
    .y((row) => y(row.dayAhead))
    .curve(curveMonotoneX);
  const spreadArea = d3Area()
    .x((row) => x(row))
    .y0((row) => y(chartMode === "basis" ? 0 : row.dayAhead))
    .y1((row) => y(chartMode === "basis" ? row.basis : row.realTime))
    .curve(curveMonotoneX);
  const primaryWidth = compact ? 6 : 3.5;
  const secondaryWidth = compact ? 3 : 1.75;
  const safeTitle = String(title || normalized.location.label).slice(0, 48);
  const latest = normalized.latest;
  const artifactHeader = showArtifactHeader
    ? viewArtifactHeaderMarkup({
        title: safeTitle,
        context: formatRange(normalized.range),
        headline: chartMode === "basis"
          ? formatBasis(latest.basis)
          : formatPrice(latest.realTime),
        colors: palette,
        compact,
        overlap: true,
      })
    : "";
  const baseline = chartMode === "basis"
    ? `<line class="power-basis__zero" x1="${plot.left}" x2="${plot.right}"
        y1="${coordinate(y(0))}" y2="${coordinate(y(0))}"
        stroke="${palette.secondary}" stroke-width="1" stroke-opacity="0.18"
        stroke-dasharray="2 8" vector-effect="non-scaling-stroke"
        pointer-events="none" aria-hidden="true"/>`
    : "";
  const secondaryLine = chartMode === "price"
    ? `<path class="power-basis__line power-basis__line--day-ahead"
        data-power-basis-line="day-ahead" d="${dayAheadLine(normalized.rows)}"
        fill="none" stroke="${palette.secondary}" stroke-width="${secondaryWidth}"
        stroke-opacity="0.42" stroke-dasharray="2 8" stroke-linecap="round"
        stroke-linejoin="round" vector-effect="non-scaling-stroke"
        pointer-events="none" aria-hidden="true"/>`
    : "";
  const readout = showReadout
    ? readoutMarkup(latest, chartMode, palette, plot, x(latest), y)
    : "";
  const columns = showReadout
    ? interactionColumnMarkup(
        normalized.rows,
        normalized.location.unit,
        chartMode,
        plot,
        x,
        y,
      )
    : "";
  const ariaLabel = normalized.ariaLabel || defaultAriaLabel(
    safeTitle,
    normalized,
  );
  const inner = `
    <desc>${escapeXml(ariaLabel)}</desc>
    <rect width="${SVG_WIDTH}" height="${height}" fill="${palette.paper}"/>
    ${baseline}
    <path class="power-basis__spread-area" data-power-basis-area=""
      d="${spreadArea(normalized.rows)}" fill="${palette.area}"
      fill-opacity="${chartMode === "basis" ? 0.1 : 0.075}"
      pointer-events="none" aria-hidden="true"/>
    ${secondaryLine}
    <path class="power-basis__line power-basis__line--${chartMode === "basis" ? "basis" : "real-time"}"
      data-power-basis-line="${chartMode === "basis" ? "basis" : "real-time"}"
      d="${line(normalized.rows)}" fill="none" stroke="${palette.line}"
      stroke-width="${primaryWidth}" stroke-linecap="round" stroke-linejoin="round"
      vector-effect="non-scaling-stroke" pathLength="1"
      stroke-dasharray="1" stroke-dashoffset="0"
      pointer-events="none" aria-hidden="true"/>
    ${columns}
    ${readout}
    ${artifactHeader}`;

  return { inner, ariaLabel, height };
}

function readoutMarkup(row, mode, palette, plot, activeX, y) {
  const realTimeY = y(mode === "basis" ? row.basis : row.realTime);
  const secondaryDot = mode === "price"
    ? `<circle data-power-basis-secondary-dot="" cx="${coordinate(activeX)}"
      cy="${coordinate(y(row.dayAhead))}" r="4" fill="${palette.paper}"
      stroke="${palette.secondary}" stroke-width="2" vector-effect="non-scaling-stroke"/>`
    : "";
  return `<g class="power-basis__readout" data-power-basis-readout=""
      pointer-events="none">
    <line data-power-basis-guide="" x1="${coordinate(activeX)}"
      x2="${coordinate(activeX)}" y1="${plot.top}" y2="${plot.bottom}"
      stroke="${palette.line}" stroke-width="1" stroke-opacity="0.2"
      vector-effect="non-scaling-stroke"/>
    <circle data-power-basis-primary-dot="" cx="${coordinate(activeX)}"
      cy="${coordinate(realTimeY)}" r="5" fill="${palette.line}"
      stroke="${palette.paper}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
    ${secondaryDot}
    <text x="2%" y="32" font-family="Geist Mono, monospace" font-size="16"
      letter-spacing="0.04em">
      <tspan data-power-basis-date="" fill="${palette.line}" font-weight="600">${escapeXml(formatDate(row.date))}</tspan>
    </text>
    <text x="30%" y="32" font-family="Geist Mono, monospace" font-size="16"
      letter-spacing="0.04em">
      <tspan data-power-basis-real-time="" fill="${palette.line}" font-weight="600">${escapeXml(`RT ${formatPrice(row.realTime)}`)}</tspan>
    </text>
    <text x="52%" y="32" font-family="Geist Mono, monospace" font-size="16"
      letter-spacing="0.04em">
      <tspan data-power-basis-day-ahead="" fill="${palette.secondary}">${escapeXml(`DA ${formatPrice(row.dayAhead)}`)}</tspan>
    </text>
    <text x="74%" y="32" font-family="Geist Mono, monospace" font-size="16"
      letter-spacing="0.04em">
      <tspan data-power-basis-value="" fill="${palette.secondary}">${escapeXml(`SPREAD ${formatBasis(row.basis)}`)}</tspan>
    </text>
  </g>`;
}

function interactionColumnMarkup(rows, unit, mode, plot, x, y) {
  const sampled = sampleInteractionRows(rows);
  return sampled
    .map((row, index) => {
      const center = x(row);
      const previous = sampled[index - 1];
      const next = sampled[index + 1];
      const left = previous ? (x(previous) + center) / 2 : plot.left;
      const right = next ? (center + x(next)) / 2 : plot.right;
      const primaryY = y(mode === "basis" ? row.basis : row.realTime);
      const secondaryY = y(mode === "basis" ? 0 : row.dayAhead);
      return `<g class="power-basis__column" data-power-basis-column=""
          data-timestamp="${escapeXml(row.timestamp)}"
          data-x="${coordinate(center)}" data-primary-y="${coordinate(primaryY)}"
          data-secondary-y="${coordinate(secondaryY)}"
          data-date="${escapeXml(formatDate(row.date))}"
          data-real-time="${escapeXml(formatPrice(row.realTime))}"
          data-day-ahead="${escapeXml(formatPrice(row.dayAhead))}"
          data-basis="${escapeXml(formatBasis(row.basis))}"
          data-aria-label="${escapeXml(rowAriaLabel(row, unit))}">
        <rect x="${coordinate(left)}" y="${plot.top}"
          width="${coordinate(Math.max(1, right - left))}"
          height="${coordinate(plot.bottom - plot.top)}"
          fill="transparent"/>
      </g>`;
    })
    .join("");
}

function configurePowerBasisNavigation(
  svgNode,
  focusedTimestamp,
  ariaLabel,
  wasFocused,
) {
  const columns = Array.from(
    svgNode.querySelectorAll("[data-power-basis-column]"),
  );
  const readout = svgNode.querySelector("[data-power-basis-readout]");
  if (!columns.length || !readout) return;
  const target = svgNode.parentElement;
  if (!target) return;
  const controller = new AbortController();
  const live = target.ownerDocument.createElement("span");
  live.className = "power-basis__live";
  live.dataset.powerBasisLive = "";
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");
  target.__deskPowerBasisNavigation = controller;
  target.dataset.powerBasisInteractive = "";
  target.classList.add("power-basis__interactive");
  target.tabIndex = 0;
  target.setAttribute("role", "group");
  target.setAttribute(
    "aria-label",
    `${ariaLabel} Use the arrow keys to inspect observations. Hold Shift to move 24 observations.`,
  );
  target.append(live);

  let activeIndex = columns.findIndex(
    (column) => column.dataset.timestamp === focusedTimestamp,
  );
  if (activeIndex < 0) activeIndex = columns.length - 1;

  const updateReadout = (column) => {
    const activeX = column.dataset.x;
    const primaryY = column.dataset.primaryY;
    const secondaryY = column.dataset.secondaryY;
    readout.querySelector("[data-power-basis-guide]")?.setAttribute("x1", activeX);
    readout.querySelector("[data-power-basis-guide]")?.setAttribute("x2", activeX);
    const primary = readout.querySelector("[data-power-basis-primary-dot]");
    primary?.setAttribute("cx", activeX);
    primary?.setAttribute("cy", primaryY);
    const secondary = readout.querySelector("[data-power-basis-secondary-dot]");
    secondary?.setAttribute("cx", activeX);
    secondary?.setAttribute("cy", secondaryY);
    setText(readout, "[data-power-basis-date]", column.dataset.date);
    setText(readout, "[data-power-basis-real-time]", `RT ${column.dataset.realTime}`);
    setText(readout, "[data-power-basis-day-ahead]", `DA ${column.dataset.dayAhead}`);
    setText(readout, "[data-power-basis-value]", `SPREAD ${column.dataset.basis}`);
  };
  const announce = (column) => {
    live.textContent = "";
    queueMicrotask(() => {
      live.textContent = column.dataset.ariaLabel || "";
    });
  };
  const selectColumn = (index, shouldAnnounce = true) => {
    activeIndex = Math.max(0, Math.min(columns.length - 1, index));
    const column = columns[activeIndex];
    target.dataset.powerBasisTimestamp = column.dataset.timestamp;
    updateReadout(column);
    if (shouldAnnounce) announce(column);
  };

  columns.forEach((column, index) => {
    column.setAttribute("aria-hidden", "true");
    column.addEventListener("pointerenter", () => selectColumn(index, false), {
      signal: controller.signal,
    });
    column.addEventListener("pointerdown", () => {
      selectColumn(index);
      target.focus({ preventScroll: true });
    }, { signal: controller.signal });
  });
  target.addEventListener("focus", () => selectColumn(activeIndex, false), {
    signal: controller.signal,
  });
  target.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 24 : 1;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      selectColumn(activeIndex + step);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      selectColumn(activeIndex - step);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectColumn(0);
    } else if (event.key === "End") {
      event.preventDefault();
      selectColumn(columns.length - 1);
    }
  }, { signal: controller.signal });
  selectColumn(activeIndex, false);
  if (wasFocused) {
    queueMicrotask(() => target.focus({ preventScroll: true }));
  }
}

function resetPowerBasisNavigation(target) {
  if (!target) return;
  const ownsNavigation = target.hasAttribute("data-power-basis-interactive");
  target.__deskPowerBasisNavigation?.abort();
  delete target.__deskPowerBasisNavigation;
  target.removeAttribute("data-power-basis-interactive");
  target.classList.remove("power-basis__interactive");
  if (ownsNavigation) {
    target.removeAttribute("tabindex");
    target.removeAttribute("role");
    target.removeAttribute("aria-label");
  }
  target.querySelector("[data-power-basis-live]")?.remove();
}

function normalizeModel(model) {
  if (
    !model?.location ||
    typeof model.location.label !== "string" ||
    !model.location.label.trim() ||
    !Array.isArray(model.rows) ||
    model.rows.length < 2
  ) {
    throw new TypeError("A power basis model with at least two rows is required");
  }
  const rows = model.rows
    .map(normalizeRow)
    .filter(Boolean)
    .sort((left, right) => left.time - right.time);
  if (rows.length < 2) {
    throw new TypeError("At least two usable power basis observations are required");
  }
  const latestSource = normalizeRow(model.latest);
  const latest = latestSource || rows.at(-1);
  return {
    location: model.location,
    range: model.range,
    rows,
    latest,
    ariaLabel: typeof model.ariaLabel === "string" ? model.ariaLabel.trim() : "",
  };
}

function normalizeRow(row) {
  if (!row || typeof row !== "object") return null;
  const date = row.date instanceof Date
    ? new Date(row.date.getTime())
    : dateFromTimestamp(row.date ?? row.timestamp);
  const realTime = Number(row.realTime);
  const dayAhead = Number(row.dayAhead);
  const basisValue = Number(row.basis);
  if (
    Number.isNaN(date.getTime()) ||
    !Number.isFinite(realTime) ||
    !Number.isFinite(dayAhead)
  ) {
    return null;
  }
  const time = date.getTime();
  return {
    ...row,
    date,
    time,
    timestamp: String(row.timestamp ?? time),
    realTime,
    dayAhead,
    basis: Number.isFinite(basisValue) ? basisValue : realTime - dayAhead,
  };
}

function dateFromTimestamp(value) {
  if (value === null || value === undefined || value === "") {
    return new Date(Number.NaN);
  }
  if (typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value.trim())) {
    return new Date(value);
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return new Date(Number.NaN);
  return new Date(Math.abs(numeric) < 1e12 ? numeric * 1000 : numeric);
}

function sampleInteractionRows(rows) {
  if (rows.length <= MAX_INTERACTION_COLUMNS) return rows;
  const lastIndex = rows.length - 1;
  const indexes = Array.from(
    { length: MAX_INTERACTION_COLUMNS },
    (_, index) => Math.round((index / (MAX_INTERACTION_COLUMNS - 1)) * lastIndex),
  );
  return indexes
    .filter((value, index) => indexes.indexOf(value) === index)
    .map((index) => rows[index]);
}

function paddedDomain(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return [-1, 1];
  let minimum = Math.min(...finite);
  let maximum = Math.max(...finite);
  if (minimum === maximum) {
    const offset = Math.max(1, Math.abs(minimum) * 0.08);
    return [minimum - offset, maximum + offset];
  }
  const padding = (maximum - minimum) * 0.08;
  minimum -= padding;
  maximum += padding;
  return [minimum, maximum];
}

function normalizeColors(colors) {
  const required = ["paper", "line", "secondary", "area"];
  if (!colors || required.some((name) => !String(colors[name] || "").trim())) {
    throw new TypeError(
      "Power basis colors must include paper, line, secondary, and area",
    );
  }
  return Object.freeze(
    Object.fromEntries(
      required.map((name) => [name, escapeXml(String(colors[name]).trim())]),
    ),
  );
}

function defaultAriaLabel(title, model) {
  const latest = model.latest;
  const unit = model.location.unit || "USD per MWh";
  const market = model.location.market
    ? ` in ${model.location.market}`
    : "";
  return `${title}${market}. Real-time power ${formatPrice(latest.realTime)} ${unit}. ` +
    `Day-ahead power ${formatPrice(latest.dayAhead)} ${unit}. ` +
    `Spread ${formatBasis(latest.basis)} ${unit}. ` +
    `${formatRange(model.range)} history.`;
}

function rowAriaLabel(row, unit) {
  const suffix = unit ? ` ${unit}` : "";
  return `${formatDate(row.date)}. Real time ${formatPrice(row.realTime)}${suffix}. ` +
    `Day ahead ${formatPrice(row.dayAhead)}${suffix}. ` +
    `Spread ${formatBasis(row.basis)}${suffix}.`;
}

function formatRange(range) {
  const value = typeof range === "object" && range
    ? range.label ?? range.id
    : range;
  return String(value || "").trim().toUpperCase();
}

function formatPrice(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "N/A";
  return amount < 0
    ? `−$${Math.abs(amount).toFixed(2)}`
    : `$${amount.toFixed(2)}`;
}

function formatBasis(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "N/A";
  const sign = amount > 0 ? "+" : amount < 0 ? "−" : "";
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  })
    .format(date)
    .replace(",", "")
    .toUpperCase();
}

function setText(root, selector, value) {
  const node = root.querySelector(selector);
  if (node) node.textContent = value || "";
}

function coordinate(value) {
  return Math.round(Number(value) * 100) / 100;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
