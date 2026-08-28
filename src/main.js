import * as d3 from "d3";
import { animate } from "motion";
import { cardPermalink } from "./card-presentation.js";
import { createCommandPalette } from "./command-palette.js";
import { shareRangeLabel } from "./share-range-label.js";
import {
  horizontalHitZones,
  positionSvgTooltip,
} from "./chart-pointer.js";
import { copyTextToClipboard } from "./card-transitions.js";

const root = document.querySelector("[data-gpu-benchmark-card]");

if (root) {
  const cardId = "gpu-index";
  const dataBase = String(root.dataset.marketDataBase || "").replace(
    /\/+$/,
    "",
  );
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const families = ["H100", "H200", "B200", "B300"];
  const palettes = ["azure", "linen", "sage", "sand"];
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
  const requestedLayout = params.get("layout");
  const initialView =
    (["card", "share", "gallery"].includes(requestedView) ||
    requestedLayout === "all")
      ? "share"
      : "detail";
  const initialLayout =
    requestedView === "gallery" || requestedLayout === "all"
      ? "all"
      : "focus";
  const state = {
    cards: new Map(),
    panel: initialView,
    layout: initialLayout,
    selected: families.includes(params.get("gpu")) ? params.get("gpu") : "H200",
    range: ranges[params.get("range")] ? params.get("range") : "7d",
    shareReady: false,
    resizeTimer: null,
    transitionPending: false,
    controlsReadyAt: 0,
    zoomWindow: null,
  };

  const nodes = {
    layoutPanels: new Map(
      Array.from(root.querySelectorAll("[data-card-layout-panel]")).map((panel) => [
        panel.dataset.cardLayoutPanel,
        panel,
      ]),
    ),
    panels: new Map(
      Array.from(root.querySelectorAll("[data-index-panel]")).map((panel) => [
        panel.dataset.indexPanel,
        panel,
      ]),
    ),
    cardRail: root.querySelector(".desk-card-rail"),
    galleryGrid: root.querySelector("[data-card-gallery-grid]"),
    galleryStatus: root.querySelector("[data-card-gallery-status]"),
    viewActions: document.querySelector(".desk-view-actions"),
    viewToggle: document.querySelector("[data-index-view-toggle]"),
    galleryToggle: document.querySelector("[data-index-gallery-toggle]"),
    copyLink: document.querySelector("[data-share-copy-link]"),
    shareObserved: root.querySelector("[data-share-observed]"),
    shareStatus: root.querySelector("[data-share-status]"),
    shareArtifactSvg: root.querySelector("[data-share-artifact-svg]"),
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
    pageClock: document.querySelector("[data-desk-clock]"),
    pageClockDate: document.querySelector("[data-desk-clock-date]"),
    pageClockTime: document.querySelector("[data-desk-clock-time]"),
    displayToolbar: document.querySelector(".desk-display-controls"),
    themeButtons: Array.from(document.querySelectorAll("[data-theme-value]")),
    paletteButtons: Array.from(document.querySelectorAll("[data-palette-value]")),
    commandPalette: document.querySelector("[data-command-palette]"),
    themeColor: document.querySelector('meta[name="theme-color"]'),
  };
  const commandPalette = createCommandPalette({
    root: nodes.commandPalette,
    reducedMotion,
  });
  const galleryCards = new Map();
  initialize();

  function initialize() {
    configureWorkspaceControls();
    setInitialPanel();
    setShareReady(false);
    configureAppearanceControls();
    configureCommandPalette();
    configureUtcClock();
    configureChoiceButtons(
      [
        ...nodes.familyButtons,
        ...(nodes.galleryToggle ? [nodes.galleryToggle] : []),
      ],
      (button) => button.dataset.gpuFamily || "all",
      selectCardTab,
      "aria-selected",
    );
    configureChoiceButtons(
      nodes.rangeButtons,
      (button) => button.dataset.gpuRange,
      selectRange,
      "aria-pressed",
    );
    nodes.viewToggle?.addEventListener("click", () => {
      showPanel(
        state.panel === "detail" ? "share" : "detail",
        true,
        "focus",
      );
    });
    nodes.copyLink?.addEventListener("click", copyCardLink);
    nodes.zoomReset?.addEventListener("click", resetCustomZoom);

    if ("ResizeObserver" in window && nodes.chart) {
      const observer = new ResizeObserver(() => {
        if (
          !state.cards.size ||
          state.panel !== "detail" ||
          state.layout !== "focus"
        ) {
          return;
        }
        window.clearTimeout(state.resizeTimer);
        state.resizeTimer = window.setTimeout(() => render(false), 90);
      });
      observer.observe(nodes.chart);
    }

    syncControls();
    loadCards();
  }

  function configureAppearanceControls() {
    syncAppearanceControls();
    nodes.displayToolbar?.addEventListener("keydown", handleDisplayToolbarKeydown);
    document.addEventListener("keydown", handleDisplayShortcut);
    for (const button of nodes.themeButtons) {
      button.addEventListener("click", () => setTheme(button.dataset.themeValue));
    }
    for (const button of nodes.paletteButtons) {
      button.addEventListener("click", () => setPalette(button.dataset.paletteValue));
    }
  }

  function configureCommandPalette() {
    commandPalette.register([
      {
        id: "cards.gpu-price-index",
        group: "Cards",
        order: 0,
        title: "GPU Price Index",
        subtitle: "/cards/gpu-price-index/full",
        hint: "Expand",
        keywords: ["desk", "market", "accelerator", "prices", "chart", "compute", "gpu", "index"],
        active: () => state.panel === "detail" && state.layout === "focus",
        run: () => showPanel("detail", true, "focus"),
      },
      {
        id: "create.gpu-share-card",
        group: "Create",
        order: 0,
        title: "Open card preview",
        subtitle: "/cards/gpu-price-index/card",
        hint: "Preview",
        keywords: ["export", "snapshot", "publish", "single"],
        disabled: () => !state.shareReady,
        active: () => state.panel === "share" && state.layout === "focus",
        run: () => showPanel("share", true, "focus"),
      },
      {
        id: "create.gpu-share-gallery",
        group: "Create",
        order: 1,
        title: "Open card gallery",
        subtitle: "/cards/gpu-price-index/gallery",
        hint: "Gallery",
        keywords: ["all", "gallery", "export", "snapshot", "publish"],
        disabled: () => !state.shareReady,
        active: () => state.panel === "share" && state.layout === "all",
        run: () => showPanel("share", true, "all"),
      },
      {
        id: "actions.copy-card-link",
        group: "Actions",
        order: 0,
        title: "Copy card link",
        subtitle: "/actions/copy-card-link",
        hint: "Copy",
        keywords: ["share", "url", "clipboard"],
        disabled: () => !state.shareReady,
        run: copyCardLink,
      },
      {
        id: "actions.toggle-display-controls",
        group: "Actions",
        order: 1,
        title: () =>
          document.documentElement.dataset.displayToolbar === "collapsed"
            ? "Show display controls"
            : "Hide display controls",
        subtitle: "/actions/toggle-display-controls",
        hint: "⌘H",
        keywords: ["toolbar", "theme", "palette", "controls"],
        run: () => {
          setDisplayToolbarCollapsed(
            document.documentElement.dataset.displayToolbar !== "collapsed",
          );
        },
      },
      ...families.map((family, index) => ({
        id: `gpu.${family.toLowerCase()}`,
        group: "GPU",
        order: index,
        title: `Use ${family}`,
        subtitle: `/cards/gpu-price-index/gpu/${family.toLowerCase()}`,
        hint: "GPU",
        keywords: ["accelerator", "family", "chip"],
        active: () => state.selected === family,
        run: () => selectFamily(family),
      })),
      ...Object.keys(ranges).map((range, index) => ({
        id: `range.${range}`,
        group: "Range",
        order: index,
        title:
          range === "1d"
            ? "Show one day"
            : range === "7d"
              ? "Show seven days"
              : "Show all history",
        subtitle: `/cards/gpu-price-index/range/${range}`,
        hint: ranges[range].label,
        keywords: ["date", "time", "history", "window"],
        active: () => state.range === range,
        run: () => selectRange(range),
      })),
      {
        id: "appearance.theme.light",
        group: "Appearance",
        order: 0,
        title: "Use light mode",
        subtitle: "/settings/theme/light",
        hint: "Theme",
        keywords: ["white", "bright", "display"],
        active: () => currentTheme() === "light",
        run: () => setTheme("light"),
      },
      {
        id: "appearance.theme.dark",
        group: "Appearance",
        order: 1,
        title: "Use dark mode",
        subtitle: "/settings/theme/dark",
        hint: "Theme",
        keywords: ["black", "night", "display"],
        active: () => currentTheme() === "dark",
        run: () => setTheme("dark"),
      },
      ...[
        ["azure", "Soft Azure"],
        ["linen", "Soft Linen"],
        ["sage", "Sage Green"],
        ["sand", "Warm Sand"],
      ].map(([palette, title], index) => ({
        id: `appearance.palette.${palette}`,
        group: "Appearance",
        order: index + 2,
        title: `Use ${title}`,
        subtitle: `/settings/palette/${palette}`,
        hint: "Palette",
        keywords: ["color", "colour", "display", title],
        active: () => currentPalette() === palette,
        run: () => setPalette(palette),
      })),
    ]);
  }

  function handleDisplayShortcut(event) {
    if (
      event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === "h"
    ) {
      event.preventDefault();
      setDisplayToolbarCollapsed(
        document.documentElement.dataset.displayToolbar !== "collapsed",
      );
    }
  }

  function handleDisplayToolbarKeydown(event) {
    const buttons = Array.from(
      nodes.displayToolbar.querySelectorAll("button:not(:disabled)"),
    );
    const current = buttons.indexOf(document.activeElement);
    if (current < 0) return;

    let next = current;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = (current + 1) % buttons.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = (current - 1 + buttons.length) % buttons.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = buttons.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    buttons[next].focus();
  }

  function setDisplayToolbarCollapsed(collapsed) {
    document.documentElement.dataset.displayToolbar = collapsed
      ? "collapsed"
      : "expanded";
    nodes.displayToolbar?.toggleAttribute("inert", collapsed);
    nodes.displayToolbar?.setAttribute("aria-hidden", String(collapsed));
    if (!collapsed) {
      window.setTimeout(() => {
        nodes.themeButtons
          .find((button) => button.getAttribute("aria-pressed") === "true")
          ?.focus({ preventScroll: true });
      }, reducedMotion ? 0 : 220);
    }
  }

  function currentTheme() {
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  }

  function configureUtcClock() {
    const months = [
      "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
      "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
    ];
    const tick = () => {
      const now = new Date();
      const iso = now.toISOString();
      if (nodes.pageClockDate) {
        nodes.pageClockDate.textContent = `${iso.slice(8, 10)} ${months[now.getUTCMonth()]} ${iso.slice(0, 4)}`;
      }
      if (nodes.pageClockTime) nodes.pageClockTime.textContent = iso.slice(11, 19);
      nodes.pageClock?.setAttribute("datetime", iso);
      window.setTimeout(tick, 1000 - now.getMilliseconds());
    };
    tick();
  }

  function currentPalette() {
    const palette = document.documentElement.dataset.palette;
    return palettes.includes(palette) ? palette : "azure";
  }

  function currentLineColor() {
    return readCssToken("--desk-accent-deep", "#315f82");
  }

  function currentPaperColor() {
    return readCssToken("--desk-canvas", currentTheme() === "dark" ? "#181818" : "#ffffff");
  }

  function readCssToken(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  function setTheme(theme) {
    if (theme !== "light" && theme !== "dark") return;
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem("desk-theme", theme);
    } catch {}
    syncAppearanceControls();
    refreshAppearance();
  }

  function setPalette(palette) {
    if (!palettes.includes(palette)) return;
    document.documentElement.dataset.palette = palette;
    try {
      window.localStorage.setItem("desk-palette", palette);
    } catch {}
    syncAppearanceControls();
    updateLocation(state.panel);
    refreshAppearance();
  }

  function syncAppearanceControls() {
    const theme = currentTheme();
    const isDark = theme === "dark";
    for (const button of nodes.themeButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.themeValue === theme));
    }
    for (const button of nodes.paletteButtons) {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.paletteValue === currentPalette()),
      );
    }
    nodes.themeColor?.setAttribute("content", currentPaperColor());
  }

  function refreshAppearance() {
    if (!state.cards.size) return;
    const card = state.cards.get(state.selected);
    const rangeRows = visibleRows(card?.rows || []);
    const latest = card?.rows.at(-1);
    if (!rangeRows.length || !latest) return;
    renderShareArtifact(rangeRows, latest);
    renderWorkspaceGallery();
    if (state.layout === "all" && !reducedMotion && nodes.galleryGrid) {
      animate(
        nodes.galleryGrid,
        { opacity: [0.58, 1] },
        { duration: 0.2, ease: [0.23, 1, 0.32, 1] },
      );
    }
  }

  function setInitialPanel() {
    syncFocusPanels();
    syncLayout(false);
    syncViewToggle(false);
  }

  function syncFocusPanels() {
    for (const [name, panel] of nodes.panels) {
      const isCurrent = name === state.panel;
      panel.hidden = !isCurrent;
      panel.toggleAttribute("inert", !isCurrent);
    }
  }

  function configureWorkspaceControls() {
    if (nodes.galleryGrid) {
      nodes.galleryGrid.dataset.cardCount = String(
        Math.min(families.length, 5),
      );
      const cards = families.map((family) => {
        const button = document.createElement("button");
        button.className = "desk-gallery-card compute-share-card-frame";
        button.type = "button";
        button.dataset.galleryFamily = family;
        button.innerHTML = `
          <svg class="compute-share-artifact desk-gallery-card__artifact" viewBox="0 0 1200 675" aria-hidden="true" data-gallery-artifact></svg>`;
        button.addEventListener("click", (event) => {
          openPublishedCard(family, event.detail === 0);
        });
        galleryCards.set(family, {
          button,
          artifact: button.querySelector("[data-gallery-artifact]"),
        });
        return button;
      });
      nodes.galleryGrid.replaceChildren(...cards);
    }
  }

  function syncLayout(animateChange) {
    for (const [name, panel] of nodes.layoutPanels) {
      const isCurrent = name === state.layout;
      panel.hidden = !isCurrent;
      panel.toggleAttribute("inert", !isCurrent);
    }
    root.dataset.workspaceLayout = state.layout;
    root.dataset.workspaceMode = state.panel;
    root.dataset.workspaceView =
      state.layout === "all" ? "gallery" : state.panel;
    document.documentElement.dataset.deskLayout = state.layout;

    if (nodes.cardRail) {
      const showRail = state.layout === "focus";
      nodes.cardRail.hidden = !showRail;
      nodes.cardRail.toggleAttribute("inert", !showRail);
    }

    const current = nodes.layoutPanels.get(state.layout);
    if (animateChange && current && !reducedMotion) {
      animate(
        current,
        {
          opacity: [0.58, 1],
          transform: ["translateY(4px)", "translateY(0)"],
        },
        { duration: 0.22, ease: [0.23, 1, 0.32, 1] },
      );
      if (state.layout === "all") {
        Array.from(galleryCards.values()).forEach(({ button }, index) => {
          animate(
            button,
            {
              opacity: [0, 1],
              transform: ["translateY(4px)", "translateY(0)"],
            },
            {
              delay: index * 0.03,
              duration: 0.24,
              ease: [0.23, 1, 0.32, 1],
            },
          );
        });
      }
    }
  }

  function syncViewToggle(animateChange) {
    if (!nodes.viewToggle) return;
    const showSizeControl = state.layout === "focus";
    if (nodes.viewActions) {
      nodes.viewActions.hidden = !showSizeControl;
      nodes.viewActions.toggleAttribute("inert", !showSizeControl);
    }
    const nextName = state.panel === "detail" ? "share" : "detail";
    const label = nextName === "share" ? "Collapse" : "Expand";
    if (nodes.viewToggle) {
      nodes.viewToggle.textContent = label;
      nodes.viewToggle.setAttribute(
        "aria-label",
        nextName === "share" ? "Collapse card" : "Expand card",
      );
      nodes.viewToggle.disabled = nextName === "share" && !state.shareReady;
    }
    if (nodes.galleryToggle) {
      nodes.galleryToggle.disabled = !state.shareReady;
    }
    if (showSizeControl && animateChange && !reducedMotion) {
      animate(
        nodes.viewToggle,
        {
          opacity: [0, 1],
          transform: ["translateY(-2px)", "translateY(0)"],
        },
        { duration: 0.18, ease: [0.23, 1, 0.32, 1] },
      );
    }
  }

  async function loadCards() {
    if (!dataBase) {
      showFailure("Benchmark history could not load.");
      signalReady();
      return;
    }

    try {
      const cards = await Promise.all(
        families.map(async (family) => {
          const url = cardUrl(family, dataBase);
          const response = await fetch(url, { cache: "no-store" });
          if (!response.ok) throw new Error(`${response.status} ${url}`);
          const payload = await response.json();
          if (
            payload?.contract !== "compute_bazaar_card" ||
            payload?.card_type !== "gpu_benchmark"
          ) {
            throw new Error(`Unsupported benchmark card at ${url}`);
          }
          return [family, normalizeCard(payload, family)];
        }),
      );
      state.cards = new Map(cards);
      setShareReady(true);
      updateFamilyQuoteNodes();
      render(true);
    } catch (error) {
      setShareReady(false);
      console.error("GPU benchmark card failed to load", error);
      showFailure("Hourly benchmark history is temporarily unavailable.");
    } finally {
      signalReady();
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
      button.addEventListener("click", (event) => {
        selectValue(getValue(button), event);
      });
      button.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const nextIndex =
          (index + direction + buttons.length) % buttons.length;
        buttons[nextIndex].focus();
        selectValue(getValue(buttons[nextIndex]), event);
      });
      button.dataset.stateAttribute = stateAttribute;
    });
  }

  function selectFamily(family) {
    if (Date.now() < state.controlsReadyAt) return;
    if (!families.includes(family)) return;
    const changed = family !== state.selected;
    if (!changed) return;
    state.selected = family;
    state.zoomWindow = null;
    syncControls();
    render(changed);
    updateLocation(state.panel);
  }

  function selectCardTab(value, event) {
    if (value === "all") {
      showPanel("share", true, "all", event?.detail === 0);
      return;
    }
    selectFamily(value);
  }

  function openPublishedCard(family, moveFocus) {
    selectFamily(family);
    showPanel("share", true, "focus", moveFocus);
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
      const selected =
        state.layout === "focus" &&
        button.dataset.gpuFamily === state.selected;
      button.setAttribute("aria-selected", String(selected));
      button.setAttribute(
        "aria-controls",
        state.panel === "share" ? "gpu-index-publish" : "gpu-index-detail",
      );
      button.tabIndex = selected ? 0 : -1;
    });
    if (nodes.galleryToggle) {
      const selected = state.layout === "all";
      nodes.galleryToggle.setAttribute("aria-selected", String(selected));
      nodes.galleryToggle.tabIndex = selected ? 0 : -1;
    }
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
          ? `${family} ${value} per GPU hour`
          : `${family}, price pending`,
      );
    }
  }

  async function showPanel(
    nextName,
    updateUrl,
    nextLayout = "focus",
    moveFocus = null,
  ) {
    const targetLayout =
      nextName === "share" && nextLayout === "all" ? "all" : "focus";
    const returnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const returnFocusWasVisible = returnFocus?.matches(":focus-visible") ?? false;
    const shouldMoveFocus = moveFocus ?? returnFocusWasVisible;
    if (
      state.transitionPending ||
      (nextName === state.panel && targetLayout === state.layout) ||
      !nodes.panels.has(nextName)
    ) {
      return;
    }
    state.transitionPending = true;
    const previousLayout = nodes.layoutPanels.get(state.layout);
    const canMorph =
      !reducedMotion && typeof document.startViewTransition === "function";

    const commitPanelChange = (animateLayout) => {
      state.panel = nextName;
      state.layout = targetLayout;
      state.controlsReadyAt = 0;
      state.zoomWindow = null;
      syncFocusPanels();
      syncControls();
      syncLayout(animateLayout);
      render(false);
      syncViewToggle(animateLayout);
    };

    if (canMorph) {
      const transition = document.startViewTransition(() => {
        commitPanelChange(false);
      });
      await transition.finished.catch(() => {});
    } else {
      if (!reducedMotion && previousLayout) {
        const exit = animate(
          previousLayout,
          {
            opacity: [1, 0.42],
            transform: ["translateY(0)", "translateY(-2px)"],
          },
          { duration: 0.16, ease: [0.23, 1, 0.32, 1] },
        );
        await exit.finished?.catch(() => {});
      }
      commitPanelChange(!reducedMotion);
    }

    state.transitionPending = false;
    root.dispatchEvent(
      new CustomEvent("compute-card:panel", {
        detail: { panel: nextName, layout: state.layout },
        bubbles: true,
      }),
    );

    const returnFocusIsAvailable =
      returnFocus?.isConnected &&
      !returnFocus.closest("[hidden], [inert]");
    if (returnFocusIsAvailable) {
      returnFocus.focus({ preventScroll: true });
    } else if (shouldMoveFocus) {
      const fallbackFocus =
        state.layout === "all"
          ? galleryCards.get(state.selected)?.button
          : state.panel === "share"
            ? nodes.galleryToggle
            : nodes.viewToggle;
      fallbackFocus?.focus({ preventScroll: true });
    } else {
      returnFocus?.blur();
    }

    if (updateUrl) updateLocation(nextName);
  }

  function updateLocation(view) {
    const url = new URL(window.location.href);
    url.searchParams.set("card", cardId);
    url.searchParams.set(
      "view",
      view === "detail"
        ? "full"
        : state.layout === "all"
          ? "gallery"
          : "card",
    );
    url.searchParams.set("gpu", state.selected);
    url.searchParams.set("range", state.range);
    url.searchParams.set("palette", currentPalette());
    url.searchParams.delete("layout");
    url.hash = root.id;
    window.history.replaceState({}, "", url);
  }

  async function copyCardLink() {
    await copyText(shareUrl(), "Link copied");
  }

  function shareUrl() {
    if (state.panel === "detail") {
      return cardPermalink(cardId, {
        gpu: state.selected,
        range: state.range,
        palette: currentPalette(),
      }).toString();
    }
    if (state.layout === "focus") {
      const publishedUrl = new URL(
        `/cards/gpu-price-index/${state.selected.toLowerCase()}/${state.range}/${currentPalette()}/${currentTheme()}/`,
        window.location.origin,
      );
      return publishedUrl.toString();
    }
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("card", cardId);
    url.searchParams.set("view", state.layout === "all" ? "gallery" : "card");
    url.searchParams.set("gpu", state.selected);
    url.searchParams.set("range", state.range);
    url.searchParams.set("palette", currentPalette());
    url.hash = root.id;
    return url.toString();
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
      if (nodes.shareObserved) {
        nodes.shareObserved.textContent = "Market data unavailable";
        nodes.shareObserved.removeAttribute("datetime");
      }
      return;
    }
    nodes.shareStatus.textContent =
      `GPU Price Index ${state.selected} ${ranges[state.range].label} ` +
      `${formatUsd(latest.value)} per GPU hour`;
    if (nodes.shareObserved) {
      nodes.shareObserved.textContent = formatUtcDateTime(latest.date);
      nodes.shareObserved.setAttribute("datetime", latest.date.toISOString());
    }
    nodes.shareArtifactSvg?.setAttribute(
      "aria-label",
      `${state.selected} ${formatUsd(latest.value)} per GPU hour ${ranges[state.range].label}`,
    );
  }

  function setShareReady(ready) {
    state.shareReady = ready;
    syncViewToggle(false);
    if (nodes.copyLink) nodes.copyLink.disabled = !ready;
    if (nodes.galleryToggle) nodes.galleryToggle.disabled = !ready;
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
    renderWorkspaceGallery();
    syncShareStatus();

    if (
      state.layout === "focus" &&
      state.panel === "detail" &&
      nodes.chart.clientWidth > 0
    ) {
      renderChart(rows, drawAnimation);
    }
  }

  function renderWorkspaceGallery() {
    if (!galleryCards.size || !state.cards.size) return;

    for (const family of families) {
      const card = state.cards.get(family);
      const cardNodes = galleryCards.get(family);
      const rows = visibleRows(card?.rows || []);
      const latest = card?.rows.at(-1);
      if (!cardNodes || !rows.length || !latest) continue;

      const value = formatUsd(latest.value);
      const selected = family === state.selected;
      cardNodes.button.dataset.selected = String(selected);
      cardNodes.button.setAttribute("aria-pressed", String(selected));
      cardNodes.button.setAttribute(
        "aria-label",
        `Open ${family} card, ${value} per GPU hour`,
      );
      drawShareArtifact(cardNodes.artifact, family, rows, latest, {
        compact: true,
      });
    }

    if (nodes.galleryStatus) {
      nodes.galleryStatus.textContent =
        `${families.length} cards ${ranges[state.range].label} range`;
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
    drawShareArtifact(
      nodes.shareArtifactSvg,
      state.selected,
      selectedRows,
      latest,
    );
  }

  function drawShareArtifact(
    svgNode,
    family,
    selectedRows,
    latest,
    options = {},
  ) {
    if (!svgNode || !selectedRows.length) {
      return;
    }
    const svg = d3.select(svgNode);
    svg.selectAll("*").remove();
    svg.attr("viewBox", "0 0 1200 675");

    const palette = {
      paper: currentPaperColor(),
      line: currentLineColor(),
    };
    const compact = options.compact === true;
    const typography = compact
      ? { family: 52, range: 36, price: 104 }
      : { family: 24, range: 24, price: 64 };
    svg
      .append("rect")
      .attr("width", 1200)
      .attr("height", 675)
      .attr("fill", palette.paper);

    appendShareText(svg, {
      x: 40,
      y: 54,
      text: family,
      fill: palette.line,
      size: typography.family,
      weight: 600,
      family: "Geist, Avenir Next, sans-serif",
      spacing: 0.25,
    });
    appendShareText(svg, {
      x: 1160,
      y: 54,
      text: shareRangeLabel(selectedRows, state.range),
      fill: palette.line,
      size: typography.range,
      anchor: "end",
      weight: 600,
      family: "Geist Mono, monospace",
      spacing: 1,
    });
    appendShareText(svg, {
      x: 40,
      y: compact ? 160 : 138,
      text: formatUsd(latest.value),
      fill: palette.line,
      size: typography.price,
      weight: 500,
      family: "Geist, Avenir Next, sans-serif",
      spacing: -2,
    });

    const chart = compact
      ? { x: 0, y: 204, width: 1200, height: 360 }
      : { x: 0, y: 174, width: 1200, height: 390 };
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
      .attr("stroke-width", compact ? 6 : 3.5);

    if (compact) {
      svg
        .append("line")
        .attr("x1", 40)
        .attr("x2", 1160)
        .attr("y1", 620)
        .attr("y2", 620)
        .attr("stroke", palette.line)
        .attr("stroke-opacity", 0.16)
        .attr("stroke-width", 1);
      appendShareText(svg, {
        x: 40,
        y: 654,
        text: "GPU PRICE INDEX",
        fill: palette.line,
        size: 28,
        weight: 500,
        family: "Geist Mono, monospace",
        spacing: 1.6,
      });
      appendShareText(svg, {
        x: 1160,
        y: 654,
        text: formatShareDate(latest.date),
        fill: palette.line,
        size: 28,
        anchor: "end",
        weight: 500,
        family: "Geist Mono, monospace",
        spacing: 1.2,
      });
    }
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
      .attr("opacity", drawAnimation && !reducedMotion ? 0.42 : 1)
      .attr(
        "transform",
        drawAnimation && !reducedMotion
          ? "translate(0,4)"
          : "translate(0,0)",
      );
    const plot = plotRoot
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);
    if (drawAnimation && !reducedMotion) {
      previousRoot
        .transition()
        .duration(160)
        .ease(d3.easeCubicOut)
        .attr("opacity", 0)
        .attr("transform", "translate(0,-2)")
        .remove();
      plotRoot
        .transition()
        .duration(220)
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
    plot
      .append("path")
      .datum(selectedRows)
      .attr("class", "gpu-benchmark__band")
      .attr("d", area);

    const line = d3
      .line()
      .x((row) => x(row.date))
      .y((row) => y(row.value))
      .curve(d3.curveMonotoneX);
    plot
      .append("path")
      .datum(selectedRows)
      .attr("class", "gpu-benchmark__line is-selected")
      .attr("d", line)
      .attr("stroke", currentLineColor());

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
        .duration(220)
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
          ? currentLineColor()
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
    return `${values.day} ${values.month} ${values.year} ${values.hour}:${values.minute} UTC`;
  }

  function formatShareDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return "DATE PENDING";
    }
    return d3.utcFormat("%d %b %Y")(date).toUpperCase();
  }

}
