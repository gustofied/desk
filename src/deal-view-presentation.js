import { horizontalHitZones, positionSvgTooltip } from "./chart-pointer.js";

const VALID_VARIANTS = Object.freeze(["static", "focus", "full"]);

/**
 * Mounts a semantic Deal view into `host`.
 *
 * Every variant is presentation-only, so it is safe inside a Catalog tile.
 */
export function mountDealView(
  host,
  model,
  {
    variant = "static",
    palette,
    reducedMotion = false,
    interactive = false,
  } = {},
) {
  assertHost(host);
  assertModel(model);
  const normalizedVariant = VALID_VARIANTS.includes(variant)
    ? variant
    : "static";
  const colors = normalizePalette(palette);

  ensureDealViewStyles(host.ownerDocument || document);

  const mount = document.createElement("div");
  mount.className = "deal-view-mount";
  mount.dataset.dealViewMount = "";
  mount.dataset.variant = normalizedVariant;
  mount.dataset.kind = model.viewKind;
  mount.style.setProperty("--deal-paper", colors.paper);
  mount.style.setProperty("--deal-line", colors.line);
  mount.style.setProperty("--deal-text", colors.text);
  mount.style.setProperty("--deal-secondary", colors.secondary);
  mount.style.setProperty("--deal-area", colors.area);
  if (reducedMotion) mount.dataset.reducedMotion = "true";
  mount.innerHTML = dealViewMarkup(model, {
    variant: normalizedVariant,
    interactive: normalizedVariant === "full" && interactive,
  });

  host.replaceChildren(mount);
  const historyInteraction = normalizedVariant === "full" && interactive
    ? configureDealHistoryInteraction(mount, model)
    : null;

  return Object.freeze({
    host,
    element: mount,
    destroy() {
      historyInteraction?.destroy();
      if (mount.parentNode === host) host.replaceChildren();
    },
  });
}

export const renderDealView = mountDealView;

function dealViewMarkup(model, { variant, interactive }) {
  return variant === "full"
    ? fullDealViewMarkup(model, interactive)
    : staticDealViewMarkup(model, variant);
}

function fullDealViewMarkup(model, interactive) {
  return `
    <article class="deal-view deal-view--${model.viewKind} deal-view--full" aria-label="${escapeHtml(model.ariaLabel)}"
      data-deal-view="">
      <div class="deal-view__shell">
        <div class="deal-view__surface">
          ${dealSummaryMarkup(model)}
          ${dealGraphicMarkup(model, { interactive })}
        </div>
      </div>
    </article>`;
}

function staticDealViewMarkup(model, variant) {
  const variantClasses = variant === "focus"
    ? "deal-view--static deal-view--focus"
    : "deal-view--static";

  return `
    <article class="deal-view deal-view--${model.viewKind} ${variantClasses}" aria-label="${escapeHtml(model.ariaLabel)}"
      data-deal-view="">
      <div class="deal-view__shell">
        <div class="deal-view__surface">
          ${dealSummaryMarkup(model)}
          ${dealGraphicMarkup(model)}
        </div>
      </div>
    </article>`;
}

function dealSummaryMarkup(model) {
  if (model.viewKind === "quote") {
    return `
      <header class="deal-view__head deal-view__summary">
        <span class="deal-view__label">${escapeHtml(model.label)}</span>
        <span class="deal-view__status">${escapeHtml(model.statusLabel)}</span>
        <strong class="deal-view__quote">${escapeHtml(model.quote.formatted)}</strong>
      </header>`;
  }

  return `
    <header class="deal-view__head deal-view__summary">
      <span class="deal-view__label">${escapeHtml(model.label)}</span>
      <span class="deal-view__status">${escapeHtml(model.asset)}</span>
      <strong class="deal-view__quote">${escapeHtml(model.quote.formatted)}</strong>
    </header>`;
}

function dealGraphicMarkup(model, options = {}) {
  return model.viewKind === "quote"
    ? dealNegotiationMarkup(model, options)
    : dealTicketMarkup(model);
}

function dealTicketMarkup(model) {
  const terms = [
    ["Capacity", model.capacityLabel],
    ["Region", model.region],
    ["Ready for service", model.rfsLabel],
  ].filter(([, value]) => value);
  return `
    <dl class="deal-view__ticket" aria-label="Deal terms">
      ${terms.map(([label, value]) => `
        <div class="deal-view__ticket-term">
          <dt>${escapeHtml(label)}</dt>
          <dd>${escapeHtml(value)}</dd>
        </div>`).join("")}
    </dl>`;
}

function dealNegotiationMarkup(model, { interactive = false } = {}) {
  const history = Array.isArray(model.quoteHistory) ? model.quoteHistory : [];
  if (history.length < 2) {
    return '<div class="deal-view__history deal-view__history--empty" aria-hidden="true"></div>';
  }

  const geometry = negotiationGeometry(history);
  if (!geometry) {
    return '<div class="deal-view__history deal-view__history--empty" aria-hidden="true"></div>';
  }

  const firstBid = formatUsd(history[0].buyerBid);
  const firstAsk = formatUsd(history[0].sellerAsk);
  const latest = formatUsd(history.at(-1).sellerAsk);
  const description = `Buyer bid ${firstBid} and seller ask ${firstAsk} converged at ${latest} across ${history.length} revisions.`;
  return `
    <figure class="deal-view__history" role="${interactive ? "group" : "img"}"
      aria-label="${escapeHtml(description)}" ${interactive ? 'data-deal-history-interactive="true"' : ""}>
      <svg viewBox="0 0 1200 420" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path class="deal-view__negotiation-line deal-view__negotiation-line--bid" d="${geometry.bid}"></path>
        <path class="deal-view__negotiation-line deal-view__negotiation-line--ask" d="${geometry.ask}"></path>
        <g class="deal-view__flow-signals">
          ${geometry.connectors.map((connector) => `
            <g class="deal-view__flow-signal deal-view__flow-signal--${connector.role}">
              <line x1="${connector.x}" y1="420" x2="${connector.x}" y2="${connector.y}"></line>
              <circle cx="${connector.x}" cy="${connector.y}" r="${connector.role === "desk" ? 8 : 6}"></circle>
            </g>`).join("")}
        </g>
        ${interactive ? dealHistoryInteractionMarkup(history, geometry) : ""}
      </svg>
      ${interactive ? `
        <span class="deal-view__keyboard-target" role="slider" tabindex="0"
          aria-label="Quote revision" aria-orientation="horizontal"
          aria-valuemin="1" aria-valuemax="${history.length}"
          aria-valuenow="${history.length}" data-deal-history-keyboard></span>
        <output class="deal-view__callout" data-deal-history-callout hidden aria-hidden="true"></output>
        <span class="deal-view__live" data-deal-history-live aria-live="polite"></span>` : ""}
    </figure>`;
}

function dealHistoryInteractionMarkup(history, geometry) {
  const halfWidth = 600;
  const coordinate = (value) => Number(Number(value).toFixed(2));
  const zones = horizontalHitZones(
    history,
    (_row, index) => (index / Math.max(1, history.length - 1)) * halfWidth,
    halfWidth,
  );
  const hitZones = zones.flatMap((zone) => [
    `<rect class="deal-view__history-hit" x="${coordinate(zone.x)}" y="0"
      width="${coordinate(zone.width)}" height="420" data-deal-history-index="${zone.index}"
      data-deal-history-side="bid"></rect>`,
    `<rect class="deal-view__history-hit" x="${coordinate(1200 - zone.x - zone.width)}" y="0"
      width="${coordinate(zone.width)}" height="420" data-deal-history-index="${zone.index}"
      data-deal-history-side="ask"></rect>`,
  ]).join("");

  return `
    <g class="deal-view__history-hits" aria-hidden="true">${hitZones}</g>
    <g class="deal-view__history-selection" data-deal-history-selection hidden aria-hidden="true">
      <circle class="deal-view__history-point deal-view__history-point--bid" r="7"
        data-deal-history-bid></circle>
      <circle class="deal-view__history-point deal-view__history-point--ask" r="7"
        data-deal-history-ask></circle>
    </g>`;
}

function configureDealHistoryInteraction(mount, model) {
  const history = model.quoteHistory;
  const geometry = negotiationGeometry(history);
  const figure = mount.querySelector("[data-deal-history-interactive]");
  const svg = figure?.querySelector("svg");
  const keyboard = figure?.querySelector("[data-deal-history-keyboard]");
  const callout = figure?.querySelector("[data-deal-history-callout]");
  const live = figure?.querySelector("[data-deal-history-live]");
  const selection = figure?.querySelector("[data-deal-history-selection]");
  const bidPoint = figure?.querySelector("[data-deal-history-bid]");
  const askPoint = figure?.querySelector("[data-deal-history-ask]");
  const hitZones = Array.from(
    figure?.querySelectorAll("[data-deal-history-index]") || [],
  );
  if (
    !geometry ||
    !figure ||
    !svg ||
    !keyboard ||
    !callout ||
    !live ||
    !selection ||
    !bidPoint ||
    !askPoint ||
    !hitZones.length
  ) {
    return null;
  }

  const controller = new AbortController();
  const listenerOptions = { signal: controller.signal };
  let activeIndex = history.length - 1;
  let activeSide = "ask";

  const show = (index, side = activeSide, announce = false) => {
    const observation = geometry.observations[index];
    if (!observation) return;
    activeIndex = index;
    activeSide = side === "bid" ? "bid" : "ask";
    bidPoint.setAttribute("cx", observation.bid.x);
    bidPoint.setAttribute("cy", observation.bid.y);
    askPoint.setAttribute("cx", observation.ask.x);
    askPoint.setAttribute("cy", observation.ask.y);
    selection.hidden = false;
    keyboard.setAttribute("aria-valuenow", String(index + 1));
    keyboard.setAttribute("aria-valuetext", dealRevisionAria(observation.row));
    callout.innerHTML = dealRevisionCallout(observation.row, index);
    callout.hidden = false;
    const anchor = activeSide === "bid" ? observation.bid : observation.ask;
    positionSvgTooltip({
      tooltipNode: callout,
      chartNode: figure,
      svgNode: svg,
      svgX: anchor.x,
      svgY: anchor.y,
    });
    if (announce) live.textContent = dealRevisionAria(observation.row);
  };

  const hide = () => {
    selection.hidden = true;
    callout.hidden = true;
  };

  hitZones.forEach((zone) => {
    zone.addEventListener("pointerenter", () => {
      show(Number(zone.dataset.dealHistoryIndex), zone.dataset.dealHistorySide);
    }, listenerOptions);
    zone.addEventListener("pointerdown", () => {
      show(Number(zone.dataset.dealHistoryIndex), zone.dataset.dealHistorySide);
      keyboard.focus({ preventScroll: true });
    }, listenerOptions);
  });
  figure.addEventListener("pointerleave", () => {
    if (figure.ownerDocument.activeElement !== keyboard) hide();
  }, listenerOptions);
  keyboard.addEventListener("focus", () => show(activeIndex, activeSide, true), listenerOptions);
  keyboard.addEventListener("blur", hide, listenerOptions);
  keyboard.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hide();
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") activeIndex = 0;
    if (event.key === "End") activeIndex = history.length - 1;
    if (event.key === "ArrowLeft") activeIndex = Math.max(0, activeIndex - 1);
    if (event.key === "ArrowRight") activeIndex = Math.min(history.length - 1, activeIndex + 1);
    show(activeIndex, activeIndex < history.length - 1 ? "bid" : "ask", true);
  }, listenerOptions);

  return Object.freeze({
    destroy() {
      controller.abort();
      hide();
    },
  });
}

function dealRevisionCallout(row, index) {
  const spread = Math.max(0, row.sellerAsk - row.buyerBid);
  return `
    <span class="deal-view__callout-head">
      <time>${escapeHtml(formatDealDate(row.timestamp))}</time>
      <small>REV ${String(index + 1).padStart(2, "0")}</small>
    </span>
    <span><b>Bid</b><strong>${formatUsd(row.buyerBid)}</strong></span>
    <span><b>Ask</b><strong>${formatUsd(row.sellerAsk)}</strong></span>
    <span><b>Gap</b><strong>${formatUsd(spread)}</strong></span>`;
}

function dealRevisionAria(row) {
  const spread = Math.max(0, row.sellerAsk - row.buyerBid);
  if (spread === 0) {
    return `${formatDealAriaDate(row.timestamp)}. Agreed at ${formatUsd(row.sellerAsk)} per GPU hour.`;
  }
  return `${formatDealAriaDate(row.timestamp)}. Bid ${formatUsd(row.buyerBid)}. Ask ${formatUsd(row.sellerAsk)}. Gap ${formatUsd(spread)}.`;
}

function formatDealDate(timestamp) {
  const date = new Date(Number(timestamp) * 1000);
  const month = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${String(date.getUTCDate()).padStart(2, "0")} ${month[date.getUTCMonth()]}`;
}

function formatDealAriaDate(timestamp) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Number(timestamp) * 1000));
}

function negotiationGeometry(history) {
  const width = 1200;
  const center = width / 2;
  const top = 48;
  const bottom = 344;
  const bids = history.map((point) => Number(point.buyerBid));
  const asks = history.map((point) => Number(point.sellerAsk));
  if (
    bids.some((value) => !Number.isFinite(value)) ||
    asks.some((value) => !Number.isFinite(value))
  ) {
    return null;
  }
  const match = asks.at(-1);
  const extent = Math.max(
    match - Math.min(...bids),
    Math.max(...asks) - match,
    0.05,
  ) * 1.18;
  const y = (distance) =>
    bottom - (Math.max(0, distance) / extent) * (bottom - top);
  const coordinate = (value) => Number(value.toFixed(2));
  const progress = (index) => index / Math.max(1, history.length - 1);
  const bidPoints = bids.map((value, index) => ({
    x: center * progress(index),
    y: y(match - value),
  }));
  const askPoints = asks.map((value, index) => ({
    x: width - center * progress(index),
    y: y(value - match),
  }));
  const stepPath = (points) => {
    let path = `M ${coordinate(points[0].x)} ${coordinate(points[0].y)}`;
    for (let index = 1; index < points.length; index += 1) {
      path += ` H ${coordinate(points[index].x)} V ${coordinate(points[index].y)}`;
    }
    return path;
  };

  return Object.freeze({
    bid: stepPath(bidPoints),
    ask: stepPath(askPoints),
    observations: Object.freeze(history.map((row, index) => Object.freeze({
      row,
      bid: Object.freeze({
        x: coordinate(bidPoints[index].x),
        y: coordinate(bidPoints[index].y),
      }),
      ask: Object.freeze({
        x: coordinate(askPoints[index].x),
        y: coordinate(askPoints[index].y),
      }),
    }))),
    connectors: Object.freeze([
      Object.freeze({ role: "buyer", x: 330, y: coordinate(bidPoints[3]?.y ?? bottom) }),
      Object.freeze({ role: "desk", x: 600, y: coordinate(bottom) }),
      Object.freeze({ role: "seller", x: 870, y: coordinate(askPoints[3]?.y ?? bottom) }),
    ]),
  });
}

const dealViewStyles = `
  .deal-view-mount {
    --deal-rule: color-mix(in srgb, var(--deal-line) 22%, transparent);
    --deal-rule-strong: color-mix(in srgb, var(--deal-line) 52%, transparent);
    --deal-buyer-tone: color-mix(in srgb, var(--deal-line) 44%, var(--deal-paper));
    --deal-desk-tone: color-mix(in srgb, var(--deal-line) 94%, var(--deal-paper));
    --deal-seller-tone: color-mix(in srgb, var(--deal-line) 68%, var(--deal-paper));
    box-sizing: border-box;
    width: 100%;
    color: var(--deal-text);
    font-family: Geist, ui-sans-serif, system-ui, sans-serif;
  }
  .deal-view-mount *, .deal-view-mount *::before, .deal-view-mount *::after {
    box-sizing: border-box;
  }
  .deal-view {
    width: 100%;
    min-width: 0;
  }
  .deal-view__shell {
    position: relative;
    border: 1px solid var(--deal-rule-strong);
    border-radius: 4px;
    background: var(--deal-paper);
    box-shadow: 0 18px 40px color-mix(in srgb, var(--deal-line) 14%, transparent);
  }
  .deal-view__surface {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    overflow: hidden;
    border-radius: 3px;
    background: var(--deal-paper);
  }
  .deal-view__head {
    display: grid;
    grid-template-areas:
      "label status"
      "quote quote"
      "spec spec";
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: 0;
    min-width: 0;
    padding: 16px 16px 0;
  }
  .deal-view__label {
    font-family: "Geist Mono", ui-monospace, monospace;
    font-variant-numeric: tabular-nums;
  }
  .deal-view__label {
    grid-area: label;
    overflow: hidden;
    color: var(--deal-line);
    font-family: Geist, ui-sans-serif, system-ui, sans-serif;
    font-size: 12px;
    font-weight: 600;
    line-height: 16px;
    letter-spacing: -0.01em;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .deal-view__status {
    grid-area: status;
    align-self: center;
    overflow: hidden;
    color: var(--deal-secondary);
    font: 600 10px/16px "Geist Mono", ui-monospace, monospace;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.04em;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
    opacity: 0.72;
  }
  .deal-view__quote {
    grid-area: quote;
    overflow: hidden;
    color: var(--deal-line);
    font-size: 32px;
    font-weight: 600;
    line-height: 40px;
    letter-spacing: -0.04em;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .deal-view__spec {
    grid-area: spec;
    display: flex;
    flex-wrap: wrap;
    gap: 5px 14px;
    align-items: baseline;
    min-width: 0;
    color: var(--deal-secondary);
    font: 600 10px/14px "Geist Mono", ui-monospace, monospace;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.025em;
    text-transform: uppercase;
    opacity: 0.68;
  }
  .deal-view__history {
    position: relative;
    min-width: 0;
    min-height: 0;
    margin: 0;
    overflow: hidden;
  }
  .deal-view__history--empty {
    visibility: hidden;
  }
  .deal-view__ticket {
    align-self: end;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
    width: 100%;
    min-width: 0;
    padding: 0 16px 16px;
    margin: 0;
    color: var(--deal-secondary);
    font: 600 10px/16px "Geist Mono", ui-monospace, monospace;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.025em;
    text-transform: uppercase;
    opacity: 0.64;
  }
  .deal-view__ticket-term {
    min-width: 0;
  }
  .deal-view__ticket-term:nth-child(2) {
    text-align: center;
  }
  .deal-view__ticket-term:last-child {
    text-align: right;
  }
  .deal-view__ticket dt {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    white-space: nowrap;
    clip: rect(0 0 0 0);
    border: 0;
  }
  .deal-view__ticket dd {
    overflow: hidden;
    margin: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .deal-view__history svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .deal-view__history-hit {
    fill: transparent;
    cursor: crosshair;
    pointer-events: all;
  }
  .deal-view__history-selection {
    pointer-events: none;
  }
  .deal-view__history-point {
    fill: var(--deal-paper);
    stroke-width: 3px;
    vector-effect: non-scaling-stroke;
  }
  .deal-view__history-point--bid { stroke: var(--deal-buyer-tone); }
  .deal-view__history-point--ask { stroke: var(--deal-seller-tone); }
  .deal-view__keyboard-target {
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
    outline: none;
  }
  .deal-view__keyboard-target:focus-visible {
    box-shadow: inset 0 0 0 2px var(--deal-rule-strong);
  }
  .deal-view__callout {
    position: absolute;
    z-index: 3;
    display: grid;
    gap: 4px;
    padding: 12px;
    color: var(--deal-secondary);
    font: 500 12px/16px "Geist Mono", ui-monospace, monospace;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
    background: var(--deal-paper);
    border: 1px solid var(--deal-rule-strong);
    border-radius: 4px;
  }
  .deal-view__callout[hidden] { display: none; }
  .deal-view__callout > span {
    display: grid;
    grid-template-columns: auto auto;
    gap: 16px;
    justify-content: space-between;
  }
  .deal-view__callout-head {
    padding-bottom: 8px;
    margin-bottom: 4px;
    border-bottom: 1px solid var(--deal-rule);
  }
  .deal-view__callout :is(time, small, b, strong) {
    color: inherit;
    font: inherit;
    text-transform: uppercase;
  }
  .deal-view__callout small,
  .deal-view__callout b {
    opacity: 0.58;
  }
  .deal-view__callout strong { color: var(--deal-line); }
  .deal-view__live {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    white-space: nowrap;
    clip: rect(0 0 0 0);
    border: 0;
  }
  .deal-view__negotiation-line {
    fill: none;
    stroke: var(--deal-line);
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 3.5px;
    vector-effect: non-scaling-stroke;
  }
  .deal-view__negotiation-line--bid,
  .deal-view__negotiation-line--ask {
    opacity: 1;
  }
  .deal-view__negotiation-line--bid { stroke: var(--deal-buyer-tone); }
  .deal-view__negotiation-line--ask { stroke: var(--deal-seller-tone); }
  .deal-view__flow-signal { --deal-signal-tone: var(--deal-line); }
  .deal-view__flow-signal--buyer { --deal-signal-tone: var(--deal-buyer-tone); }
  .deal-view__flow-signal--desk { --deal-signal-tone: var(--deal-desk-tone); }
  .deal-view__flow-signal--seller { --deal-signal-tone: var(--deal-seller-tone); }
  .deal-view__flow-signal line {
    stroke: var(--deal-signal-tone);
    stroke-width: 3.5px;
    opacity: 0.34;
    vector-effect: non-scaling-stroke;
  }
  .deal-view__flow-signal circle {
    fill: var(--deal-paper);
    stroke: var(--deal-signal-tone);
    stroke-width: 2px;
    opacity: 0.82;
    vector-effect: non-scaling-stroke;
  }
  .deal-view__flow-signal--desk line {
    opacity: 0.44;
  }
  .deal-view__flow-signal--desk circle {
    fill: var(--deal-desk-tone);
    stroke: var(--deal-paper);
    stroke-width: 2.5px;
    opacity: 1;
  }
  .deal-view--static .deal-view__shell,
  .deal-view--focus .deal-view__shell { box-shadow: none; }
  @media (max-width: 620px) {
    .deal-view__head {
      padding: 12px 12px 0;
    }
    .deal-view__quote { font-size: 24px; line-height: 32px; }
    .deal-view__spec { column-gap: 10px; }
    .deal-view__ticket {
      gap: 8px;
      padding: 0 12px 12px;
      font-size: 9px;
      line-height: 14px;
    }
  }
`;

function ensureDealViewStyles(targetDocument) {
  if (targetDocument.getElementById("deal-view-component-styles")) return;
  const style = targetDocument.createElement("style");
  style.id = "deal-view-component-styles";
  style.textContent = dealViewStyles;
  targetDocument.head.append(style);
}

function assertHost(host) {
  if (!host || typeof host.replaceChildren !== "function") {
    throw new TypeError("A DOM host is required to mount a Deal view");
  }
}

function assertModel(model) {
  if (
    !model ||
    model.version !== 1 ||
    !Array.isArray(model.stages) ||
    model.stages.length !== 3
  ) {
    throw new TypeError("Unsupported Deal view model");
  }
}

function normalizePalette(value = {}) {
  return {
    paper: String(value.paper || "currentColor"),
    line: String(value.line || "currentColor"),
    text: String(value.text || "currentColor"),
    secondary: String(value.secondary || value.text || "currentColor"),
    area: String(value.area || value.paper || "currentColor"),
  };
}

function formatUsd(value) {
  return `$${Number(value).toFixed(2)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
