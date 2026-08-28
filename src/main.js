import * as d3 from "d3";
import { animate } from "motion";
import { cardPermalink } from "./card-presentation.js";
import { createCardFeed } from "./compute-card-feed.js";
import { shareRangeLabel } from "./share-range-label.js";
import {
  horizontalHitZones,
  positionSvgTooltip,
} from "./chart-pointer.js";
import {
  bindCardCover,
  copyTextToClipboard,
  swapCardPanels,
} from "./card-transitions.js";

const root = document.querySelector("[data-gpu-benchmark-card]");

if (root) {
  const cardId = "gpu-index";
  const configuredDataBase = String(root.dataset.marketDataBase || "").replace(
    /\/+$/,
    "",
  );
  const fetchDataBase = ["127.0.0.1", "localhost"].includes(
    window.location.hostname,
  )
    ? `${window.location.origin}/api/dashboard-snapshots`
    : configuredDataBase;
  const publicationDataBase = "https://bazaar.adamsioud.com";
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const families = ["H100", "H200", "B200", "B300"];
  const selectedLineColor = "#315f82";
  const familyColors = new Map([
    ["H100", "#587383"],
    ["H200", "#708690"],
    ["B200", "#899ba2"],
    ["B300", "#a0afb4"],
  ]);
  const ranges = {
    "1d": { milliseconds: 24 * 60 * 60 * 1000, label: "1D" },
    "7d": { milliseconds: 7 * 24 * 60 * 60 * 1000, label: "7D" },
    all: { milliseconds: null, label: "ALL" },
  };
  const params = new URL(window.location.href).searchParams;
  const requestedCard = params.get("card");
  const requestedView =
    requestedCard === cardId ? params.get("view") : null;
  const initialView = ["detail", "card", "share"].includes(requestedView)
    ? requestedView
    : "detail";
  const state = {
    cards: new Map(),
    panel: initialView,
    selected: families.includes(params.get("gpu")) ? params.get("gpu") : "H200",
    range: ranges[params.get("range")] ? params.get("range") : "7d",
    shareReady: false,
    resizeTimer: null,
    transitionPending: false,
    controlsReadyAt: 0,
    zoomWindow: null,
  };

  const nodes = {
    panels: new Map(
      Array.from(root.querySelectorAll("[data-index-panel]")).map((panel) => [
        panel.dataset.indexPanel,
        panel,
      ]),
    ),
    cover: root.querySelector("[data-index-cover]"),
    open: root.querySelector("[data-index-open]"),
    closeButtons: Array.from(root.querySelectorAll("[data-index-close]")),
    shareButtons: Array.from(root.querySelectorAll("[data-index-share]")),
    cardButtons: Array.from(
      root.querySelectorAll("[data-index-card]"),
    ),
    return: root.querySelector("[data-share-return]"),
    copyLink: root.querySelector("[data-share-copy-link]"),
    shareStatus: root.querySelector("[data-share-status]"),
    shareArtifactSvg: root.querySelector("[data-share-artifact-svg]"),
    coverUpdated: root.querySelector("[data-cover-updated]"),
    familyButtons: Array.from(root.querySelectorAll("[data-gpu-family]")),
    familyValues: new Map(
      Array.from(root.querySelectorAll("[data-gpu-family-value]")).map(
        (node) => [node.dataset.gpuFamilyValue, node],
      ),
    ),
    rangeButtons: Array.from(root.querySelectorAll("[data-gpu-range]")),
    zoomReset: root.querySelector("[data-gpu-zoom-reset]"),
    rangeStart: root.querySelector("[data-gpu-range-start]"),
    rangeEnd: root.querySelector("[data-gpu-range-end]"),
    chart: root.querySelector("[data-gpu-chart]"),
    svg: root.querySelector("[data-gpu-chart-svg]"),
    tooltip: root.querySelector("[data-gpu-tooltip]"),
    chartState: root.querySelector("[data-gpu-state]"),
    coverFeed: root.querySelector('[data-card-feed="gpu"]'),
  };
  const coverFeed = createCardFeed(nodes.coverFeed, {
    visibleRows: 3,
    advanceDelayMs: 1800,
    motion: "snap",
    pauseOnHover: false,
  });

  initialize();

  function initialize() {
    setInitialPanel();
    setShareReady(false);
    configureChoiceButtons(
      nodes.familyButtons,
      (button) => button.dataset.gpuFamily,
      selectFamily,
      "aria-selected",
    );
    configureChoiceButtons(
      nodes.rangeButtons,
      (button) => button.dataset.gpuRange,
      selectRange,
      "aria-pressed",
    );
    nodes.open?.addEventListener("click", () => showPanel("detail", true));
    bindCardCover({
      cover: nodes.cover,
      activate: () => showPanel("detail", true),
    });
    nodes.closeButtons.forEach((button) => {
      button.addEventListener("click", () => showPanel("detail", true));
    });
    nodes.cardButtons.forEach((button) => {
      button.addEventListener("click", () => showPanel("card", true));
    });
    nodes.shareButtons.forEach((button) => {
      button.addEventListener("click", () => showPanel("share", true));
    });
    nodes.return?.addEventListener("click", () => showPanel("detail", true));
    nodes.copyLink?.addEventListener("click", copyCardLink);
    nodes.zoomReset?.addEventListener("click", resetCustomZoom);

    if ("ResizeObserver" in window && nodes.chart) {
      const observer = new ResizeObserver(() => {
        if (!state.cards.size || state.panel !== "detail") return;
        window.clearTimeout(state.resizeTimer);
        state.resizeTimer = window.setTimeout(() => render(false), 90);
      });
      observer.observe(nodes.chart);
    }

    syncControls();
    loadCards();
  }

  function setInitialPanel() {
    for (const [name, panel] of nodes.panels) {
      const isCurrent = name === state.panel;
      panel.hidden = !isCurrent;
      panel.toggleAttribute("inert", !isCurrent);
    }
    nodes.open?.setAttribute(
      "aria-expanded",
      String(state.panel === "detail"),
    );
    nodes.cover?.setAttribute(
      "aria-expanded",
      String(state.panel === "detail"),
    );
  }

  async function loadCards() {
    if (!fetchDataBase) {
      showFailure("Benchmark history could not load.");
      signalReady();
      return;
    }

    try {
      const cards = await Promise.all(
        families.map(async (family) => {
          const url = cardUrl(family, fetchDataBase);
          const response = await fetch(url, { cache: "no-store" });
          if (!response.ok) throw new Error(`${response.status} ${url}`);
          const payload = await response.json();
          if (
            payload?.contract !== "compute_bazaar_card" ||
            payload?.card_type !== "gpu_benchmark"
          ) {
            throw new Error(`Unsupported benchmark card at ${url}`);
          }
          const publication = await loadPublication(family);
          return [
            family,
            normalizeCard(
              publication ? { ...payload, publication } : payload,
              family,
            ),
          ];
        }),
      );
      state.cards = new Map(cards);
      setShareReady(true);
      updateFamilyQuoteNodes();
      renderCoverFeed();
      render(true);
    } catch (error) {
      setShareReady(false);
      console.error("GPU benchmark card failed to load", error);
      coverFeed.setItems([
        {
          label: "GPU benchmark",
          value: "unavailable",
          title: "Hourly benchmark history is temporarily unavailable.",
        },
      ]);
      showFailure("Hourly benchmark history is temporarily unavailable.");
    } finally {
      signalReady();
    }
  }

  async function loadPublication(family) {
    try {
      const response = await fetch(cardUrl(family, publicationDataBase), {
        cache: "no-store",
      });
      if (!response.ok) return null;
      const payload = await response.json();
      return payload?.publication || null;
    } catch {
      return null;
    }
  }

  function normalizeCard(payload, family) {
    const rows = Array.isArray(payload.series)
      ? payload.series
          .map((row) => normalizeRow(row, family))
          .filter(Boolean)
          .sort((left, right) => left.date - right.date)
      : [];
    return { payload, rows };
  }

  function renderCoverFeed() {
    const orderedFamilies = [
      state.selected,
      ...families.filter((family) => family !== state.selected),
    ];
    const latestRows = families
      .map((family) => state.cards.get(family)?.rows?.at(-1))
      .filter(Boolean);
    const lastUpdated = latestRows.reduce(
      (latest, row) => (!latest || row.date > latest ? row.date : latest),
      null,
    );
    if (nodes.coverUpdated) {
      nodes.coverUpdated.textContent = lastUpdated
        ? `As of ${formatCardDateTime(lastUpdated)}`
        : "As of pending";
    }
    coverFeed.setItems(
      orderedFamilies.flatMap((family) => {
        const card = state.cards.get(family);
        const latest = card?.rows?.at(-1);
        if (!latest) return [];
        return [
          {
            label: family,
            value: formatUsd(latest.value),
            href: cardUrl(family, configuredDataBase),
            title: `${family} index level: ${formatUsd(latest.value)} per GPU-hour. As of ${formatDateTime(latest.date)}.`,
          },
        ];
      }),
    );
  }

  function normalizeRow(row, family) {
    const value = Number(row?.value);
    const date = new Date(row?.observed_at);
    if (!Number.isFinite(value) || Number.isNaN(date.getTime())) return null;
    const lower =
      row?.lower === null || row?.lower === "" ? NaN : Number(row?.lower);
    const upper =
      row?.upper === null || row?.upper === "" ? NaN : Number(row?.upper);
    return {
      family,
      date,
      value,
      lower: Number.isFinite(lower) ? lower : value,
      upper: Number.isFinite(upper) ? upper : value,
    };
  }

  function configureChoiceButtons(
    buttons,
    getValue,
    selectValue,
    stateAttribute,
  ) {
    buttons.forEach((button, index) => {
      button.addEventListener("click", () => selectValue(getValue(button)));
      button.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const nextIndex =
          (index + direction + buttons.length) % buttons.length;
        buttons[nextIndex].focus();
        selectValue(getValue(buttons[nextIndex]));
      });
      button.dataset.stateAttribute = stateAttribute;
    });
  }

  function selectFamily(family) {
    if (Date.now() < state.controlsReadyAt) return;
    if (!families.includes(family) || family === state.selected) return;
    state.selected = family;
    syncControls();
    renderCoverFeed();
    render(true);
    updateLocation(state.panel);
  }

  function selectRange(range) {
    if (Date.now() < state.controlsReadyAt) return;
    if (!ranges[range] || range === state.range) return;
    state.range = range;
    state.zoomWindow = null;
    syncControls();
    render(true);
    updateLocation(state.panel);
  }

  function syncControls() {
    nodes.familyButtons.forEach((button) => {
      const selected = button.dataset.gpuFamily === state.selected;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    nodes.rangeButtons.forEach((button) => {
      const selected = button.dataset.gpuRange === state.range;
      button.setAttribute("aria-pressed", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    if (nodes.zoomReset) nodes.zoomReset.hidden = !state.zoomWindow;
  }

  function resetCustomZoom(event) {
    if (!state.zoomWindow) return;
    state.zoomWindow = null;
    syncControls();
    render(false);
    if (event?.detail === 0) {
      nodes.rangeButtons
        .find((button) => button.dataset.gpuRange === "all")
        ?.focus({ preventScroll: true });
    }
  }

  function updateFamilyQuoteNodes() {
    for (const family of families) {
      const latest = state.cards.get(family)?.rows?.at(-1);
      const value = latest ? formatUsd(latest.value) : "pending";
      const node = nodes.familyValues.get(family);
      if (node) node.textContent = value;
      const button = nodes.familyButtons.find(
        (candidate) => candidate.dataset.gpuFamily === family,
      );
      button?.setAttribute(
        "aria-label",
        latest
          ? `${family}, ${value} per GPU-hour`
          : `${family}, price pending`,
      );
    }
  }

  async function showPanel(nextName, updateUrl) {
    if (
      state.transitionPending ||
      nextName === state.panel ||
      !nodes.panels.has(nextName)
    ) {
      return;
    }
    state.transitionPending = true;
    const previousName = state.panel;
    const previous = nodes.panels.get(previousName);
    const next = nodes.panels.get(nextName);
    state.panel = nextName;
    state.controlsReadyAt =
      nextName === "detail" && !reducedMotion ? Date.now() + 560 : 0;
    nodes.open?.setAttribute(
      "aria-expanded",
      String(nextName === "detail"),
    );
    nodes.cover?.setAttribute(
      "aria-expanded",
      String(nextName === "detail"),
    );
    const snapping = previousName === "card" || nextName === "card";
    const turning =
      ["detail", "card", "share"].includes(previousName) &&
      ["detail", "card", "share"].includes(nextName);

    await swapCardPanels({
      root,
      previous,
      next,
      reducedMotion,
      effect: snapping ? "snap" : turning ? "turn" : "resize",
      onPrepare:
        nextName === "detail"
          ? () => render(false)
          : nextName === "share"
            ? () => render(false)
            : null,
    });

    state.transitionPending = false;
    root.dispatchEvent(
      new CustomEvent("compute-card:panel", {
        detail: { panel: nextName },
        bubbles: true,
      }),
    );

    if (nextName === "detail") {
      nodes.cardButtons[0]?.focus({ preventScroll: true });
    } else if (nextName === "card") {
      nodes.open?.focus({ preventScroll: true });
    } else if (nextName === "share") {
      nodes.copyLink?.focus({ preventScroll: true });
    }

    if (updateUrl) updateLocation(nextName);
  }

  function updateLocation(view) {
    const url = new URL(window.location.href);
    if (view === "detail") {
      url.searchParams.delete("view");
      if (url.searchParams.get("card") === cardId) {
        url.searchParams.delete("card");
      }
    } else {
      url.searchParams.set("card", cardId);
      url.searchParams.set("view", view);
    }
    url.searchParams.set("gpu", state.selected);
    url.searchParams.set("range", state.range);
    url.hash = root.id;
    window.history.replaceState({}, "", url);
  }

  async function copyCardLink() {
    const copied = await copyText(publicationUrl(), "Link copied.");
    if (!copied || !nodes.copyLink) return;
    nodes.copyLink.textContent = "Copied";
    window.clearTimeout(copyCardLink.timer);
    copyCardLink.timer = window.setTimeout(() => {
      nodes.copyLink.textContent = "Copy link";
    }, 2200);
  }

  function publicationUrl() {
    const publication = state.cards.get(state.selected)?.payload?.publication
      ?.ranges?.[state.range];
    if (publication?.url) return String(publication.url);
    if (publication?.live_url) return String(publication.live_url);
    return cardPermalink(cardId, {
      gpu: state.selected,
      range: state.range,
    }).toString();
  }

  async function copyText(value, successMessage) {
    try {
      const copied = await copyTextToClipboard(value);
      setShareStatus(copied ? successMessage : "Copy unavailable in this browser");
      return copied;
    } catch {
      setShareStatus("Copy unavailable in this browser");
      return false;
    }
  }

  function setShareStatus(message) {
    if (nodes.shareStatus) nodes.shareStatus.textContent = message;
    window.clearTimeout(setShareStatus.timer);
    setShareStatus.timer = window.setTimeout(() => {
      syncShareStatus();
    }, 2200);
  }

  function syncShareStatus() {
    if (!nodes.shareStatus) return;
    const rows = visibleRows(state.cards.get(state.selected)?.rows || []);
    const latest = rows.at(-1);
    if (!latest) {
      nodes.shareStatus.textContent = "";
      return;
    }
    nodes.shareStatus.textContent =
      `${state.selected} · ${ranges[state.range].label} · ` +
      `${formatUsd(latest.value)} per GPU hour`;
  }

  function setShareReady(ready) {
    state.shareReady = ready;
    for (const button of nodes.shareButtons) {
      button.disabled = !ready;
      button.textContent = "Share";
    }
    if (nodes.copyLink) nodes.copyLink.disabled = !ready;
  }

  function render(drawAnimation) {
    const card = state.cards.get(state.selected);
    const rangeRows = visibleRows(card?.rows || []);
    const rows = customZoomRows(rangeRows);
    if (!card || !rangeRows.length) {
      showFailure(`${state.selected} history is still being collected.`);
      return;
    }

    const latest = card.rows[card.rows.length - 1];
    nodes.chartState.hidden = true;
    nodes.tooltip.hidden = true;
    updateRangeDates(rows);
    renderShareArtifact(rangeRows, latest);
    syncShareStatus();

    if (state.panel === "detail" && nodes.chart.clientWidth > 0) {
      renderChart(rows, drawAnimation);
      if (drawAnimation && !reducedMotion) {
        animate(
          nodes.svg,
          { opacity: [0.72, 1] },
          { duration: 0.42, ease: [0.23, 1, 0.32, 1] },
        );
      }
    }
  }

  function updateRangeDates(rows) {
    const start = rows[0]?.date;
    const end = rows.at(-1)?.date;
    const format = d3.timeFormat("%d %b");
    if (nodes.rangeStart) nodes.rangeStart.textContent = start ? format(start) : "pending";
    if (nodes.rangeEnd) nodes.rangeEnd.textContent = end ? format(end) : "pending";
  }

  function renderShareArtifact(selectedRows, latest) {
    if (!nodes.shareArtifactSvg || !selectedRows.length) {
      return;
    }
    const svg = d3.select(nodes.shareArtifactSvg);
    svg.selectAll("*").remove();
    svg.attr("viewBox", "0 0 1200 675");

    const palette = {
      paper: "#ffffff",
      line: "#315f82",
    };
    svg
      .append("rect")
      .attr("width", 1200)
      .attr("height", 675)
      .attr("fill", palette.paper);

    appendShareText(svg, {
      x: 40,
      y: 54,
      text: state.selected,
      fill: palette.line,
      size: 24,
      weight: 600,
      family: "Geist, Avenir Next, sans-serif",
      spacing: 0.25,
    });
    appendShareText(svg, {
      x: 1160,
      y: 54,
      text: shareRangeLabel(selectedRows, state.range),
      fill: palette.line,
      size: 20,
      anchor: "end",
      weight: 600,
      family: "Geist Mono, monospace",
      spacing: 1,
    });
    appendShareText(svg, {
      x: 40,
      y: 138,
      text: formatUsd(latest.value),
      fill: palette.line,
      size: 64,
      weight: 500,
      family: "Geist, Avenir Next, sans-serif",
      spacing: -2,
    });

    const chart = { x: 0, y: 174, width: 1200, height: 390 };
    let start = d3.min(selectedRows, (row) => row.date);
    let end = d3.max(selectedRows, (row) => row.date);
    if (+start === +end) {
      start = new Date(+start - 30 * 60 * 1000);
      end = new Date(+end + 30 * 60 * 1000);
    }
    const minimum = d3.min(selectedRows, (row) => row.value) ?? 0;
    const maximum = d3.max(selectedRows, (row) => row.value) ?? minimum + 1;
    const spread = Math.max(maximum - minimum, maximum * 0.025, 0.12);
    const x = d3
      .scaleTime()
      .domain([start, end])
      .range([chart.x, chart.x + chart.width]);
    const y = d3
      .scaleLinear()
      .domain([
        Math.max(0, minimum - spread * 0.2),
        maximum + spread * 0.2,
      ])
      .range([chart.y + chart.height, chart.y]);

    const line = d3
      .line()
      .x((row) => x(row.date))
      .y((row) => y(row.value))
      .curve(d3.curveMonotoneX);
    const valueArea = d3
      .area()
      .x((row) => x(row.date))
      // Carry the pale chart field through the date row to the card edge.
      .y0(675)
      .y1((row) => y(row.value))
      .curve(d3.curveMonotoneX);
    svg
      .append("path")
      .datum(selectedRows)
      .attr("d", valueArea)
      .attr("fill", palette.line)
      .attr("fill-opacity", 0.055);
    svg
      .append("path")
      .datum(selectedRows)
      .attr("d", line)
      .attr("fill", "none")
      .attr("stroke", palette.line)
      .attr("stroke-linecap", "round")
      .attr("stroke-linejoin", "round")
      .attr("stroke-width", 3.5);
  }

  function renderChart(selectedRows, drawAnimation) {
    const width = Math.max(300, Math.round(nodes.chart.clientWidth));
    const height = Math.max(180, Math.round(nodes.chart.clientHeight));
    const margin = {
      top: 8,
      right: 0,
      bottom: 8,
      left: 0,
    };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    let start = d3.min(selectedRows, (row) => row.date);
    let end = d3.max(selectedRows, (row) => row.date);
    if (+start === +end) {
      start = new Date(+start - 30 * 60 * 1000);
      end = new Date(+end + 30 * 60 * 1000);
    }

    const values = selectedRows.flatMap((row) => [
      row.lower,
      row.value,
      row.upper,
    ]);
    const minimum = d3.min(values) ?? 0;
    const maximum = d3.max(values) ?? minimum + 1;
    const spread = Math.max(maximum - minimum, Math.abs(maximum) * 0.06, 0.08);
    const x = d3.scaleTime().domain([start, end]).range([0, innerWidth]);
    const y = d3
      .scaleLinear()
      .domain([
        Math.max(0, minimum - spread * 0.18),
        maximum + spread * 0.18,
      ])
      .nice(5)
      .range([innerHeight, 0]);
    const svg = d3.select(nodes.svg);
    svg.selectAll(".gpu-benchmark__plot-root.is-exiting").remove();
    const previousRoot = svg.select(".gpu-benchmark__plot-root");
    previousRoot
      .classed("is-exiting", true)
      .style("pointer-events", "none");
    svg.attr("viewBox", `0 0 ${width} ${height}`);

    const plotRoot = svg
      .append("g")
      .attr("class", "gpu-benchmark__plot-root")
      .attr("opacity", drawAnimation && !reducedMotion ? 0.18 : 1)
      .attr(
        "transform",
        drawAnimation && !reducedMotion
          ? "translate(0,7)"
          : "translate(0,0)",
      );
    const plot = plotRoot
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);
    if (drawAnimation && !reducedMotion) {
      previousRoot
        .transition()
        .duration(260)
        .ease(d3.easeCubicOut)
        .attr("opacity", 0)
        .attr("transform", "translate(0,-5)")
        .remove();
      plotRoot
        .transition()
        .delay(48)
        .duration(430)
        .ease(d3.easeCubicOut)
        .attr("opacity", 1)
        .attr("transform", "translate(0,0)");
    } else {
      previousRoot.remove();
    }

    const area = d3
      .area()
      .x((row) => x(row.date))
      .y0((row) => y(Math.min(row.lower, row.upper)))
      .y1((row) => y(Math.max(row.lower, row.upper)))
      .curve(d3.curveMonotoneX);
    const bandPath = plot
      .append("path")
      .datum(selectedRows)
      .attr("class", "gpu-benchmark__band")
      .attr("d", area);
    if (drawAnimation && !reducedMotion) {
      bandPath
        .attr("opacity", 0)
        .transition()
        .duration(520)
        .ease(d3.easeCubicOut)
        .attr("opacity", 1);
    }

    const line = d3
      .line()
      .x((row) => x(row.date))
      .y((row) => y(row.value))
      .curve(d3.curveMonotoneX);
    const selectedPath = plot
      .append("path")
      .datum(selectedRows)
      .attr("class", "gpu-benchmark__line is-selected")
      .attr("d", line)
      .attr("stroke", selectedLineColor);
    if (drawAnimation && !reducedMotion) {
      const length = selectedPath.node()?.getTotalLength() || 0;
      if (length) {
        selectedPath
          .attr("stroke-dasharray", `${length} ${length}`)
          .attr("stroke-dashoffset", length)
          .transition()
          .delay(80)
          .duration(880)
          .ease(d3.easeCubicInOut)
          .attr("stroke-dashoffset", 0)
          .on("end", () => selectedPath.attr("stroke-dasharray", null));
      }
    }

    const zoomSelection = plot
      .append("rect")
      .attr("class", "gpu-benchmark__zoom-selection")
      .attr("y", -4)
      .attr("height", innerHeight + 8)
      .attr("rx", 8)
      .attr("ry", 8)
      .style("display", "none");

    const interaction = plot
      .append("g")
      .attr("class", "gpu-benchmark__interaction")
      .style("display", "none");
    const crosshair = interaction
      .append("line")
      .attr("class", "gpu-benchmark__crosshair")
      .attr("y1", 0)
      .attr("y2", innerHeight);
    const point = interaction
      .append("circle")
      .attr("class", "gpu-benchmark__point is-selected")
      .attr("r", 3.8);
    let focusIndex = selectedRows.length - 1;
    const overlay = plot
      .append("rect")
      .attr("class", "gpu-benchmark__hit")
      .attr("width", innerWidth)
      .attr("height", innerHeight)
      .style("pointer-events", "none")
      .attr("tabindex", 0)
      .attr("role", "slider")
      .attr("aria-valuemin", 0)
      .attr("aria-valuemax", selectedRows.length - 1)
      .attr("aria-valuenow", focusIndex)
      .attr(
        "aria-label",
        `${state.selected} observed benchmark history. Use left and right arrow keys to inspect observations.`,
      )
      .on("focus", () => {
        interaction.style("display", null);
        showPoint();
      })
      .on("blur", hidePoint)
      .on("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
          return;
        }
        event.preventDefault();
        if (event.key === "Home") focusIndex = 0;
        if (event.key === "End") focusIndex = selectedRows.length - 1;
        if (event.key === "ArrowLeft") {
          focusIndex = Math.max(0, focusIndex - 1);
        }
        if (event.key === "ArrowRight") {
          focusIndex = Math.min(selectedRows.length - 1, focusIndex + 1);
        }
        showPoint();
      });

    const hitZones = plot
      .append("g")
      .attr("class", "gpu-benchmark__hit-zones")
      .attr("aria-hidden", "true")
      .selectAll("rect")
      .data(horizontalHitZones(selectedRows, (row) => x(row.date), innerWidth))
      .join("rect")
      .attr("x", (zone) => zone.x)
      .attr("width", (zone) => zone.width)
      .attr("height", innerHeight)
      .attr("data-observation-index", (zone) => zone.index)
      .attr("fill", "transparent")
      .style("cursor", "crosshair")
      .style("pointer-events", "all")
      .on("pointerenter", (_event, zone) => {
        if (zoomDrag) return;
        focusIndex = zone.index;
        interaction.style("display", null);
        showPoint();
      });
    const zoomEnabled =
      state.range === "all" &&
      window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    let zoomDrag = null;
    if (zoomEnabled) {
      hitZones.on("pointerdown.zoom", beginZoom);
    }
    plot.on("pointerleave", hidePoint);

    function pointerX(event) {
      const bounds = nodes.svg.getBoundingClientRect();
      const value = bounds.width
        ? ((event.clientX - bounds.left) / bounds.width) * width - margin.left
        : 0;
      return Math.max(0, Math.min(innerWidth, value));
    }

    function startZoomTracking() {
      window.addEventListener("pointermove", moveZoom, true);
      window.addEventListener("pointerup", finishZoom, true);
      window.addEventListener("pointercancel", cancelZoom, true);
      window.addEventListener("blur", cancelActiveZoom);
    }

    function stopZoomTracking() {
      window.removeEventListener("pointermove", moveZoom, true);
      window.removeEventListener("pointerup", finishZoom, true);
      window.removeEventListener("pointercancel", cancelZoom, true);
      window.removeEventListener("blur", cancelActiveZoom);
    }

    function beginZoom(event) {
      if (event.button !== 0) return;
      const startX = pointerX(event);
      zoomDrag = {
        pointerId: event.pointerId,
        startX,
        currentX: startX,
      };
      startZoomTracking();
      interaction.style("display", "none");
      nodes.tooltip.hidden = true;
      zoomSelection
        .interrupt()
        .attr("x", startX)
        .attr("width", 0)
        .style("opacity", 1)
        .style("display", null);
      event.preventDefault();
    }

    function moveZoom(event) {
      if (!zoomDrag || event.pointerId !== zoomDrag.pointerId) return;
      zoomDrag.currentX = pointerX(event);
      const left = Math.min(zoomDrag.startX, zoomDrag.currentX);
      const right = Math.max(zoomDrag.startX, zoomDrag.currentX);
      zoomSelection.attr("x", left).attr("width", right - left);
    }

    function finishZoom(event) {
      if (!zoomDrag || event.pointerId !== zoomDrag.pointerId) return;
      zoomDrag.currentX = pointerX(event);
      const left = Math.min(zoomDrag.startX, zoomDrag.currentX);
      const right = Math.max(zoomDrag.startX, zoomDrag.currentX);
      stopZoomTracking();
      zoomDrag = null;
      if (right - left < 12) {
        zoomSelection.style("display", "none").style("opacity", 1);
        return;
      }
      const nextZoomWindow = [x.invert(left), x.invert(right)];
      const commitZoom = () => {
        state.zoomWindow = nextZoomWindow;
        syncControls();
        render(false);
      };
      if (reducedMotion) {
        commitZoom();
        return;
      }
      zoomSelection
        .raise()
        .transition()
        .duration(400)
        .ease(d3.easeCubicOut)
        .attr("x", 0)
        .attr("width", innerWidth)
        .style("opacity", 0)
        .on("end", commitZoom);
    }

    function cancelZoom(event) {
      if (
        !zoomDrag ||
        (event.pointerId != null && event.pointerId !== zoomDrag.pointerId)
      ) {
        return;
      }
      stopZoomTracking();
      zoomDrag = null;
      zoomSelection
        .interrupt()
        .style("display", "none")
        .style("opacity", 1);
    }

    function cancelActiveZoom() {
      cancelZoom({ pointerId: zoomDrag?.pointerId });
    }

    function showPoint() {
      const selectedRow = selectedRows[focusIndex];
      if (!selectedRow) return;
      const pointX = x(selectedRow.date);
      const pointY = y(selectedRow.value);
      crosshair.attr("x1", pointX).attr("x2", pointX);
      point.attr("cx", pointX).attr("cy", pointY);
      overlay
        .attr("aria-valuenow", focusIndex)
        .attr(
          "aria-valuetext",
          `${formatDateTime(selectedRow.date)}. ${state.selected} ${formatUsd(selectedRow.value)}. Middle range ${formatUsd(selectedRow.lower)} to ${formatUsd(selectedRow.upper)}.`,
        );
      renderTooltip(selectedRow.date, [
        { ...selectedRow, family: state.selected },
      ]);
      positionSvgTooltip({
        tooltipNode: nodes.tooltip,
        chartNode: nodes.chart,
        svgNode: nodes.svg,
        svgX: pointX + margin.left,
        svgY: pointY + margin.top,
      });
    }

    function hidePoint() {
      interaction.style("display", "none");
      nodes.tooltip.hidden = true;
    }
  }

  function renderTooltip(dateValue, rows) {
    const date = document.createElement("time");
    date.textContent = formatDateTime(dateValue);
    const entries = rows.map((row) => {
      const entry = document.createElement("span");
      const swatch = document.createElement("i");
      const label = document.createElement("b");
      const value = document.createElement("strong");
      const range = document.createElement("small");
      entry.className = "gpu-benchmark__tooltip-row";
      if (row.family === state.selected) entry.dataset.selected = "true";
      swatch.style.backgroundColor =
        row.family === state.selected
          ? selectedLineColor
          : familyColors.get(row.family);
      label.textContent = row.family;
      value.textContent = formatUsd(row.value);
      range.textContent =
        row.family === state.selected
          ? `${formatUsd(row.lower)} to ${formatUsd(row.upper)}`
          : "";
      entry.append(swatch, label, value, range);
      return entry;
    });
    nodes.tooltip.replaceChildren(date, ...entries);
    nodes.tooltip.hidden = false;
  }

  function visibleRows(rows) {
    const milliseconds = ranges[state.range]?.milliseconds;
    if (!milliseconds || !rows.length) return rows;
    const latest = d3.max(
      Array.from(state.cards.values()).flatMap((card) => card.rows),
      (row) => row.date,
    );
    const cutoff = new Date(latest.getTime() - milliseconds);
    return rows.filter((row) => row.date >= cutoff);
  }

  function customZoomRows(rows) {
    if (state.range !== "all" || !state.zoomWindow || !rows.length) {
      return rows;
    }
    const [start, end] = state.zoomWindow;
    const selected = rows.filter((row) => row.date >= start && row.date <= end);
    return selected.length > 1 ? selected : rows;
  }

  function showFailure(message) {
    nodes.chartState.textContent = message;
    nodes.chartState.hidden = false;
    nodes.tooltip.hidden = true;
  }

  function signalReady() {
    root.dataset.cardReady = "true";
    root.dispatchEvent(new CustomEvent("compute-card:ready", { bubbles: true }));
  }

  function cardUrl(family, base) {
    return `${base}/gpu-benchmark/${family.toLowerCase()}.json`;
  }

  function appendShareText(
    svg,
    {
      x,
      y,
      text,
      fill,
      size,
      family,
      anchor = "start",
      weight = 400,
      spacing = 0,
    },
  ) {
    svg
      .append("text")
      .attr("x", x)
      .attr("y", y)
      .attr("fill", fill)
      .attr("font-family", family)
      .attr("font-size", size)
      .attr("font-weight", weight)
      .attr("letter-spacing", spacing)
      .attr("text-anchor", anchor)
      .text(text);
  }

  function formatUsd(value) {
    if (!Number.isFinite(Number(value))) return "pending";
    const number = Number(value);
    if (number < 1) return `$${number.toFixed(3)}`;
    if (number < 10) return `$${number.toFixed(2)}`;
    return `$${number.toFixed(1)}`;
  }

  function formatAxisUsd(value) {
    if (value === 0) return "$0";
    if (value < 1) return `$${value.toFixed(2)}`;
    return `$${value.toFixed(value < 10 ? 1 : 0)}`;
  }

  function formatObservationWindow(window) {
    const start = new Date(window?.started_at);
    const end = new Date(window?.ended_at);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return "";
    }
    return `${formatDateTime(start)} to ${formatDateTime(end)}`;
  }

  function formatDateTime(date) {
    return date.toLocaleString(undefined, {
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      month: "short",
      timeZoneName: "short",
    });
  }

  function formatCardDateTime(date) {
    return date
      .toLocaleString(undefined, {
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        month: "short",
        timeZoneName: "short",
      })
      .replace(",", " ·");
  }

  function formatUtcDateTime(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return "pending";
    }
    const parts = new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      month: "short",
      timeZone: "UTC",
      year: "numeric",
    }).formatToParts(date);
    const values = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );
    return `${values.day} ${values.month} ${values.year}, ${values.hour}:${values.minute} UTC`;
  }

}
