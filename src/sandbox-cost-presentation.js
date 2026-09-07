import { area as d3Area, curveMonotoneX, interpolateRgb, line as d3Line, scaleBand, scaleLinear } from "d3";
import { animateChartDraw, animateChartSupport, cancelChartMotion } from "./chart-motion.js";
import { viewArtifactHeaderMarkup } from "./view-artifact-header.js";

const WIDTH = 1200;
const HEIGHT = 600;
const MOBILE_HEIGHT = 800;
const COMPACT_HEIGHT = 675;
const INSET = 16;
const PROVIDER_ORDER = ["blaxel", "daytona-vm", "e2b", "modal-gvisor", "modal-vm", "novita"];
const controllers = new WeakMap();
const INSTRUCTIONS = "Use Left and Right to inspect observations, Up and Down to change provider, and Home or End to reach the first or last observation.";

/** Static exports and embedded previews share the same authored SVG geometry. */
export function renderSandboxCostSvg(model, options = {}) {
  const chart = markup(model, options);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${chart.height}"
    viewBox="0 0 ${WIDTH} ${chart.height}" ${options.decorative ? 'aria-hidden="true"'
      : `role="img" aria-label="${escapeXml(chart.label)}"`}>${chart.inner}</svg>`;
}

/** Listeners belong to the removable chart group, not the shared SVG or parent. */
export function paintSandboxCostChart(svg, model, options = {}) {
  if (!svg) return;
  const oldRoot = svg.querySelector("[data-sandbox-chart]");
  const old = oldRoot && controllers.get(oldRoot);
  const focused = svg.ownerDocument?.activeElement === oldRoot;
  const selected = old?.selected;
  old?.abort();
  if (oldRoot) controllers.delete(oldRoot);
  cancelChartMotion(svg);
  const mobile = options.minimal || (svg.clientWidth > 0 &&
    (options.compact ? svg.clientWidth <= 480 : svg.clientWidth < 640));
  // Match the host's actual chart height instead of letterboxing the mobile
  // Monitor. Preview cards retain Desk's shared 16:9 artifact dimensions.
  const measuredHeight = !options.compact && svg.clientWidth > 0 && svg.clientHeight > 0
    ? WIDTH * svg.clientHeight / svg.clientWidth : null;
  const chart = markup(model, { ...options, _mobile: mobile,
    _pixelWidth: svg.clientWidth, _height: measuredHeight });
  const interactive = options.interactive !== false && !options.decorative;
  svg.setAttribute("viewBox", `0 0 ${WIDTH} ${chart.height}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.innerHTML = chart.inner;
  svg.removeAttribute("tabindex");
  svg.removeAttribute("aria-hidden");
  svg.removeAttribute("role");
  svg.removeAttribute("aria-label");
  if (options.decorative) svg.setAttribute("aria-hidden", "true");
  else {
    svg.setAttribute("role", interactive ? "group" : "img");
    svg.setAttribute("aria-label", chart.label + (interactive ? ` ${INSTRUCTIONS}` : ""));
  }
  if (interactive) {
    configureNavigation(svg, chart, selected);
    if (focused) svg.querySelector("[data-sandbox-chart]").focus({ preventScroll: true });
  } else {
    svg.querySelectorAll("[data-sandbox-hit]").forEach(node => node.remove());
  }
  if (options.reducedMotion || options.decorative) return;
  svg.querySelectorAll("[data-sandbox-history-segment]").forEach((node, index) => animateChartDraw(node, { delay: index * 45 }));
  svg.querySelectorAll("[data-sandbox-distribution]").forEach((node, index) => animateChartSupport(node, { delay: index * 42 }));
  svg.querySelectorAll("[data-sandbox-history-area]").forEach(node => animateChartSupport(node));
}

function markup(model, { colors, compact = false, artifact = compact, minimal = false, gallery = false, _mobile = false,
  _pixelWidth = 0, _height = null,
  title = "Sandbox cost" } = {}) {
  const normalized = normalizeModel(model);
  const palette = normalizeColors(colors);
  const isLatest = normalized.range === "now";
  const height = compact ? COMPACT_HEIGHT : Number.isFinite(_height) && _height > 0
    ? coord(_height) : minimal || _mobile ? MOBILE_HEIGHT : HEIGHT;
  const narrow = !gallery && (minimal || _mobile);
  // Ported from AdamSioud's sandbox-market-card.source.js: rounded distributions
  // or edge-to-edge, independently scaled history lanes, without the price tiles.
  // Only the host geometry, palette and removable event ownership are Desk's.
  // Gallery spends its space on the data and one aggregate headline. Keep
  // provider labels and axes in Focus, Monitor and the interactive previews.
  const measuredWidth = _pixelWidth > 0 ? _pixelWidth : compact ? narrow ? 320 : 600 : narrow ? 390 : 960;
  const pixelWidth = gallery ? 600 : measuredWidth;
  const unit = WIDTH / pixelWidth;
  const stroke = value => coord(value);
  const smallFont = coord((compact || narrow ? 12 : 14) * unit);
  const gutter = coord((compact || narrow ? 12 : 16) * unit);
  const medianHalf = gallery ? 12 : coord((compact ? 4 : 8) * unit);
  const inlineHistory = !isLatest && compact && pixelWidth < 480;
  const plotTop = artifact ? gallery ? 240 : 128 : 0;
  const plotBottom = height - (gallery ? isLatest ? 0 : INSET : isLatest ? smallFont + gutter * 2 : 0);
  const labelWidth = Math.max(...normalized.providers.map(provider => provider.label.length)) * smallFont * 0.64;
  const valueWidth = Math.max(...normalized.providers.map(provider => formatCents(provider.median).length)) * smallFont * 0.64;
  const plotLeft = gallery ? 0 : isLatest || inlineHistory ? coord(labelWidth + gutter * 2) : 0;
  const plotRight = gallery ? WIDTH : isLatest || inlineHistory ? coord(WIDTH - valueWidth - gutter * 2) : WIDTH;
  const laneHeight = (plotBottom - plotTop) / normalized.providers.length;
  // A distribution plot need not begin at zero. Gallery fits one shared scale
  // to the observed bounds; a constant extent maps safely to D3's midpoint.
  const costDomain = gallery
    ? [Math.min(...normalized.providers.map(provider => provider.minimum)),
      Math.max(...normalized.providers.map(provider => provider.maximum))]
    : [0, Math.max(0.0001, ...normalized.providers.map(provider => provider.maximum)) * 1.06];
  const x = scaleLinear().domain(isLatest ? costDomain : [normalized.start, normalized.end])
    .range([plotLeft, plotRight]);
  if (isLatest && !gallery) x.nice(5);
  const latestHistory = provider => provider.history.filter(point => point.value !== null).at(-1)?.value ?? Infinity;
  const ordered = [...normalized.providers].sort((a, b) =>
    (isLatest ? a.median : latestHistory(a)) - (isLatest ? b.median : latestHistory(b)));
  // Equal weight per displayed provider, not a pooled replicate statistic.
  // History uses the last observed batch median for each available provider.
  const averageValues = ordered.map(provider => isLatest ? provider.median : latestHistory(provider)).filter(Number.isFinite);
  const average = averageValues.length ? averageValues.reduce((sum, value) => sum + value / averageValues.length, 0) : null;
  const averageHeadline = average === null ? "—" : formatCents(average);
  const averageSummary = `Average cost ${average === null ? "unavailable" : averageHeadline}; unweighted mean of ${averageValues.length} displayed providers' ${isLatest ? "medians" : "last available batch medians"}.`;
  const latestY = scaleBand().domain(ordered.map(provider => provider.id))
    .range([plotTop + (gallery ? 0 : gutter), plotBottom]).padding(gallery ? 0.24 : 0.42);
  const overview = ordered.map(provider => `${provider.label} ${formatCents(isLatest ? provider.median : latestHistory(provider))}`).join("; ");
  const label = `${title}. Cost estimate in cents per job. ${gallery ? `${averageSummary} ` : ""}${overview}. ${isLatest ? "Latest replicate distributions" : "Batch median history; each provider has its own vertical scale"}. As of ${formatDay(normalized.asOf, true)}.`;
  normalized.providers.forEach((provider, index) => {
    // Retain the original series-specific tonal hierarchy in the chosen theme.
    const order = PROVIDER_ORDER.indexOf(provider.id);
    provider.color = interpolateRgb(palette.secondary, palette.line)(0.35 + (order < 0 ? index : order) * 0.13);
  });
  const lanes = ordered.map((provider, index) => {
    const top = plotTop + laneHeight * index;
    const bottom = top + laneHeight;
    const center = isLatest ? latestY(provider.id) + latestY.bandwidth() / 2 : (top + bottom) / 2;
    const points = [];
    let drawing;
    if (isLatest) {
      const start = x(provider.minimum);
      const end = x(provider.maximum);
      const medianX = x(provider.median);
      drawing = `<line x1="${coord(plotLeft)}" x2="${plotRight}" y1="${coord(center)}" y2="${coord(center)}"
        stroke="${palette.secondary}" stroke-opacity="0.08" stroke-width="${stroke(1)}" vector-effect="non-scaling-stroke" pointer-events="none"/>
        <g data-sandbox-distribution="${escapeXml(provider.id)}" pointer-events="none">
        <line data-sandbox-whisker="" x1="${coord(start)}" x2="${coord(end)}" y1="${coord(center)}" y2="${coord(center)}"
          stroke="${provider.color}" stroke-opacity="${gallery ? 0.64 : 0.5}" stroke-width="${stroke(1.25)}" stroke-linecap="round" fill="none" vector-effect="non-scaling-stroke"/>
        <line data-sandbox-iqr="" x1="${coord(x(provider.p25))}" x2="${coord(x(provider.p75))}" y1="${coord(center)}" y2="${coord(center)}"
          stroke="${provider.color}" stroke-opacity="${gallery ? 0.88 : 0.72}" stroke-width="${stroke(gallery ? 3 : compact ? 4 : 6)}" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
        <line data-sandbox-median="" x1="${coord(medianX)}" x2="${coord(medianX)}" y1="${coord(center - medianHalf)}" y2="${coord(center + medianHalf)}"
          stroke="${provider.color}" stroke-width="${stroke(gallery ? 1.5 : 2)}" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      </g>
      ${gallery ? "" : text(plotLeft - gutter, center + smallFont * 0.32, provider.label, provider.color, smallFont, 'data-sandbox-label="" text-anchor="end" pointer-events="none"', "500")}
      ${gallery ? "" : text(WIDTH - gutter, center + smallFont * 0.32, formatCents(provider.median), provider.color, smallFont, 'data-sandbox-latest-value="" text-anchor="end" pointer-events="none"', "600")}`;
      points.push({ time: normalized.asOf, value: provider.median, x: medianX, y: center,
        detail: `${provider.label}: median ${formatCents(provider.median)}, minimum ${formatCents(provider.minimum)}, 25th percentile ${formatCents(provider.p25)}, 75th percentile ${formatCents(provider.p75)}, maximum ${formatCents(provider.maximum)}.` });
    } else {
      const finite = provider.history.filter(point => point.value !== null);
      const minimum = finite.length ? Math.min(...finite.map(point => point.value)) : 0;
      const maximum = finite.length ? Math.max(...finite.map(point => point.value)) : 0;
      const spread = Math.max(maximum - minimum, maximum * 0.035, 0.00035);
      const y = scaleLinear().domain([Math.max(0, minimum - spread * 0.24), maximum + spread * 0.24])
        .range([bottom - Math.min(gutter / 2, laneHeight * 0.1),
          top + (gallery ? Math.min(gutter / 2, laneHeight * 0.1) : inlineHistory ? gutter / 2 : smallFont + 8 * unit)]);
      // Original monotone curves interpolate the observed points only. The soft
      // trailing area is decorative ink, never presented as a measured band.
      drawing = segments(provider.history).map((segment, segmentIndex) => {
        const path = d3Line().x(point => x(point.time)).y(point => y(point.value)).curve(curveMonotoneX)(segment);
        const area = d3Area().x(point => x(point.time)).y1(point => y(point.value))
          .y0(point => Math.min(bottom, y(point.value) + Math.min(24, laneHeight * 0.28)))
          .curve(curveMonotoneX)(segment);
        return `<path data-sandbox-history-area="" aria-hidden="true" d="${area}" fill="${provider.color}" opacity="0.14" pointer-events="none"/>
          <path data-sandbox-history="${escapeXml(provider.id)}" data-sandbox-history-segment="${segmentIndex}"
          d="${path}" data-sandbox-history-observations="${segment.length}" fill="none" stroke="${provider.color}" stroke-width="${stroke(provider.id === normalized.primary ? 2.5 : 1.9)}"
          stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" pointer-events="none"/>` +
          (segment.length === 1 ? `<circle data-sandbox-observation="${escapeXml(provider.id)}" cx="${coord(x(segment[0].time))}" cy="${coord(y(segment[0].value))}" r="3" fill="${provider.color}" pointer-events="none"/>` : "");
      }).join("");
      drawing = `<line data-sandbox-row-rule="" x1="0" x2="${WIDTH}" y1="${coord(top)}" y2="${coord(top)}" stroke="${palette.secondary}" stroke-opacity="0.14" stroke-width="${stroke(0.7)}" vector-effect="non-scaling-stroke"/>
        ${gallery ? "" : text(inlineHistory ? plotLeft - gutter : gutter, inlineHistory ? center + smallFont * 0.32 : top + smallFont + 4 * unit,
          provider.label, provider.color, smallFont, `data-sandbox-label="" ${inlineHistory ? 'text-anchor="end"' : ''} pointer-events="none"`, "500")}
        ${gallery ? "" : text(WIDTH - gutter, inlineHistory ? center + smallFont * 0.32 : top + smallFont + 4 * unit,
          formatCents(finite.at(-1)?.value), provider.color, smallFont, 'data-sandbox-latest-value="" text-anchor="end" pointer-events="none"', "600")}
        ${drawing}`;
      finite.forEach(point => points.push({ ...point, x: x(point.time), y: y(point.value),
        detail: `${provider.label}: batch median ${formatCents(point.value)}.` }));
    }
    provider.points = points;
    return `<g data-sandbox-provider="${escapeXml(provider.id)}" data-sandbox-primary="${provider.id === normalized.primary}">
      ${drawing}
      <rect data-sandbox-hit="${escapeXml(provider.id)}" x="0" y="${coord(top)}" width="${WIDTH}" height="${coord(laneHeight)}" fill="${provider.color}" fill-opacity="0" aria-hidden="true" style="cursor:crosshair"/>
    </g>`;
  }).join("");
  const ticks = isLatest && !gallery ? x.ticks(narrow ? 4 : 6) : [];
  const grid = isLatest ? ticks.map(value => `<line x1="${coord(x(value))}" x2="${coord(x(value))}"
    y1="${plotTop}" y2="${plotBottom}" stroke="${palette.secondary}" stroke-opacity="0.08" stroke-width="${stroke(1)}"
    vector-effect="non-scaling-stroke" pointer-events="none"/>`).join("") : "";
  const axis = gallery ? "" : ticks.map((value, index) => text(x(value), height - gutter,
    `${Number((value * 100).toFixed(2))}¢`, palette.secondary, smallFont,
    `text-anchor="${index === 0 ? "start" : index === ticks.length - 1 ? "end" : "middle"}" pointer-events="none"`)).join("");
  const artifactHeader = artifact ? viewArtifactHeaderMarkup({ title, context: isLatest ? "LATEST" : normalized.range.toUpperCase(),
    headline: gallery ? averageHeadline : "", colors: palette, compact }) : "";
  const header = artifact && gallery ? `<g data-sandbox-average="" data-value="${average ?? ""}" data-provider-count="${averageValues.length}" data-method="mean-of-provider-medians" data-summary="${escapeXml(averageSummary)}">
    ${artifactHeader}
  </g>` : artifactHeader;
  const initial = ordered.find(provider => provider.id === normalized.primary && provider.points.length)
    || ordered.find(provider => provider.points.length);
  const point = initial?.points.at(-1);
  const tooltip = { width: Math.min(WIDTH - gutter * 2, 288 * unit), height: (isLatest ? 112 : 88) * unit,
    gap: 12 * unit, padding: 16 * unit, font: 12 * unit };
  const tooltipFont = tooltip.font;
  const inner = `<g data-sandbox-chart="${normalized.range}" data-sandbox-layout="${gallery ? "gallery" : inlineHistory ? "inline" : "full"}">
    <desc>${escapeXml(label)}</desc><rect data-sandbox-canvas="" width="${WIDTH}" height="${height}" fill="${palette.paper}"/>
    ${header}
    ${grid}${lanes}${axis}
    <g data-sandbox-readout="" pointer-events="none" visibility="hidden">
      <circle data-sandbox-active-marker="" r="4" fill="${palette.line}" stroke="${palette.paper}" stroke-width="2" vector-effect="non-scaling-stroke"/>
      <g data-sandbox-tooltip="">
        <rect width="${tooltip.width}" height="${tooltip.height}" rx="4" fill="${palette.paper}" stroke="${palette.secondary}" stroke-opacity="0.4" stroke-width="1" vector-effect="non-scaling-stroke"/>
        ${text(tooltip.padding, tooltip.padding + tooltipFont, "", palette.secondary, tooltipFont, 'data-sandbox-tooltip-title=""', "500")}
        ${text(tooltip.width - tooltip.padding, tooltip.padding + tooltipFont, "", palette.secondary, tooltipFont, 'data-sandbox-readout-date="" text-anchor="end"', "500")}
        ${text(tooltip.padding, tooltip.padding + tooltipFont + 32 * unit, "", palette.line, 24 * unit, 'data-sandbox-readout-value=""', "600")}
        ${text(tooltip.padding, tooltip.height - tooltip.padding, "", palette.secondary, tooltipFont, 'data-sandbox-tooltip-detail=""')}
      </g>
    </g>
  </g>`;
  return { inner, height, label, isLatest, tooltip, providers: ordered, initial: point ? { id: initial.id, time: point.time } : null };
}

function configureNavigation(svg, chart, previous) {
  const target = svg.querySelector("[data-sandbox-chart]");
  const controller = new AbortController();
  const owner = { selected: previous || chart.initial, abort: () => controller.abort() };
  controllers.set(target, owner);
  target.setAttribute("tabindex", "0");
  target.setAttribute("role", "group");
  target.setAttribute("aria-label", `${chart.label} ${INSTRUCTIONS}`);
  const options = { signal: controller.signal };
  let providerIndex = Math.max(0, chart.providers.findIndex(provider => provider.id === owner.selected?.id));
  let pointIndex = 0;
  const readout = svg.querySelector("[data-sandbox-readout]");
  const tooltip = svg.querySelector("[data-sandbox-tooltip]");
  let highlighted = null;
  let renderedObservation = null;
  const highlight = id => {
    if (id === highlighted) return;
    highlighted = id;
    svg.querySelectorAll("[data-sandbox-history]").forEach(path => {
      path.setAttribute("opacity", id && path.getAttribute("data-sandbox-history") !== id ? "0.16" : "1");
    });
    svg.querySelectorAll("[data-sandbox-hit]").forEach(hit => {
      hit.setAttribute("fill-opacity", chart.isLatest && hit.getAttribute("data-sandbox-hit") === id ? "0.06" : "0");
    });
  };
  const hide = () => { readout.setAttribute("visibility", "hidden"); highlight(null); renderedObservation = null; };
  const select = (nextProvider, nextPoint, visible = true) => {
    const provider = chart.providers[nextProvider];
    if (!provider?.points.length) return;
    providerIndex = nextProvider;
    pointIndex = Math.max(0, Math.min(provider.points.length - 1, nextPoint));
    const point = provider.points[pointIndex];
    owner.selected = { id: provider.id, time: point.time };
    const nextObservation = `${provider.id}:${point.time}:${visible}`;
    if (renderedObservation === nextObservation) return;
    renderedObservation = nextObservation;
    readout.setAttribute("visibility", visible ? "visible" : "hidden");
    svg.querySelector("[data-sandbox-tooltip-title]").textContent = provider.label;
    svg.querySelector("[data-sandbox-readout-value]").textContent = `${formatCents(point.value)}${chart.isLatest ? " median" : ""}`;
    svg.querySelector("[data-sandbox-readout-date]").textContent = formatDay(point.time, true);
    svg.querySelector("[data-sandbox-tooltip-detail]").textContent = chart.isLatest
      ? `${formatCents(provider.p25)} – ${formatCents(provider.p75)}${Number.isFinite(provider.runtime?.median) ? `\u2003${Math.round(provider.runtime.median)}s` : ""}`
      : "";
    const left = Math.min(WIDTH - chart.tooltip.width - INSET,
      Math.max(INSET, point.x + chart.tooltip.gap + chart.tooltip.width > WIDTH
        ? point.x - chart.tooltip.width - chart.tooltip.gap : point.x + chart.tooltip.gap));
    const top = Math.max(INSET, Math.min(chart.height - chart.tooltip.height - INSET,
      point.y - chart.tooltip.height - chart.tooltip.gap));
    tooltip.setAttribute("transform", `translate(${coord(left)},${coord(top)})`);
    highlight(visible ? provider.id : null);
    const marker = svg.querySelector("[data-sandbox-active-marker]");
    marker.setAttribute("cx", coord(point.x));
    marker.setAttribute("cy", coord(point.y));
    target.setAttribute("aria-label", `${point.detail} ${chart.isLatest ? formatDate(point.time, true) : formatDay(point.time, true)}. Cost estimate in cents per job. ${INSTRUCTIONS}`);
  };
  const nearest = (points, target, field = "time") => points.reduce((best, point, index) =>
    Math.abs(point[field] - target) < Math.abs(points[best][field] - target) ? index : best, 0);
  const initialProvider = chart.providers[providerIndex];
  if (initialProvider?.points.length) select(providerIndex, nearest(initialProvider.points, owner.selected?.time ?? Infinity), false);
  svg.querySelectorAll("[data-sandbox-hit]").forEach((hit, index) => {
    const inspect = event => {
      const points = chart.providers[index].points;
      if (!points.length) return;
      const matrix = svg.getScreenCTM?.();
      const rect = svg.getBoundingClientRect();
      const x = matrix?.a ? (event.clientX - matrix.e) / matrix.a : (event.clientX - rect.left) * WIDTH / rect.width;
      select(index, nearest(points, x, "x"));
    };
    hit.addEventListener("pointermove", inspect, options);
    hit.addEventListener("pointerdown", event => { inspect(event); target.focus({ preventScroll: true }); }, options);
  });
  target.addEventListener("pointerleave", event => {
    // Touch pointers leave on release; keep the tapped observation readable.
    if (event.pointerType !== "touch") hide();
  }, options);
  target.addEventListener("focus", () => select(providerIndex, pointIndex), options);
  target.addEventListener("blur", hide, options);
  target.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const points = chart.providers[providerIndex].points;
    if (!points.length) return;
    if (event.key === "Home" || event.key === "End") select(providerIndex, event.key === "Home" ? 0 : points.length - 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowRight") select(providerIndex, pointIndex + (event.key === "ArrowRight" ? 1 : -1));
    else {
      const direction = event.key === "ArrowDown" ? 1 : -1;
      for (let next = providerIndex + direction; next >= 0 && next < chart.providers.length; next += direction) {
        if (chart.providers[next].points.length) { select(next, nearest(chart.providers[next].points, points[pointIndex].time)); break; }
      }
    }
  }, options);
}

function normalizeModel(model) {
  if (!model || !["now", "7d", "all"].includes(model.range) || !Array.isArray(model.providers)
    || !model.providers.length || model.providers.length > 6 || !Number.isFinite(model.asOf)) {
    throw new TypeError("A Sandbox cost model with up to six providers is required");
  }
  const ids = new Set();
  const providers = model.providers.map(provider => {
    if (!provider?.id || ids.has(provider.id) || !provider.label) throw new TypeError("Sandbox providers require unique IDs and labels");
    ids.add(provider.id);
    const distribution = [provider.minimum, provider.p25, provider.median, provider.p75, provider.maximum];
    if (model.range === "now" && distribution.some((value, index) => !Number.isFinite(value) || value < 0 || (index > 0 && value < distribution[index - 1]))) {
      throw new TypeError("Sandbox distributions must contain ordered finite costs");
    }
    const history = (provider.history || []).filter(point => Number.isFinite(point?.time)).map(point => ({ ...point,
      value: Number.isFinite(point.value) && point.value >= 0 ? point.value : null })).sort((a, b) => a.time - b.time);
    return { ...provider, label: String(provider.label).slice(0, 16), history };
  });
  const times = providers.flatMap(provider => provider.history.map(point => point.time));
  const start = Number.isFinite(model.start) ? model.start : times.length ? Math.min(...times) : model.asOf;
  const end = Number.isFinite(model.end) ? model.end : times.length ? Math.max(...times) : model.asOf;
  if (end < start) throw new TypeError("Sandbox history dates must be ordered");
  return { ...model, providers, start, end: end === start ? start + 1 : end,
    primary: typeof model.primary === "string" ? model.primary : model.primary?.id };
}

function segments(history) {
  const result = [];
  let segment = [];
  for (const point of history) {
    const split = point.value === null || point.breakBefore;
    if (split && segment.length) { result.push(segment); segment = []; }
    if (point.value !== null) segment.push(point);
  }
  if (segment.length) result.push(segment);
  return result;
}

function normalizeColors(colors) {
  if (!colors || ["paper", "line", "secondary"].some(key => !String(colors[key] || "").trim())) {
    throw new TypeError("Sandbox colors must include paper, line and secondary");
  }
  return Object.fromEntries(Object.entries(colors).map(([key, value]) => [key, escapeXml(value)]));
}
function text(x, y, value, color, size, attrs = "", weight = "400") {
  return `<text x="${coord(x)}" y="${coord(y)}" fill="${color}" font-family="Geist Mono, monospace" font-size="${size}" font-weight="${weight}"
    style="font-variant-numeric:tabular-nums" ${attrs}>${escapeXml(value)}</text>`;
}
function formatCents(value) {
  if (!Number.isFinite(value)) return "Unavailable";
  const cents = value * 100;
  return cents > 0 && cents < 0.005 ? "<0.01¢" : `${cents.toFixed(2)}¢`;
}
function formatDate(time, year = false) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", ...(year ? { year: "numeric" } : {}),
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(time).replace(",", "").toUpperCase() + " UTC";
}
function formatDay(time, year = false) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" }).format(time).toUpperCase();
}
function coord(value) { return Math.round(value * 100) / 100; }
function escapeXml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
