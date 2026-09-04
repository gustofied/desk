import {
  area,
  curveStepAfter,
  easeCubicOut,
  extent,
  line,
  max,
  min,
  scaleLinear,
  scaleTime,
  select,
} from "d3";
import {
  horizontalHitZones,
  positionSvgTooltip,
} from "./chart-pointer.js";

const VALID_VARIANTS = Object.freeze(["static", "focus", "full"]);
const QUOTE_CHART_WIDTH = 1200;
const QUOTE_CHART_HEIGHT = 420;
const DEAL_CHART_WIDTH = 1200;
const DEAL_CHART_HEIGHT = 600;
const DEAL_PLOT_TOP = 220;
const DEAL_PLOT_BOTTOM = 556;
const DEAL_REVEAL_DURATION = 200;
let dealChartSequence = 0;

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

  const mount = (host.ownerDocument || document).createElement("div");
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
  const isQuote = model.viewKind === "quote";
  const chartMotion = isQuote
    ? null
    : configureDealHistoryMotion(
      mount,
      host,
      model,
      reducedMotion,
      normalizedVariant === "full" && interactive,
    );
  const historyInteraction = normalizedVariant === "full" && interactive
    ? isQuote
      ? configureQuoteHistoryInteraction(mount, model)
      : configureDealHistoryInteraction(mount, model, { reducedMotion })
    : null;

  return Object.freeze({
    host,
    element: mount,
    destroy() {
      chartMotion?.destroy();
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
      <span class="deal-view__status">${escapeHtml(model.priceStatusLabel || model.statusLabel)}</span>
      <strong class="deal-view__quote">${escapeHtml(model.quote.formatted)}</strong>
    </header>`;
}

function dealGraphicMarkup(model, options = {}) {
  if (model.viewKind === "quote") {
    return quoteNegotiationMarkup(model, options);
  }
  return model.quoteHistory?.length > 1
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

function quoteNegotiationMarkup(model, { interactive = false } = {}) {
  const history = Array.isArray(model.quoteHistory) ? model.quoteHistory : [];
  if (history.length < 2) {
    return '<div class="deal-view__history deal-view__history--empty" aria-hidden="true"></div>';
  }

  const geometry = quoteNegotiationGeometry(history);
  if (!geometry) {
    return '<div class="deal-view__history deal-view__history--empty" aria-hidden="true"></div>';
  }

  const firstBid = formatUsd(history[0].buyerBid);
  const firstAsk = formatUsd(history[0].sellerAsk);
  const latest = formatUsd(history.at(-1).sellerAsk);
  const description = `Buyer bid ${firstBid} and seller ask ${firstAsk} converged at ${latest} across ${history.length} revisions.`;
  return `
    <figure class="deal-view__history quote-view__history" role="${interactive ? "group" : "img"}"
      aria-label="${escapeHtml(description)}" ${interactive ? 'data-deal-history-interactive="true"' : ""}>
      <svg viewBox="0 0 ${QUOTE_CHART_WIDTH} ${QUOTE_CHART_HEIGHT}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path class="deal-view__negotiation-line deal-view__negotiation-line--bid" d="${geometry.bid}"></path>
        <path class="deal-view__negotiation-line deal-view__negotiation-line--ask" d="${geometry.ask}"></path>
        <g class="quote-view__flow-signals">
          ${geometry.connectors.map((connector) => `
            <g class="quote-view__flow-signal quote-view__flow-signal--${connector.role}">
              <line x1="${connector.x}" y1="${QUOTE_CHART_HEIGHT}" x2="${connector.x}" y2="${connector.y}"></line>
              <circle cx="${connector.x}" cy="${connector.y}" r="${connector.role === "desk" ? 8 : 6}"></circle>
            </g>`).join("")}
        </g>
        ${interactive ? quoteHistoryInteractionMarkup(history) : ""}
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

function quoteHistoryInteractionMarkup(history) {
  const halfWidth = QUOTE_CHART_WIDTH / 2;
  const coordinate = (value) => Number(Number(value).toFixed(2));
  const zones = horizontalHitZones(
    history,
    (_row, index) => (index / Math.max(1, history.length - 1)) * halfWidth,
    halfWidth,
  );
  const hitZones = zones.flatMap((zone) => [
    `<rect class="deal-view__history-hit" x="${coordinate(zone.x)}" y="0"
      width="${coordinate(zone.width)}" height="${QUOTE_CHART_HEIGHT}" data-deal-history-index="${zone.index}"
      data-deal-history-side="bid"></rect>`,
    `<rect class="deal-view__history-hit" x="${coordinate(QUOTE_CHART_WIDTH - zone.x - zone.width)}" y="0"
      width="${coordinate(zone.width)}" height="${QUOTE_CHART_HEIGHT}" data-deal-history-index="${zone.index}"
      data-deal-history-side="ask"></rect>`,
  ]).join("");

  return `
    <g class="deal-view__history-hits" aria-hidden="true">${hitZones}</g>
    <g class="quote-view__history-selection" data-deal-history-selection hidden aria-hidden="true">
      <circle class="quote-view__history-point quote-view__history-point--bid" r="7"
        data-deal-history-bid></circle>
      <circle class="quote-view__history-point quote-view__history-point--ask" r="7"
        data-deal-history-ask></circle>
    </g>`;
}

function configureQuoteHistoryInteraction(mount, model) {
  const history = model.quoteHistory;
  const geometry = quoteNegotiationGeometry(history);
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
    keyboard.setAttribute("aria-valuetext", quoteRevisionAria(observation.row));
    callout.innerHTML = quoteRevisionCallout(observation.row, index);
    callout.hidden = false;
    const anchor = activeSide === "bid" ? observation.bid : observation.ask;
    positionSvgTooltip({
      tooltipNode: callout,
      chartNode: figure,
      svgNode: svg,
      svgX: anchor.x,
      svgY: anchor.y,
    });
    if (announce) live.textContent = quoteRevisionAria(observation.row);
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

function quoteRevisionCallout(row, index) {
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

function quoteRevisionAria(row) {
  const spread = Math.max(0, row.sellerAsk - row.buyerBid);
  if (spread === 0) {
    return `${formatDealAriaDate(row.timestamp)}. Agreed at ${formatUsd(row.sellerAsk)} per GPU hour.`;
  }
  return `${formatDealAriaDate(row.timestamp)}. Bid ${formatUsd(row.buyerBid)}. Ask ${formatUsd(row.sellerAsk)}. Gap ${formatUsd(spread)}.`;
}

function dealNegotiationMarkup(model, { interactive = false } = {}) {
  const sourceHistory = Array.isArray(model.quoteHistory)
    ? model.quoteHistory
    : [];
  if (sourceHistory.length < 2) {
    return '<div class="deal-view__history deal-view__history--empty" aria-hidden="true"></div>';
  }

  const geometry = negotiationGeometry(sourceHistory);
  if (!geometry) {
    return '<div class="deal-view__history deal-view__history--empty" aria-hidden="true"></div>';
  }
  const history = geometry.rows;

  const firstBid = formatUsd(history[0].buyerBid);
  const firstAsk = formatUsd(history[0].sellerAsk);
  const finalRevision = history.at(-1);
  const finalTarget = formatUsd(finalRevision.buyerBid);
  const finalQuote = formatUsd(finalRevision.sellerAsk);
  const description = finalRevision.buyerBid === finalRevision.sellerAsk
    ? `Buyer target ${firstBid} and provider quote ${firstAsk} converged at ${finalQuote} across ${history.length} revisions.`
    : `Buyer target moved from ${firstBid} to ${finalTarget} while the provider quote moved from ${firstAsk} to ${finalQuote} across ${history.length} revisions.`;
  const clipId = `deal-history-clip-${++dealChartSequence}`;
  const isAgreed = finalRevision.buyerBid === finalRevision.sellerAsk;
  const agreed = isAgreed ? geometry.observations.at(-1) : null;
  const agreedPosition = agreed ? pointPositionStyle(agreed.ask) : "";
  return `
    <figure class="deal-view__history" role="${interactive ? "group" : "img"}"
      aria-label="${escapeHtml(description)}" ${interactive ? 'data-deal-history-interactive="true"' : ""}>
      <svg viewBox="0 0 ${DEAL_CHART_WIDTH} ${DEAL_CHART_HEIGHT}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <defs>
          <clipPath id="${clipId}">
            <rect x="0" y="0" width="${DEAL_CHART_WIDTH}" height="${DEAL_CHART_HEIGHT}"></rect>
          </clipPath>
        </defs>
        <g clip-path="url(#${clipId})" data-deal-history-reveal>
          <path class="deal-view__negotiation-area" d="${geometry.spread}"></path>
          <path class="deal-view__negotiation-line deal-view__negotiation-line--bid" d="${geometry.bid}"></path>
          <path class="deal-view__negotiation-line deal-view__negotiation-line--ask" d="${geometry.ask}"></path>
        </g>
        ${interactive ? dealHistoryInteractionMarkup(geometry.rows, geometry) : ""}
      </svg>
      ${agreed ? `<span class="deal-view__agreed-point" style="${agreedPosition}" aria-hidden="true"></span>` : ""}
      ${interactive ? `
        <span class="deal-view__history-point deal-view__history-point--bid"
          data-deal-history-bid aria-hidden="true" hidden></span>
        <span class="deal-view__history-point deal-view__history-point--ask"
          data-deal-history-ask aria-hidden="true" hidden></span>
        <span class="deal-view__keyboard-target" role="slider" tabindex="0"
          aria-label="Quote revision" aria-orientation="horizontal"
          aria-valuemin="1" aria-valuemax="${history.length}"
          aria-valuenow="${history.length}"
          aria-valuetext="${escapeHtml(dealRevisionAria(finalRevision))}"
          data-deal-history-keyboard></span>
        <output class="deal-view__callout" data-deal-history-callout hidden aria-hidden="true"></output>
        <span class="deal-view__live" data-deal-history-live aria-live="polite"></span>` : ""}
    </figure>`;
}

function dealHistoryInteractionMarkup(history, geometry) {
  const coordinate = (value) => Number(Number(value).toFixed(2));
  const hitZones = horizontalHitZones(
    history,
    (row) => geometry.x(new Date(row.timestamp * 1000)),
    DEAL_CHART_WIDTH,
  );
  return `
    <g class="deal-view__history-hits" aria-hidden="true">
      ${hitZones.map((zone) => `
        <rect class="deal-view__history-hit" x="${coordinate(zone.x)}" y="${DEAL_PLOT_TOP}"
          width="${coordinate(zone.width)}" height="${DEAL_PLOT_BOTTOM - DEAL_PLOT_TOP}"
          data-deal-history-index="${zone.index}"></rect>`).join("")}
    </g>
    <g class="deal-view__history-selection" data-deal-history-selection hidden aria-hidden="true">
      <line class="deal-view__history-cursor" data-deal-history-cursor></line>
      <line class="deal-view__history-gap" data-deal-history-gap></line>
    </g>`;
}

function configureDealHistoryMotion(
  mount,
  host,
  model,
  reducedMotion,
  interactive,
) {
  const reveal = mount.querySelector("[data-deal-history-reveal]");
  const agreedPoint = mount.querySelector(".deal-view__agreed-point");
  if (!reveal || !interactive || reducedMotion) return null;

  const signature = [
    model.id,
    model.quoteHistory.length,
    model.quoteHistory.at(-1)?.timestamp,
    model.quote.value,
  ].join(":");
  if (host.dataset.dealMotionSignature === signature) return null;
  host.dataset.dealMotionSignature = signature;

  const selection = select(reveal);
  selection
    .interrupt()
    .attr("transform", "translate(0 4)")
    .style("opacity", 0.48)
    .transition()
    .duration(DEAL_REVEAL_DURATION)
    .ease(easeCubicOut)
    .attr("transform", "translate(0 0)")
    .style("opacity", 1);
  const pointSelection = agreedPoint ? select(agreedPoint) : null;
  pointSelection
    ?.interrupt()
    .style("opacity", 0)
    .style("transform", "translate(var(--deal-point-x, -50%), -50%) scale(0.94)")
    .transition()
    .delay(DEAL_REVEAL_DURATION - 80)
    .duration(100)
    .ease(easeCubicOut)
    .style("opacity", 1)
    .style("transform", "translate(var(--deal-point-x, -50%), -50%) scale(1)");

  return Object.freeze({
    destroy() {
      selection
        .interrupt()
        .attr("transform", "translate(0 0)")
        .style("opacity", 1);
      pointSelection
        ?.interrupt()
        .style("opacity", 1)
        .style("transform", "translate(var(--deal-point-x, -50%), -50%) scale(1)");
    },
  });
}

function configureDealHistoryInteraction(
  mount,
  model,
  { reducedMotion = false } = {},
) {
  const geometry = negotiationGeometry(model.quoteHistory);
  const figure = mount.querySelector("[data-deal-history-interactive]");
  const svg = figure?.querySelector("svg");
  const keyboard = figure?.querySelector("[data-deal-history-keyboard]");
  const callout = figure?.querySelector("[data-deal-history-callout]");
  const live = figure?.querySelector("[data-deal-history-live]");
  const selection = figure?.querySelector("[data-deal-history-selection]");
  const cursor = figure?.querySelector("[data-deal-history-cursor]");
  const gap = figure?.querySelector("[data-deal-history-gap]");
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
    !cursor ||
    !gap ||
    !bidPoint ||
    !askPoint ||
    !hitZones.length
  ) {
    return null;
  }

  const history = geometry.rows;
  const controller = new AbortController();
  const listenerOptions = { signal: controller.signal };
  let activeIndex = -1;
  let selectionSource = "";
  let calloutWasVisible = false;
  let touchGesture = null;

  const indexForPointer = (event) => {
    const bounds = figure.getBoundingClientRect();
    if (!bounds.width) return -1;
    const svgX = Math.max(
      0,
      Math.min(DEAL_CHART_WIDTH, ((event.clientX - bounds.left) / bounds.width) * DEAL_CHART_WIDTH),
    );
    return geometry.observations.reduce((nearest, observation, index) => {
      const distance = Math.abs(observation.ask.x - svgX);
      return nearest.index < 0 || distance < nearest.distance
        ? { index, distance }
        : nearest;
    }, { index: -1, distance: Infinity }).index;
  };

  const show = (index, announce = false) => {
    const observation = geometry.observations[index];
    if (!observation) return;
    activeIndex = index;
    cursor.setAttribute("x1", observation.ask.x);
    cursor.setAttribute("x2", observation.ask.x);
    cursor.setAttribute("y1", DEAL_PLOT_TOP);
    cursor.setAttribute("y2", DEAL_PLOT_BOTTOM);
    gap.setAttribute("x1", observation.ask.x);
    gap.setAttribute("x2", observation.ask.x);
    gap.setAttribute("y1", observation.ask.y);
    gap.setAttribute("y2", observation.bid.y);
    bidPoint.setAttribute("style", pointPositionStyle(observation.bid));
    askPoint.setAttribute("style", pointPositionStyle(observation.ask));
    bidPoint.hidden = false;
    askPoint.hidden = false;
    selection.hidden = false;
    keyboard.setAttribute("aria-valuenow", String(index + 1));
    keyboard.setAttribute("aria-valuetext", dealRevisionAria(observation.row));
    callout.innerHTML = dealRevisionCallout(
      observation.row,
      index,
      history.length,
    );
    callout.hidden = false;
    positionSvgTooltip({
      tooltipNode: callout,
      chartNode: figure,
      svgNode: svg,
      svgX: observation.ask.x,
      svgY: (observation.ask.y + observation.bid.y) / 2,
    });
    if (
      !calloutWasVisible &&
      !reducedMotion &&
      typeof callout.animate === "function"
    ) {
      callout.getAnimations?.().forEach((animation) => animation.cancel());
      callout.animate(
        [
          { opacity: 0.72, transform: "translateY(2px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 120, easing: "cubic-bezier(0.32, 0.72, 0, 1)" },
      );
    }
    calloutWasVisible = true;
    if (selectionSource !== "activity") {
      figure.dispatchEvent(new CustomEvent("desk:deal-revision-select", {
        bubbles: true,
        detail: {
          dealId: model.id,
          timestamp: observation.row.timestamp,
        },
      }));
    }
    if (announce) live.textContent = dealRevisionAria(observation.row);
  };

  const hide = () => {
    const shouldSyncActivity = selectionSource !== "activity";
    selection.hidden = true;
    bidPoint.hidden = true;
    askPoint.hidden = true;
    callout.hidden = true;
    calloutWasVisible = false;
    if (shouldSyncActivity) {
      figure.dispatchEvent(new CustomEvent("desk:deal-revision-clear", {
        bubbles: true,
        detail: { dealId: model.id },
      }));
    }
  };

  hitZones.forEach((zone) => {
    zone.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "touch") return;
      selectionSource = "chart";
      show(Number(zone.dataset.dealHistoryIndex));
    }, listenerOptions);
    zone.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "touch") return;
      selectionSource = "chart";
      show(Number(zone.dataset.dealHistoryIndex), true);
      keyboard.focus({ preventScroll: true });
    }, listenerOptions);
  });
  figure.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") return;
    touchGesture = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
  }, listenerOptions);
  figure.addEventListener("pointermove", (event) => {
    if (!touchGesture || event.pointerId !== touchGesture.pointerId) return;
    if (
      Math.hypot(event.clientX - touchGesture.x, event.clientY - touchGesture.y) > 8
    ) {
      touchGesture.moved = true;
    }
  }, listenerOptions);
  figure.addEventListener("pointerup", (event) => {
    if (!touchGesture || event.pointerId !== touchGesture.pointerId) return;
    const shouldSelect = !touchGesture.moved;
    touchGesture = null;
    if (!shouldSelect) return;
    selectionSource = "chart";
    show(indexForPointer(event), true);
  }, listenerOptions);
  figure.addEventListener("pointercancel", (event) => {
    if (!touchGesture || event.pointerId !== touchGesture.pointerId) return;
    touchGesture = null;
    if (selectionSource === "chart") hide();
  }, listenerOptions);
  figure.addEventListener("pointerleave", (event) => {
    if (
      event.pointerType !== "touch" &&
      figure.ownerDocument.activeElement !== keyboard &&
      selectionSource !== "activity"
    ) {
      hide();
    }
  }, listenerOptions);
  keyboard.addEventListener("focus", () => {
    selectionSource = "keyboard";
    show(activeIndex < 0 ? history.length - 1 : activeIndex, true);
  }, listenerOptions);
  keyboard.addEventListener("blur", hide, listenerOptions);
  keyboard.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") activeIndex = 0;
    if (event.key === "End") activeIndex = history.length - 1;
    if (["ArrowLeft", "ArrowDown"].includes(event.key)) activeIndex = Math.max(0, activeIndex - 1);
    if (["ArrowRight", "ArrowUp"].includes(event.key)) activeIndex = Math.min(history.length - 1, activeIndex + 1);
    show(activeIndex, true);
  }, listenerOptions);
  figure.ownerDocument.addEventListener("desk:deal-event-select", (event) => {
    if (String(event.detail?.dealId) !== String(model.id)) return;
    const timestamp = Number(event.detail?.timestamp);
    if (!Number.isFinite(timestamp)) return;
    selectionSource = "activity";
    const index = asOfRevisionIndex(history, timestamp);
    if (index < 0) {
      hide();
      return;
    }
    show(index, Boolean(event.detail?.announce));
  }, listenerOptions);
  figure.ownerDocument.addEventListener("desk:deal-event-clear", (event) => {
    if (String(event.detail?.dealId) !== String(model.id)) return;
    if (figure.ownerDocument.activeElement !== keyboard) {
      selectionSource = "";
      hide();
    }
  }, listenerOptions);
  figure.ownerDocument.addEventListener("pointerdown", (event) => {
    if (
      event.pointerType === "touch" &&
      !figure.contains(event.target) &&
      selectionSource === "chart"
    ) {
      touchGesture = null;
      hide();
    }
  }, listenerOptions);

  return Object.freeze({
    destroy() {
      controller.abort();
      selectionSource = "activity";
      hide();
    },
  });
}

function pointPositionStyle(point) {
  const x = (Number(point?.x) / DEAL_CHART_WIDTH) * 100;
  const y = (Number(point?.y) / DEAL_CHART_HEIGHT) * 100;
  const shiftX = x <= 0.001 ? "0%" : x >= 99.999 ? "-100%" : "-50%";
  return `left:${x.toFixed(3)}%;top:${y.toFixed(3)}%;--deal-point-x:${shiftX}`;
}

function dealRevisionCallout(row, index, total) {
  const spread = Math.max(0, row.sellerAsk - row.buyerBid);
  return `
    <span class="deal-view__callout-head">
      <time>${escapeHtml(formatDealDateTime(row.timestamp))}</time>
      <small>${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}</small>
    </span>
    <span><b>Target</b><strong>${formatUsd(row.buyerBid)}</strong></span>
    <span><b>Quote</b><strong>${formatUsd(row.sellerAsk)}</strong></span>
    <span><b>Spread</b><strong>${formatUsd(spread)}</strong></span>`;
}

function dealRevisionAria(row) {
  const spread = Math.max(0, row.sellerAsk - row.buyerBid);
  if (spread === 0) {
    return `${formatDealAriaDate(row.timestamp)}. Buyer and provider agreed at ${formatUsd(row.sellerAsk)} per GPU hour.`;
  }
  return `${formatDealAriaDate(row.timestamp)}. Buyer target ${formatUsd(row.buyerBid)}. Provider quote ${formatUsd(row.sellerAsk)}. Spread ${formatUsd(spread)}.`;
}

function formatDealDate(timestamp) {
  const date = new Date(Number(timestamp) * 1000);
  const month = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${String(date.getUTCDate()).padStart(2, "0")} ${month[date.getUTCMonth()]}`;
}

function formatDealDateTime(timestamp) {
  const date = new Date(Number(timestamp) * 1000);
  return `${formatDealDate(timestamp)} ${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")} UTC`;
}

function formatDealAriaDate(timestamp) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(new Date(Number(timestamp) * 1000)) + " UTC";
}

function asOfRevisionIndex(history, timestamp) {
  let revisionIndex = -1;
  history.forEach((row, index) => {
    if (Number(row.timestamp) <= timestamp) revisionIndex = index;
  });
  return revisionIndex;
}

function quoteNegotiationGeometry(history) {
  const center = QUOTE_CHART_WIDTH / 2;
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
  const quoteExtent = Math.max(
    ...bids.map((value) => Math.abs(match - value)),
    ...asks.map((value) => Math.abs(value - match)),
    0.05,
  ) * 1.18;
  const y = (distance) =>
    bottom - (Math.abs(distance) / quoteExtent) * (bottom - top);
  const coordinate = (value) => Number(value.toFixed(2));
  const progress = (index) => index / Math.max(1, history.length - 1);
  const bidPoints = bids.map((value, index) => ({
    x: center * progress(index),
    y: y(match - value),
  }));
  const askPoints = asks.map((value, index) => ({
    x: QUOTE_CHART_WIDTH - center * progress(index),
    y: y(value - match),
  }));
  const stepPath = (points) => {
    let path = `M ${coordinate(points[0].x)} ${coordinate(points[0].y)}`;
    for (let index = 1; index < points.length; index += 1) {
      path += ` H ${coordinate(points[index].x)} V ${coordinate(points[index].y)}`;
    }
    return path;
  };
  const stepYAt = (points, targetX) => {
    const ascending = points.at(-1).x >= points[0].x;
    let pointAtX = points[0];
    for (let index = 1; index < points.length; index += 1) {
      const point = points[index];
      const reached = ascending ? point.x <= targetX : point.x >= targetX;
      if (!reached) break;
      pointAtX = point;
    }
    return coordinate(pointAtX.y);
  };
  const buyerSignalX = 330;
  const sellerSignalX = 870;

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
      Object.freeze({ role: "buyer", x: buyerSignalX, y: stepYAt(bidPoints, buyerSignalX) }),
      Object.freeze({ role: "desk", x: 600, y: coordinate(bottom) }),
      Object.freeze({ role: "seller", x: sellerSignalX, y: stepYAt(askPoints, sellerSignalX) }),
    ]),
  });
}

function negotiationGeometry(history) {
  const rows = history.filter(
    (point) =>
      point?.timestamp !== null &&
      point?.timestamp !== undefined &&
      point?.buyerBid !== null &&
      point?.buyerBid !== undefined &&
      point?.sellerAsk !== null &&
      point?.sellerAsk !== undefined &&
      Number.isFinite(Number(point?.timestamp)) &&
      Number.isFinite(Number(point?.buyerBid)) &&
      Number.isFinite(Number(point?.sellerAsk)),
  ).map((point) => ({
    ...point,
    timestamp: Number(point.timestamp),
    buyerBid: Number(point.buyerBid),
    sellerAsk: Number(point.sellerAsk),
  }));
  if (rows.length < 2) return null;

  const timeDomain = extent(rows, (point) => new Date(point.timestamp * 1000));
  const low = min(rows, (point) => Math.min(point.buyerBid, point.sellerAsk));
  const high = max(rows, (point) => Math.max(point.buyerBid, point.sellerAsk));
  if (!timeDomain[0] || !timeDomain[1] || !Number.isFinite(low) || !Number.isFinite(high)) {
    return null;
  }
  const padding = Math.max((high - low) * 0.12, 0.08);
  const x = scaleTime(timeDomain, [0, DEAL_CHART_WIDTH]);
  const y = scaleLinear(
    [low - padding, high + padding],
    [DEAL_PLOT_BOTTOM, DEAL_PLOT_TOP],
  );
  const coordinate = (value) => Number(value.toFixed(2));
  const bidPath = line()
    .x((point) => x(new Date(point.timestamp * 1000)))
    .y((point) => y(point.buyerBid))
    .curve(curveStepAfter);
  const askPath = line()
    .x((point) => x(new Date(point.timestamp * 1000)))
    .y((point) => y(point.sellerAsk))
    .curve(curveStepAfter);
  const spreadPath = area()
    .x((point) => x(new Date(point.timestamp * 1000)))
    .y0((point) => y(point.buyerBid))
    .y1((point) => y(point.sellerAsk))
    .curve(curveStepAfter);

  return Object.freeze({
    rows: Object.freeze(rows),
    bid: bidPath(rows),
    ask: askPath(rows),
    spread: spreadPath(rows),
    x,
    observations: Object.freeze(rows.map((row) => Object.freeze({
      row,
      bid: Object.freeze({
        x: coordinate(x(new Date(row.timestamp * 1000))),
        y: coordinate(y(row.buyerBid)),
      }),
      ask: Object.freeze({
        x: coordinate(x(new Date(row.timestamp * 1000))),
        y: coordinate(y(row.sellerAsk)),
      }),
    }))),
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
    min-height: 240px;
    overflow: hidden;
    border-radius: 3px;
    background: var(--deal-paper);
  }
  .deal-view__head {
    position: absolute;
    inset: 0 0 auto;
    z-index: 2;
    display: grid;
    grid-template-areas:
      "label status"
      "quote quote";
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: 0;
    min-width: 0;
    padding: 16px 16px 0;
    pointer-events: none;
  }
  .deal-view--quote .deal-view__surface {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
  }
  .deal-view--quote .deal-view__head {
    position: relative;
    inset: auto;
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
  .deal-view__history {
    position: absolute;
    inset: 0;
    min-width: 0;
    min-height: 0;
    margin: 0;
    overflow: hidden;
  }
  .deal-view--quote .deal-view__history {
    position: relative;
    inset: auto;
  }
  .deal-view__history[data-deal-history-interactive="true"] {
    cursor: crosshair;
    touch-action: pan-y;
  }
  .deal-view__history--empty {
    visibility: hidden;
  }
  .deal-view__ticket {
    position: absolute;
    inset: auto 0 0;
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
  .deal-view__history-selection {
    pointer-events: none;
  }
  .deal-view__history-hit {
    fill: transparent;
    pointer-events: all;
  }
  .deal-view__history-cursor {
    stroke: var(--deal-rule-strong);
    stroke-width: 1px;
    vector-effect: non-scaling-stroke;
  }
  .deal-view__history-gap {
    stroke: var(--deal-line);
    stroke-dasharray: 4 4;
    stroke-width: 2px;
    opacity: 0.72;
    vector-effect: non-scaling-stroke;
  }
  .deal-view__history-point {
    position: absolute;
    z-index: 2;
    display: block;
    width: 10px;
    height: 10px;
    pointer-events: none;
    background: var(--deal-paper);
    border: 2px solid var(--deal-line);
    border-radius: 50%;
    transform: translate(var(--deal-point-x, -50%), -50%);
  }
  .deal-view__history-point[hidden] { display: none; }
  .deal-view__history-point--bid { border-color: var(--deal-buyer-tone); }
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
    background: color-mix(in srgb, var(--deal-paper) 94%, transparent);
    border: 1px solid var(--deal-rule-strong);
    border-radius: 4px;
    box-shadow: 0 12px 32px color-mix(in srgb, var(--deal-line) 12%, transparent);
    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);
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
    stroke-linecap: square;
    stroke-linejoin: bevel;
    stroke-width: 4px;
    vector-effect: non-scaling-stroke;
  }
  .deal-view__negotiation-area {
    fill: var(--deal-area);
    opacity: 0.32;
  }
  .deal-view__negotiation-line--bid {
    stroke: var(--deal-buyer-tone);
    stroke-dasharray: 8 8;
    stroke-width: 3px;
    opacity: 0.76;
  }
  .deal-view__negotiation-line--ask { stroke: var(--deal-line); }
  .deal-view--quote .deal-view__negotiation-line {
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 3.5px;
  }
  .deal-view--quote .deal-view__negotiation-line--bid {
    stroke: var(--deal-buyer-tone);
    stroke-dasharray: none;
    stroke-width: 3.5px;
    opacity: 1;
  }
  .deal-view--quote .deal-view__negotiation-line--ask {
    stroke: var(--deal-seller-tone);
    opacity: 1;
  }
  .quote-view__flow-signal { --deal-signal-tone: var(--deal-line); }
  .quote-view__flow-signal--buyer { --deal-signal-tone: var(--deal-buyer-tone); }
  .quote-view__flow-signal--desk { --deal-signal-tone: var(--deal-desk-tone); }
  .quote-view__flow-signal--seller { --deal-signal-tone: var(--deal-seller-tone); }
  .quote-view__flow-signal line {
    stroke: var(--deal-signal-tone);
    stroke-width: 3.5px;
    opacity: 0.34;
    vector-effect: non-scaling-stroke;
  }
  .quote-view__flow-signal circle {
    fill: var(--deal-paper);
    stroke: var(--deal-signal-tone);
    stroke-width: 2px;
    opacity: 0.82;
    vector-effect: non-scaling-stroke;
  }
  .quote-view__flow-signal--desk line { opacity: 0.44; }
  .quote-view__flow-signal--desk circle {
    fill: var(--deal-desk-tone);
    stroke: var(--deal-paper);
    stroke-width: 2.5px;
    opacity: 1;
  }
  .quote-view__history-selection { pointer-events: none; }
  .quote-view__history-point {
    fill: var(--deal-paper);
    stroke: var(--deal-line);
    stroke-width: 3px;
    vector-effect: non-scaling-stroke;
  }
  .quote-view__history-point--bid { stroke: var(--deal-buyer-tone); }
  .quote-view__history-point--ask { stroke: var(--deal-seller-tone); }
  .deal-view__agreed-point {
    position: absolute;
    z-index: 1;
    display: block;
    width: 12px;
    height: 12px;
    pointer-events: none;
    background: var(--deal-paper);
    border: 3px solid var(--deal-line);
    border-radius: 50%;
    transform: translate(var(--deal-point-x, -50%), -50%);
  }
  .deal-view--static .deal-view__shell,
  .deal-view--focus .deal-view__shell { box-shadow: none; }
  @media (max-width: 620px) {
    .deal-view__head {
      padding: 12px 12px 0;
    }
    .deal-view__quote { font-size: 24px; line-height: 32px; }
    .deal-view__ticket {
      gap: 8px;
      padding: 0 12px 12px;
      font-size: 9px;
      line-height: 14px;
    }
    .deal-view__callout {
      right: 12px !important;
      bottom: 12px !important;
      left: 12px !important;
      top: auto !important;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      padding: 12px;
    }
    .deal-view__callout > span {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 0;
    }
    .deal-view__callout-head {
      grid-column: 1 / -1;
      grid-template-columns: minmax(0, 1fr) auto !important;
      padding-bottom: 8px;
      margin-bottom: 0;
    }
    .deal-view__callout > span:last-child { display: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .deal-view__history-point { transition: none; }
  }
  @media (prefers-contrast: more) {
    .deal-view__callout,
    .deal-view__shell { border-color: var(--deal-line); }
    .deal-view__status,
    .deal-view__callout small,
    .deal-view__callout b { opacity: 1; }
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
