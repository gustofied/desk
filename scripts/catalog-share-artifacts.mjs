import { createHash } from "node:crypto";
import { area, curveMonotoneX, extent, interpolateRgb, line, scaleLinear, scaleUtc } from "d3";
import { CARD_REGISTRY, PALETTES, RANGES, SITE_ORIGIN, cardStateParamIds, getCardDefinition, normalizeCardState } from "../src/card-registry.js";
import { normalizeCardVisualization } from "../src/card-document.js";
import { cardDetailDescription } from "../src/card-descriptions.js";
import { chartYDomain, comparisonStrokeOpacity, INDEX_BASELINE, spreadLineLabels } from "../src/chart-domain.js";
import { alignIndexedPriceSeries, createPriceSeriesIndex, priceRowsForRange } from "../src/price-series.js";
import { createCrossMarketSeries, hasCrossMarketLayers } from "../src/cross-market-series.js";
import { createSandboxCostModel } from "../src/sandbox-cost-model.js";
import { renderSandboxCostSvg } from "../src/sandbox-cost-presentation.js";
import { createForwardPricesModel } from "../src/forward-prices-model.js";
import { renderForwardPricesSvg } from "../src/forward-prices-presentation.js";
import { createDealViewModel } from "../src/deal-view-model.js";
import { renderDealViewSvg } from "../src/deal-view-presentation.js";
import { viewArtifactHeaderMarkup } from "../src/view-artifact-header.js";

const SUPPORTED = new Set(["equities", "sandbox-cost", "quote-view", "deal-view", "forward-prices"]);
const RENDERER_VERSION = "catalog-share-v1";

/** Pure, deterministic social SVGs from caller-supplied runtime snapshots. */
export function renderCatalogShareArtifact(cardId, stateParams = {}, payloads = new Map()) {
  if (!SUPPORTED.has(cardId)) throw new TypeError(`Unsupported catalog share card: ${String(cardId)}`);
  const card = getCardDefinition(cardId);
  const normalized = normalizeCardState(cardId, stateParams);
  const state = normalizeCardVisualization(cardId, normalized);
  const sources = payloads instanceof Map ? payloads : new Map(Object.entries(payloads || {}));
  const colors = themeColors(normalized.palette, normalized.theme);
  const used = [];
  const requirePayload = sourceId => {
    const payload = sources.get(sourceId);
    if (!payload || payload.cardId !== sourceId || typeof payload.revision !== "string" || !payload.revision) {
      throw new TypeError(`A versioned ${sourceId} runtime payload is required`);
    }
    used.push([sourceId, payload.revision]);
    return payload;
  };
  let svg;
  let title;
  let imageAlt;
  const description = cardDetailDescription(card, normalized);

  if (cardId === "equities") {
    const runtime = requirePayload(cardId);
    if (runtime.dataset?.status !== "ready" || runtime.dataset?.currency !== "USD") {
      throw new TypeError("Ready USD equity history is required");
    }
    const mixed = hasCrossMarketLayers(card, normalized.layers);
    if (mixed) requirePayload("gpu-index");
    const index = createPriceSeriesIndex(sources, CARD_REGISTRY);
    const milliseconds = RANGES[normalized.range]?.milliseconds;
    const order = [normalized.symbol, ...normalized.layers.filter(id => id !== normalized.symbol)];
    let series = mixed ? createCrossMarketSeries(index, card, normalized, { milliseconds })
      : order.map(id => {
        const layer = card.layers.find(candidate => candidate.id === id);
        const rows = priceRowsForRange(index, card, id, milliseconds);
        const base = rows[0]?.value;
        return { layer, primary: id === normalized.symbol, rows: rows.map(row => ({
          ...row, plotValue: normalized.scale === "index" ? row.value / base * 100 : row.value,
        })) };
      });
    if (!mixed && normalized.scale === "index") series = alignIndexedPriceSeries(series);
    if (series.length !== normalized.layers.length || series.some(candidate => candidate.rows.length < 2 ||
      candidate.rows.some(row => !Number.isFinite(row.value) || row.value <= 0 || !Number.isFinite(row.plotValue)))) {
      throw new TypeError("Every selected comparison requires at least two valid shared observations");
    }
    const primary = series.find(candidate => candidate.primary);
    const latest = primary.rows.at(-1);
    title = order.join(" + ");
    const headline = normalized.scale === "index" ? percent(latest.plotValue - INDEX_BASELINE) : usd(latest.value);
    const start = Math.min(...series.map(candidate => +candidate.rows[0].date));
    const end = Math.max(...series.map(candidate => +candidate.rows.at(-1).date));
    imageAlt = `${title}. ${normalized.range.toUpperCase()}. ${normalized.symbol} ${headline}${normalized.scale === "price" ? " per share" : " from the shared starting date"}. ${day(start)} to ${day(end)}. ${description}`;
    svg = equitySvg(series, normalized, colors, { title, headline, imageAlt });
  } else if (cardId === "forward-prices") {
    const model = createForwardPricesModel(requirePayload(cardId), normalized);
    title = `${model.gpu} forwards`;
    imageAlt = `${title}. ${description}`;
    const content = renderForwardPricesSvg(model, { colors, compact: true, gallery: true, height: 630, title });
    svg = svgFrame(colors, title, imageAlt, svgInner(content));
  } else if (cardId === "sandbox-cost") {
    const model = createSandboxCostModel(requirePayload(cardId), card, {
      range: normalized.range, primaryId: normalized.provider, layerIds: normalized.layers,
    });
    if (normalized.range !== "now" && !model.rows.length) throw new TypeError("Selected Sandbox history is unavailable");
    title = "Sandbox cost";
    imageAlt = `${title}. ${normalized.range === "now" ? "Latest" : normalized.range.toUpperCase()}. ${description} ${model.providers.map(provider => {
      const value = normalized.range === "now" ? provider.median : provider.history.at(-1)?.value;
      return `${provider.label}: ${Number.isFinite(value) ? `${(value * 100).toFixed(2)} cents per job` : "unavailable"}`;
    }).join("; ")}.`;
    // The existing full-width artifact mode retains provider labels, exact
    // distributions/history and its authored 675-unit geometry without tiles.
    const content = renderSandboxCostSvg(model, { colors, compact: true, artifact: true, decorative: true, title });
    svg = svgFrame(colors, title, imageAlt, `<g transform="translate(40 0) scale(${630 / 675})">${svgInner(content)}</g>`);
  } else {
    const payload = requirePayload("deal-view");
    const model = createDealViewModel(payload, { kind: card.viewKind, overrides: normalized });
    title = cardId === "quote-view" ? `Quote ${normalized.gpu}` : card.title;
    imageAlt = `${title}. ${normalized.quantity} ${normalized.gpu} GPUs at ${usd(normalized.quote)} per GPU-hour. Ready for service ${normalized.rfs}. ${description}`;
    // Only registered title and explicitly supported terms leave the private
    // model; its parties, event labels, notes and source identity stay private.
    const statusLabel = model.priceStatusLabel === "Rate agreed" ? "RATE AGREED" : "OPEN";
    svg = renderDealViewSvg({ ...model, label: title, ariaLabel: imageAlt, statusLabel }, { palette: colors });
  }

  const destination = new URL("/", SITE_ORIGIN);
  destination.searchParams.set("card", cardId);
  destination.searchParams.set("view", "monitor");
  for (const key of cardStateParamIds(card)) {
    const value = state[key];
    if (value !== null && value !== undefined && value !== "") destination.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  destination.hash = card.hash;
  const revision = createHash("sha256").update(JSON.stringify({ renderer: RENDERER_VERSION, cardId, state, sources: used, svg })).digest("hex").slice(0, 16);
  return { svg, title, description, imageAlt, revision, state, destination: destination.href };
}

function equitySvg(series, state, colors, { title, headline, imageAlt }) {
  const rows = series.flatMap(candidate => candidate.rows);
  const x = scaleUtc().domain(extent(rows, row => row.date)).range([0, 1200]);
  const y = scaleLinear().domain(chartYDomain(rows.map(row => row.plotValue), { scale: state.scale })).range([604, 220]);
  const path = line().x(row => x(row.date)).y(row => y(row.plotValue)).curve(curveMonotoneX);
  const primary = series.find(candidate => candidate.primary);
  const baseline = state.scale === "index" ? `<line data-share-baseline="100" x1="0" x2="1200" y1="${coord(y(INDEX_BASELINE))}" y2="${coord(y(INDEX_BASELINE))}" stroke="${colors.line}" stroke-opacity="0.18" stroke-width="1" stroke-dasharray="2 8"/>` : "";
  const shade = state.scale === "index" && series.length === 1
    ? `<path d="${area().x(row => x(row.date)).y0(y(INDEX_BASELINE)).y1(row => y(row.plotValue)).curve(curveMonotoneX)(primary.rows)}" fill="${colors.area}" opacity="0.10"/>` : "";
  const lines = [...series].sort((a, b) => Number(a.primary) - Number(b.primary)).map(candidate => {
    const last = candidate.rows.at(-1);
    return `<path data-share-series="${escapeXml(candidate.layer.id)}" data-first-value="${candidate.rows[0].plotValue}" data-last-value="${last.plotValue}" data-start="${+candidate.rows[0].date}" data-end="${+last.date}" data-observation-count="${candidate.rows.length}" d="${path(candidate.rows)}" fill="none" stroke="${candidate.primary ? colors.line : colors.secondary}" stroke-opacity="${candidate.primary ? 1 : comparisonStrokeOpacity(state.theme)}" stroke-width="${candidate.primary ? 3.5 : 2}" stroke-dasharray="${candidate.primary ? "" : escapeXml(candidate.layer.strokeDasharray || "")}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join("");
  const labels = series.length > 1 ? spreadLineLabels(series.map(candidate => ({ candidate, lineY: y(candidate.rows.at(-1).plotValue) })), 232, 592, 26).map(({ candidate, lineY, labelY }) => {
    const color = candidate.primary ? colors.line : colors.secondary;
    return `<path d="M1200,${coord(lineY)}H1192V${coord(labelY)}" fill="none" stroke="${color}" stroke-width="1.5"/>
      <text x="1188" y="${coord(labelY + 6)}" text-anchor="end" fill="${color}" stroke="${colors.paper}" stroke-width="8" stroke-linejoin="round" style="paint-order:stroke fill" font-family="Geist Mono, monospace" font-size="18" font-weight="${candidate.primary ? 600 : 500}">${escapeXml(candidate.layer.id)}</text>`;
  }).join("") : "";
  return svgFrame(colors, title, imageAlt, `${shade}${baseline}${lines}${labels}${viewArtifactHeaderMarkup({ title, context: state.range.toUpperCase(), headline, colors })}`);
}

function themeColors(paletteId, theme) {
  const accent = PALETTES.find(palette => palette.id === paletteId).accent;
  const mix = (a, b, share) => interpolateRgb(b, a)(share);
  if (theme === "dark") return {
    theme, accent, paper: mix(accent, "#171717", 0.03), line: mix(accent, "#ffffff", 0.88),
    text: mix(accent, "#ffffff", 0.72), secondary: mix(accent, "#ffffff", 0.28), area: mix(accent, "#ffffff", 0.28),
  };
  return { theme, accent, paper: mix(accent, "#ffffff", 0.05), line: mix(accent, "#102635", 0.52),
    text: mix(accent, "#102635", 0.28), secondary: mix(accent, "#102635", 0.28), area: mix(accent, "#102635", 0.28) };
}
function svgFrame(colors, title, description, content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${escapeXml(description)}"><title>${escapeXml(title)}</title><desc>${escapeXml(description)}</desc><rect width="1200" height="630" fill="${colors.paper}"/>${content}</svg>`;
}
function svgInner(svg) { return svg.replace(/^<svg\b[^>]*>/, "").replace(/<\/svg>\s*$/, ""); }
function usd(value) { return `$${value.toFixed(2)}`; }
function percent(value) { return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}%`; }
function day(value) { return new Date(value).toISOString().slice(0, 10); }
function coord(value) { return Math.round(value * 100) / 100; }
function escapeXml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;"); }
