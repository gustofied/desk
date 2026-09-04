import {
  viewArtifactHeaderLayout,
  viewArtifactHeaderMarkup,
} from "./view-artifact-header.js";

const SVG_WIDTH = 1200;
const SVG_HEIGHT = 630;
const COMPACT_SVG_HEIGHT = 675;

export function renderGpuMarketDepthSvg(model, options = {}) {
  const { inner, ariaLabel } = gpuMarketDepthMarkup(model, options);
  const height = options.compact ? COMPACT_SVG_HEIGHT : SVG_HEIGHT;
  const accessibility = options.decorative
    ? `aria-hidden="true"`
    : `role="img" aria-label="${escapeXml(ariaLabel)}"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" ` +
    `height="${height}" viewBox="0 0 ${SVG_WIDTH} ${height}" ` +
    `${accessibility}>${inner}</svg>`
  );
}

export function paintGpuMarketDepthChart(
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
  const focusedPrice = interactionTarget?.dataset.depthActivePrice;
  const focusedHistoryTimestamp =
    interactionTarget?.dataset.depthActiveTimestamp;
  const { inner, ariaLabel } = gpuMarketDepthMarkup(model, options);
  const height = options.compact ? COMPACT_SVG_HEIGHT : SVG_HEIGHT;
  const canInteract = interactive && !decorative && !options.minimal;
  const view = depthView(model, options);

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

  if (canInteract && view === "history") {
    configureHistoryNavigation(svgNode, focusedHistoryTimestamp, ariaLabel);
  } else if (canInteract) {
    configureShelfNavigation(svgNode, focusedPrice, ariaLabel);
  } else {
    resetDepthNavigation(interactionTarget);
  }
  if (reducedMotion) return;

  if (view === "history") {
    svgNode.querySelector("[data-depth-history-heatmap]")?.animate?.(
      [{ opacity: 0 }, { opacity: 1 }],
      {
        duration: 280,
        easing: "cubic-bezier(0.32, 0.72, 0, 1)",
        fill: "both",
      },
    );
    svgNode.querySelector("[data-depth-history-clearing]")?.animate?.(
      [{ opacity: 0 }, { opacity: 1 }],
      {
        delay: 80,
        duration: 360,
        easing: "cubic-bezier(0.32, 0.72, 0, 1)",
        fill: "both",
      },
    );
    return;
  }

  svgNode.querySelectorAll("[data-depth-shelf-band]").forEach((shelf, index) => {
    shelf.animate?.([{ opacity: 0 }, { opacity: 1 }], {
      delay: Math.min(index * 14, 180),
      duration: 360,
      easing: "cubic-bezier(0.32, 0.72, 0, 1)",
      fill: "both",
    });
  });
  svgNode.querySelector("[data-depth-current-profile]")?.animate?.(
    [
      { strokeDashoffset: 1, opacity: 0.42 },
      { strokeDashoffset: 0, opacity: 1 },
    ],
    {
      duration: 560,
      easing: "cubic-bezier(0.32, 0.72, 0, 1)",
      fill: "both",
    },
  );
  svgNode.querySelectorAll("[data-depth-anchor]").forEach((anchor, index) => {
    anchor.animate?.(
      [
        { transform: "scale(0.62)", opacity: 0 },
        { transform: "scale(1)", opacity: 1 },
      ],
      {
        delay: 170 + index * 45,
        duration: 280,
        easing: "cubic-bezier(0.32, 0.72, 0, 1)",
        fill: "both",
      },
    );
  });
}

export function gpuMarketDepthMarkup(
  model,
  {
    colors,
    title = model?.title || "H100 depth",
    compact = false,
    artifact = compact,
    minimal = false,
    ...options
  } = {},
) {
  assertModel(model);
  const palette = normalizeColors(colors);
  const layout = chartLayout(compact, artifact);
  const view = depthView(model, options);
  if (view === "history") {
    return gpuMarketDepthHistoryMarkup(model, {
      palette,
      title,
      compact,
      artifact,
      minimal,
      layout,
    });
  }
  const capacityMaximum = Math.max(
    model.targetNodes,
    model.current.totalAvailableNodes,
  );
  const capacityScale = linearScale(
    0,
    capacityMaximum,
    layout.plotLeft,
    layout.plotRight,
  );
  const x = (value) => capacityScale(value);
  const displayPriceDomain = paddedPriceDomain(
    model.priceDomain,
    model.priceLevels,
  );
  const y = linearScale(
    displayPriceDomain[0],
    displayPriceDomain[1],
    layout.plotBottom,
    layout.plotTop,
  );
  const currentPath = availabilityProfilePath(model.current.buckets, x, y);
  const currentArea = availabilityAreaPath(
    model.current.buckets,
    layout.plotLeft,
    x,
    y,
  );
  const referencePrice = snapshotBenchmarkPrice(model.current);
  const clearingPrice = model.current.clearingPrice;
  const referenceY = y(referencePrice);
  const targetX = x(model.targetNodes);
  const clearingY = clearingPrice === null ? null : y(clearingPrice);
  const ariaLabel = marketDepthAriaLabel(model, title);
  const shelfBands = shelfBandMarkup(
    model,
    palette,
    layout,
    x,
    y,
    displayPriceDomain,
  );
  const bucketHitAreas = minimal
    ? ""
    : bucketMarkup(
        model,
        palette,
        layout,
        x,
        y,
        compact,
        displayPriceDomain,
      );
  const clearingGuide = clearingY === null
    ? ""
    : clearingMarkup(
        palette,
        targetX,
        referenceY,
        clearingY,
        compact,
      );

  const artifactHeader = artifact
    ? viewArtifactHeaderMarkup({
        title,
        context: "NOW",
        headline: model.current.clearingPrice === null
          ? `>${formatPrice(model.priceDomain[1])}`
          : formatPrice(model.current.clearingPrice),
        colors: palette,
        compact,
        overlap: true,
      })
    : "";

  const inner = `
    <desc>${escapeXml(ariaLabel)}</desc>
    <rect width="${SVG_WIDTH}" height="${layout.height}" fill="${palette.paper}"/>
    <path data-depth-current-area="" d="${currentArea}" fill="${palette.area}"
      fill-opacity="0.055" pointer-events="none" aria-hidden="true"/>
    ${shelfBands}
    <path class="gpu-market-depth__profile" data-depth-current-profile=""
      d="${currentPath}" fill="none" stroke="${palette.line}"
      stroke-width="${compact ? 6 : 3.5}" stroke-linecap="round" stroke-linejoin="round"
      vector-effect="non-scaling-stroke" pathLength="1" stroke-dasharray="1" stroke-dashoffset="0"/>
    <line data-depth-reference="" x1="${layout.plotLeft}" x2="${layout.plotRight}"
      y1="${coordinate(referenceY)}" y2="${coordinate(referenceY)}"
      stroke="${palette.secondary}" stroke-width="1.25" stroke-opacity="0.2"
      stroke-dasharray="2 7" vector-effect="non-scaling-stroke"/>
    ${clearingGuide}
    ${bucketHitAreas}
    ${artifactHeader}`;

  return { inner, ariaLabel };
}

function gpuMarketDepthHistoryMarkup(
  model,
  { palette, title, compact, artifact, minimal, layout },
) {
  const history = historySnapshots(model);
  const displayPriceDomain = paddedPriceDomain(
    model.priceDomain,
    model.priceLevels,
  );
  const y = linearScale(
    displayPriceDomain[0],
    displayPriceDomain[1],
    layout.plotBottom,
    layout.plotTop,
  );
  const columnWidth = (layout.plotRight - layout.plotLeft) /
    Math.max(1, history.length);
  const xForIndex = (index) =>
    layout.plotLeft + (index + 0.5) * columnWidth;
  const intensityMaximum = historyIntensityMaximum(history);
  const cells = history
    .map((snapshot, columnIndex) => {
      const left = layout.plotLeft + columnIndex * columnWidth;
      return snapshot.buckets
        .map((bucket, bucketIndex) => {
          const bounds = bucketRowBounds(
            snapshot.buckets,
            bucketIndex,
            displayPriceDomain,
            y,
          );
          const nodes = bucketIncrementalNodes(snapshot.buckets, bucketIndex);
          if (nodes <= 0) return "";
          const intensity = Math.min(1, nodes / intensityMaximum);
          const edgeDistance = Math.min(
            bucketIndex,
            snapshot.buckets.length - bucketIndex - 1,
          );
          const edgeWeight = edgeDistance === 0
            ? 0.45
            : edgeDistance === 1
              ? 0.75
              : 1;
          const opacity = (0.006 + Math.pow(intensity, 1.2) *
            (palette.dark ? 0.22 : 0.18)) * edgeWeight;
          const x = Math.max(layout.plotLeft, left);
          const right = Math.min(
            layout.plotRight,
            left + columnWidth,
          );
          return `<rect data-depth-history-cell="" x="${coordinate(x)}"
            y="${coordinate(bounds.top)}" width="${coordinate(right - x)}"
            height="${coordinate(bounds.height)}" fill="${palette.line}"
            fill-opacity="${coordinate(opacity)}" pointer-events="none"
            aria-hidden="true"/>`;
        })
        .join("");
    })
    .join("");
  const benchmarkPath = historyValuePath(
    history,
    (snapshot) => snapshot.benchmarkPrice,
    xForIndex,
    y,
  );
  const clearingPath = historyValuePath(
    history,
    (snapshot) => snapshot.clearingPrice,
    xForIndex,
    y,
  );
  const ariaLabel = marketDepthHistoryAriaLabel(model, history, title);
  const hitColumns = minimal
    ? ""
    : historyColumnMarkup(
        history,
        model.targetNodes,
        layout,
        columnWidth,
        xForIndex,
        y,
      );
  const readout = minimal
    ? ""
    : historyReadoutMarkup(palette, layout, compact);
  const artifactHeader = artifact
    ? viewArtifactHeaderMarkup({
        title,
        context: `${Math.max(1, history.length)}D`,
        headline: model.current.clearingPrice === null
          ? `>${formatPrice(model.priceDomain[1])}`
          : formatPrice(model.current.clearingPrice),
        colors: palette,
        compact,
        overlap: true,
      })
    : "";

  const inner = `
    <desc>${escapeXml(ariaLabel)}</desc>
    <rect width="${SVG_WIDTH}" height="${layout.height}" fill="${palette.paper}"/>
    <g data-depth-history-heatmap="" shape-rendering="crispEdges">${cells}</g>
    <path data-depth-history-benchmark="" d="${benchmarkPath}" fill="none"
      stroke="${palette.secondary}" stroke-width="${compact ? 2 : 1.5}"
      stroke-opacity="0.28" stroke-dasharray="2 8" stroke-linecap="round"
      stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    <path data-depth-history-clearing="" d="${clearingPath}" fill="none"
      stroke="${palette.line}" stroke-width="${compact ? 5 : 3.5}"
      stroke-linecap="round" stroke-linejoin="round"
      vector-effect="non-scaling-stroke"/>
    ${hitColumns}
    ${readout}
    ${artifactHeader}`;

  return { inner, ariaLabel };
}

function resetDepthNavigation(target) {
  if (!target) return;
  const ownsNavigation = target.hasAttribute("data-depth-interactive");
  target.__deskDepthNavigation?.abort();
  delete target.__deskDepthNavigation;
  target.removeAttribute("data-depth-interactive");
  if (ownsNavigation) {
    target.removeAttribute("tabindex");
    target.removeAttribute("role");
    target.removeAttribute("aria-label");
  }
  target.querySelector("[data-depth-live]")?.remove();
}

function createDepthNavigation(svgNode, ariaLabel, instruction) {
  const target = svgNode.parentElement;
  if (!target) return null;
  const wasFocused = target === target.ownerDocument.activeElement;
  resetDepthNavigation(target);
  const controller = new AbortController();
  const live = target.ownerDocument.createElement("span");
  live.className = "gpu-market-depth__live";
  live.dataset.depthLive = "";
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");
  target.__deskDepthNavigation = controller;
  target.dataset.depthInteractive = "";
  target.tabIndex = 0;
  target.setAttribute("role", "group");
  target.setAttribute("aria-label", `${ariaLabel} ${instruction}`);
  target.append(live);
  if (wasFocused) queueMicrotask(() => target.focus({ preventScroll: true }));
  return { live, signal: controller.signal, target };
}

function announceDepthValue(live, value) {
  if (!live || !value) return;
  live.textContent = "";
  queueMicrotask(() => {
    live.textContent = value;
  });
}

function configureHistoryNavigation(svgNode, focusedTimestamp, ariaLabel) {
  const columns = Array.from(
    svgNode.querySelectorAll("[data-depth-history-column]"),
  );
  const overlay = svgNode.querySelector("[data-depth-history-readout]");
  if (!columns.length || !overlay) return;
  const navigation = createDepthNavigation(
    svgNode,
    ariaLabel,
    "Use the arrow keys to inspect dates. Hold Shift to move seven days.",
  );
  if (!navigation) return;
  const { live, signal, target } = navigation;
  let activeIndex = columns.findIndex(
    (column) => column.dataset.timestamp === focusedTimestamp,
  );
  if (activeIndex < 0) activeIndex = columns.length - 1;

  const updateReadout = (column, visible) => {
    if (!column || !visible) {
      overlay.setAttribute("opacity", "0");
      return;
    }
    const x = Number(column.dataset.x);
    const width = Number(column.dataset.width);
    const benchmarkY = Number(column.dataset.benchmarkY);
    const clearingValue = column.dataset.clearingY;
    const clearingY = clearingValue === "" ? null : Number(clearingValue);
    const clearingVisible = Number.isFinite(clearingY);
    overlay.setAttribute("opacity", "1");
    overlay
      .querySelector("[data-depth-history-highlight]")
      ?.setAttribute("x", coordinate(x - width / 2));
    overlay
      .querySelector("[data-depth-history-highlight]")
      ?.setAttribute("width", coordinate(width));
    for (const node of overlay.querySelectorAll("[data-depth-history-guide]")) {
      node.setAttribute("x1", coordinate(x));
      node.setAttribute("x2", coordinate(x));
    }
    const basis = overlay.querySelector("[data-depth-history-basis]");
    basis?.setAttribute("y1", coordinate(benchmarkY));
    basis?.setAttribute("y2", coordinate(clearingY ?? benchmarkY));
    basis?.setAttribute("opacity", clearingVisible ? "0.58" : "0");
    const benchmark = overlay.querySelector("[data-depth-history-benchmark-dot]");
    benchmark?.setAttribute("cx", coordinate(x));
    benchmark?.setAttribute("cy", coordinate(benchmarkY));
    const clearing = overlay.querySelector("[data-depth-history-clearing-dot]");
    clearing?.setAttribute("cx", coordinate(x));
    clearing?.setAttribute("cy", coordinate(clearingY ?? benchmarkY));
    clearing?.setAttribute("opacity", clearingVisible ? "1" : "0");
    setText(overlay, "[data-depth-history-date]", column.dataset.dateLabel);
    setText(
      overlay,
      "[data-depth-history-benchmark-value]",
      `BENCHMARK ${column.dataset.benchmarkLabel}`,
    );
    setText(
      overlay,
      "[data-depth-history-clearing-value]",
      `CLEAR ${column.dataset.clearingLabel}`,
    );
    setText(
      overlay,
      "[data-depth-history-basis-value]",
      `BASIS ${column.dataset.basisLabel}`,
    );
  };
  const setActive = (column, active) => {
    column?.toggleAttribute("data-active", active);
    updateReadout(column, active);
  };
  const selectColumn = (index, announce = true) => {
    const nextIndex = Math.max(0, Math.min(columns.length - 1, index));
    setActive(columns[activeIndex], false);
    activeIndex = nextIndex;
    target.dataset.depthActiveTimestamp = columns[activeIndex].dataset.timestamp;
    setActive(columns[activeIndex], true);
    if (announce) {
      announceDepthValue(live, columns[activeIndex].dataset.ariaLabel);
    }
  };

  columns.forEach((column, index) => {
    column.setAttribute("aria-hidden", "true");
    column.addEventListener("pointerenter", () => {
      setActive(columns[activeIndex], false);
      setActive(column, true);
    }, { signal });
    column.addEventListener("pointerleave", () => {
      setActive(column, false);
      setActive(columns[activeIndex], true);
    }, { signal });
    column.addEventListener("pointerdown", () => {
      setActive(columns[activeIndex], false);
      activeIndex = index;
      target.dataset.depthActiveTimestamp = column.dataset.timestamp;
      target.focus({ preventScroll: true });
      selectColumn(index);
    }, { signal });
  });
  target.addEventListener("focus", () => selectColumn(activeIndex, false), {
    signal,
  });
  target.addEventListener("blur", () => setActive(columns[activeIndex], true), {
    signal,
  });
  target.addEventListener("keydown", (event) => {
    const distance = event.shiftKey ? 7 : 1;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      selectColumn(activeIndex + distance);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      selectColumn(activeIndex - distance);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectColumn(0);
    } else if (event.key === "End") {
      event.preventDefault();
      selectColumn(columns.length - 1);
    }
  }, { signal });
  selectColumn(activeIndex, false);
}

function historyColumnMarkup(
  history,
  targetNodes,
  layout,
  columnWidth,
  xForIndex,
  y,
) {
  return history
    .map((snapshot, index) => {
      const x = xForIndex(index);
      const left = Math.max(
        layout.plotLeft,
        layout.plotLeft + index * columnWidth,
      );
      const right = Math.min(layout.plotRight, left + columnWidth);
      const benchmarkY = y(snapshot.benchmarkPrice);
      const clearingY = snapshot.clearingPrice === null
        ? ""
        : y(snapshot.clearingPrice);
      const clearingLabel = snapshot.clearingPrice === null
        ? `>${formatPrice(historyPriceMaximum(history))}`
        : formatPrice(snapshot.clearingPrice);
      const basisLabel = snapshot.clearingPrice === null
        ? "N/A"
        : formatBasis(snapshot.clearingPrice - snapshot.benchmarkPrice);
      const ariaLabel = historyColumnAriaLabel(
        snapshot,
        targetNodes,
        clearingLabel,
        basisLabel,
      );
      return `<g data-depth-history-column="" data-timestamp="${snapshot.timestamp}"
        style="cursor:crosshair;outline:none"
        data-x="${coordinate(x)}" data-width="${coordinate(Math.max(1, right - left))}"
        data-benchmark-y="${coordinate(benchmarkY)}"
        data-clearing-y="${clearingY === "" ? "" : coordinate(clearingY)}"
        data-date-label="${escapeXml(formatHistoryDate(snapshot.timestamp))}"
        data-benchmark-label="${escapeXml(formatPrice(snapshot.benchmarkPrice))}"
        data-clearing-label="${escapeXml(clearingLabel)}"
        data-basis-label="${escapeXml(basisLabel)}"
        data-aria-label="${escapeXml(ariaLabel)}">
        <rect x="${coordinate(left)}" y="${layout.plotTop}"
          width="${coordinate(Math.max(1, right - left))}"
          height="${coordinate(layout.plotBottom - layout.plotTop)}"
          fill="#000000" fill-opacity="0"/>
      </g>`;
    })
    .join("");
}

function historyReadoutMarkup(palette, layout, compact) {
  const fontSize = compact ? 16 : 15;
  const readoutY = layout.plotTop + 28;
  return `<g data-depth-history-readout="" opacity="0" pointer-events="none">
    <rect data-depth-history-highlight="" x="0" y="${layout.plotTop}"
      width="1" height="${coordinate(layout.plotBottom - layout.plotTop)}"
      fill="${palette.line}" fill-opacity="0.055"/>
    <line data-depth-history-guide="" x1="0" x2="0" y1="${layout.plotTop}"
      y2="${layout.plotBottom}" stroke="${palette.line}" stroke-width="1"
      stroke-opacity="0.28" vector-effect="non-scaling-stroke"/>
    <line data-depth-history-guide="" data-depth-history-basis="" x1="0" x2="0"
      y1="0" y2="0" stroke="${palette.line}" stroke-width="3"
      stroke-opacity="0.72" vector-effect="non-scaling-stroke"/>
    <circle data-depth-history-benchmark-dot="" cx="0" cy="0" r="5"
      fill="${palette.paper}" stroke="${palette.secondary}" stroke-width="2.5"
      vector-effect="non-scaling-stroke"/>
    <circle data-depth-history-clearing-dot="" cx="0" cy="0" r="6"
      fill="${palette.line}" stroke="${palette.paper}" stroke-width="2.5"
      vector-effect="non-scaling-stroke"/>
    <text x="18" y="${coordinate(readoutY)}" font-family="Geist Mono, monospace"
      font-size="${fontSize}" letter-spacing="0.25">
      <tspan data-depth-history-date="" fill="${palette.line}" font-weight="650"></tspan>
      <tspan data-depth-history-benchmark-value="" dx="22" fill="${palette.secondary}"></tspan>
      <tspan data-depth-history-clearing-value="" dx="22" fill="${palette.line}" font-weight="600"></tspan>
      <tspan data-depth-history-basis-value="" dx="22" fill="${palette.secondary}"></tspan>
    </text>
  </g>`;
}

function historySnapshots(model) {
  const source = Array.isArray(model.history) ? [...model.history] : [];
  if (
    model.current?.timestamp &&
    !source.some((snapshot) => snapshot?.timestamp === model.current.timestamp)
  ) {
    source.push(model.current);
  }
  const daily = new Map();
  source
    .filter(
      (snapshot) =>
        Number.isFinite(Number(snapshot?.timestamp)) &&
        Array.isArray(snapshot?.buckets) &&
        snapshot.buckets.length,
    )
    .sort((left, right) => left.timestamp - right.timestamp)
    .forEach((snapshot) => {
      const timestamp = Number(snapshot.timestamp);
      const dateKey = Math.floor(timestamp / (24 * 60 * 60));
      const benchmarkPrice = snapshotBenchmarkPrice(snapshot);
      const clearingPrice = snapshotClearingPrice(snapshot, model.targetNodes);
      daily.set(dateKey, {
        ...snapshot,
        timestamp,
        benchmarkPrice,
        clearingPrice,
      });
    });
  const history = Array.from(daily.values()).slice(-91);
  if (!history.length) {
    throw new TypeError("Market depth history is required for the history view");
  }
  return history;
}

function historyIntensityMaximum(history) {
  const values = history
    .flatMap((snapshot) =>
      snapshot.buckets.map((_, index) =>
        bucketIncrementalNodes(snapshot.buckets, index),
      ),
    )
    .filter((value) => value > 0)
    .sort((left, right) => left - right);
  if (!values.length) return 1;
  return Math.max(1, values[Math.floor((values.length - 1) * 0.95)]);
}

function historyValuePath(history, valueForSnapshot, xForIndex, y) {
  let path = "";
  let drawing = false;
  history.forEach((snapshot, index) => {
    const rawValue = valueForSnapshot(snapshot);
    if (rawValue === null || rawValue === undefined) {
      drawing = false;
      return;
    }
    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      drawing = false;
      return;
    }
    const command = drawing ? "L" : "M";
    path += `${command}${coordinate(xForIndex(index))},${coordinate(y(value))}`;
    drawing = true;
  });
  return path;
}

function marketDepthHistoryAriaLabel(model, history, title) {
  const latest = history.at(-1);
  const start = formatHistoryDate(history[0].timestamp, true);
  const end = formatHistoryDate(latest.timestamp, true);
  const heading = /\bhistory$/i.test(String(title).trim())
    ? String(title).trim()
    : `${title} history`;
  const clearing = latest.clearingPrice === null
    ? `${formatInteger(model.targetNodes)} nodes exceed the visible availability range.`
    : `${formatInteger(model.targetNodes)} nodes most recently clear at ` +
      `${formatPrice(latest.clearingPrice)} per GPU hour, a basis of ` +
      `${formatBasis(latest.clearingPrice - latest.benchmarkPrice)} to the benchmark.`;
  return `${heading} from ${start} through ${end}. ` +
    "Color intensity represents incremental node capacity at each price. " +
    `The dashed line is the benchmark and the solid line is the clearing price. ${clearing}`;
}

function historyColumnAriaLabel(
  snapshot,
  targetNodes,
  clearingLabel,
  basisLabel,
) {
  const clearing = snapshot.clearingPrice === null
    ? `${formatInteger(targetNodes)} nodes do not clear in the visible range.`
    : `${formatInteger(targetNodes)} nodes clear at ${clearingLabel}. ` +
      `Basis ${basisLabel}.`;
  return `${formatHistoryDate(snapshot.timestamp, true)}. ` +
    `Benchmark ${formatPrice(snapshot.benchmarkPrice)}. ${clearing}`;
}

function snapshotBenchmarkPrice(snapshot) {
  const price = Number(
    snapshot?.benchmarkPrice ??
    snapshot?.referencePrice ??
    snapshot?.postedPrice,
  );
  if (!Number.isFinite(price)) {
    throw new TypeError("Market depth benchmark price is required");
  }
  return price;
}

function snapshotCapacityAtBenchmark(snapshot) {
  const provided = Number(
    snapshot?.capacityAtBenchmark ?? snapshot?.capacityAtReference,
  );
  if (Number.isFinite(provided)) return provided;
  const benchmark = snapshotBenchmarkPrice(snapshot);
  return snapshot.buckets
    .filter((bucket) => Number(bucket.price) <= benchmark)
    .at(-1)?.cumulativeNodes || 0;
}

function snapshotClearingPrice(snapshot, targetNodes) {
  if (snapshot?.clearingPrice === null) return null;
  const provided = Number(snapshot?.clearingPrice);
  if (Number.isFinite(provided)) return provided;
  return snapshot.buckets.find(
    (bucket) => Number(bucket.cumulativeNodes) >= Number(targetNodes),
  )?.price ?? null;
}

function bucketIncrementalNodes(buckets, index) {
  const provided = Number(buckets[index]?.incrementalNodes);
  if (Number.isFinite(provided)) return Math.max(0, provided);
  const cumulative = Number(buckets[index]?.cumulativeNodes) || 0;
  const previous = Number(buckets[index - 1]?.cumulativeNodes) || 0;
  return Math.max(0, cumulative - previous);
}

function historyPriceMaximum(history) {
  return Math.max(
    ...history.flatMap((snapshot) =>
      snapshot.buckets.map((bucket) => Number(bucket.price)),
    ),
  );
}

function formatHistoryDate(timestamp, long = false) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: long ? "long" : "short",
    ...(long ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(new Date(Number(timestamp) * 1000)).toUpperCase();
}

function formatBasis(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "N/A";
  const sign = amount > 0 ? "+" : amount < 0 ? "−" : "";
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

function setText(root, selector, value) {
  const node = root.querySelector(selector);
  if (node) node.textContent = value || "";
}

function configureShelfNavigation(svgNode, focusedPrice, ariaLabel) {
  const buckets = Array.from(svgNode.querySelectorAll("[data-depth-bucket]"));
  if (!buckets.length) return;
  const navigation = createDepthNavigation(
    svgNode,
    ariaLabel,
    "Use the arrow keys to inspect price shelves.",
  );
  if (!navigation) return;
  const { live, signal, target } = navigation;
  let activeIndex = Math.max(
    0,
    buckets.findIndex((bucket) => bucket.dataset.price === focusedPrice),
  );

  const setActive = (bucket, active) => {
    if (!bucket) return;
    bucket.toggleAttribute("data-active", active);
    bucket
      .querySelector("[data-depth-bucket-highlight]")
      ?.setAttribute("opacity", active ? "0.02" : "0");
    bucket
      .querySelector("[data-depth-bucket-band]")
      ?.setAttribute("stroke-opacity", active ? "0.32" : "0");
    bucket
      .querySelector("[data-depth-bucket-edge]")
      ?.setAttribute("stroke-width", active ? "5" : "0");
    bucket
      .querySelector("[data-depth-bucket-readout]")
      ?.setAttribute("opacity", active ? "1" : "0");
  };
  const selectBucket = (index, announce = true) => {
    const nextIndex = (index + buckets.length) % buckets.length;
    setActive(buckets[activeIndex], false);
    activeIndex = nextIndex;
    target.dataset.depthActivePrice = buckets[activeIndex].dataset.price;
    setActive(buckets[activeIndex], true);
    if (announce) {
      announceDepthValue(live, buckets[activeIndex].dataset.ariaLabel);
    }
  };

  buckets.forEach((bucket, index) => {
    bucket.setAttribute("aria-hidden", "true");
    bucket.addEventListener("pointerenter", () => {
      setActive(buckets[activeIndex], false);
      setActive(bucket, true);
    }, { signal });
    bucket.addEventListener("pointerleave", () => {
      setActive(bucket, false);
      if (target === target.ownerDocument.activeElement) {
        setActive(buckets[activeIndex], true);
      }
    }, { signal });
    bucket.addEventListener("pointerdown", () => {
      setActive(buckets[activeIndex], false);
      activeIndex = index;
      target.dataset.depthActivePrice = bucket.dataset.price;
      target.focus({ preventScroll: true });
      selectBucket(index);
    }, { signal });
  });
  target.addEventListener("focus", () => selectBucket(activeIndex, false), {
    signal,
  });
  target.addEventListener("blur", () => setActive(buckets[activeIndex], false), {
    signal,
  });
  target.addEventListener("keydown", (event) => {
    if (event.key === "ArrowUp" || event.key === "ArrowRight") {
      event.preventDefault();
      selectBucket(activeIndex + 1);
    } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
      event.preventDefault();
      selectBucket(activeIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectBucket(0);
    } else if (event.key === "End") {
      event.preventDefault();
      selectBucket(buckets.length - 1);
    }
  }, { signal });
}

function shelfBandMarkup(model, palette, layout, x, y, priceDomain) {
  const maxShelf = Math.max(
    1,
    ...model.current.buckets.map((bucket) => bucket.incrementalNodes),
  );
  let previousCapacity = 0;
  return model.current.buckets
    .map((bucket, index) => {
      const start = x(previousCapacity);
      const end = x(bucket.cumulativeNodes);
      previousCapacity = bucket.cumulativeNodes;
      if (end <= start) return "";
      const { top, height } = bucketRowBounds(
        model.current.buckets,
        index,
        priceDomain,
        y,
      );
      const weight = bucket.incrementalNodes / maxShelf;
      const shelfOpacity = 0.015 + weight * 0.055;
      const rowTop = top + 0.5;
      const rowHeight = Math.max(1, height - 1);
      return `
        <rect data-depth-shelf-band="" x="${coordinate(start)}" y="${coordinate(rowTop)}"
          width="${coordinate(end - start)}" height="${coordinate(rowHeight)}"
          fill="${palette.line}" fill-opacity="${coordinate(shelfOpacity)}"
          pointer-events="none" aria-hidden="true"/>`;
    })
    .join("");
}

function bucketRowBounds(buckets, index, priceDomain, y) {
  const bucket = buckets[index];
  const previousPrice = buckets[index - 1]?.price ?? priceDomain[0];
  const nextPrice = buckets[index + 1]?.price ?? priceDomain[1];
  const upper = index === buckets.length - 1
    ? y(priceDomain[1])
    : y((bucket.price + nextPrice) / 2);
  const lower = index === 0
    ? y(priceDomain[0])
    : y((previousPrice + bucket.price) / 2);
  return {
    top: Math.min(upper, lower),
    height: Math.max(1, Math.abs(lower - upper)),
  };
}

function bucketMarkup(model, palette, layout, x, y, compact, priceDomain) {
  const buckets = model.current.buckets;
  let previousCapacity = 0;
  return buckets
    .map((bucket, index) => {
      const { top: rowTop, height: rowHeight } = bucketRowBounds(
        buckets,
        index,
        priceDomain,
        y,
      );
      const shelfStart = x(previousCapacity);
      const shelfEnd = x(bucket.cumulativeNodes);
      previousCapacity = bucket.cumulativeNodes;
      const targetSentence = bucket.isClearingShelf
        ? ` This shelf clears the ${formatInteger(model.targetNodes)} node target.`
        : "";
      const ariaLabel =
        `${formatPrice(bucket.price)} per GPU hour. ` +
        `${formatInteger(bucket.incrementalNodes)} nodes become available here. ` +
        `${formatInteger(bucket.cumulativeNodes)} nodes are available at or below this price.` +
        targetSentence;
      const readoutX = layout.plotLeft + 12;
      const readoutY = layout.plotTop + 24;

      return `
        <g class="gpu-market-depth__bucket" data-depth-bucket="" data-price="${escapeXml(bucket.price)}"
          data-aria-label="${escapeXml(ariaLabel)}">
          <rect data-depth-bucket-highlight="" x="${layout.plotLeft}" y="${coordinate(rowTop)}"
            width="${coordinate(layout.plotRight - layout.plotLeft)}" height="${coordinate(rowHeight)}"
            fill="${palette.line}" opacity="0" pointer-events="none"/>
          <line data-depth-bucket-band="" x1="${coordinate(shelfStart)}" x2="${coordinate(shelfEnd)}"
            y1="${coordinate(y(bucket.price))}" y2="${coordinate(y(bucket.price))}"
            stroke="${palette.line}" stroke-width="18" stroke-opacity="0"
            vector-effect="non-scaling-stroke" pointer-events="none"/>
          <line data-depth-bucket-edge="" x1="${coordinate(shelfStart)}" x2="${coordinate(shelfEnd)}"
            y1="${coordinate(y(bucket.price))}" y2="${coordinate(y(bucket.price))}"
            stroke="${palette.line}" stroke-width="0" stroke-opacity="0.9"
            vector-effect="non-scaling-stroke" pointer-events="none"/>
          <rect x="${layout.plotLeft}" y="${coordinate(rowTop)}"
            width="${coordinate(layout.plotRight - layout.plotLeft)}" height="${coordinate(rowHeight)}"
            fill="${palette.paper}" fill-opacity="0"/>
          ${compact ? "" : shelfReadout(bucket, palette, readoutX, readoutY)}
        </g>`;
    })
    .join("");
}

function shelfReadout(bucket, palette, x, y) {
  return `
    <g data-depth-bucket-readout="" opacity="0" pointer-events="none">
      <text x="${x}" y="${y}" font-family="Geist Mono, monospace"
        font-size="15" letter-spacing="0.25">
        <tspan fill="${palette.line}" font-weight="650">${escapeXml(formatPrice(bucket.price))}</tspan>
        <tspan dx="18" fill="${palette.secondary}" font-size="12">${escapeXml(`${formatInteger(bucket.incrementalNodes)} ADDED`)}</tspan>
        <tspan dx="18" fill="${palette.secondary}" font-size="12">${escapeXml(`${formatInteger(bucket.cumulativeNodes)} TOTAL`)}</tspan>
      </text>
    </g>`;
}

function clearingMarkup(palette, targetX, referenceY, clearingY, compact) {
  return `
    <line data-depth-basis="" x1="${coordinate(targetX)}" x2="${coordinate(targetX)}"
      y1="${coordinate(referenceY)}" y2="${coordinate(clearingY)}"
      stroke="${palette.line}" stroke-width="${compact ? 4 : 3}"
      stroke-opacity="0.34" vector-effect="non-scaling-stroke"/>
    <circle data-depth-anchor="clearing" cx="${coordinate(targetX)}" cy="${coordinate(clearingY)}"
      r="${compact ? 6 : 5}" fill="${palette.line}" stroke="${palette.paper}"
      stroke-width="${compact ? 3 : 2.5}" vector-effect="non-scaling-stroke"
      style="transform-box:fill-box;transform-origin:center"/>`;
}

function availabilityProfilePath(buckets, x, y) {
  if (!buckets.length) return "";
  let path = `M${coordinate(x(0))},${coordinate(y(buckets[0].price))}`;
  buckets.forEach((bucket, index) => {
    if (index > 0) path += `V${coordinate(y(bucket.price))}`;
    path += `H${coordinate(x(bucket.cumulativeNodes))}`;
  });
  return path;
}

function availabilityAreaPath(buckets, left, x, y) {
  if (!buckets.length) return "";
  let path = `M${coordinate(left)},${coordinate(y(buckets[0].price))}`;
  path += `H${coordinate(x(buckets[0].cumulativeNodes))}`;
  buckets.slice(1).forEach((bucket) => {
    path += `V${coordinate(y(bucket.price))}`;
    path += `H${coordinate(x(bucket.cumulativeNodes))}`;
  });
  path += `H${coordinate(left)}Z`;
  return path;
}

function marketDepthAriaLabel(model, title) {
  const target = model.current.targetReached
    ? `${formatInteger(model.targetNodes)} nodes clear at ` +
      `${formatPrice(model.current.clearingPrice)} per GPU hour.`
    : `${formatInteger(model.targetNodes)} nodes exceed the visible availability range.`;
  const benchmarkPrice = snapshotBenchmarkPrice(model.current);
  const reference =
    `The benchmark is ${formatPrice(benchmarkPrice)}, where ` +
    `${formatInteger(snapshotCapacityAtBenchmark(model.current))} nodes are available.`;
  const basis = model.current.clearingPrice === null
    ? ""
    : ` Basis ${formatBasis(model.current.clearingPrice - benchmarkPrice)}.`;
  return `${title}. ${reference} ${target}${basis}`;
}

function chartLayout(compact, artifact = compact) {
  const height = compact ? COMPACT_SVG_HEIGHT : SVG_HEIGHT;
  const header = viewArtifactHeaderLayout("", { compact });
  return {
    height,
    plotLeft: 0,
    plotRight: SVG_WIDTH,
    plotTop: artifact ? header.plotTop : 0,
    plotBottom: artifact ? height : height - 8,
  };
}

function normalizeColors(colors) {
  const required = ["paper", "line", "secondary", "area"];
  if (!colors || required.some((name) => !String(colors[name] || "").trim())) {
    throw new TypeError(
      "GPU depth colors must include paper, line, secondary, and area",
    );
  }
  const normalized = Object.fromEntries(
    required.map((name) => [name, escapeXml(String(colors[name]).trim())]),
  );
  normalized.dark = colors.theme === "dark" || colors.dark === true;
  return Object.freeze(normalized);
}

function paddedPriceDomain(priceDomain, priceLevels = []) {
  const gaps = priceLevels
    .slice(1)
    .map((price, index) => Number(price) - Number(priceLevels[index]))
    .filter((gap) => Number.isFinite(gap) && gap > 0)
    .sort((left, right) => left - right);
  const medianGap = gaps.length
    ? gaps[Math.floor((gaps.length - 1) / 2)]
    : (Number(priceDomain[1]) - Number(priceDomain[0])) / 10;
  const padding = Math.max(0, medianGap / 2);
  return [
    Number(priceDomain[0]) - padding,
    Number(priceDomain[1]),
  ];
}

function linearScale(domainStart, domainEnd, rangeStart, rangeEnd) {
  const domainSpan = domainEnd - domainStart;
  const rangeSpan = rangeEnd - rangeStart;
  return (value) => rangeStart + ((value - domainStart) / domainSpan) * rangeSpan;
}

function depthView(model, options = {}) {
  const requested = String(
    options.view ??
    options.mode ??
    options.visualization ??
    options.scale ??
    model?.view ??
    model?.mode ??
    model?.scale ??
    "now",
  ).toLowerCase();
  return requested === "history" || requested === "historic"
    ? "history"
    : "now";
}

function formatPrice(value) {
  return `$${Number(value).toFixed(2)}`;
}

function formatInteger(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
    Number(value),
  );
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

function assertModel(model) {
  if (
    !model?.current?.buckets?.length ||
    !model?.instrument ||
    !Number.isFinite(Number(model.asOf)) ||
    !Array.isArray(model.priceDomain) ||
    model.priceDomain.length !== 2 ||
    !Array.isArray(model.capacityDomain) ||
    model.capacityDomain.length !== 2
  ) {
    throw new TypeError("A GPU availability model is required");
  }
}
