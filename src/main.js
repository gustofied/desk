import * as d3 from "d3";
import { animate } from "motion";
import { cardUrl, replaceCardLocation } from "./card-presentation.js";
import {
  compositionKey,
  createComposition,
  setCompositionScale,
  setPrimaryLayer,
  toggleCompositionLayer,
} from "./craft-composition.js";
import {
  cardStateParamIds,
  getCardDefinition,
  getLayerDefinition,
  normalizeCardState,
  CARD_REGISTRY,
  PALETTES,
  paletteIds,
  PUBLISHED_CARD_VERSION,
  publishedCardSharePath,
  RANGES,
  serializeLayerIds,
} from "./card-registry.js";
import { createGpuPriceBarModel } from "./gpu-price-bar-model.js";
import { paintGpuPriceBarChart } from "./gpu-price-bar-presentation.js";
import { createGpuMarketDepthModel } from "./gpu-market-depth-model.js";
import { paintGpuMarketDepthChart } from "./gpu-market-depth-presentation.js";
import { createDealViewModel } from "./deal-view-model.js";
import { mountDealView } from "./deal-view-presentation.js";
import { createCommandPalette } from "./command-palette.js";
import {
  deleteCatalogItem,
  loadSavedCatalog,
  MAX_CATALOG_NAME_LENGTH,
  normalizeCatalogName,
  SAVED_CATALOG_STORAGE_KEY,
  saveCatalogItem,
} from "./saved-catalog.js";
import {
  CATALOG_ORDER_STORAGE_KEY,
  loadCatalogOrder,
  orderCatalogEntries,
  saveCatalogOrder,
} from "./catalog-order.js";
import {
  ALL_CARDS_CATALOG_ID,
  CATALOG_COLLECTIONS_STORAGE_KEY,
  MAX_CATALOG_COLLECTION_NAME_LENGTH,
  activeCatalogCollection,
  addCatalogCollectionKey,
  createCatalogCollection,
  deleteCatalogCollection,
  loadCatalogCollections,
  normalizeCatalogCollectionName,
  removeCatalogKeyFromCollections,
  renameCatalogCollection,
  replaceCatalogCollectionKeys,
  toggleCatalogCollectionKey,
} from "./catalog-collections.js";
import { shareRangeLabel } from "./share-range-label.js";
import {
  horizontalHitZones,
  positionSvgTooltip,
} from "./chart-pointer.js";
import { copyTextToClipboard } from "./card-transitions.js";
import {
  chartYDomain,
  comparisonStrokeOpacity,
  INDEX_BASELINE,
  spreadLineLabels,
} from "./chart-domain.js";
const root = document.querySelector("[data-gpu-benchmark-card]");

if (root) {
  const params = new URL(window.location.href).searchParams;
  const cardDefinition = getCardDefinition(params.get("card") || root.dataset.cardId);
  const cardId = cardDefinition.id;
  const isBarCard = cardDefinition.renderer === "categorical-bar";
  const isDepthCard = cardDefinition.renderer === "cumulative-depth";
  const isDealCard = cardDefinition.renderer === "deal";
  root.dataset.cardId = cardId;
  root.dataset.cardRenderer = cardDefinition.renderer || "line";
  root
    .querySelector(".gpu-index-detail__body")
    ?.setAttribute("aria-label", cardDefinition.title);
  const craftDraftStorageKey = `desk.craft-draft.v1.${cardId}`;
  const catalogColorStorageKey = "desk.catalog-colors.v1";
  const catalogScrollStorageKey = "desk.catalog-scroll.v1";
  const activeCatalogSessionKey = "desk.active-catalog.v1";
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const mobileViewport = window.matchMedia("(max-width: 640px)");
  const families = cardDefinition.layers
    .filter((layer) => layer.primary !== false)
    .map((layer) => layer.id);
  const railFamilies = getCardDefinition("gpu-index").layers
    .filter((layer) => layer.unit === "usd-hour")
    .map((layer) => layer.id);
  const palettes = paletteIds();
  const ranges = RANGES;
  const requestedCard = params.get("card");
  const requestedViewParam = params.get("view");
  const requestedView =
    requestedCard === cardId ? requestedViewParam : null;
  const supportedViewParams = [
    "card",
    "gallery",
    "monitor",
    "full",
    "craft",
  ];
  const requestedLayout = params.get("layout");
  const mobileCardView =
    mobileViewport.matches && requestedView === "card";
  const initialMode =
    requestedView === "craft"
      ? "craft"
      : requestedView === "monitor" ||
          requestedView === "full" ||
          mobileCardView
        ? "monitor"
        : "catalog";
  const initialView = initialMode === "catalog" ? "share" : "detail";
  const initialCraftEmpty =
    initialMode === "craft" &&
    params.get("draft") === "new" &&
    families.length > 1;
  const initialLayout =
    initialMode === "catalog" &&
    (
      mobileViewport.matches ||
      requestedView === "gallery" ||
      requestedLayout === "all"
    )
      ? "all"
      : "focus";
  const requestedState = normalizeCardState(cardId, {
    ...Object.fromEntries(
      cardStateParamIds(cardDefinition).map((name) => [name, params.get(name)]),
    ),
    palette:
      params.get("palette") || document.documentElement.dataset.palette,
    theme: params.get("theme") || document.documentElement.dataset.theme,
  });
  const selected = requestedState.gpu;
  const initialCompositionLayers = new Set(
    initialCraftEmpty ? [selected] : requestedState.layers,
  );
  const initialCompositionScale = initialCraftEmpty
    ? cardDefinition.defaults.scale
    : requestedState.scale;
  const initialRange = requestedState.range;
  const savedCatalog = loadSavedCatalog(cardId);
  const catalogCollections = loadCatalogCollections();
  const hasCompleteCatalogSnapshot = cardStateParamIds(cardDefinition).every(
    (name) => params.has(name),
  );
  const requestedCatalogItem =
    !initialCraftEmpty && hasCompleteCatalogSnapshot
      ? savedCatalog.find((item) => item.id === params.get("item")) || null
      : null;
  const initialCraftDraft =
    initialMode === "craft" ? null : loadCraftDraft(savedCatalog);
  const initialViewNeedsRepair =
    mobileCardView ||
    (params.has("card") && requestedCard !== cardId) ||
    (params.has("view") &&
      (requestedCard !== cardId ||
        !supportedViewParams.includes(requestedViewParam))) ||
    requestedView === "full";
  const initialNormalizedState = {
    ...requestedState,
    gpu: selected,
    layers: serializeLayerIds(initialCompositionLayers, cardDefinition),
    scale: initialCompositionScale,
    range: initialRange,
  };
  const initialStateNeedsRepair =
    cardStateParamIds(cardDefinition).some(
      (name) => params.has(name) && params.get(name) !== String(initialNormalizedState[name]),
    ) ||
    (params.has("item") && !requestedCatalogItem) ||
    params.has("locked");
  const state = {
    seriesByLayer: new Map(),
    runtimePayloads: new Map(),
    runtimePayload: null,
    mode: initialMode,
    panel: initialView,
    layout: initialLayout,
    selected,
    layers: initialCompositionLayers,
    scale: initialCompositionScale,
    range: initialRange,
    options: Object.fromEntries(
      (cardDefinition.stateOptions || []).map((option) => [
        option.id,
        requestedState[option.id],
      ]),
    ),
    compareOpen: false,
    depthCraftMenu: null,
    dataRevision: null,
    shareReady: false,
    resizeTimer: null,
    transitionPending: false,
    controlsReadyAt: 0,
    catalogDirty: true,
    catalogOrder: loadCatalogOrder(),
    catalogCollections,
    activeCatalogViewId: loadActiveCatalogSession(catalogCollections),
    catalogMenuOpen: false,
    catalogDialogMode: null,
    catalogColorMode: loadCatalogColorMode(),
    zoomWindow: null,
    savedCatalog,
    activeCatalogId: requestedCatalogItem?.id || null,
    catalogName: requestedCatalogItem?.name || "",
    craftEmpty: initialCraftEmpty,
    craftDirty: false,
    craftBaseline: null,
    craftDraft: initialCraftDraft,
    catalogScrollY: readCatalogScrollPosition(),
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
    catalogBar: document.querySelector("[data-catalog-bar]"),
    catalogSwitcher: document.querySelector("[data-catalog-switcher]"),
    catalogSwitcherName: document.querySelector("[data-catalog-switcher-name]"),
    catalogMenu: document.querySelector("[data-catalog-menu]"),
    catalogList: document.querySelector("[data-catalog-list]"),
    catalogCardsAction: document.querySelector("[data-catalog-cards]"),
    catalogCreate: document.querySelector("[data-catalog-create]"),
    catalogRename: document.querySelector("[data-catalog-rename]"),
    catalogDelete: document.querySelector("[data-catalog-delete]"),
    catalogEmpty: root.querySelector("[data-catalog-empty]"),
    catalogAddCards: root.querySelector("[data-catalog-add-cards]"),
    modeButtons: Array.from(document.querySelectorAll("[data-desk-mode]")),
    galleryToggle: document.querySelector("[data-index-gallery-toggle]"),
    workspaceTitle: root.querySelector("#desk-workspace-title"),
    mobileSummaryLabel: root.querySelector("[data-mobile-summary-label]"),
    mobileSummaryValue: root.querySelector("[data-mobile-summary-value]"),
    mobileSummaryRange: root.querySelector("[data-mobile-summary-range]"),
    detailPanel: root.querySelector("#gpu-index-detail"),
    focusPanel: root.querySelector("#desk-card-focus"),
    workspaceStatus: root.querySelector("[data-workspace-status]"),
    shareObserved: root.querySelector("[data-share-observed]"),
    shareStatus: root.querySelector("[data-share-status]"),
    shareArtifactSvg: root.querySelector("[data-share-artifact-svg]"),
    dealPreview: root.querySelector("[data-deal-preview]"),
    dealWorkspace: root.querySelector("[data-deal-workspace]"),
    focusCardMonitor: root.querySelector("[data-focus-card-monitor]"),
    familyButtons: Array.from(root.querySelectorAll("[data-gpu-family]")),
    cardPresetButtons: Array.from(root.querySelectorAll("[data-card-preset]")),
    familyValues: new Map(
      Array.from(root.querySelectorAll("[data-gpu-family-value]")).map(
        (node) => [node.dataset.gpuFamilyValue, node],
      ),
    ),
    rangeButtons: Array.from(root.querySelectorAll("[data-gpu-range]")),
    rangeGroup: root.querySelector("[data-gpu-range-group]"),
    depthView: root.querySelector("[data-depth-view]"),
    depthViewButtons: Array.from(root.querySelectorAll("[data-depth-scale]")),
    zoomReset: root.querySelector("[data-gpu-zoom-reset]"),
    rangeStart: root.querySelector("[data-gpu-range-start]"),
    rangeEnd: root.querySelector("[data-gpu-range-end]"),
    layerGroup: root.querySelector("[data-card-layers]"),
    layerRow: root.querySelector("[data-card-layer-row]"),
    layerButtons: [],
    primaryGroup: root.querySelector("[data-card-primary-layers]"),
    primaryRow: root.querySelector("[data-card-primary-row]"),
    primaryLabel: root.querySelector("[data-card-primary-label]"),
    primaryButtons: [],
    scaleButtons: Array.from(root.querySelectorAll("[data-card-scale]")),
    scaleGroup: root.querySelector("[data-card-scales]"),
    scaleControl: root.querySelector("[data-card-scale-control]"),
    layerLabel: root.querySelector("[data-card-layer-label]"),
    compareToggle: root.querySelector("[data-card-compare-toggle]"),
    comparePanel: root.querySelector("[data-card-compare-panel]"),
    compareCount: root.querySelector("[data-card-compare-count]"),
    dataLabel: root.querySelector("[data-card-data-label]"),
    depthCraft: root.querySelector("[data-depth-craft]"),
    depthContract: root.querySelector("[data-depth-contract]"),
    depthContractGpu: root.querySelector("[data-depth-contract-gpu]"),
    depthContractRegion: root.querySelector("[data-depth-contract-region]"),
    depthContractNode: root.querySelector("[data-depth-contract-node]"),
    depthContractNetwork: root.querySelector("[data-depth-contract-network]"),
    depthContractTerm: root.querySelector("[data-depth-contract-term]"),
    depthTargetTrigger: root.querySelector("[data-depth-target-trigger]"),
    depthTargetLabel: root.querySelector("[data-depth-target-label]"),
    depthTargetMenu: root.querySelector("[data-depth-target-menu]"),
    depthTargetOptions: root.querySelector("[data-depth-target-options]"),
    depthViewTrigger: root.querySelector("[data-depth-view-trigger]"),
    depthViewLabel: root.querySelector("[data-depth-view-label]"),
    depthViewMenu: root.querySelector("[data-depth-view-menu]"),
    depthCraftViews: root.querySelector("[data-depth-craft-views]"),
    depthCraftViewButtons: [],
    dealCraft: root.querySelector("[data-deal-craft]"),
    dealCraftGpu: root.querySelector("[data-deal-craft-gpu]"),
    dealCraftQuantity: root.querySelector("[data-deal-craft-quantity]"),
    dealCraftQuote: root.querySelector("[data-deal-craft-quote]"),
    dealCraftRfs: root.querySelector("[data-deal-craft-rfs]"),
    optionGroup: root.querySelector("[data-card-options]"),
    optionButtons: [],
    composer: root.querySelector("[data-card-composer]"),
    saveButton: root.querySelector("[data-card-save]"),
    cardAnnounce: root.querySelector("[data-card-announce]"),
    chart: root.querySelector("[data-gpu-chart]"),
    svg: root.querySelector("[data-gpu-chart-svg]"),
    chartDescription: root.querySelector("[data-gpu-chart-description]"),
    tooltip: root.querySelector("[data-gpu-tooltip]"),
    chartState: root.querySelector("[data-gpu-state]"),
    craftEmpty: root.querySelector("[data-craft-empty]"),
    pageClock: document.querySelector("[data-desk-clock]"),
    pageClockDate: document.querySelector("[data-desk-clock-date]"),
    pageClockTime: document.querySelector("[data-desk-clock-time]"),
    displayToolbar: document.querySelector(".desk-display-controls"),
    themeButtons: Array.from(document.querySelectorAll("[data-theme-value]")),
    paletteButtons: Array.from(document.querySelectorAll("[data-palette-value]")),
    commandPalette: document.querySelector("[data-command-palette]"),
    commandOpen: document.querySelector("[data-command-open]"),
    saveDialog: document.querySelector("[data-save-dialog]"),
    saveForm: document.querySelector("[data-save-form]"),
    saveTitle: document.querySelector("[data-save-title]"),
    saveName: document.querySelector("[data-save-name]"),
    saveError: document.querySelector("[data-save-error]"),
    saveCancel: document.querySelector("[data-save-cancel]"),
    saveSubmit: document.querySelector("[data-save-submit]"),
    catalogDialog: document.querySelector("[data-catalog-dialog]"),
    catalogForm: document.querySelector("[data-catalog-form]"),
    catalogDialogTitle: document.querySelector("[data-catalog-dialog-title]"),
    catalogDialogDescription: document.querySelector(
      "[data-catalog-dialog-description]",
    ),
    catalogNameLabel: document.querySelector("[data-catalog-name-label]"),
    catalogNameInput: document.querySelector("[data-catalog-name]"),
    catalogError: document.querySelector("[data-catalog-error]"),
    catalogCancel: document.querySelector("[data-catalog-cancel]"),
    catalogSubmit: document.querySelector("[data-catalog-submit]"),
    themeColor: document.querySelector('meta[name="theme-color"]'),
  };
  const commandPalette = createCommandPalette({
    root: nodes.commandPalette,
    reducedMotion,
  });
  const catalogCards = new Map();
  const catalogReflowAnimations = new Map();
  let catalogPointerDrag = null;
  let suppressedCatalogClickKey = null;
  let unregisterSavedCatalogCommands = () => {};
  let unregisterCatalogCollectionCommands = () => {};
  initialize();

  function initialize() {
    if (state.craftEmpty) clearStoredCraftDraft();
    state.craftBaseline = state.craftEmpty
      ? null
      : requestedCatalogItem
        ? compositionKey(cardId, requestedCatalogItem.state)
        : state.mode === "craft"
          ? null
          : compositionKey(cardId, currentCardState());
    state.craftDirty =
      state.mode === "craft" &&
      !state.craftEmpty &&
      (state.craftBaseline
        ? compositionKey(cardId, currentCardState()) !== state.craftBaseline
        : true);
    configureWorkspaceControls();
    setInitialPanel();
    setShareReady(false);
    configureAppearanceControls();
    configureComposerControls();
    configureDealCraftControls();
    configureSaveControls();
    configureCatalogCollectionControls();
    configureCommandPalette();
    syncSavedCatalogCommands();
    syncCatalogCollectionCommands();
    configureUtcClock();
    if (initialStateNeedsRepair || initialViewNeedsRepair) updateLocation();
    configureChoiceButtons(
      nodes.familyButtons,
      (button) => button.dataset.gpuFamily,
      selectCardTab,
      "aria-selected",
      "horizontal",
    );
    nodes.cardPresetButtons.forEach((button) => {
      button.addEventListener("click", (event) => {
        openCardPreset(button.dataset.cardPreset, "card", event.detail === 0);
      });
    });
    configureChoiceButtons(
      nodes.rangeButtons,
      (button) => button.dataset.gpuRange,
      selectRange,
      "aria-pressed",
      "buttons",
    );
    configureChoiceButtons(
      nodes.depthViewButtons,
      (button) => button.dataset.depthScale,
      selectScale,
      "aria-pressed",
      "buttons",
    );
    for (const button of nodes.modeButtons) {
      button.addEventListener("click", () => {
        const mode = button.dataset.deskMode;
        if (
          mode === "catalog" &&
          state.mode === "catalog" &&
          state.layout === "all"
        ) {
          setCatalogMenuOpen(!state.catalogMenuOpen, { moveFocus: true });
        } else if (mode === "craft") openCraft(false);
        else switchWorkspaceMode(mode, false);
      });
    }
    nodes.commandOpen?.addEventListener("click", () => commandPalette.open());
    mobileViewport.addEventListener("change", handleMobileViewportChange);
    nodes.galleryToggle?.addEventListener("click", (event) => {
      showPanel("share", true, "all", event.detail === 0, "catalog");
    });
    nodes.focusCardMonitor?.addEventListener("click", () => {
      switchWorkspaceMode("monitor", false);
    });
    nodes.cardRail?.addEventListener("keydown", handleCardRailKeydown, true);
    nodes.compareToggle?.addEventListener("click", (event) => {
      setCompareOpen(!state.compareOpen, event.detail === 0);
    });
    nodes.comparePanel?.addEventListener("keydown", handleComparePanelKeydown);
    nodes.zoomReset?.addEventListener("click", resetCustomZoom);

    if ("ResizeObserver" in window && nodes.chart) {
      const observer = new ResizeObserver(() => {
        if (
          !state.runtimePayload ||
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
    syncComposerControls();
    loadCards();
  }

  function configureComposerControls() {
    if (nodes.primaryGroup) {
      nodes.primaryButtons = families.map((family) => {
        const button = document.createElement("button");
        button.type = "button";
        button.role = "radio";
        button.dataset.cardPrimary = family;
        button.setAttribute("aria-checked", "false");
        button.textContent = family;
        return button;
      });
      nodes.primaryGroup.replaceChildren(...nodes.primaryButtons);
      configureChoiceButtons(
        nodes.primaryButtons,
        (button) => button.dataset.cardPrimary,
        selectPrimaryData,
        "aria-checked",
        "radio",
      );
    }

    if (nodes.layerGroup) {
      nodes.layerButtons = cardDefinition.layers.map((layer) => {
        const button = document.createElement("button");
        const swatch = document.createElement("i");
        const label = document.createElement("span");
        button.type = "button";
        button.dataset.cardLayer = layer.id;
        button.setAttribute("aria-pressed", "false");
        button.setAttribute(
          "aria-label",
          layer.unit === "index"
            ? `Add ${layer.label} layer`
            : `Add ${layer.label} price layer`,
        );
        swatch.setAttribute("aria-hidden", "true");
        swatch.style.opacity = String(layer.strokeOpacity);
        if (layer.strokeDasharray) swatch.dataset.pattern = layer.id.toLowerCase();
        label.textContent = layer.shortLabel || layer.label;
        button.append(swatch, label);
        button.addEventListener("click", () => toggleLayer(layer.id));
        return button;
      });
      nodes.layerGroup.replaceChildren(...nodes.layerButtons);
    }

    if (nodes.scaleGroup) {
      nodes.scaleButtons = cardDefinition.visualizations.map((visualization) => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.cardScale = visualization.id;
        button.setAttribute("aria-pressed", "false");
        button.textContent = visualization.label;
        return button;
      });
      nodes.scaleGroup.replaceChildren(...nodes.scaleButtons);
      configureChoiceButtons(
        nodes.scaleButtons,
        (button) => button.dataset.cardScale,
        selectScale,
        "aria-pressed",
        "buttons",
      );
    }

    if (isDepthCard) configureDepthCraftControls();

    if (nodes.optionGroup && !isDepthCard && !isDealCard) {
      const optionControls = (cardDefinition.stateOptions || []).map((option) => {
        const label = document.createElement("span");
        const buttons = document.createElement("div");
        label.className = "gpu-benchmark__compare-label";
        label.textContent = option.label;
        buttons.className = "gpu-benchmark__options";
        buttons.setAttribute("role", "radiogroup");
        buttons.setAttribute("aria-label", option.label);
        const optionButtons = option.values.map((value) => {
          const button = document.createElement("button");
          button.type = "button";
          button.role = "radio";
          button.dataset.cardOption = option.id;
          button.dataset.cardOptionValue = String(value);
          button.setAttribute("aria-checked", "false");
          button.textContent =
            option.valueLabels?.[value] ||
            `${value}${option.suffix || ""}`;
          return button;
        });
        nodes.optionButtons.push(...optionButtons);
        buttons.append(...optionButtons);
        configureChoiceButtons(
          optionButtons,
          (button) => button.dataset.cardOptionValue,
          (value) => selectCardOption(option.id, value),
          "aria-checked",
          "radio",
        );
        const fragment = document.createDocumentFragment();
        fragment.append(label, buttons);
        return fragment;
      });
      nodes.optionGroup.replaceChildren(...optionControls);
      nodes.optionGroup.hidden = optionControls.length === 0;
    }
  }

  function configureDepthCraftControls() {
    const targetOption = (cardDefinition.stateOptions || []).find(
      (option) => option.id === "target",
    );
    if (nodes.depthTargetOptions && targetOption) {
      const targetButtons = targetOption.values.map((value) => {
        const button = document.createElement("button");
        button.type = "button";
        button.role = "radio";
        button.dataset.cardOption = "target";
        button.dataset.cardOptionValue = String(value);
        button.setAttribute("aria-checked", "false");
        button.setAttribute("aria-label", `${value} node target`);
        button.textContent = String(value);
        return button;
      });
      nodes.optionButtons.push(...targetButtons);
      nodes.depthTargetOptions.replaceChildren(...targetButtons);
      configureChoiceButtons(
        targetButtons,
        (button) => button.dataset.cardOptionValue,
        (value, event) => {
          selectCardOption("target", value);
          setDepthCraftMenu(null);
          if (event?.detail === 0) {
            nodes.depthTargetTrigger?.focus({ preventScroll: true });
          }
        },
        "aria-checked",
        "radio",
      );
    }

    if (nodes.depthCraftViews) {
      nodes.depthCraftViewButtons = cardDefinition.visualizations.map(
        (visualization) => {
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.depthCraftScale = visualization.id;
          button.setAttribute("aria-pressed", "false");
          button.textContent = visualization.label;
          return button;
        },
      );
      nodes.depthCraftViews.replaceChildren(...nodes.depthCraftViewButtons);
      configureChoiceButtons(
        nodes.depthCraftViewButtons,
        (button) => button.dataset.depthCraftScale,
        (scale, event) => {
          selectScale(scale);
          setDepthCraftMenu(null);
          if (event?.detail === 0) {
            nodes.depthViewTrigger?.focus({ preventScroll: true });
          }
        },
        "aria-pressed",
        "horizontal",
      );
    }

    nodes.depthTargetTrigger?.addEventListener("click", (event) => {
      setDepthCraftMenu(
        state.depthCraftMenu === "target" ? null : "target",
        event.detail === 0,
      );
    });
    nodes.depthViewTrigger?.addEventListener("click", (event) => {
      setDepthCraftMenu(
        state.depthCraftMenu === "view" ? null : "view",
        event.detail === 0,
      );
    });
    nodes.depthCraft?.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !state.depthCraftMenu) return;
      event.preventDefault();
      const trigger = state.depthCraftMenu === "target"
        ? nodes.depthTargetTrigger
        : nodes.depthViewTrigger;
      setDepthCraftMenu(null);
      trigger?.focus({ preventScroll: true });
    });
    document.addEventListener("pointerdown", (event) => {
      if (!state.depthCraftMenu || nodes.depthCraft?.contains(event.target)) return;
      setDepthCraftMenu(null);
    }, true);
  }

  function setDepthCraftMenu(menu, moveFocus = false) {
    const nextMenu = menu === "target" || menu === "view" ? menu : null;
    state.depthCraftMenu = nextMenu;
    const controls = [
      ["target", nodes.depthTargetTrigger, nodes.depthTargetMenu],
      ["view", nodes.depthViewTrigger, nodes.depthViewMenu],
    ];
    for (const [id, trigger, panel] of controls) {
      const open = id === nextMenu;
      trigger?.setAttribute("aria-expanded", String(open));
      if (!panel) continue;
      panel.hidden = !open;
      panel.toggleAttribute("inert", !open);
      if (open && !reducedMotion) {
        panel.animate(
          [
            { opacity: 0, transform: "translateY(-4px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          {
            duration: 240,
            easing: "cubic-bezier(0.32, 0.72, 0, 1)",
          },
        );
      }
    }
    if (!moveFocus || !nextMenu) return;
    window.requestAnimationFrame(() => {
      const buttons = nextMenu === "target"
        ? nodes.optionButtons.filter((button) => button.dataset.cardOption === "target")
        : nodes.depthCraftViewButtons;
      buttons.find((button) =>
        button.getAttribute(nextMenu === "target" ? "aria-checked" : "aria-pressed") === "true"
      )?.focus({ preventScroll: true });
    });
  }

  function selectCardOption(optionId, value) {
    if (state.mode !== "craft" || state.craftEmpty) return;
    mutateComposition({
      ...currentCardState(),
      [optionId]: value,
    });
  }

  function configureDealCraftControls() {
    if (!isDealCard || !nodes.dealCraft) return;
    const controls = [
      ["gpu", nodes.dealCraftGpu],
      ["quantity", nodes.dealCraftQuantity],
      ["quote", nodes.dealCraftQuote],
      ["rfs", nodes.dealCraftRfs],
    ];
    controls.forEach(([optionId, control]) => {
      let inputTimer = null;
      control?.addEventListener("input", () => {
        if (control instanceof HTMLSelectElement) return;
        window.clearTimeout(inputTimer);
        if (!control.value || !control.checkValidity()) return;
        inputTimer = window.setTimeout(() => {
          commitDealCraftField(optionId, control);
        }, 240);
      });
      control?.addEventListener("change", () => {
        window.clearTimeout(inputTimer);
        commitDealCraftField(optionId, control);
      });
    });
  }

  function commitDealCraftField(optionId, control) {
    if (
      !isDealCard ||
      state.mode !== "craft" ||
      state.craftEmpty ||
      !control
    ) {
      return;
    }
    if (!control.checkValidity()) {
      control.value = String(state.options[optionId] ?? "");
      announceCard(`${control.getAttribute("aria-label") || optionId} is unchanged`);
      control.focus({ preventScroll: true });
      return;
    }
    const next = normalizeCardState(cardId, {
      ...currentCardState(),
      [optionId]: control.value,
    });
    if (String(next[optionId]) === String(state.options[optionId])) return;
    mutateComposition(next, {
      message: `${dealOptionLabel(optionId)} updated`,
    });
  }

  function dealOptionLabel(optionId) {
    return cardDefinition.stateOptions?.find((option) => option.id === optionId)
      ?.label || optionId;
  }

  function selectDealStage(stageId) {
    if (!isDealCard) return;
    const stageOption = cardDefinition.stateOptions?.find(
      (option) => option.id === "stage",
    );
    if (!stageOption?.values.includes(stageId) || stageId === state.options.stage) {
      return;
    }
    state.options.stage = stageId;
    root.dataset.dealStage = stageId;
    syncCraftDirtyState();
    syncMobileSummary();
    updateLocation();
    const label = stageOption.valueLabels?.[stageId] || stageId;
    announceCard(`${label} opened`);
  }

  function configureSaveControls() {
    nodes.saveButton?.addEventListener("click", () => {
      if (state.activeCatalogId) {
        if (state.craftDirty) updateCurrentComposition();
        return;
      }
      openSaveDialog();
    });
    nodes.saveForm?.addEventListener("submit", saveCurrentComposition);
    nodes.saveCancel?.addEventListener("click", () => {
      nodes.saveDialog?.close("cancel");
      nodes.saveButton?.focus({ preventScroll: true });
    });
    nodes.saveDialog?.addEventListener("cancel", (event) => {
      event.preventDefault();
      nodes.saveDialog.close("cancel");
      nodes.saveButton?.focus({ preventScroll: true });
    });
    nodes.saveName?.addEventListener("input", clearSaveError);
  }

  function configureCatalogCollectionControls() {
    nodes.catalogSwitcher?.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
      if (state.mode !== "catalog" || state.layout !== "all") return;
      event.preventDefault();
      setCatalogMenuOpen(true, { moveFocus: true, edge: event.key });
    });
    nodes.catalogList?.addEventListener("click", (event) => {
      const option = event.target instanceof Element
        ? event.target.closest("[data-catalog-collection]")
        : null;
      if (!option || !nodes.catalogList.contains(option)) return;
      selectCatalogCollection(option.dataset.catalogCollection, true);
    });
    nodes.catalogMenu?.addEventListener("keydown", handleCatalogMenuKeydown);
    nodes.catalogCardsAction?.addEventListener("click", openCatalogCardCommands);
    nodes.catalogCreate?.addEventListener("click", () => {
      openCatalogCollectionDialog("create");
    });
    nodes.catalogRename?.addEventListener("click", () => {
      openCatalogCollectionDialog("rename");
    });
    nodes.catalogDelete?.addEventListener("click", () => {
      openCatalogCollectionDialog("delete");
    });
    nodes.catalogAddCards?.addEventListener("click", () => {
      openCatalogCardCommands();
    });
    nodes.catalogForm?.addEventListener("submit", submitCatalogCollectionDialog);
    nodes.catalogCancel?.addEventListener("click", closeCatalogCollectionDialog);
    nodes.catalogDialog?.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeCatalogCollectionDialog();
    });
    nodes.catalogNameInput?.addEventListener(
      "input",
      clearCatalogCollectionError,
    );
    document.addEventListener("pointerdown", (event) => {
      if (
        state.catalogMenuOpen &&
        nodes.catalogBar &&
        event.target instanceof Node &&
        !nodes.catalogBar.contains(event.target)
      ) {
        setCatalogMenuOpen(false);
      }
    });
    nodes.catalogBar?.addEventListener("focusout", () => {
      window.requestAnimationFrame(() => {
        if (
          state.catalogMenuOpen &&
          nodes.catalogBar &&
          !nodes.catalogBar.contains(document.activeElement)
        ) {
          setCatalogMenuOpen(false);
        }
      });
    });
    window.addEventListener("storage", (event) => {
      if (event.key === CATALOG_COLLECTIONS_STORAGE_KEY) {
        const activeId = state.activeCatalogViewId;
        state.catalogCollections = loadCatalogCollections();
        state.activeCatalogViewId =
          activeId === ALL_CARDS_CATALOG_ID ||
          state.catalogCollections.collections.some(
            (collection) => collection.id === activeId,
          )
            ? activeId
            : ALL_CARDS_CATALOG_ID;
        saveActiveCatalogSession(state.activeCatalogViewId);
        refreshCatalogWorkspace(
          state.catalogCollections.unavailable
            ? "Named Catalogs are unavailable"
            : "Catalogs updated",
        );
        return;
      }
      if (event.key === SAVED_CATALOG_STORAGE_KEY) {
        state.savedCatalog = loadSavedCatalog(cardId);
        if (
          state.activeCatalogId &&
          !state.savedCatalog.some((item) => item.id === state.activeCatalogId)
        ) {
          state.activeCatalogId = null;
          state.catalogName = "";
        }
        refreshCatalogWorkspace("Views updated");
        syncSavedCatalogCommands();
        return;
      }
      if (event.key === CATALOG_ORDER_STORAGE_KEY) {
        state.catalogOrder = loadCatalogOrder();
        refreshCatalogWorkspace();
      }
    });
    syncCatalogCollectionControls();
  }

  function refreshCatalogWorkspace(message = "") {
    state.catalogDirty = true;
    configureWorkspaceControls();
    syncCatalogCollectionCommands();
    syncControls();
    if (state.layout === "all") renderWorkspaceGallery();
    if (message) announceWorkspace(message);
  }

  function setCatalogMenuOpen(
    open,
    { moveFocus = false, edge = "" } = {},
  ) {
    const next = Boolean(
      open &&
      state.mode === "catalog" &&
      state.layout === "all" &&
      nodes.catalogMenu &&
      nodes.catalogSwitcher,
    );
    state.catalogMenuOpen = next;
    nodes.catalogSwitcher?.setAttribute("aria-expanded", String(next));
    if (nodes.catalogMenu) {
      nodes.catalogMenu.hidden = !next;
      nodes.catalogMenu.toggleAttribute("inert", !next);
      if (next && !reducedMotion) {
        nodes.catalogMenu.animate(
          [
            { opacity: 0, transform: "translateY(-4px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          {
            duration: 200,
            easing: "cubic-bezier(0.32, 0.72, 0, 1)",
          },
        );
      }
    }
    if (!next || !moveFocus) return;
    window.requestAnimationFrame(() => {
      const options = catalogCollectionOptions();
      const selectedIndex = options.findIndex(
        (option) => option.getAttribute("aria-selected") === "true",
      );
      const index = edge === "ArrowUp"
        ? options.length - 1
        : Math.max(0, selectedIndex);
      focusCatalogCollectionOption(options[index]);
    });
  }

  function handleCatalogMenuKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      setCatalogMenuOpen(false);
      nodes.catalogSwitcher?.focus({ preventScroll: true });
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }
    const options = catalogCollectionOptions();
    if (!options.length) return;
    const current = options.indexOf(document.activeElement);
    if (current < 0 && !nodes.catalogList?.contains(document.activeElement)) {
      return;
    }
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? options.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
          options.length;
    focusCatalogCollectionOption(options[nextIndex]);
  }

  function focusCatalogCollectionOption(option) {
    if (!option) return;
    for (const candidate of catalogCollectionOptions()) {
      candidate.tabIndex = candidate === option ? 0 : -1;
    }
    option.focus({ preventScroll: true });
  }

  function catalogCollectionOptions() {
    return nodes.catalogList
      ? Array.from(
          nodes.catalogList.querySelectorAll("[data-catalog-collection]"),
        )
      : [];
  }

  function syncCatalogCollectionControls() {
    const collection = currentCatalogCollection();
    const allEntries = catalogEntriesAll();
    const visibleEntries = entriesForCatalogCollection(allEntries, collection);
    const availableKeys = new Set(allEntries.map((entry) => entry.key));
    if (nodes.catalogSwitcherName) {
      nodes.catalogSwitcherName.textContent = state.mode === "catalog"
        ? collection.system
          ? "All"
          : collection.name
        : "Catalog";
    }
    nodes.catalogSwitcher?.setAttribute(
      "aria-label",
      state.mode === "catalog" && state.layout === "all"
        ? `Switch Catalog, ${collection.name}, ${visibleEntries.length} ${visibleEntries.length === 1 ? "view" : "views"}`
        : `Open ${collection.name} in Catalog`,
    );
    const catalogUnavailable = Boolean(state.catalogCollections.unavailable);
    if (nodes.catalogCreate) nodes.catalogCreate.disabled = catalogUnavailable;
    if (nodes.catalogRename) {
      nodes.catalogRename.disabled = collection.system || catalogUnavailable;
    }
    if (nodes.catalogDelete) {
      nodes.catalogDelete.disabled = collection.system || catalogUnavailable;
    }
    if (nodes.catalogCardsAction) {
      nodes.catalogCardsAction.disabled = collection.system || catalogUnavailable;
    }
    if (nodes.catalogList) {
      const collections = [
        { id: ALL_CARDS_CATALOG_ID, name: "All views", keys: null, system: true },
        ...state.catalogCollections.collections,
      ];
      const options = collections.map((candidate) => {
        const option = document.createElement("button");
        const count = candidate.system
          ? allEntries.length
          : candidate.keys.filter((key) => availableKeys.has(key)).length;
        option.className = "desk-catalog-option";
        option.type = "button";
        option.setAttribute("role", "option");
        option.setAttribute(
          "aria-selected",
          String(candidate.id === collection.id),
        );
        option.tabIndex = candidate.id === collection.id ? 0 : -1;
        option.setAttribute(
          "aria-label",
          `${candidate.name}, ${count} ${count === 1 ? "view" : "views"}`,
        );
        option.dataset.catalogCollection = candidate.id;
        const label = document.createElement("span");
        label.textContent = candidate.name;
        label.title = candidate.name;
        const total = document.createElement("small");
        total.textContent = String(count);
        option.append(label, total);
        return option;
      });
      nodes.catalogList.replaceChildren(...options);
    }
    const empty = !visibleEntries.length;
    if (nodes.catalogEmpty) nodes.catalogEmpty.hidden = !empty;
    if (nodes.galleryGrid) nodes.galleryGrid.hidden = empty;
  }

  function currentCatalogCollection() {
    const collection = activeCatalogCollection(
      state.catalogCollections,
      state.activeCatalogViewId,
    );
    if (collection.id !== state.activeCatalogViewId) {
      state.activeCatalogViewId = collection.id;
      saveActiveCatalogSession(collection.id);
    }
    return collection;
  }

  function loadActiveCatalogSession(collections) {
    try {
      const id = window.sessionStorage.getItem(activeCatalogSessionKey) || "";
      return id === ALL_CARDS_CATALOG_ID ||
          collections.collections.some((collection) => collection.id === id)
        ? id
        : ALL_CARDS_CATALOG_ID;
    } catch {
      return ALL_CARDS_CATALOG_ID;
    }
  }

  function saveActiveCatalogSession(collectionId) {
    try {
      window.sessionStorage.setItem(activeCatalogSessionKey, collectionId);
    } catch {
      // The current tab still keeps the active Catalog in memory.
    }
  }

  function openCatalogCardCommands() {
    const collection = currentCatalogCollection();
    if (collection.system) return;
    setCatalogMenuOpen(false);
    commandPalette.open({
      query: `Select views ${collection.name}`,
      returnFocus: nodes.catalogSwitcher,
    });
  }

  function entriesForCatalogCollection(entries, collection) {
    if (collection.system) return entries;
    const entriesByKey = new Map(entries.map((entry) => [entry.key, entry]));
    return collection.keys
      .map((key) => entriesByKey.get(key))
      .filter(Boolean);
  }

  async function selectCatalogCollection(collectionId, restoreFocus = false) {
    const id = String(collectionId || "");
    const exists =
      id === ALL_CARDS_CATALOG_ID ||
      state.catalogCollections.collections.some((collection) =>
        collection.id === id
      );
    if (!exists) {
      announceWorkspace("Could not open that Catalog");
      return;
    }
    if (state.mode === "craft") preserveCraftDraft();
    state.activeCatalogViewId = id;
    saveActiveCatalogSession(id);
    state.catalogDirty = true;
    setCatalogMenuOpen(false);
    configureWorkspaceControls();
    syncCatalogCollectionCommands();
    if (state.mode !== "catalog" || state.layout !== "all") {
      await showPanel("share", true, "all", false, "catalog");
    } else {
      renderWorkspaceGallery();
    }
    const collection = currentCatalogCollection();
    announceWorkspace(`${collection.name} opened`);
    if (restoreFocus) {
      nodes.catalogSwitcher?.focus({ preventScroll: true });
    }
  }

  function openCatalogCollectionDialog(mode) {
    if (!nodes.catalogDialog || !nodes.catalogNameInput) return;
    const collection = currentCatalogCollection();
    if ((mode === "rename" || mode === "delete") && collection.system) return;
    state.catalogDialogMode = mode;
    clearCatalogCollectionError();
    setCatalogMenuOpen(false);
    const deleting = mode === "delete";
    if (nodes.catalogDialogTitle) {
      nodes.catalogDialogTitle.textContent =
        mode === "create"
          ? "New catalog"
          : mode === "rename"
            ? "Rename catalog"
            : `Delete ${collection.name}?`;
    }
    if (nodes.catalogDialogDescription) {
      nodes.catalogDialogDescription.textContent =
        mode === "create"
          ? "Choose the views after creating it."
          : mode === "rename"
            ? "Views and order stay the same."
            : "Views stay in All views.";
    }
    if (nodes.catalogNameLabel) nodes.catalogNameLabel.hidden = deleting;
    nodes.catalogNameInput.hidden = deleting;
    nodes.catalogNameInput.required = !deleting;
    nodes.catalogNameInput.maxLength = MAX_CATALOG_COLLECTION_NAME_LENGTH;
    nodes.catalogNameInput.value = mode === "rename" ? collection.name : "";
    if (nodes.catalogSubmit) {
      nodes.catalogSubmit.textContent =
        mode === "create" ? "Create" : mode === "rename" ? "Rename" : "Delete";
    }
    nodes.catalogDialog.showModal();
    window.requestAnimationFrame(() => {
      const target = deleting ? nodes.catalogCancel : nodes.catalogNameInput;
      target?.focus({ preventScroll: true });
      if (!deleting) nodes.catalogNameInput.select();
    });
  }

  function closeCatalogCollectionDialog() {
    if (nodes.catalogDialog?.open) nodes.catalogDialog.close("cancel");
    state.catalogDialogMode = null;
    nodes.catalogSwitcher?.focus({ preventScroll: true });
  }

  async function submitCatalogCollectionDialog(event) {
    event.preventDefault();
    const mode = state.catalogDialogMode;
    if (!mode) return;
    const collection = currentCatalogCollection();
    const name = normalizeCatalogCollectionName(nodes.catalogNameInput?.value);
    if (mode !== "delete" && !name) {
      showCatalogCollectionError("Enter a name");
      return;
    }
    if (state.mode === "craft") preserveCraftDraft();
    try {
      state.catalogCollections =
        mode === "create"
          ? createCatalogCollection(name)
          : mode === "rename"
            ? renameCatalogCollection(collection.id, name)
            : deleteCatalogCollection(collection.id);
    } catch (error) {
      console.error("Catalog update failed", error);
      showCatalogCollectionError(
        error instanceof TypeError ? error.message : "Could not update Catalog",
      );
      return;
    }
    state.activeCatalogViewId =
      mode === "create"
        ? state.catalogCollections.collections.at(-1)?.id ||
          ALL_CARDS_CATALOG_ID
        : mode === "delete"
          ? ALL_CARDS_CATALOG_ID
          : collection.id;
    saveActiveCatalogSession(state.activeCatalogViewId);
    state.catalogDialogMode = null;
    nodes.catalogDialog?.close(mode);
    state.catalogDirty = true;
    configureWorkspaceControls();
    syncCatalogCollectionCommands();
    if (state.mode !== "catalog" || state.layout !== "all") {
      await showPanel("share", true, "all", false, "catalog");
    } else {
      renderWorkspaceGallery();
    }
    const next = currentCatalogCollection();
    announceWorkspace(
      mode === "create"
        ? `${next.name} created`
        : mode === "rename"
          ? `${next.name} renamed`
          : `${collection.name} deleted`,
    );
    nodes.catalogSwitcher?.focus({ preventScroll: true });
  }

  function clearCatalogCollectionError() {
    nodes.catalogNameInput?.removeAttribute("aria-invalid");
    if (nodes.catalogError) nodes.catalogError.textContent = "";
  }

  function showCatalogCollectionError(message) {
    nodes.catalogNameInput?.setAttribute("aria-invalid", "true");
    if (nodes.catalogError) nodes.catalogError.textContent = message;
    if (!nodes.catalogNameInput?.hidden) {
      nodes.catalogNameInput?.focus({ preventScroll: true });
    }
  }

  function openSaveDialog({ rename = false } = {}) {
    if (
      state.mode !== "craft" ||
      state.craftEmpty ||
      !state.shareReady ||
      !nodes.saveDialog ||
      !nodes.saveName
    ) {
      return;
    }
    clearSaveError();
    if (state.activeCatalogId && !rename) return;
    if (nodes.saveTitle) {
      nodes.saveTitle.textContent = rename ? "Rename view" : "Save view";
    }
    if (nodes.saveSubmit) nodes.saveSubmit.textContent = rename ? "Rename" : "Save";
    nodes.saveName.maxLength = MAX_CATALOG_NAME_LENGTH;
    nodes.saveName.value = state.catalogName || suggestedCatalogName();
    nodes.saveDialog.showModal();
    window.requestAnimationFrame(() => {
      nodes.saveName.focus({ preventScroll: true });
      nodes.saveName.select();
    });
  }

  async function saveCurrentComposition(event) {
    event.preventDefault();
    if (!nodes.saveName || !nodes.saveDialog) return;
    const name = normalizeCatalogName(nodes.saveName.value);
    if (!name) {
      showSaveError("Enter a name");
      return;
    }

    await persistCurrentComposition(name);
  }

  async function updateCurrentComposition() {
    if (!state.activeCatalogId || !state.craftDirty) return;
    await persistCurrentComposition(state.catalogName || suggestedCatalogName());
  }

  async function persistCurrentComposition(name) {
    const creating = !state.activeCatalogId;
    let saved;
    let collectionWarning = "";
    try {
      saved = saveCatalogItem({
        cardId,
        name,
        state: currentCardState(),
        itemId: state.activeCatalogId,
      });
      state.savedCatalog = loadSavedCatalog(cardId);
      const collection = currentCatalogCollection();
      if (creating && !collection.system) {
        try {
          state.catalogCollections = addCatalogCollectionKey(
            collection.id,
            savedCatalogKey(cardId, saved.id),
          );
        } catch (error) {
          console.error("Catalog membership save failed", error);
          collectionWarning = " View saved in All views.";
        }
      }
    } catch (error) {
      console.error("Catalog save failed", error);
      const message =
        error instanceof TypeError ? error.message : "Could not save this view";
      if (nodes.saveDialog?.open) showSaveError(message);
      else announceCard(message);
      return;
    }

    state.activeCatalogId = saved.id;
    state.catalogName = saved.name;
    state.craftEmpty = false;
    state.craftDirty = false;
    state.craftBaseline = compositionKey(cardId, saved.state);
    state.craftDraft = null;
    clearStoredCraftDraft();
    if (nodes.saveDialog?.open) nodes.saveDialog.close("saved");
    state.catalogDirty = true;
    configureWorkspaceControls();
    syncSavedCatalogCommands();
    syncCatalogCollectionCommands();
    syncControls();
    if (creating) {
      await showPanel("share", true, "all", false, "catalog");
      const savedCard = catalogCards.get(savedCatalogKey(cardId, saved.id));
      savedCard?.button.scrollIntoView({ block: "nearest", inline: "nearest" });
      savedCard?.button.focus({ preventScroll: true });
    } else {
      updateLocation();
      nodes.saveButton?.focus({ preventScroll: true });
    }
    announceWorkspace(`${saved.name} saved.${collectionWarning}`.trim());
  }

  function removeCurrentCatalogMembership() {
    if (!state.activeCatalogId) return;
    const collection = currentCatalogCollection();
    if (collection.system) return;
    const name = state.catalogName || "This view";
    try {
      state.catalogCollections = replaceCatalogCollectionKeys(
        collection.id,
        collection.keys.filter(
          (key) => key !== savedCatalogKey(cardId, state.activeCatalogId),
        ),
      );
    } catch (error) {
      console.error("Catalog membership removal failed", error);
      announceCard("Could not update this Catalog");
      return;
    }
    refreshCatalogWorkspace();
    announceWorkspace(`${name} removed from ${collection.name}`);
  }

  function deleteCurrentCatalogItem() {
    if (!state.activeCatalogId) return;
    const name = state.catalogName || "This view";
    const key = savedCatalogKey(cardId, state.activeCatalogId);
    const affectedCollections = state.catalogCollections.collections.filter(
      (collection) => collection.keys.includes(key),
    );
    const scope = affectedCollections.length
      ? ` and ${affectedCollections.length} named ${affectedCollections.length === 1 ? "Catalog" : "Catalogs"}`
      : "";
    if (!window.confirm(`Delete ${name} from All views${scope}?`)) return;
    try {
      state.catalogCollections = removeCatalogKeyFromCollections(key);
    } catch (error) {
      console.error("Catalog reference cleanup failed", error);
      announceCard("Could not delete this view");
      return;
    }
    try {
      deleteCatalogItem({ cardId, itemId: state.activeCatalogId });
    } catch (error) {
      console.error("Catalog deletion failed", error);
      for (const collection of affectedCollections) {
        try {
          state.catalogCollections = addCatalogCollectionKey(collection.id, key);
        } catch (restoreError) {
          console.error("Catalog reference restore failed", restoreError);
        }
      }
      state.catalogCollections = loadCatalogCollections();
      announceCard("Could not delete this view");
      return;
    }
    state.savedCatalog = loadSavedCatalog(cardId);
    state.activeCatalogId = null;
    state.catalogName = "";
    state.craftBaseline = compositionKey(cardId, currentCardState());
    state.craftDirty = false;
    configureWorkspaceControls();
    syncSavedCatalogCommands();
    syncCatalogCollectionCommands();
    syncControls();
    if (state.layout === "all") {
      state.catalogDirty = true;
      renderWorkspaceGallery();
    }
    updateLocation();
    announceWorkspace(`${name} deleted`);
  }

  function suggestedCatalogName() {
    if (isBarCard) return "Accelerator prices";
    if (isDepthCard) return `H100 depth ${state.options.target} nodes`;
    if (isDealCard) {
      const id = state.runtimePayload?.id || "041";
      return `Deal ${id} ${state.options.gpu}`;
    }
    const labels = orderedLayerLabels({
      gpu: state.selected,
      layers: Array.from(state.layers),
    });
    const composition = labels.length > 1
      ? `${labels[0]} with ${labels.slice(1).join(" + ")}`
      : labels[0] || state.selected;
    return `${composition} ${ranges[state.range].label}`;
  }

  function clearSaveError() {
    nodes.saveName?.removeAttribute("aria-invalid");
    if (nodes.saveError) nodes.saveError.textContent = "";
  }

  function showSaveError(message) {
    nodes.saveName?.setAttribute("aria-invalid", "true");
    if (nodes.saveError) nodes.saveError.textContent = message;
    nodes.saveName?.focus({ preventScroll: true });
  }

  function handleComparePanelKeydown(event) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    setCompareOpen(false);
    nodes.compareToggle?.focus({ preventScroll: true });
  }

  function setCompareOpen(open, moveFocus = false) {
    if (!nodes.comparePanel || !nodes.compareToggle) return;
    const nextOpen = Boolean(open);
    if (nextOpen && state.mode !== "craft") return;
    const panel = nodes.comparePanel;
    state.compareOpen = nextOpen;
    nodes.compareToggle.setAttribute("aria-expanded", String(nextOpen));
    panel.getAnimations().forEach((animation) => animation.cancel());
    panel.toggleAttribute("inert", !nextOpen);

    if (nextOpen) {
      panel.hidden = false;
      if (!reducedMotion) {
        panel.animate(
          [
            { opacity: 0, transform: "translateY(-4px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          {
            duration: 240,
            easing: "cubic-bezier(0.32, 0.72, 0, 1)",
          },
        );
      }
      if (moveFocus) {
        window.requestAnimationFrame(() => {
          const target = state.craftEmpty
            ? nodes.primaryButtons[0]
            : nodes.optionButtons.find(
                (button) =>
                  !button.disabled && button.getAttribute("aria-checked") === "true",
              ) ||
              nodes.optionButtons.find((button) => !button.disabled) ||
              nodes.layerButtons.find((button) => !button.disabled);
          target?.focus();
        });
      }
    } else if (reducedMotion || panel.hidden) {
      panel.hidden = true;
    } else {
      const animation = panel.animate(
        [
          { opacity: 1, transform: "translateY(0)" },
          { opacity: 0, transform: "translateY(-4px)" },
        ],
        {
          duration: 200,
          easing: "cubic-bezier(0.32, 0.72, 0, 1)",
        },
      );
      animation.finished.then(() => {
        if (!state.compareOpen) panel.hidden = true;
      }).catch(() => {});
    }

    syncComposerControls();
  }

  async function openCraft(focusNavigation = false) {
    if (state.mode === "monitor" && !state.craftEmpty) {
      state.craftDirty = state.craftBaseline
        ? compositionKey(cardId, currentCardState()) !== state.craftBaseline
        : true;
      await switchWorkspaceMode("craft", focusNavigation);
      return;
    }
    if (state.craftDraft) {
      await resumeCraftDraft(focusNavigation);
      return;
    }
    if (state.mode === "catalog") {
      if (state.craftDirty) {
        await switchWorkspaceMode("craft", focusNavigation);
      } else {
        await beginNewComposition(focusNavigation);
      }
      return;
    }
    await switchWorkspaceMode("craft", focusNavigation);
  }

  function preserveCraftDraft() {
    if (!state.craftDirty || state.craftEmpty) return;
    state.craftDraft = {
      cardState: currentCardState(),
      activeCatalogId: state.activeCatalogId,
      catalogName: state.catalogName,
      craftBaseline: state.craftBaseline,
    };
    storeCraftDraft(state.craftDraft);
  }

  async function resumeCraftDraft(focusNavigation = false) {
    const draft = state.craftDraft;
    if (!draft) return;
    applyCompositionFields(draft.cardState);
    state.activeCatalogId = draft.activeCatalogId;
    state.catalogName = draft.catalogName;
    state.craftEmpty = false;
    state.craftDirty = true;
    state.craftBaseline = draft.craftBaseline;
    state.craftDraft = null;
    clearStoredCraftDraft();
    state.zoomWindow = null;
    setCompareOpen(false);
    await showPanel("detail", true, "focus", false, "craft");
    if (focusNavigation) {
      nodes.modeButtons
        .find((button) => button.dataset.deskMode === "craft")
        ?.focus({ preventScroll: true });
    }
    announceWorkspace("Draft resumed in Craft");
  }

  async function beginNewComposition(focusNavigation = false) {
    const next = createComposition(cardId, {
      palette: currentPalette(),
      theme: currentTheme(),
      range: state.range,
    });
    applyCompositionFields(next);
    state.activeCatalogId = null;
    state.catalogName = "";
    state.craftEmpty = families.length > 1;
    state.craftDirty = !state.craftEmpty;
    state.craftBaseline = null;
    state.craftDraft = null;
    clearStoredCraftDraft();
    state.zoomWindow = null;
    setCompareOpen(false);

    if (
      state.mode === "craft" &&
      state.panel === "detail" &&
      state.layout === "focus"
    ) {
      syncControls();
      render(false);
      updateLocation();
    } else {
      await showPanel("detail", true, "focus", false, "craft");
    }

    if (isDepthCard) setDepthCraftMenu("target", focusNavigation);
    else setCompareOpen(true, focusNavigation);
    announceWorkspace("New composition opened in Craft");
  }

  function selectPrimaryData(layerId) {
    if (state.mode !== "craft" || !families.includes(layerId)) return;
    const wasEmpty = state.craftEmpty;
    const base = currentCardState();
    const next = wasEmpty
      ? normalizeCardState(cardId, {
          ...base,
          gpu: layerId,
          layers: layerId,
          scale: cardDefinition.defaults.scale,
        })
      : setPrimaryLayer(cardId, base, layerId);
    mutateComposition(next, {
      message: wasEmpty
        ? `${layerId} added as the main series`
        : `${layerId} is now the main series`,
    });
  }

  function selectScale(scale) {
    if (state.craftEmpty || !cardDefinition.visualizations.some(
      (visualization) => visualization.id === scale,
    )) {
      return;
    }
    if (scale === state.scale) return;
    const label = visualizationLabel(scale);
    if (isDepthCard && state.mode === "monitor") {
      state.scale = scale;
      state.zoomWindow = null;
      syncControls();
      render(true);
      updateLocation();
      announceCard(`${label} view selected`);
      return;
    }
    if (state.mode !== "craft") return;
    const hadToken = state.layers.has("TOKEN");
    const next = setCompositionScale(cardId, currentCardState(), scale);
    mutateComposition(next, {
      message:
        scale === "price" && hadToken && !next.layers.includes("TOKEN")
          ? "Price view selected, Token Price Index removed"
          : `${label} view selected`,
    });
  }

  function visualizationLabel(scale, definition = cardDefinition) {
    return definition.visualizations.find(
      (visualization) => visualization.id === scale,
    )?.label || scale;
  }

  function depthViewMode(scale) {
    return scale === "history" ? "history" : "now";
  }

  function mutateComposition(nextState, { message = "" } = {}) {
    if (state.mode !== "craft") return;
    const next = applyCompositionFields(nextState);
    state.craftEmpty = false;
    state.craftDirty = state.craftBaseline
      ? compositionKey(cardId, next) !== state.craftBaseline
      : true;
    state.zoomWindow = null;
    syncControls();
    render(true);
    updateLocation();
    if (message) announceCard(message);
  }

  function configureAppearanceControls() {
    syncAppearanceControls();
    nodes.displayToolbar?.addEventListener("keydown", handleDisplayToolbarKeydown);
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
        id: "workspace.catalog",
        group: "Workspace",
        order: 0,
        title: "Open Catalog",
        subtitle: cardDefinition.title,
        hint: "Catalog",
        keywords: ["catalog", "view", "views", "card", "cards", "gallery", "market", "accelerator", "prices", "compute", "gpu"],
        disabled: () => !state.shareReady,
        active: () => state.mode === "catalog",
        run: () => switchWorkspaceMode("catalog", true),
      },
      {
        id: "workspace.monitor",
        group: "Workspace",
        order: 1,
        title: "Open Monitor",
        subtitle: cardDefinition.title,
        hint: "Monitor",
        keywords: ["monitor", "inspect", "read", "zoom", "chart", "market", "prices", "compute", "gpu"],
        disabled: () => !state.shareReady || state.craftEmpty,
        active: () => state.mode === "monitor",
        run: () => switchWorkspaceMode("monitor", true),
      },
      {
        id: "workspace.craft",
        group: "Workspace",
        order: 2,
        title: () =>
          state.craftDraft
            ? "Resume draft"
            : state.mode === "catalog" && !state.craftDirty
              ? "Start a new composition"
              : "Open Craft",
        subtitle: cardDefinition.title,
        hint: "Craft",
        keywords: ["craft", "edit", "compose", "compare", "layers", "chart", "compute", "gpu"],
        disabled: () => !state.shareReady,
        active: () => state.mode === "craft",
        run: () => openCraft(true),
      },
      {
        id: "create.gpu-share-gallery",
        group: "Catalog",
        order: 0,
        title: "Show all views",
        subtitle: "All views",
        hint: "All",
        keywords: ["catalog", "view", "views", "card", "cards", "all", "gallery", "export", "snapshot", "publish"],
        disabled: () => !state.shareReady,
        active: () => state.mode === "catalog" && state.layout === "all",
        run: () => showPanel("share", true, "all", true, "catalog"),
      },
      {
        id: "catalog.accelerator-prices",
        group: "Catalog",
        order: 1,
        title: "Open Accelerator prices",
        subtitle: "Bar chart",
        hint: "Prices",
        keywords: ["bar", "bars", "ranking", "snapshot", "gpu", "market"],
        disabled: () => !state.shareReady,
        active: () => isBarCard && state.mode === "catalog",
        run: () => openCardPreset("gpu-price-snapshot", "card", true),
      },
      {
        id: "catalog.h100-market-depth",
        group: "Catalog",
        order: 2,
        title: "Open H100 depth",
        subtitle: "Capacity by hourly price",
        hint: "Depth",
        keywords: ["capacity", "availability", "supply", "depth", "h100"],
        disabled: () => !state.shareReady,
        active: () => isDepthCard && state.mode === "catalog",
        run: () => openCardPreset("gpu-market-depth", "card", true),
      },
      {
        id: "catalog.deal-041",
        group: "Catalog",
        order: 3,
        title: "Open Deal 041",
        subtitle: "Reserved B200 capacity",
        hint: "Deal",
        keywords: [
          "deal",
          "private",
          "capacity",
          "contract",
          "quote",
          "b200",
        ],
        disabled: () => !state.shareReady,
        active: () => isDealCard && state.mode === "monitor",
        run: () => openCardPreset("deal-view", "monitor", true),
      },
      {
        id: "actions.copy-card-link",
        group: "Actions",
        order: 0,
        title: "Copy view link",
        subtitle: "/actions/copy-view-link",
        hint: "Copy",
        keywords: ["share", "view", "card", "url", "clipboard"],
        disabled: () => !state.shareReady || state.craftEmpty,
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
        hint: "Display",
        keywords: ["toolbar", "theme", "palette", "controls"],
        run: () => {
          setDisplayToolbarCollapsed(
            document.documentElement.dataset.displayToolbar !== "collapsed",
          );
        },
      },
      {
        id: "actions.save-to-catalog",
        group: "Actions",
        order: 2,
        title: () => state.activeCatalogId ? "Update view" : "Save view",
        subtitle: () => state.activeCatalogId
          ? state.catalogName
          : "Available in this browser",
        hint: "Save",
        keywords: ["save", "keep", "catalog", "view", "card", "name", "composition"],
        disabled: () =>
          state.mode !== "craft" ||
          state.craftEmpty ||
          !state.shareReady ||
          (state.activeCatalogId && !state.craftDirty),
        run: () => state.activeCatalogId
          ? updateCurrentComposition()
          : openSaveDialog(),
      },
      {
        id: "actions.rename-catalog-card",
        group: "Actions",
        order: 3,
        title: "Rename view",
        subtitle: () => state.catalogName,
        hint: "Rename",
        keywords: ["rename", "name", "catalog", "view", "card"],
        disabled: () =>
          state.mode !== "craft" ||
          state.craftEmpty ||
          !state.shareReady ||
          !state.activeCatalogId,
        run: () => openSaveDialog({ rename: true }),
      },
      {
        id: "actions.remove-catalog-card",
        group: "Actions",
        order: 4,
        title: () => `Remove from ${currentCatalogCollection().name}`,
        subtitle: () => `${state.catalogName} stays in All views`,
        hint: "Remove",
        keywords: ["remove", "catalog", "view", "card", "membership"],
        disabled: () =>
          !state.activeCatalogId || currentCatalogCollection().system,
        run: removeCurrentCatalogMembership,
      },
      {
        id: "actions.delete-catalog-card",
        group: "Actions",
        order: 5,
        title: "Delete saved view",
        subtitle: () => state.catalogName,
        hint: "Delete",
        keywords: ["delete", "remove", "saved", "view", "card", "everywhere"],
        disabled: () => !state.activeCatalogId,
        run: deleteCurrentCatalogItem,
      },
      ...families.map((family, index) => ({
        id: `gpu.${family.toLowerCase()}`,
        group: "Catalog",
        order: index + 1,
        title: `Open ${family} in Catalog`,
        subtitle: "GPU price history",
        hint: family,
        keywords: ["view", "card", "catalog", "accelerator", "family", "chip"],
        active: () =>
          cardId === "gpu-index" &&
          state.mode === "catalog" &&
          state.layout === "focus" &&
          state.selected === family,
        run: () => selectCardTab(family, { detail: 0 }),
      })),
      ...(isDealCard ? [] : cardDefinition.layers).map((layer, index) => ({
        id: `layer.${layer.id.toLowerCase()}`,
        group: "Layers",
        order: index,
        title: () =>
          !state.craftEmpty && state.layers.has(layer.id)
            ? `Remove ${layer.shortLabel || layer.label}`
            : `Add ${layer.shortLabel || layer.label}`,
        subtitle: "Comparison series",
        hint: "Layer",
        keywords: ["compare", "overlay", "series", layer.label],
        active: () =>
          state.mode === "craft" &&
          !state.craftEmpty &&
          state.layers.has(layer.id),
        disabled: () =>
          state.mode !== "craft" ||
          state.craftEmpty ||
          (state.selected === layer.id && state.layers.has(layer.id)),
        run: () => toggleLayer(layer.id),
      })),
      ...(isDealCard ? [] : families).map((family, index) => ({
        id: `primary.${family.toLowerCase()}`,
        group: isBarCard ? "Highlight" : "Main data",
        order: index,
        title: isBarCard
          ? `Highlight ${family}`
          : `Use ${family} as main series`,
        subtitle: "Primary series",
        hint: isBarCard ? "Highlight" : "Main",
        keywords: ["primary", "main", "highlight", "series", "data", family],
        active: () =>
          state.mode === "craft" &&
          !state.craftEmpty &&
          state.selected === family,
        disabled: () => state.mode !== "craft",
        run: () => selectPrimaryData(family),
      })),
      ...(isDealCard ? [] : cardDefinition.visualizations).map((visualization, index) => ({
        id: `scale.${visualization.id}`,
        group: "Chart",
        order: index,
        title: `Use ${visualization.label}`,
        subtitle: "Chart mode",
        hint: visualization.label,
        keywords: ["scale", "view", "price", "index", visualization.label],
        active: () =>
          state.mode !== "catalog" &&
          !state.craftEmpty &&
          state.scale === visualization.id,
        disabled: () =>
          state.craftEmpty || (!isDepthCard && state.mode !== "craft") ||
          (isDepthCard && state.mode === "catalog"),
        run: () => selectScale(visualization.id),
      })),
      ...(isBarCard || isDepthCard || isDealCard
        ? []
        : cardDefinition.ranges || Object.keys(ranges)
      ).map((range, index) => ({
        id: `range.${range}`,
        group: "Range",
        order: index,
        title: rangeCommandTitle(range),
        subtitle: "History range",
        hint: rangeControlLabel(range),
        keywords: ["date", "time", "history", "window"],
        active: () =>
          state.mode !== "catalog" &&
          (state.mode !== "craft" || !state.craftEmpty) &&
          state.range === range,
        disabled: () => state.mode === "catalog" || state.craftEmpty,
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
      {
        id: "appearance.catalog.match-desk",
        group: "Appearance",
        order: 6,
        title: "Match Desk colors",
        subtitle: "Use one palette across Catalog",
        hint: "Catalog",
        keywords: [
          "catalog",
          "views",
          "cards",
          "color",
          "colour",
          "theme",
          "same",
          "reset",
        ],
        active: () => state.catalogColorMode === "match-desk",
        run: () => setCatalogColorMode("match-desk"),
      },
      {
        id: "appearance.catalog.card-colors",
        group: "Appearance",
        order: 7,
        title: "Show view colors",
        subtitle: "Use each view’s saved appearance",
        hint: "Catalog",
        keywords: [
          "catalog",
          "views",
          "cards",
          "color",
          "colour",
          "theme",
          "individual",
          "saved",
        ],
        active: () => state.catalogColorMode === "card-colors",
        run: () => setCatalogColorMode("card-colors"),
      },
    ]);
  }

  function syncSavedCatalogCommands() {
    unregisterSavedCatalogCommands();
    unregisterSavedCatalogCommands = commandPalette.register(
      CARD_REGISTRY.flatMap((entryCard) =>
        loadSavedCatalog(entryCard.id).map((item) => ({ entryCard, item })),
      ).map(({ entryCard, item }, index) => ({
        id: `catalog.saved.${entryCard.id}.${item.id}`,
        group: "Catalog",
        order: 100 + index,
        title: item.name,
        subtitle: describeCatalogState(item.state, entryCard),
        hint: "Saved",
        keywords: [
          "saved",
          "catalog",
          item.name,
          ...(Array.isArray(item.state.layers)
            ? item.state.layers
            : [item.state.gpu].filter(Boolean)),
        ],
        disabled: () => !state.shareReady,
        active: () =>
          cardId === entryCard.id &&
          state.activeCatalogId === item.id &&
          state.mode === "monitor",
        run: () =>
          monitorCatalogEntry(
            {
              key: savedCatalogKey(entryCard.id, item.id),
              kind: "saved",
              cardId: entryCard.id,
              item,
            },
            true,
          ),
      })),
    );
  }

  function syncCatalogCollectionCommands() {
    unregisterCatalogCollectionCommands();
    const collection = currentCatalogCollection();
    const allEntries = catalogEntriesAll();
    const included = new Set(collection.system ? [] : collection.keys);
    const collections = [
      { id: ALL_CARDS_CATALOG_ID, name: "All views", keys: null, system: true },
      ...state.catalogCollections.collections,
    ];
    const commands = [
      ...collections.map((candidate, index) => {
        const count = candidate.system
          ? allEntries.length
          : candidate.keys.filter((key) =>
              allEntries.some((entry) => entry.key === key)
            ).length;
        return {
          id: `catalog.collection.open.${candidate.id}`,
          group: "Catalogs",
          order: index,
          title: `Open ${candidate.name}`,
          subtitle: `${count} ${count === 1 ? "view" : "views"}`,
          hint: "Catalog",
          keywords: ["catalog", "switch", "collection", candidate.name],
          active: () => state.activeCatalogViewId === candidate.id,
          run: () => selectCatalogCollection(candidate.id),
        };
      }),
      {
        id: "catalog.collection.new",
        group: "Catalogs",
        order: 50,
        title: "New catalog",
        subtitle: "Choose a set of views",
        hint: "New",
        keywords: ["catalog", "create", "new", "collection"],
        disabled: () => Boolean(state.catalogCollections.unavailable),
        run: () => openCatalogCollectionDialog("create"),
      },
      {
        id: "catalog.collection.rename",
        group: "Catalogs",
        order: 51,
        title: "Rename catalog",
        subtitle: collection.name,
        hint: "Rename",
        keywords: ["catalog", "rename", collection.name],
        disabled: () =>
          currentCatalogCollection().system ||
          Boolean(state.catalogCollections.unavailable),
        run: () => openCatalogCollectionDialog("rename"),
      },
      {
        id: "catalog.collection.delete",
        group: "Catalogs",
        order: 52,
        title: "Delete catalog",
        subtitle: collection.name,
        hint: "Delete",
        keywords: ["catalog", "delete", "remove", collection.name],
        disabled: () =>
          currentCatalogCollection().system ||
          Boolean(state.catalogCollections.unavailable),
        run: () => openCatalogCollectionDialog("delete"),
      },
      ...(collection.system
        ? []
        : allEntries.map((entry, index) => {
            const entryIncluded = included.has(entry.key);
            const title = catalogEntryTitle(entry);
            return {
              id: `catalog.collection.card.${collection.id}.${entry.key}`,
              group: "Catalog views",
              order: index,
              title: `${entryIncluded ? "Remove" : "Add"} ${title}`,
              subtitle: `${collection.name} ${catalogEntryKindLabel(entry)}`,
              hint: entryIncluded ? "Remove" : "Add",
              keywords: [
                "catalog",
                "view",
                "card",
                "select",
                entryIncluded ? "remove" : "add",
                title,
                collection.name,
              ],
              active: () =>
                !currentCatalogCollection().system &&
                currentCatalogCollection().keys.includes(entry.key),
              disabled: () => Boolean(state.catalogCollections.unavailable),
              keepOpen: true,
              run: () => toggleCatalogEntryInActiveCollection(entry),
            };
          })),
    ];
    unregisterCatalogCollectionCommands = commandPalette.register(commands);
  }

  function toggleCatalogEntryInActiveCollection(entry) {
    const collection = currentCatalogCollection();
    if (collection.system) return;
    const included = collection.keys.includes(entry.key);
    try {
      state.catalogCollections = toggleCatalogCollectionKey(
        collection.id,
        entry.key,
      );
    } catch (error) {
      console.error("Catalog card update failed", error);
      announceWorkspace(
        error instanceof TypeError
          ? error.message
          : "Could not update this Catalog",
      );
      return;
    }
    state.catalogDirty = true;
    configureWorkspaceControls();
    syncCatalogCollectionCommands();
    renderWorkspaceGallery();
    announceWorkspace(
      `${catalogEntryTitle(entry)} ${included ? "removed from" : "added to"} ${collection.name}`,
    );
  }

  function describeCatalogState(cardState, definition = cardDefinition) {
    if (definition.renderer === "deal") {
      const stageOption = definition.stateOptions?.find(
        (option) => option.id === "stage",
      );
      const stageLabel =
        stageOption?.valueLabels?.[cardState.stage] || cardState.stage;
      return `${stageLabel} stage`;
    }
    if (definition.renderer === "categorical-bar") {
      return `${cardState.layers.length} accelerator price${cardState.layers.length === 1 ? "" : "s"}`;
    }
    if (definition.renderer === "cumulative-depth") {
      return `${visualizationLabel(cardState.scale, definition)} ${cardState.target} node target`;
    }
    const labels = orderedLayerLabels(cardState, definition);
    const composition = labels.length > 1
      ? `${labels[0]} with ${labels.slice(1).join(" + ")}`
      : labels[0] || cardState.gpu;
    return `${composition} ${ranges[cardState.range].label}`;
  }

  function orderedLayerLabels(cardState, definition = cardDefinition) {
    const layerIds = [
      cardState.gpu,
      ...cardState.layers.filter((layerId) => layerId !== cardState.gpu),
    ];
    return layerIds.map((layerId) => {
      const layer = getLayerDefinition(definition, layerId);
      return layer?.shortLabel || layer?.label || layerId;
    });
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

  function loadCatalogColorMode() {
    try {
      return window.localStorage.getItem(catalogColorStorageKey) === "card-colors"
        ? "card-colors"
        : "match-desk";
    } catch {
      return "match-desk";
    }
  }

  function setCatalogColorMode(mode) {
    if (mode !== "match-desk" && mode !== "card-colors") return;
    if (state.catalogColorMode === mode) return;
    state.catalogColorMode = mode;
    try {
      window.localStorage.setItem(catalogColorStorageKey, mode);
    } catch {}
    state.catalogDirty = true;
    if (state.layout === "all") renderWorkspaceGallery();
    commandPalette.refresh();
    announceWorkspace(
      mode === "match-desk"
        ? "Catalog now matches Desk colors"
        : "Catalog now shows each view’s colors",
    );
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

  function currentSecondaryLineColor() {
    return readCssToken("--desk-comparison-line", currentLineColor());
  }

  function currentAreaColor() {
    return currentSecondaryLineColor();
  }

  function currentPaperColor() {
    return readCssToken("--desk-canvas", currentTheme() === "dark" ? "#181818" : "#ffffff");
  }

  function readCssToken(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  function setTheme(theme) {
    if (theme !== "light" && theme !== "dark") return;
    if (theme === currentTheme()) {
      updateLocation();
      return;
    }
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem("desk-theme", theme);
    } catch {}
    syncAppearanceControls();
    syncCraftDirtyState();
    updateLocation();
    refreshAppearance();
  }

  function setPalette(palette) {
    if (!palettes.includes(palette)) return;
    if (palette === currentPalette()) {
      updateLocation();
      return;
    }
    document.documentElement.dataset.palette = palette;
    try {
      window.localStorage.setItem("desk-palette", palette);
    } catch {}
    syncAppearanceControls();
    syncCraftDirtyState();
    updateLocation();
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
    if (!state.runtimePayload) return;
    render(false);
    if (state.layout === "all" && !reducedMotion && nodes.galleryGrid) {
      animate(
        nodes.galleryGrid,
        { opacity: [0.58, 1] },
        { duration: 0.2, ease: [0.23, 1, 0.32, 1] },
      );
    }
  }

  function syncCraftDirtyState() {
    if (state.mode !== "craft" || state.craftEmpty) return;
    state.craftDirty = state.craftBaseline
      ? compositionKey(cardId, currentCardState()) !== state.craftBaseline
      : true;
    syncComposerControls();
  }

  function setInitialPanel() {
    syncFocusPanels();
    syncLayout(false);
    syncModeActions(false);
  }

  function syncFocusPanels() {
    for (const [name, panel] of nodes.panels) {
      const isCurrent = name === state.panel;
      panel.hidden = !isCurrent;
      panel.toggleAttribute("inert", !isCurrent);
    }
  }

  function configureWorkspaceControls() {
    if (!nodes.galleryGrid) return;
    cancelCatalogReorder();
    state.catalogDirty = true;
    catalogCards.clear();
    const entries = catalogEntries();
    nodes.galleryGrid.dataset.cardCount = String(Math.min(entries.length, 5));
    nodes.galleryGrid.setAttribute("role", "list");
    const cards = entries.map((entry) => {
      const entryCard = getCardDefinition(entry.cardId || cardId);
      const item = document.createElement("div");
      const button = document.createElement("button");
      item.className = "desk-gallery-item";
      item.dataset.catalogId = entry.key;
      item.setAttribute("role", "listitem");
      button.className = "desk-gallery-card compute-share-card-frame";
      button.type = "button";
      button.dataset.catalogId = entry.key;
      button.dataset.catalogKind = entry.kind;
      button.setAttribute("aria-label", `Monitor ${catalogEntryTitle(entry)}`);
      if (entryCard.renderer === "deal") {
        const dealHost = document.createElement("div");
        dealHost.className = "deal-view-host deal-view-host--catalog";
        dealHost.dataset.galleryDeal = "";
        dealHost.setAttribute("aria-hidden", "true");
        button.append(dealHost);
      } else {
        const artifact = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "svg",
        );
        artifact.classList.add(
          "compute-share-artifact",
          "desk-gallery-card__artifact",
        );
        artifact.setAttribute("viewBox", "0 0 1200 675");
        artifact.setAttribute("aria-hidden", "true");
        artifact.dataset.galleryArtifact = "";
        button.append(artifact);
      }
      button.addEventListener("click", (event) => {
        if (
          event.detail !== 0 &&
          suppressedCatalogClickKey === entry.key
        ) {
          event.preventDefault();
          event.stopPropagation();
          suppressedCatalogClickKey = null;
          return;
        }
        monitorCatalogEntry(entry, event.detail === 0);
      });
      const cardNodes = {
        entry,
        item,
        button,
        artifact: button.querySelector("[data-gallery-artifact]"),
        dealHost: button.querySelector("[data-gallery-deal]"),
      };
      configureCatalogCardReordering(cardNodes);
      item.append(button);
      catalogCards.set(entry.key, cardNodes);
      return item;
    });
    nodes.galleryGrid.replaceChildren(...cards);
    syncCatalogCollectionControls();
    syncCatalogCardPositions();
  }

  function catalogEntries() {
    return entriesForCatalogCollection(
      catalogEntriesAll(),
      currentCatalogCollection(),
    );
  }

  function catalogEntriesAll() {
    const savedEntries = CARD_REGISTRY.flatMap((card) =>
      loadSavedCatalog(card.id).map((item) => ({
        key: savedCatalogKey(card.id, item.id),
        kind: "saved",
        cardId: card.id,
        item,
      })),
    );
    const presetEntries = CARD_REGISTRY.flatMap((card) =>
      (card.catalogPresets || []).map((preset) => ({
        key: presetCatalogKey(card.id, preset.id),
        kind: "preset",
        cardId: card.id,
        presetId: preset.id,
        family: preset.state?.gpu || preset.label,
        label: preset.label,
        state: normalizeCardState(card.id, {
          ...card.defaults,
          ...preset.state,
        }),
      })),
    );
    return orderCatalogEntries(
      [...savedEntries, ...presetEntries],
      state.catalogOrder,
    );
  }

  function catalogEntryTitle(entry) {
    if (entry.kind === "saved") return entry.item.name;
    return entry.label || entry.family || getCardDefinition(entry.cardId).title;
  }

  function catalogEntryKindLabel(entry) {
    if (entry.kind === "saved") return "Saved view";
    return getCardDefinition(entry.cardId).renderer === "deal"
      ? "Deal view"
      : "Market view";
  }

  function configureCatalogCardReordering(cardNodes) {
    const { button } = cardNodes;
    button.addEventListener("pointerdown", (event) => {
      beginCatalogPointerReorder(event, cardNodes);
    });
    button.addEventListener(
      "touchmove",
      (event) => {
        if (
          catalogPointerDrag?.surface === button &&
          catalogPointerDrag.dragging
        ) {
          event.preventDefault();
        }
      },
      { passive: false },
    );
    button.addEventListener("keydown", (event) => {
      handleCatalogReorderKeydown(event, cardNodes);
    });
  }

  function beginCatalogPointerReorder(event, cardNodes) {
    if (
      !nodes.galleryGrid ||
      !event.isPrimary ||
      event.button !== 0 ||
      catalogPointerDrag
    ) {
      return;
    }
    finishCatalogReflowAnimations();
    const surface = event.currentTarget;
    const items = catalogDomItems();
    const itemRect = cardNodes.item.getBoundingClientRect();
    const drag = {
      ...cardNodes,
      surface,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      itemWidth: itemRect.width,
      itemHeight: itemRect.height,
      grabOffsetX: event.clientX - itemRect.left,
      grabOffsetY: event.clientY - itemRect.top,
      startGridScrollLeft: nodes.galleryGrid.scrollLeft,
      startGridScrollTop: nodes.galleryGrid.scrollTop,
      startWindowScrollX: window.scrollX,
      startWindowScrollY: window.scrollY,
      frame: 0,
      holdTimer: 0,
      held: false,
      movedBeforeHold: false,
      armed: event.pointerType !== "touch",
      dragging: false,
      items,
      slots: measureCatalogSlots(items),
      originIndex: items.indexOf(cardNodes.item),
      targetIndex: items.indexOf(cardNodes.item),
      dropTarget: null,
    };
    drag.move = (nextEvent) => updateCatalogPointerReorder(nextEvent, drag);
    drag.end = (nextEvent) => {
      if (nextEvent.pointerId === drag.pointerId) {
        drag.currentX = nextEvent.clientX;
        drag.currentY = nextEvent.clientY;
        finishCatalogPointerReorder(true);
      }
    };
    drag.cancel = (nextEvent) => {
      if (nextEvent.pointerId === drag.pointerId) {
        finishCatalogPointerReorder(false);
      }
    };
    catalogPointerDrag = drag;
    window.addEventListener("pointermove", drag.move, { passive: false });
    window.addEventListener("pointerup", drag.end, { capture: true });
    window.addEventListener("pointercancel", drag.cancel, { capture: true });
    surface.addEventListener("lostpointercapture", drag.cancel);
    if (drag.armed) {
      captureCatalogPointer(drag);
    } else {
      drag.holdTimer = window.setTimeout(() => {
        armCatalogPointerReorder(drag);
      }, 320);
    }
  }

  function armCatalogPointerReorder(drag) {
    if (catalogPointerDrag !== drag || drag.armed) return;
    drag.armed = true;
    drag.held = true;
    drag.holdTimer = 0;
    drag.item.dataset.reorderReady = "true";
    captureCatalogPointer(drag);
  }

  function captureCatalogPointer(drag) {
    try {
      drag.surface.setPointerCapture?.(drag.pointerId);
    } catch {
      // The existing listeners still cover a pointer that remains over the card.
    }
  }

  function updateCatalogPointerReorder(event, drag) {
    if (
      catalogPointerDrag !== drag ||
      event.pointerId !== drag.pointerId
    ) {
      return;
    }
    drag.currentX = event.clientX;
    drag.currentY = event.clientY;
    const distance = Math.hypot(
      drag.currentX - drag.startX,
      drag.currentY - drag.startY,
    );
    if (!drag.armed) {
      if (distance >= 8) {
        drag.movedBeforeHold = true;
        finishCatalogPointerReorder(false);
      }
      return;
    }
    if (!drag.dragging) {
      if (distance < 8) return;
      drag.dragging = true;
      drag.item.removeAttribute("data-reorder-ready");
      drag.item.dataset.dragging = "true";
      nodes.galleryGrid.dataset.reordering = "true";
      document.documentElement.dataset.catalogReordering = "true";
    }
    event.preventDefault();
    scheduleCatalogDragFrame(drag);
  }

  function scheduleCatalogDragFrame(drag) {
    if (drag.frame || catalogPointerDrag !== drag) return;
    drag.frame = window.requestAnimationFrame(() => {
      drag.frame = 0;
      renderCatalogPointerDrag(drag, true);
    });
  }

  function renderCatalogPointerDrag(drag, allowAutoScroll) {
    if (!drag.dragging) return;
    applyCatalogDragPosition(drag);
    const scrolled = allowAutoScroll && autoScrollCatalogDrag(drag);
    if (scrolled) applyCatalogDragPosition(drag);
    updateCatalogDropTarget(drag);
    if (scrolled) scheduleCatalogDragFrame(drag);
  }

  function applyCatalogDragPosition(drag) {
    const x =
      drag.currentX - drag.startX +
      nodes.galleryGrid.scrollLeft - drag.startGridScrollLeft +
      window.scrollX - drag.startWindowScrollX;
    const y =
      drag.currentY - drag.startY +
      nodes.galleryGrid.scrollTop - drag.startGridScrollTop +
      window.scrollY - drag.startWindowScrollY;
    drag.item.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    drag.item.style.willChange = "transform";
  }

  function autoScrollCatalogDrag(drag) {
    const grid = nodes.galleryGrid;
    const gridRect = grid.getBoundingClientRect();
    const beforeGridLeft = grid.scrollLeft;
    const beforeGridTop = grid.scrollTop;
    const beforeWindowX = window.scrollX;
    const beforeWindowY = window.scrollY;
    if (grid.scrollWidth > grid.clientWidth) {
      if (drag.currentX < gridRect.left + 40) grid.scrollLeft -= 12;
      else if (drag.currentX > gridRect.right - 40) grid.scrollLeft += 12;
    }
    if (drag.currentY < 40) window.scrollBy(0, -12);
    else if (drag.currentY > window.innerHeight - 40) window.scrollBy(0, 12);
    return (
      grid.scrollLeft !== beforeGridLeft ||
      grid.scrollTop !== beforeGridTop ||
      window.scrollX !== beforeWindowX ||
      window.scrollY !== beforeWindowY
    );
  }

  function updateCatalogDropTarget(drag) {
    if (!drag.slots.length) return;
    const gridRect = nodes.galleryGrid.getBoundingClientRect();
    const centerX =
      drag.currentX - drag.grabOffsetX + drag.itemWidth / 2 -
      gridRect.left + nodes.galleryGrid.scrollLeft;
    const centerY =
      drag.currentY - drag.grabOffsetY + drag.itemHeight / 2 -
      gridRect.top + nodes.galleryGrid.scrollTop;
    const distances = drag.slots.map((slot) =>
      Math.hypot(centerX - slot.centerX, centerY - slot.centerY),
    );
    let nearestIndex = 0;
    for (let index = 1; index < distances.length; index += 1) {
      if (distances[index] < distances[nearestIndex]) nearestIndex = index;
    }
    const currentDistance = distances[drag.targetIndex];
    const nearestDistance = distances[nearestIndex];
    if (
      nearestIndex !== drag.targetIndex &&
      nearestDistance + 14 >= currentDistance
    ) {
      return;
    }
    if (nearestIndex === drag.targetIndex) return;
    drag.targetIndex = nearestIndex;
    setCatalogDropTarget(drag);
  }

  function setCatalogDropTarget(drag) {
    drag.dropTarget?.removeAttribute("data-drop-target");
    drag.dropTarget =
      drag.targetIndex === drag.originIndex
        ? null
        : drag.items[drag.targetIndex] || null;
    drag.dropTarget?.setAttribute("data-drop-target", "true");
  }

  function moveCatalogItemToIndex(item, requestedIndex) {
    const items = catalogDomItems();
    const currentIndex = items.indexOf(item);
    if (currentIndex < 0) return false;
    const remaining = items.filter((candidate) => candidate !== item);
    const nextIndex = Math.max(0, Math.min(remaining.length, requestedIndex));
    const reordered = [...remaining];
    reordered.splice(nextIndex, 0, item);
    if (reordered.every((candidate, index) => candidate === items[index])) {
      return false;
    }

    const beforeRects = measureCatalogItems(items);
    moveCatalogItemInDom(item, nextIndex);
    animateCatalogReflow(beforeRects);
    syncCatalogCardPositions();
    return true;
  }

  function moveCatalogItemInDom(item, requestedIndex) {
    const items = catalogDomItems();
    const currentIndex = items.indexOf(item);
    if (currentIndex < 0) return false;
    const remaining = items.filter((candidate) => candidate !== item);
    const nextIndex = Math.max(0, Math.min(remaining.length, requestedIndex));
    if (nextIndex === currentIndex) return false;
    nodes.galleryGrid.insertBefore(item, remaining[nextIndex] || null);
    return true;
  }

  function finishCatalogPointerReorder(commit) {
    const drag = catalogPointerDrag;
    if (!drag) return;
    if (drag.frame) {
      window.cancelAnimationFrame(drag.frame);
      drag.frame = 0;
    }
    if (drag.dragging) renderCatalogPointerDrag(drag, false);
    catalogPointerDrag = null;
    if (drag.holdTimer) window.clearTimeout(drag.holdTimer);
    window.removeEventListener("pointermove", drag.move);
    window.removeEventListener("pointerup", drag.end, { capture: true });
    window.removeEventListener("pointercancel", drag.cancel, { capture: true });
    drag.surface.removeEventListener("lostpointercapture", drag.cancel);
    if (drag.surface.hasPointerCapture?.(drag.pointerId)) {
      drag.surface.releasePointerCapture(drag.pointerId);
    }
    drag.item.removeAttribute("data-reorder-ready");
    if (!drag.dragging) {
      if (drag.held || drag.movedBeforeHold) {
        suppressCatalogPointerClick(drag.entry.key);
      }
      return;
    }

    const beforeRects = measureCatalogItems();
    drag.dropTarget?.removeAttribute("data-drop-target");
    drag.item.removeAttribute("data-dragging");
    nodes.galleryGrid.removeAttribute("data-reordering");
    document.documentElement.removeAttribute("data-catalog-reordering");
    drag.item.style.removeProperty("transform");
    drag.item.style.removeProperty("will-change");

    if (commit) {
      const changed = moveCatalogItemInDom(drag.item, drag.targetIndex);
      if (changed) {
        persistCatalogDomOrder();
        announceCatalogPosition(drag.entry, drag.item, "moved");
      }
    } else {
      announceWorkspace("Catalog move cancelled");
    }
    animateCatalogReflow(beforeRects);
    suppressCatalogPointerClick(drag.entry.key);
    syncCatalogCardPositions();
  }

  function suppressCatalogPointerClick(key) {
    suppressedCatalogClickKey = key;
    window.setTimeout(() => {
      if (suppressedCatalogClickKey === key) {
        suppressedCatalogClickKey = null;
      }
    }, 0);
  }

  function handleCatalogReorderKeydown(event, cardNodes) {
    if (
      !event.altKey ||
      ![
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
      ].includes(event.key)
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const items = catalogDomItems();
    const currentIndex = items.indexOf(cardNodes.item);
    const columns = catalogGridColumnCount();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : currentIndex + (
              event.key === "ArrowLeft"
                ? -1
                : event.key === "ArrowRight"
                  ? 1
                  : event.key === "ArrowUp"
                    ? -columns
                    : columns
            );
    if (moveCatalogItemToIndex(cardNodes.item, nextIndex)) {
      persistCatalogDomOrder();
      cardNodes.button.focus({ preventScroll: true });
      announceCatalogPosition(cardNodes.entry, cardNodes.item, "moved to");
    }
  }

  function cancelCatalogReorder() {
    if (catalogPointerDrag) finishCatalogPointerReorder(false);
  }

  function catalogDomItems() {
    return nodes.galleryGrid
      ? Array.from(nodes.galleryGrid.children).filter((item) =>
          item.classList.contains("desk-gallery-item"),
        )
      : [];
  }

  function catalogDomKeys() {
    return catalogDomItems().map((item) => item.dataset.catalogId);
  }

  function persistCatalogDomOrder() {
    const keys = catalogDomKeys();
    const collection = currentCatalogCollection();
    if (collection.system) {
      state.catalogOrder = saveCatalogOrder(keys);
    } else {
      try {
        state.catalogCollections = replaceCatalogCollectionKeys(
          collection.id,
          keys,
        );
      } catch (error) {
        console.error("Catalog order save failed", error);
        announceWorkspace("Could not save this order");
      }
    }
    syncCatalogCardMapOrder();
    syncCatalogCollectionControls();
  }

  function syncCatalogCardMapOrder() {
    const orderedCards = catalogDomKeys()
      .map((key) => [key, catalogCards.get(key)])
      .filter(([, card]) => card);
    catalogCards.clear();
    for (const [key, card] of orderedCards) catalogCards.set(key, card);
  }

  function measureCatalogSlots(items = catalogDomItems()) {
    return items.map((item) => ({
      centerX: item.offsetLeft + item.offsetWidth / 2,
      centerY: item.offsetTop + item.offsetHeight / 2,
    }));
  }

  function measureCatalogItems(items = catalogDomItems()) {
    return new Map(items.map((item) => [item, item.getBoundingClientRect()]));
  }

  function finishCatalogReflowAnimations() {
    for (const animation of catalogReflowAnimations.values()) {
      try {
        animation.finish();
      } catch {
        animation.cancel();
      }
    }
    catalogReflowAnimations.clear();
  }

  function animateCatalogReflow(beforeRects) {
    if (reducedMotion) return;
    for (const item of catalogDomItems()) {
      if (!beforeRects.has(item)) continue;
      catalogReflowAnimations.get(item)?.cancel();
      const before = beforeRects.get(item);
      const after = item.getBoundingClientRect();
      const x = before.left - after.left;
      const y = before.top - after.top;
      if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) continue;
      const animation = item.animate(
        [
          { transform: `translate3d(${x}px, ${y}px, 0)` },
          { transform: "translate3d(0, 0, 0)" },
        ],
        {
          duration: 280,
          easing: "cubic-bezier(0.32, 0.72, 0, 1)",
        },
      );
      catalogReflowAnimations.set(item, animation);
      const cleanUp = () => {
        if (catalogReflowAnimations.get(item) === animation) {
          catalogReflowAnimations.delete(item);
        }
      };
      animation.addEventListener("finish", cleanUp, { once: true });
      animation.addEventListener("cancel", cleanUp, { once: true });
    }
  }

  function catalogGridColumnCount() {
    const styles = window.getComputedStyle(nodes.galleryGrid);
    if (styles.gridAutoFlow.includes("column")) return 1;
    const columns = styles.gridTemplateColumns.trim().split(/\s+/).length;
    return Math.max(1, columns);
  }

  function syncCatalogCardPositions() {
    const items = catalogDomItems();
    const total = items.length;
    items.forEach((item, index) => {
      const card = catalogCards.get(item.dataset.catalogId);
      if (!card) return;
      item.setAttribute("aria-posinset", String(index + 1));
      item.setAttribute("aria-setsize", String(total));
      card.button.setAttribute(
        "aria-keyshortcuts",
        "Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown Alt+Home Alt+End",
      );
      card.button.setAttribute("aria-describedby", "desk-catalog-reorder-help");
    });
  }

  function announceCatalogPosition(entry, item, action) {
    const position = catalogDomItems().indexOf(item) + 1;
    const total = catalogDomItems().length;
    announceWorkspace(
      `${catalogEntryTitle(entry)} ${action} ${position} of ${total}`,
    );
  }

  function sameCatalogOrder(left, right) {
    return left.length === right.length &&
      left.every((key, index) => key === right[index]);
  }

  function savedCatalogKey(entryCardId, id) {
    return `saved-${entryCardId}-${id}`;
  }

  function presetCatalogKey(entryCardId, family) {
    return `preset-${entryCardId}-${family.toLowerCase()}`;
  }

  function activeCatalogKey() {
    if (state.craftDraft && !state.craftDraft.activeCatalogId) return null;
    return state.activeCatalogId
      ? savedCatalogKey(cardId, state.activeCatalogId)
      : presetCatalogKey(cardId, activePresetId());
  }

  function activePresetId() {
    const presets = cardDefinition.catalogPresets || [];
    const selectedPreset = presets.find(
      (preset) => preset.state?.gpu === state.selected,
    );
    return selectedPreset?.id || presets[0]?.id || state.selected;
  }

  function syncLayout(animateChange) {
    for (const [name, panel] of nodes.layoutPanels) {
      const isCurrent = name === state.layout;
      panel.hidden = !isCurrent;
      panel.toggleAttribute("inert", !isCurrent);
    }
    root.dataset.workspaceLayout = state.layout;
    root.dataset.workspaceMode = state.panel;
    root.dataset.workspaceView = state.layout === "all" ? "gallery" : state.mode;
    root.dataset.workspaceSurface = state.mode;
    document.documentElement.dataset.deskLayout = state.layout;
    document.documentElement.dataset.deskView = state.mode;

    if (nodes.cardRail) {
      const showRail =
        !isDealCard && state.layout === "focus" && state.panel === "share";
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
        Array.from(catalogCards.values()).forEach(({ item }, index) => {
          animate(
            item,
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

  function catalogDestinationLayout() {
    return mobileViewport.matches ||
      state.layout === "all" ||
      state.catalogCollections.collections.length > 0 ||
      state.activeCatalogId ||
      state.craftDirty ||
      state.craftDraft
      ? "all"
      : "focus";
  }

  function syncModeActions(animateChange) {
    const label = workspaceLabel();
    const catalogCollection = currentCatalogCollection();
    const catalogCount = entriesForCatalogCollection(
      catalogEntriesAll(),
      catalogCollection,
    ).length;
    if (nodes.catalogSwitcherName) {
      nodes.catalogSwitcherName.textContent = state.mode === "catalog"
        ? catalogCollection.system
          ? "All"
          : catalogCollection.name
        : "Catalog";
    }
    for (const button of nodes.modeButtons) {
      const mode = button.dataset.deskMode;
      const active = mode === state.mode;
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
      button.disabled =
        !state.shareReady || (mode === "monitor" && state.craftEmpty);
      if (mode === "catalog") {
        const switchesCatalog = active && state.layout === "all";
        if (switchesCatalog) {
          button.setAttribute("aria-controls", "desk-catalog-listbox");
          button.setAttribute("aria-haspopup", "listbox");
          button.setAttribute("aria-expanded", String(state.catalogMenuOpen));
        } else {
          button.setAttribute(
            "aria-controls",
            catalogDestinationLayout() === "all"
              ? "desk-card-gallery"
              : "desk-card-focus",
          );
          button.removeAttribute("aria-haspopup");
          button.removeAttribute("aria-expanded");
        }
      }
      button.setAttribute(
        "aria-label",
        mode === "catalog"
          ? state.mode === "catalog" && state.layout === "all"
            ? `Switch Catalog, ${catalogCollection.name}, ${catalogCount} ${catalogCount === 1 ? "view" : "views"}`
            : `Open ${catalogCollection.name} in Catalog`
          : mode === "monitor"
            ? `Monitor ${label}`
            : state.mode === "catalog" && state.craftDraft
              ? "Resume draft in Craft"
              : state.mode === "catalog" && !state.craftDirty
                ? "Start a new composition in Craft"
                : `Edit ${label} in Craft`,
      );
    }
    if (nodes.galleryToggle) {
      nodes.galleryToggle.disabled = !state.shareReady;
    }
    const activeButton = nodes.modeButtons.find(
      (button) => button.dataset.deskMode === state.mode,
    );
    if (activeButton && animateChange && !reducedMotion) {
      animate(
        activeButton,
        {
          opacity: [0.68, 1],
        },
        { duration: 0.18, ease: [0.23, 1, 0.32, 1] },
      );
    }
  }

  async function loadCards() {
    if (!cardDefinition.dataUrl) {
      showFailure("Market data could not load.");
      signalReady();
      return;
    }

    try {
      const manifest = await loadDataManifest();
      const requests = new Map();
      for (const definition of CARD_REGISTRY) {
        const sourceId = definition.sourceCardId || definition.id;
        const source = getCardDefinition(sourceId);
        if (!source.dataUrl) continue;
        const dataUrl = new URL(source.dataUrl, window.location.href);
        const manifestRevision = manifest?.cards?.[sourceId]?.revision;
        if (manifestRevision) dataUrl.searchParams.set("v", manifestRevision);
        const requestUrl = dataUrl.toString();
        if (requests.has(requestUrl)) continue;
        requests.set(requestUrl, { sourceId, source, manifestRevision });
      }
      const settled = await Promise.allSettled(
        Array.from(requests, async ([url, request]) => {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`${response.status} ${url}`);
          const payload = await response.json();
          validateRuntimePayload(payload, request.source, url);
          if (
            request.manifestRevision &&
            payload.revision !== request.manifestRevision
          ) {
            throw new Error(`Revision mismatch at ${url}`);
          }
          return [request.sourceId, payload];
        }),
      );
      const results = settled
        .filter((result) => result.status === "fulfilled")
        .map((result) => result.value);
      settled
        .filter((result) => result.status === "rejected")
        .forEach((result) => console.warn("Auxiliary card data unavailable", result.reason));
      state.runtimePayloads = new Map(results);
      const sourceId = cardDefinition.sourceCardId || cardDefinition.id;
      const payload = state.runtimePayloads.get(sourceId);
      if (!payload) throw new Error(`Missing ${sourceId} market data`);
      state.runtimePayload = payload;
      state.dataRevision = payload.revision;

      const gpuPayload = state.runtimePayloads.get("gpu-index");
      const gpuDefinition = getCardDefinition("gpu-index");
      state.seriesByLayer = new Map(
        gpuDefinition.layers
          .map((layer) => [
            layer.id,
            normalizeRuntimeSeries(gpuPayload?.series?.[layer.id], layer.id),
          ])
          .filter(([, rows]) => rows.length),
      );
      root.dataset.cardDataVersion = String(payload.version);
      if (
        cardDefinition.renderer === "line" &&
        !state.seriesByLayer.has(state.selected)
      ) {
        throw new Error(`Missing ${state.selected} data`);
      }
      setShareReady(true);
      updateFamilyQuoteNodes();
      syncMobileSummary();
      render(true);
      if (state.mode === "craft" && state.craftEmpty) {
        setCompareOpen(true);
      }
    } catch (error) {
      setShareReady(false);
      console.error("Desk market data failed to load", error);
      showFailure("Market data is temporarily unavailable.");
    } finally {
      signalReady();
    }
  }

  async function loadDataManifest() {
    try {
      const response = await fetch("./data/manifest.json", { cache: "no-store" });
      if (!response.ok) return null;
      const manifest = await response.json();
      return manifest?.version === 1 && manifest.cards ? manifest : null;
    } catch {
      return null;
    }
  }

  function validateRuntimePayload(payload, definition, url) {
    if (
      !Number.isInteger(payload?.version) ||
      typeof payload.revision !== "string" ||
      !payload.revision.trim()
    ) {
      throw new Error(`Unsupported card data at ${url}`);
    }
    if (definition.renderer === "deal") {
      if (
        payload.cardId !== definition.id ||
        payload.id !== "041" ||
        !Array.isArray(payload.stages) ||
        payload.stages.length !== 3
      ) {
        throw new Error(`Unsupported deal data at ${url}`);
      }
      return;
    }
    if (definition.renderer === "cumulative-depth") {
      if (!Array.isArray(payload.priceLevels) || !Array.isArray(payload.snapshots)) {
        throw new Error(`Unsupported market depth data at ${url}`);
      }
      return;
    }
    if (!payload.series || typeof payload.series !== "object") {
      throw new Error(`Unsupported price data at ${url}`);
    }
  }

  function normalizeRuntimeSeries(points, layerId) {
    if (!Array.isArray(points)) return [];
    return points
      .map((point) => normalizeRuntimePoint(point, layerId))
      .filter(Boolean)
      .sort((left, right) => left.date - right.date);
  }

  function normalizeRuntimePoint(point, layerId) {
    const value = Number(point?.[1]);
    const date = new Date(Number(point?.[0]) * 1000);
    if (!Number.isFinite(value) || Number.isNaN(date.getTime())) return null;
    const lower = Number(point?.[2]);
    const upper = Number(point?.[3]);
    return {
      layerId,
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
    keyboardMode = "horizontal",
  ) {
    buttons.forEach((button, index) => {
      button.addEventListener("click", (event) => {
        selectValue(getValue(button), event);
      });
      if (keyboardMode === "buttons") {
        button.dataset.stateAttribute = stateAttribute;
        return;
      }
      button.addEventListener("keydown", (event) => {
        const arrowKeys = keyboardMode === "radio"
          ? ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]
          : ["ArrowLeft", "ArrowRight"];
        if (![...arrowKeys, "Home", "End"].includes(event.key)) {
          return;
        }
        event.preventDefault();
        const direction = ["ArrowRight", "ArrowDown"].includes(event.key)
          ? 1
          : -1;
        const nextIndex =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (index + direction + buttons.length) % buttons.length;
        buttons[nextIndex].focus();
        selectValue(getValue(buttons[nextIndex]), event);
      });
      button.dataset.stateAttribute = stateAttribute;
    });
  }

  function handleCardRailKeydown(event) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = [
      ...nodes.familyButtons,
      ...nodes.cardPresetButtons,
    ].filter((button) => button && !button.disabled);
    const current = tabs.indexOf(event.target);
    if (current < 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
            tabs.length;
    tabs[nextIndex].focus({ preventScroll: true });
    tabs[nextIndex].click();
    window.requestAnimationFrame(() => revealCardRailTab(tabs[nextIndex]));
  }

  function handleMobileViewportChange(event) {
    syncModeActions(false);
    if (
      event.matches &&
      state.mode === "catalog" &&
      state.layout === "focus"
    ) {
      showPanel("share", true, "all", false, "catalog");
    }
  }

  function revealCardRailTab(button) {
    if (!mobileViewport.matches || !button) return;
    const scroller = button.closest(".desk-card-tabs");
    if (!scroller) return;
    const tabStart = button.offsetLeft;
    const tabEnd = tabStart + button.offsetWidth;
    const visibleStart = scroller.scrollLeft;
    const visibleEnd = visibleStart + scroller.clientWidth;
    if (tabStart < visibleStart) {
      scroller.scrollTo({ left: tabStart, behavior: "auto" });
    } else if (tabEnd > visibleEnd) {
      scroller.scrollTo({ left: tabEnd - scroller.clientWidth, behavior: "auto" });
    }
  }

  function selectCardTab(family, event) {
    if (!railFamilies.includes(family)) return;
    if (cardId !== "gpu-index") {
      openCardPreset("gpu-index", "card", event?.detail === 0, {
        gpu: family,
        layers: family,
        scale: "price",
      });
      return;
    }
    openPublishedCard(family, event?.detail === 0);
  }

  function openCardPreset(
    nextCardId,
    view = "card",
    moveFocus = false,
    stateOverrides = {},
  ) {
    const nextCard = getCardDefinition(nextCardId);
    if (nextCard.id === cardId) {
      preserveCraftDraft();
      applyCardState({
        ...nextCard.defaults,
        palette: currentPalette(),
        theme: currentTheme(),
        ...stateOverrides,
      });
      syncControls();
      showPanel("share", true, "focus", moveFocus, "catalog");
      return;
    }

    preserveCraftDraft();
    const nextState = normalizeCardState(nextCard.id, {
      ...nextCard.defaults,
      palette: currentPalette(),
      theme: currentTheme(),
      ...stateOverrides,
    });
    persistCatalogScrollPosition();
    window.location.assign(cardUrl(nextCard.id, view, nextState));
  }

  async function openPublishedCard(family, moveFocus) {
    if (!railFamilies.includes(family)) return;
    preserveCraftDraft();
    applyCardState(publishedCardState(family));
    syncControls();
    if (state.panel === "share" && state.layout === "focus") {
      render(true);
      updateLocation();
      if (moveFocus) {
        nodes.familyButtons
          .find((button) => button.dataset.gpuFamily === state.selected)
          ?.focus({ preventScroll: true });
      }
      announceWorkspaceView();
      return;
    }
    await showPanel("share", true, "focus", moveFocus, "catalog");
  }

  async function monitorCatalogEntry(entry, focusNavigation) {
    if (!entry) return;
    preserveCraftDraft();
    const entryCard = getCardDefinition(entry.cardId || cardId);
    const entryState = catalogEntryOpenState(entry);
    if (entryCard.id !== cardId) {
      const url = cardUrl(entryCard.id, "monitor", entryState);
      if (entry.kind === "saved") url.searchParams.set("item", entry.item.id);
      persistCatalogScrollPosition();
      window.location.assign(url);
      return;
    }
    const alreadyMonitoring =
      state.mode === "monitor" &&
      state.panel === "detail" &&
      state.layout === "focus";
    if (entry.kind === "saved") {
      applyCardState(entry.item.state, {
        catalogId: entry.item.id,
        catalogName: entry.item.name,
      });
    } else if (entry.state) {
      applyCardState(entryState);
    } else if (families.includes(entry.family)) {
      applyCardState(publishedCardState(entry.family));
    } else {
      return;
    }
    syncControls();
    if (alreadyMonitoring) {
      render(true);
      updateLocation();
      announceWorkspaceView();
      if (focusNavigation) {
        nodes.modeButtons
          .find((button) => button.dataset.deskMode === "monitor")
          ?.focus({ preventScroll: true });
      }
      return;
    }
    await switchWorkspaceMode("monitor", focusNavigation);
  }

  function publishedCardState(family) {
    return normalizeCardState(cardId, {
      ...currentCardState(),
      gpu: family,
      layers: family,
      scale: "price",
    });
  }

  function catalogEntryState(entry) {
    if (entry.kind === "saved") return entry.item.state;
    const entryCard = getCardDefinition(entry.cardId || cardId);
    return normalizeCardState(entryCard.id, entry.state);
  }

  function catalogEntryDisplayState(entry) {
    const authoredState = catalogEntryState(entry);
    if (state.catalogColorMode === "card-colors") return authoredState;
    return {
      ...authoredState,
      palette: currentPalette(),
      theme: currentTheme(),
    };
  }

  function catalogEntryOpenState(entry) {
    return entry.kind === "saved"
      ? catalogEntryState(entry)
      : catalogEntryDisplayState(entry);
  }

  function applyCardState(
    nextState,
    { catalogId = null, catalogName = "" } = {},
  ) {
    const next = applyCompositionFields(nextState);
    state.activeCatalogId = catalogId;
    state.catalogName = catalogName;
    state.craftEmpty = false;
    state.craftDirty = false;
    state.craftBaseline = compositionKey(cardId, next);
    state.zoomWindow = null;
    setCompareOpen(false);
    setDepthCraftMenu(null);
  }

  function applyCompositionFields(nextState) {
    const next = normalizeCardState(cardId, nextState);
    state.selected = next.gpu;
    state.layers = new Set(next.layers);
    state.scale = next.scale;
    state.range = next.range;
    state.options = Object.fromEntries(
      (cardDefinition.stateOptions || []).map((option) => [
        option.id,
        next[option.id],
      ]),
    );
    document.documentElement.dataset.palette = next.palette;
    document.documentElement.dataset.theme = next.theme;
    syncAppearanceControls();
    return next;
  }

  function selectRange(range) {
    if (Date.now() < state.controlsReadyAt) return;
    if (isBarCard || isDealCard) return;
    if (state.mode === "craft" && state.craftEmpty) return;
    if (
      !ranges[range] ||
      !cardDefinition.ranges?.includes(range) ||
      range === state.range
    ) {
      return;
    }
    if (state.mode === "craft") {
      mutateComposition({ ...currentCardState(), range });
      return;
    }
    state.range = range;
    state.zoomWindow = null;
    syncControls();
    render(true);
    updateLocation();
  }

  function toggleLayer(layerId) {
    if (state.mode !== "craft" || state.craftEmpty) return;
    const layer = getLayerDefinition(cardDefinition, layerId);
    if (!layer) return;
    if (layerId === state.selected) {
      announceCard(`${layer.label} is the main series`);
      return;
    }
    const adding = !state.layers.has(layerId);
    const previousScale = state.scale;
    const next = toggleCompositionLayer(cardId, currentCardState(), layerId);
    mutateComposition(next, {
      message:
        adding && previousScale !== next.scale
          ? `${layer.label} added, view changed to Index`
          : `${layer.label} ${adding ? "added" : "removed"}`,
    });
  }

  function announceCard(message) {
    if (!nodes.cardAnnounce) return;
    nodes.cardAnnounce.textContent = "";
    window.requestAnimationFrame(() => {
      nodes.cardAnnounce.textContent = message;
    });
  }

  function syncControls() {
    const activeFamilyButton = nodes.familyButtons.find(
      (button) => button.dataset.gpuFamily === state.selected,
    );
    const activePresetButton = nodes.cardPresetButtons.find(
      (button) => button.dataset.cardPreset === cardId,
    );
    nodes.familyButtons.forEach((button) => {
      const selected =
        cardId === "gpu-index" &&
        state.layout === "focus" &&
        state.panel === "share" &&
        button === activeFamilyButton;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    nodes.cardPresetButtons.forEach((button) => {
      const selected =
        state.layout === "focus" &&
        state.panel === "share" &&
        button === activePresetButton;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    if (nodes.galleryToggle) nodes.galleryToggle.tabIndex = 0;
    const activeRailButton = cardDefinition.renderer === "line"
      ? activeFamilyButton
      : activePresetButton;
    if (
      state.layout === "focus" &&
      state.panel === "share" &&
      activeRailButton
    ) {
      window.requestAnimationFrame(() => revealCardRailTab(activeRailButton));
    }
    if (nodes.focusPanel) {
      const labelledBy = cardDefinition.renderer === "line"
        ? activeFamilyButton?.id
        : activePresetButton?.id;
      if (
        state.panel === "share" &&
        state.layout === "focus" &&
        labelledBy
      ) {
        nodes.focusPanel.setAttribute("role", "tabpanel");
        nodes.focusPanel.setAttribute("aria-labelledby", labelledBy);
        nodes.focusPanel.removeAttribute("aria-label");
        nodes.focusPanel.tabIndex = -1;
      } else {
        nodes.focusPanel.removeAttribute("role");
        nodes.focusPanel.removeAttribute("aria-label");
        nodes.focusPanel.removeAttribute("aria-labelledby");
        nodes.focusPanel.tabIndex = -1;
      }
    }
    nodes.rangeButtons.forEach((button) => {
      const selected = button.dataset.gpuRange === state.range;
      const unavailable =
        isBarCard || isDealCard || (state.mode === "craft" && state.craftEmpty);
      const supported = cardDefinition.ranges?.includes(button.dataset.gpuRange);
      button.hidden = !supported;
      if (supported) {
        button.textContent = rangeControlLabel(button.dataset.gpuRange);
        button.setAttribute(
          "aria-label",
          rangeControlAriaLabel(button.dataset.gpuRange),
        );
      }
      button.setAttribute("aria-pressed", String(selected));
      button.disabled = unavailable || !supported;
      button.tabIndex = unavailable || !supported ? -1 : 0;
    });
    if (nodes.rangeGroup) {
      nodes.rangeGroup.hidden = isDepthCard || isDealCard;
      nodes.rangeGroup.setAttribute(
        "aria-label",
        "History range",
      );
    }
    const depthViewAvailable =
      isDepthCard &&
      state.mode === "monitor" &&
      state.layout === "focus" &&
      state.panel === "detail" &&
      !(state.mode === "craft" && state.craftEmpty);
    if (nodes.depthView) nodes.depthView.hidden = !depthViewAvailable;
    nodes.depthViewButtons.forEach((button) => {
      const scale = button.dataset.depthScale;
      const selected = scale === state.scale;
      button.setAttribute("aria-pressed", String(selected));
      button.disabled = !state.shareReady || !depthViewAvailable;
      button.tabIndex = button.disabled ? -1 : 0;
      button.setAttribute("aria-label", `Show ${visualizationLabel(scale)} view`);
    });
    if (nodes.zoomReset) {
      nodes.zoomReset.hidden = state.craftEmpty || !state.zoomWindow;
    }
    if (nodes.workspaceTitle) {
      const titleMode = state.mode === "craft" ? "Craft" : "Monitor";
      const label = workspaceLabel();
      const rangeSuffix = isBarCard || isDealCard
        ? ""
        : isDepthCard
          ? state.scale === "history" && !/\bhistory\b/i.test(label)
            ? " history"
            : ""
          : ` ${rangeControlLabel(state.range)}`;
      nodes.workspaceTitle.textContent = state.mode === "craft" && state.craftEmpty
        ? "Craft new composition"
        : `${titleMode} ${label}${rangeSuffix}${state.craftDirty ? " edited" : ""}`;
    }
    syncMobileSummary();
    updateFamilyQuoteNodes();
    syncModeActions(false);
    syncComposerControls();
  }

  function syncMobileSummary() {
    if (isDealCard) {
      const payload = state.runtimePayload;
      if (nodes.mobileSummaryLabel) {
        nodes.mobileSummaryLabel.textContent = payload?.label || "Deal 041";
      }
      if (nodes.mobileSummaryValue) {
        const quantity = Number(state.options.quantity || payload?.quantity || 256);
        const model = state.options.gpu || payload?.asset || "B200";
        nodes.mobileSummaryValue.textContent = `${quantity} × ${model}`;
      }
      if (nodes.mobileSummaryRange) {
        const stage = String(state.options.stage || "diligence");
        nodes.mobileSummaryRange.textContent =
          stage.charAt(0).toUpperCase() + stage.slice(1);
      }
      return;
    }
    const summarySeries = !isBarCard && !isDepthCard && !state.craftEmpty
      ? createLayerSeries(state.selected, { scale: state.scale })
      : null;
    const summaryLatest = summarySeries?.rows.at(-1);
    if (nodes.mobileSummaryLabel) {
      const summaryLayer = getLayerDefinition(cardDefinition, state.selected);
      nodes.mobileSummaryLabel.textContent =
        summaryLayer?.shortLabel || summaryLayer?.label || state.selected;
    }
    if (nodes.mobileSummaryValue) {
      nodes.mobileSummaryValue.textContent = summaryLatest
        ? formatCardHeadline(summaryLatest.plotValue, state.scale)
        : "";
    }
    if (nodes.mobileSummaryRange) {
      nodes.mobileSummaryRange.textContent = rangeControlLabel(state.range);
    }
  }

  function syncDealCraftControls(editing, empty) {
    if (!nodes.dealCraft) return;
    const available = isDealCard && editing && !empty;
    nodes.dealCraft.hidden = !available;
    nodes.dealCraft.toggleAttribute("inert", !available);
    if (!available) return;
    syncDealCraftControlValue(nodes.dealCraftGpu, state.options.gpu);
    syncDealCraftControlValue(nodes.dealCraftQuantity, state.options.quantity);
    syncDealCraftControlValue(nodes.dealCraftQuote, state.options.quote);
    syncDealCraftControlValue(nodes.dealCraftRfs, state.options.rfs);
  }

  function syncDealCraftControlValue(control, value) {
    if (!control || document.activeElement === control) return;
    control.value = String(value ?? "");
  }

  function syncComposerControls() {
    const editing = state.mode === "craft";
    const empty = editing && state.craftEmpty;
    if (nodes.composer) {
      const available = editing;
      nodes.composer.hidden = !available;
      nodes.composer.toggleAttribute("inert", !available);
    }
    syncDealCraftControls(editing, empty);
    syncDepthCraftControls(editing, empty);
    if (nodes.compareToggle) nodes.compareToggle.hidden = isDepthCard || isDealCard;
    if (nodes.comparePanel && (isDepthCard || isDealCard)) {
      nodes.comparePanel.hidden = true;
      nodes.comparePanel.setAttribute("inert", "");
    }
    if (nodes.primaryGroup) {
      nodes.primaryGroup.setAttribute("aria-required", String(empty));
    }
    if (nodes.primaryLabel) nodes.primaryLabel.textContent = isBarCard ? "Highlight" : "Main";
    if (nodes.layerLabel) nodes.layerLabel.textContent = isBarCard ? "Bars" : "Compare";
    if (nodes.primaryRow) nodes.primaryRow.hidden = isDepthCard;
    if (nodes.layerRow) {
      nodes.layerRow.hidden = cardDefinition.allowComparisons === false;
    }
    if (nodes.scaleControl) {
      nodes.scaleControl.hidden =
        isDepthCard || cardDefinition.visualizations.length < 2;
    }
    nodes.primaryGroup?.setAttribute(
      "aria-label",
      isBarCard ? "Highlighted bar" : "Main data",
    );
    nodes.layerGroup?.setAttribute(
      "aria-label",
      isBarCard ? "Visible bars" : "Comparison data",
    );
    nodes.primaryButtons.forEach((button, index) => {
      const selected = !empty && button.dataset.cardPrimary === state.selected;
      button.setAttribute("aria-checked", String(selected));
      button.tabIndex = selected || (empty && index === 0) ? 0 : -1;
      button.disabled = !state.shareReady;
      button.setAttribute(
        "aria-label",
        selected
          ? `${button.dataset.cardPrimary} ${isBarCard ? "highlighted bar" : "main series"}`
          : `Use ${button.dataset.cardPrimary} as ${isBarCard ? "the highlighted bar" : "main series"}`,
      );
    });
    nodes.layerButtons.forEach((button) => {
      const selected = !empty && state.layers.has(button.dataset.cardLayer);
      const layer = getLayerDefinition(cardDefinition, button.dataset.cardLayer);
      const primary = !empty && button.dataset.cardLayer === state.selected;
      button.hidden = primary;
      button.setAttribute("aria-pressed", String(selected));
      button.dataset.primary = String(primary);
      button.disabled = !state.shareReady || empty || primary;
      button.setAttribute(
        "aria-label",
        primary
          ? `${layer.label} is ${isBarCard ? "highlighted" : "the main series"}`
          : selected
            ? `Remove ${layer.label} ${isBarCard ? "bar" : "comparison"}`
            : `Add ${layer.label} ${isBarCard ? "bar" : "comparison"}`,
      );
    });
    nodes.scaleButtons.forEach((button) => {
      const selected = !empty && button.dataset.cardScale === state.scale;
      button.setAttribute("aria-pressed", String(selected));
      button.disabled = !state.shareReady || empty;
      button.tabIndex = button.disabled ? -1 : 0;
      button.setAttribute(
        "aria-label",
        `Use ${visualizationLabel(button.dataset.cardScale)} chart mode`,
      );
    });
    nodes.depthCraftViewButtons.forEach((button) => {
      const selected = !empty && button.dataset.depthCraftScale === state.scale;
      button.setAttribute("aria-pressed", String(selected));
      button.disabled = !state.shareReady || empty;
      button.setAttribute(
        "aria-label",
        `Use ${visualizationLabel(button.dataset.depthCraftScale)} view`,
      );
    });
    const dataCount = empty ? 0 : state.layers.size;
    const comparisonCount = Math.max(0, dataCount - 1);
    if (nodes.dataLabel) {
      nodes.dataLabel.textContent = isDepthCard
        ? "Target"
        : empty
          ? "Add data"
          : "Data";
    }
    if (nodes.compareCount) {
      nodes.compareCount.textContent = isDepthCard
        ? String(state.options.target)
        : String(dataCount);
      nodes.compareCount.hidden = empty || (!isDepthCard && dataCount === 0);
    }
    if (nodes.compareToggle) {
      nodes.compareToggle.setAttribute("aria-expanded", String(state.compareOpen));
      nodes.compareToggle.disabled = !state.shareReady;
      nodes.compareToggle.setAttribute(
        "aria-label",
        isDepthCard
          ? `Target, ${state.options.target} nodes`
          : empty
          ? "Add data"
          : isBarCard
            ? `Data, ${dataCount} bar${dataCount === 1 ? "" : "s"}, ${state.selected} highlighted`
            : `Data, ${state.selected} main series, ${comparisonCount} comparison${comparisonCount === 1 ? "" : "s"}`,
      );
    }
    const hasSelectedOption = Array.from(nodes.optionButtons).some(
      (button) =>
        state.options[button.dataset.cardOption] ===
        button.dataset.cardOptionValue,
    );
    nodes.optionButtons.forEach((button, index) => {
      const selected =
        state.options[button.dataset.cardOption] ===
        button.dataset.cardOptionValue;
      button.setAttribute("aria-checked", String(selected));
      button.tabIndex = selected || (!hasSelectedOption && index === 0) ? 0 : -1;
      button.disabled = !state.shareReady || empty;
    });
    if (nodes.saveButton) {
      const savedAndCurrent = Boolean(state.activeCatalogId) && !state.craftDirty;
      nodes.saveButton.disabled = !state.shareReady || empty || savedAndCurrent;
      nodes.saveButton.textContent = state.activeCatalogId
        ? state.craftDirty
          ? "Update"
          : "Saved"
        : "Save";
      nodes.saveButton.setAttribute(
        "aria-label",
        state.activeCatalogId
          ? state.craftDirty
            ? `Update ${workspaceLabel()}`
            : `${workspaceLabel()} is saved`
          : "Save to Catalog",
      );
    }
    if (nodes.focusCardMonitor) {
      nodes.focusCardMonitor.disabled = !state.shareReady;
      nodes.focusCardMonitor.setAttribute(
        "aria-label",
        `Monitor ${workspaceLabel()}`,
      );
    }
    root.dataset.cardScale = state.scale;
    root.dataset.comparisonCount = String(comparisonCount);
    root.dataset.craftEmpty = String(empty);
    root.dataset.craftDirty = String(editing && state.craftDirty);
    if (nodes.craftEmpty) nodes.craftEmpty.hidden = !empty;
    if (nodes.svg) {
      const hideChartSvg = empty || isDealCard;
      nodes.svg.toggleAttribute("hidden", hideChartSvg);
      if (hideChartSvg) nodes.svg.setAttribute("aria-hidden", "true");
      else nodes.svg.removeAttribute("aria-hidden");
    }
    if (empty && nodes.tooltip) nodes.tooltip.hidden = true;
    if (empty && nodes.chartState) nodes.chartState.hidden = true;
    if (nodes.chartDescription && !empty && !isDealCard) {
      const labels = activeLayerDefinitions().map((layer) => layer.label).join(", ");
      nodes.svg?.setAttribute(
        "aria-label",
        isDepthCard
          ? `${cardDefinition.title}, ${visualizationLabel(state.scale)} chart mode, ${state.options.target} node target`
          : isBarCard
          ? `${labels} hourly price comparison`
          : state.scale === "index"
          ? `${labels} comparison index`
          : `${labels} price history`,
      );
      nodes.chartDescription.textContent =
        isDepthCard
          ? state.scale === "history"
            ? `${cardDefinition.title}. Color intensity shows available capacity by price through time. The solid path shows the executable price for the selected target.`
            : `${cardDefinition.title}. Shelf length shows where capacity becomes available. The benchmark and target meet at the executable price.`
          : isBarCard
          ? `${labels} latest hourly benchmark prices. Each wider band shows the middle range of quotes.`
          : state.scale === "index"
          ? `${labels} rebased to 100 at the start of the selected range.`
          : `${labels} hourly prices. The band shows the middle range of quotes for ${state.selected}.`;
    }
  }

  function syncDepthCraftControls(editing, empty) {
    if (!nodes.depthCraft) return;
    const available = isDepthCard && editing && !empty;
    nodes.depthCraft.hidden = !available;
    nodes.depthCraft.toggleAttribute("inert", !available);
    if (!available) {
      setDepthCraftMenu(null);
      return;
    }

    const instrument = state.runtimePayload?.instrument || {};
    const gpu = instrument.gpuLabel || instrument.gpu || "H100";
    const region = instrument.region || "US";
    const nodeGpuCount = Number(instrument.nodeGpuCount) || 8;
    const interconnect = instrument.interconnect || "InfiniBand";
    const network = interconnect.toLowerCase() === "infiniband"
      ? "IB"
      : interconnect;
    const termDays = Number(instrument.termDays) || 30;
    if (nodes.depthContractGpu) nodes.depthContractGpu.textContent = gpu;
    if (nodes.depthContractRegion) nodes.depthContractRegion.textContent = region;
    if (nodes.depthContractNode) {
      nodes.depthContractNode.textContent = `${nodeGpuCount} GPU`;
    }
    if (nodes.depthContractNetwork) {
      nodes.depthContractNetwork.textContent = network;
    }
    if (nodes.depthContractTerm) {
      nodes.depthContractTerm.textContent = `${termDays}D`;
    }
    nodes.depthContract?.setAttribute(
      "aria-label",
      `${gpu}, ${instrument.regionLabel || region}, ${nodeGpuCount} GPU node, ${interconnect}, ${termDays} day term`,
    );
    if (nodes.depthTargetLabel) {
      nodes.depthTargetLabel.textContent = `${state.options.target} nodes`;
    }
    if (nodes.depthViewLabel) {
      nodes.depthViewLabel.textContent = visualizationLabel(state.scale);
    }
    if (nodes.depthTargetTrigger) {
      nodes.depthTargetTrigger.disabled = !state.shareReady;
      nodes.depthTargetTrigger.setAttribute(
        "aria-label",
        `Target ${state.options.target} nodes`,
      );
    }
    if (nodes.depthViewTrigger) {
      nodes.depthViewTrigger.disabled = !state.shareReady;
      nodes.depthViewTrigger.setAttribute(
        "aria-label",
        `${visualizationLabel(state.scale)} view`,
      );
    }
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
    for (const family of railFamilies) {
      const latest = state.seriesByLayer.get(family)?.at(-1);
      const selectedIndex =
        family === state.selected && state.scale === "index"
          ? createLayerSeries(family, { scale: "index" })?.rows.at(-1)
          : null;
      const value = selectedIndex
        ? formatCardHeadline(selectedIndex.plotValue, "index")
        : latest
          ? formatUsd(latest.value)
          : "pending";
      const node = nodes.familyValues.get(family);
      if (node) {
        node.textContent = value;
        node.hidden = cardDefinition.renderer !== "line";
      }
      const button = nodes.familyButtons.find(
        (candidate) => candidate.dataset.gpuFamily === family,
      );
      button?.setAttribute(
        "aria-label",
        selectedIndex
          ? `${family} ${value} over ${ranges[state.range].label}`
          : latest
            ? `${family} ${value} per GPU hour`
            : `${family}, price pending`,
      );
    }
  }

  async function switchWorkspaceMode(mode, focusNavigation = false) {
    if (!["catalog", "monitor", "craft"].includes(mode)) return;
    if (mode === "monitor" && state.craftEmpty) {
      announceWorkspace("Choose a main series before opening Monitor");
      return;
    }
    if (mode === state.mode) {
      if (mode === "catalog" && state.layout !== "all") {
        await showPanel("share", true, "all", false, mode);
      }
      if (focusNavigation) {
        nodes.modeButtons
          .find((button) => button.dataset.deskMode === mode)
          ?.focus({ preventScroll: true });
      }
      return;
    }
    if (mode !== "craft") setDepthCraftMenu(null);
    if (mode === "catalog") {
      preserveCraftDraft();
      await showPanel(
        "share",
        true,
        catalogDestinationLayout(),
        false,
        mode,
      );
    } else {
      await showPanel("detail", true, "focus", false, mode);
    }
    if (focusNavigation) {
      nodes.modeButtons
        .find((button) => button.dataset.deskMode === mode)
        ?.focus({ preventScroll: true });
    }
  }

  async function showPanel(
    nextName,
    updateUrl,
    nextLayout = "focus",
    moveFocus = null,
    requestedMode = null,
  ) {
    const targetLayout =
      nextName === "share" &&
      (nextLayout === "all" || mobileViewport.matches)
        ? "all"
        : "focus";
    const targetMode =
      nextName === "share" || targetLayout === "all"
        ? "catalog"
        : requestedMode === "craft"
          ? "craft"
          : "monitor";
    const returnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const returnFocusWasVisible = returnFocus?.matches(":focus-visible") ?? false;
    const shouldMoveFocus = moveFocus ?? returnFocusWasVisible;
    if (state.transitionPending || !nodes.panels.has(nextName)) {
      return;
    }
    if (
      nextName === state.panel &&
      targetLayout === state.layout &&
      targetMode === state.mode
    ) {
      if (shouldMoveFocus) {
        viewFocusTarget(nextName, targetLayout)?.focus({ preventScroll: true });
      }
      return;
    }
    if (targetMode !== "catalog") setCatalogMenuOpen(false);
    if (
      mobileViewport.matches &&
      state.layout === "all" &&
      targetLayout !== "all"
    ) {
      state.catalogScrollY = window.scrollY;
    }
    if (targetMode !== "craft" && state.compareOpen) {
      setCompareOpen(false);
    }
    state.transitionPending = true;
    const previousLayout = nodes.layoutPanels.get(state.layout);
    const canMorph =
      !reducedMotion && typeof document.startViewTransition === "function";

    const commitPanelChange = (animateLayout) => {
      state.panel = nextName;
      state.layout = targetLayout;
      state.mode = targetMode;
      state.controlsReadyAt = 0;
      state.zoomWindow = null;
      syncFocusPanels();
      syncControls();
      syncLayout(animateLayout);
      render(false);
      syncModeActions(animateLayout);
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
          { duration: 0.2, ease: [0.23, 1, 0.32, 1] },
        );
        await exit.finished?.catch(() => {});
      }
      commitPanelChange(!reducedMotion);
    }

    state.transitionPending = false;
    root.dispatchEvent(
      new CustomEvent("compute-card:panel", {
        detail: { panel: nextName, layout: state.layout, mode: state.mode },
        bubbles: true,
      }),
    );

    const returnFocusIsAvailable =
      returnFocus?.isConnected &&
      !returnFocus.closest("[hidden], [inert]");
    if (shouldMoveFocus) {
      viewFocusTarget(state.panel, state.layout)?.focus({ preventScroll: true });
    } else if (returnFocusIsAvailable) {
      returnFocus.focus({ preventScroll: true });
    } else {
      returnFocus?.blur();
    }

    announceWorkspaceView();
    if (updateUrl) updateLocation();
    if (
      mobileViewport.matches &&
      targetLayout === "all" &&
      Number.isFinite(state.catalogScrollY)
    ) {
      restoreCatalogScrollPosition();
    }
  }

  function viewFocusTarget(panel, layout) {
    if (layout === "all") {
      return (
        catalogCards.get(activeCatalogKey())?.button ||
        nodes.modeButtons.find((button) => button.dataset.deskMode === "craft")
      );
    }
    if (panel === "detail" && state.mode === "craft" && state.craftEmpty) {
      return nodes.primaryButtons[0] || nodes.compareToggle;
    }
    if (panel === "detail") return nodes.detailPanel;
    if (isDealCard) return nodes.focusCardMonitor;
    return cardDefinition.renderer !== "line"
      ? nodes.cardPresetButtons.find(
          (button) => button.dataset.cardPreset === cardId,
        )
      : nodes.familyButtons.find(
          (button) => button.dataset.gpuFamily === state.selected,
        );
  }

  function announceWorkspaceView() {
    const label = workspaceLabel();
    announceWorkspace(
      state.layout === "all"
        ? "Catalog opened"
        : state.mode === "monitor"
          ? `Monitor opened for ${label}`
          : state.mode === "craft"
            ? `Craft opened for ${label}`
            : `${label} opened in Catalog`,
    );
  }

  function workspaceLabel() {
    if (state.craftEmpty) return "New composition";
    return state.catalogName ||
      (cardDefinition.renderer === "line" ? state.selected : cardDefinition.title);
  }

  function rangeControlLabel(range) {
    return ranges[range]?.label || String(range || "").toUpperCase();
  }

  function rangeControlAriaLabel(range) {
    if (range === "1d") return "Show one day";
    if (range === "7d") return "Show seven days";
    return "Show all history";
  }

  function rangeCommandTitle(range) {
    return rangeControlAriaLabel(range);
  }

  function announceWorkspace(message) {
    if (!nodes.workspaceStatus) return;
    nodes.workspaceStatus.textContent = "";
    window.requestAnimationFrame(() => {
      nodes.workspaceStatus.textContent = message;
    });
  }

  function updateLocation() {
    const view =
      state.layout === "all"
        ? "gallery"
        : state.mode === "craft"
          ? "craft"
          : state.mode === "monitor"
            ? "monitor"
            : "card";
    const url = replaceCardLocation(
      cardId,
      view,
      currentCardState(),
    );
    if (state.mode === "craft" && state.craftEmpty) {
      url.searchParams.set("draft", "new");
    }
    if (state.activeCatalogId) {
      url.searchParams.set("item", state.activeCatalogId);
    }
    window.history.replaceState({}, "", url);
  }

  function persistCatalogScrollPosition() {
    if (!mobileViewport.matches || state.layout !== "all") return;
    try {
      window.sessionStorage.setItem(
        catalogScrollStorageKey,
        JSON.stringify({
          position: window.scrollY,
          savedAt: Date.now(),
        }),
      );
    } catch {}
  }

  function readCatalogScrollPosition() {
    try {
      const stored = window.sessionStorage.getItem(catalogScrollStorageKey);
      if (stored === null) return null;
      let position = Number(stored);
      if (!Number.isFinite(position)) {
        const snapshot = JSON.parse(stored);
        if (
          !snapshot ||
          Date.now() - Number(snapshot.savedAt) > 10 * 60 * 1000
        ) {
          clearCatalogScrollPosition();
          return null;
        }
        position = Number(snapshot.position);
      }
      return Number.isFinite(position) && position >= 0 ? position : null;
    } catch {
      clearCatalogScrollPosition();
      return null;
    }
  }

  function restoreCatalogScrollPosition() {
    const position = state.catalogScrollY;
    if (!Number.isFinite(position)) return;
    let attempts = 0;
    let stableFrames = 0;
    const restore = () => {
      if (
        !mobileViewport.matches ||
        state.mode !== "catalog" ||
        state.layout !== "all"
      ) {
        return;
      }
      const maxScroll = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      const target = Math.min(position, maxScroll);
      window.scrollTo({ top: target, behavior: "auto" });
      attempts += 1;
      stableFrames = Math.abs(window.scrollY - target) < 1
        ? stableFrames + 1
        : 0;
      if ((maxScroll >= position && stableFrames >= 2) || attempts >= 8) {
        state.catalogScrollY = window.scrollY;
        clearCatalogScrollPosition();
        return;
      }
      window.requestAnimationFrame(restore);
    };
    window.requestAnimationFrame(restore);
  }

  function clearCatalogScrollPosition() {
    try {
      window.sessionStorage.removeItem(catalogScrollStorageKey);
    } catch {}
  }

  function currentCardState() {
    return {
      gpu: state.selected,
      layers: serializeLayerIds(state.layers, cardDefinition),
      scale: state.scale,
      range: state.range,
      palette: currentPalette(),
      theme: currentTheme(),
      ...state.options,
    };
  }

  function loadCraftDraft(savedItems) {
    try {
      const stored = JSON.parse(
        window.sessionStorage.getItem(craftDraftStorageKey) || "null",
      );
      if (stored?.version !== 1 || !stored.cardState) return null;
      const cardState = normalizeCardState(cardId, stored.cardState);
      const savedItem = savedItems.find(
        (item) => item.id === stored.activeCatalogId,
      );
      return {
        cardState,
        activeCatalogId: savedItem?.id || null,
        catalogName: savedItem?.name || "",
        craftBaseline: savedItem
          ? compositionKey(cardId, savedItem.state)
          : null,
      };
    } catch {
      return null;
    }
  }

  function storeCraftDraft(draft) {
    try {
      window.sessionStorage.setItem(
        craftDraftStorageKey,
        JSON.stringify({
          version: 1,
          cardState: normalizeCardState(cardId, draft.cardState),
          activeCatalogId: draft.activeCatalogId || null,
        }),
      );
    } catch {}
  }

  function clearStoredCraftDraft() {
    try {
      window.sessionStorage.removeItem(craftDraftStorageKey);
    } catch {}
  }

  async function copyCardLink() {
    const copied = await copyText(shareUrl(), "Link copied");
    if (copied) announceCard("Link copied");
  }

  function shareUrl() {
    if (isDealCard) {
      return cardUrl(cardId, "monitor", currentCardState()).toString();
    }
    const cardState =
      state.layout === "all" &&
      !state.activeCatalogId &&
      cardDefinition.renderer === "line"
        ? {
            ...currentCardState(),
            layers: state.selected,
            scale: "price",
          }
        : currentCardState();
    const publishedUrl = new URL(
      publishedCardSharePath(cardId, cardState),
      window.location.origin,
    );
    if (state.dataRevision) {
      publishedUrl.searchParams.set(
        "v",
        `${PUBLISHED_CARD_VERSION}-${state.dataRevision}`,
      );
    }
    return publishedUrl.toString();
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
    if (isDealCard && state.runtimePayload) {
      const observed = new Date(state.runtimePayload.asOf * 1000);
      if (nodes.shareStatus) {
        nodes.shareStatus.textContent =
          `${state.runtimePayload.label || "Deal 041"} ` +
          `${state.options.stage || state.runtimePayload.currentStage}`;
      }
      if (nodes.shareObserved) {
        nodes.shareObserved.textContent = formatUtcDateTime(observed);
        nodes.shareObserved.setAttribute("datetime", observed.toISOString());
      }
      return;
    }
    if (isDepthCard && state.runtimePayload) {
      try {
        syncDepthShareStatus(createDepthModel(currentCardState(), state.runtimePayload));
      } catch {}
      return;
    }
    if (isBarCard && state.runtimePayload) {
      try {
        syncBarShareStatus(
          createGpuPriceBarModel(state.runtimePayload, cardDefinition, {
            layerIds: Array.from(state.layers),
          }),
        );
      } catch {}
      return;
    }
    if (!nodes.shareStatus) return;
    const primary = createLayerSeries(state.selected, { scale: state.scale });
    const latest = primary?.rows.at(-1);
    if (!latest) {
      nodes.shareStatus.textContent = "";
      if (nodes.shareObserved) {
        nodes.shareObserved.textContent = "Market data unavailable";
        nodes.shareObserved.removeAttribute("datetime");
      }
      return;
    }
    const activeLayers = activeLayerDefinitions();
    const primaryLayer = activeLayers.find(
      (layer) => layer.id === state.selected,
    );
    const layerLabels = [
      primaryLayer,
      ...activeLayers.filter((layer) => layer.id !== state.selected),
    ]
      .filter(Boolean)
      .map((layer) => layer.shortLabel || layer.label);
    const layerNames = layerLabels.length > 1
      ? `${layerLabels[0]} compared with ${layerLabels.slice(1).join(", ")}`
      : layerLabels[0];
    nodes.shareStatus.textContent =
      `${layerNames} ${ranges[state.range].label} ` +
      `${formatCardHeadline(latest.plotValue, state.scale)}`;
    if (nodes.shareObserved) {
      nodes.shareObserved.textContent = formatUtcDateTime(latest.date);
      nodes.shareObserved.setAttribute("datetime", latest.date.toISOString());
    }
    nodes.shareArtifactSvg?.setAttribute(
      "aria-label",
      `${layerNames} ${formatCardHeadline(latest.plotValue, state.scale)} ${ranges[state.range].label}`,
    );
  }

  function syncDepthShareStatus(model) {
    const observed = new Date(model.asOf * 1000);
    const clearingPrice = model.current.clearingPrice;
    const viewLabel = visualizationLabel(state.scale);
    if (nodes.shareStatus) {
      nodes.shareStatus.textContent = clearingPrice === null
        ? `${viewLabel} ${model.targetNodes} nodes above ${formatUsd(model.priceDomain[1])}`
        : `${viewLabel} ${model.targetNodes} nodes ${formatUsd(clearingPrice)}`;
    }
    if (nodes.shareObserved) {
      nodes.shareObserved.textContent = formatUtcDateTime(observed);
      nodes.shareObserved.setAttribute("datetime", observed.toISOString());
    }
    nodes.shareArtifactSvg?.setAttribute(
      "aria-label",
      `${model.title}. ${viewLabel} view. Benchmark ${formatUsd(model.current.benchmarkPrice)} reaches ` +
      `${model.current.capacityAtBenchmark} nodes. ${model.targetNodes} nodes clear at ${
        clearingPrice === null ? `more than ${formatUsd(model.priceDomain[1])}` : formatUsd(clearingPrice)
      } per GPU hour.`,
    );
  }

  function syncBarShareStatus(model) {
    const prices = model.bars.map((bar) => formatUsd(bar.value));
    const observed = new Date(model.asOf * 1000);
    if (nodes.shareStatus) {
      nodes.shareStatus.textContent =
        `${model.bars.length} accelerator prices from ${prices.at(-1)} to ${prices[0]}`;
    }
    if (nodes.shareObserved) {
      nodes.shareObserved.textContent = formatUtcDateTime(observed);
      nodes.shareObserved.setAttribute("datetime", observed.toISOString());
    }
    nodes.shareArtifactSvg?.setAttribute(
      "aria-label",
      `Accelerator prices. ${model.bars
        .map((bar) => `${bar.label} ${formatUsd(bar.value)}`)
        .join(", ")} per GPU hour. Observed ${formatUtcDateTime(observed)}`,
    );
  }

  function setShareReady(ready) {
    state.shareReady = ready;
    syncControls();
  }

  function render(drawAnimation) {
    if (state.mode === "craft" && state.craftEmpty) {
      syncComposerControls();
      return;
    }
    if (isDealCard) {
      renderDealWorkspace();
      return;
    }
    if (isDepthCard) {
      renderDepthWorkspace(drawAnimation);
      return;
    }
    if (isBarCard) {
      renderBarWorkspace(drawAnimation);
      return;
    }
    const rangeSeries = activeSeries({ zoom: false });
    const chartSeries = activeSeries({ zoom: true });
    const primary = rangeSeries.find((series) => series.layer.id === state.selected);
    if (!primary?.rows.length) {
      showFailure(`${state.selected} history is still being collected.`);
      return;
    }

    nodes.chartState.hidden = true;
    nodes.tooltip.hidden = true;
    updateRangeDates(primary.rows);
    renderShareArtifact(rangeSeries);
    state.catalogDirty = true;
    if (state.layout === "all") renderWorkspaceGallery();
    syncShareStatus();

    if (
      state.layout === "focus" &&
      state.panel === "detail" &&
      nodes.chart.clientWidth > 0
    ) {
      renderChart(chartSeries, drawAnimation);
    }
  }

  function createDealModel(cardState = currentCardState(), payload = null) {
    const sourcePayload =
      payload || state.runtimePayloads.get(cardDefinition.id);
    const marketPayload = state.runtimePayloads.get("gpu-index");
    return createDealViewModel(sourcePayload, {
      stage: cardState.stage,
      marketPayload,
      overrides: dealModelOverrides(cardState),
    });
  }

  function dealModelOverrides(cardState) {
    return {
      gpu: cardState.gpu,
      quantity: cardState.quantity,
      quote: cardState.quote,
      rfs: cardState.rfs,
    };
  }

  function renderDealWorkspace() {
    if (!state.runtimePayload) return;
    let model;
    try {
      model = createDealModel(currentCardState(), state.runtimePayload);
    } catch (error) {
      console.error("Deal view could not render", error);
      showFailure("Deal view is temporarily unavailable.");
      return;
    }

    const palette = cardPalette(currentCardState());
    if (nodes.shareArtifactSvg) nodes.shareArtifactSvg.hidden = true;
    if (nodes.dealPreview) {
      nodes.dealPreview.hidden = false;
      mountDealView(nodes.dealPreview, model, {
        variant: "focus",
        palette,
        reducedMotion,
      });
    }
    if (nodes.dealWorkspace) {
      nodes.dealWorkspace.hidden = false;
      mountDealView(nodes.dealWorkspace, model, {
        variant: "full",
        palette,
        reducedMotion,
        onStageChange: selectDealStage,
      });
    }
    if (nodes.chartState) nodes.chartState.hidden = true;
    if (nodes.tooltip) nodes.tooltip.hidden = true;
    root.dataset.dealStage = model.activeStage;
    state.catalogDirty = true;
    if (state.layout === "all") renderWorkspaceGallery();
    syncMobileSummary();
    syncShareStatus();
  }

  function createDepthModel(cardState = currentCardState(), payload = null) {
    const definition = getCardDefinition("gpu-market-depth");
    const sourcePayload =
      payload || state.runtimePayloads.get(definition.sourceCardId || definition.id);
    return createGpuMarketDepthModel(sourcePayload, definition, {
      targetNodes: Number(cardState.target),
    });
  }

  function renderDepthWorkspace(drawAnimation) {
    if (!state.runtimePayload) return;
    let model;
    try {
      model = createDepthModel(currentCardState(), state.runtimePayload);
    } catch (error) {
      console.error("GPU market depth could not render", error);
      showFailure("Market depth is temporarily unavailable.");
      return;
    }

    nodes.chartState.hidden = true;
    nodes.tooltip.hidden = true;
    const observed = new Date(model.asOf * 1000);
    const historyStart = state.scale === "history" && model.history.length
      ? new Date(model.history[0].timestamp * 1000)
      : null;
    const format = d3.timeFormat("%d %b");
    if (historyStart) {
      updateRangeDate(nodes.rangeStart, historyStart, format);
    } else if (nodes.rangeStart) {
      nodes.rangeStart.textContent = "";
      nodes.rangeStart.removeAttribute("datetime");
      nodes.rangeStart.setAttribute("aria-hidden", "true");
    }
    updateRangeDate(nodes.rangeEnd, observed, format);
    const palette = cardPalette(currentCardState());
    paintGpuMarketDepthChart(nodes.shareArtifactSvg, model, {
      colors: palette,
      title: state.catalogName || cardDefinition.title,
      compact: true,
      reducedMotion,
      interactive: false,
      view: depthViewMode(state.scale),
    });
    if (nodes.mobileSummaryLabel) {
      nodes.mobileSummaryLabel.textContent = visualizationLabel(state.scale);
    }
    if (nodes.mobileSummaryValue) {
      nodes.mobileSummaryValue.textContent = `${model.targetNodes} nodes`;
    }
    if (nodes.mobileSummaryRange) {
      nodes.mobileSummaryRange.textContent = model.current.clearingPrice === null
        ? `>${formatUsd(model.priceDomain[1])}`
        : formatUsd(model.current.clearingPrice);
    }
    state.catalogDirty = true;
    if (state.layout === "all") renderWorkspaceGallery();
    syncDepthShareStatus(model);

    if (
      state.layout === "focus" &&
      state.panel === "detail" &&
      nodes.chart.clientWidth > 0
    ) {
      paintGpuMarketDepthChart(nodes.svg, model, {
        colors: palette,
        title: state.catalogName || cardDefinition.title,
        reducedMotion: reducedMotion || !drawAnimation,
        interactive: !mobileViewport.matches,
        minimal: mobileViewport.matches,
        view: depthViewMode(state.scale),
      });
    }
  }

  function renderBarWorkspace(drawAnimation) {
    if (!state.runtimePayload) return;
    let model;
    try {
      model = createGpuPriceBarModel(state.runtimePayload, cardDefinition, {
        layerIds: Array.from(state.layers),
      });
    } catch (error) {
      console.error("GPU price bars could not render", error);
      showFailure("Accelerator prices are temporarily unavailable.");
      return;
    }

    nodes.chartState.hidden = true;
    nodes.tooltip.hidden = true;
    const observed = new Date(model.asOf * 1000);
    const format = d3.timeFormat("%d %b");
    updateRangeDate(nodes.rangeStart, observed, format);
    updateRangeDate(nodes.rangeEnd, observed, format);
    const palette = cardPalette(currentCardState());
    paintGpuPriceBarChart(nodes.shareArtifactSvg, model, {
      colors: palette,
      title: state.catalogName || "Accelerator prices",
      reducedMotion,
      interactive: false,
    });
    state.catalogDirty = true;
    if (state.layout === "all") renderWorkspaceGallery();
    syncBarShareStatus(model);

    if (
      state.layout === "focus" &&
      state.panel === "detail" &&
      nodes.chart.clientWidth > 0
    ) {
      paintGpuPriceBarChart(nodes.svg, model, {
        colors: palette,
        title: state.catalogName || "Accelerator prices",
        reducedMotion: reducedMotion || !drawAnimation,
        interactive: true,
      });
    }
  }

  function renderWorkspaceGallery() {
    if (
      state.layout !== "all" ||
      !state.catalogDirty ||
      !state.runtimePayloads.size
    ) {
      return;
    }

    const entries = catalogEntries();
    if (nodes.galleryStatus) {
      nodes.galleryStatus.textContent = entries.length
        ? `${entries.length} ${entries.length === 1 ? "view" : "views"}`
        : "";
    }
    if (!catalogCards.size) {
      state.catalogDirty = false;
      return;
    }

    for (const cardNodes of catalogCards.values()) {
      const { entry } = cardNodes;
      const entryCard = getCardDefinition(entry.cardId || cardId);
      const cardState = catalogEntryState(entry);
      const displayState = catalogEntryDisplayState(entry);
      const title = catalogEntryTitle(entry);
      const selected = entry.key === activeCatalogKey();
      cardNodes.button.dataset.selected = String(selected);
      if (selected) cardNodes.button.setAttribute("aria-current", "true");
      else cardNodes.button.removeAttribute("aria-current");

      if (entryCard.renderer === "deal") {
        const payload = state.runtimePayloads.get(
          entryCard.sourceCardId || entryCard.id,
        );
        if (!payload || !cardNodes.dealHost) continue;
        const model = createDealViewModel(payload, {
          stage: cardState.stage,
          marketPayload: state.runtimePayloads.get("gpu-index"),
          overrides: dealModelOverrides(cardState),
        });
        cardNodes.button.setAttribute(
          "aria-label",
          `Monitor ${title}. ${model.ariaLabel}`,
        );
        mountDealView(cardNodes.dealHost, model, {
          variant: "static",
          palette: cardPalette(displayState),
          reducedMotion,
        });
        continue;
      }

      if (entryCard.renderer === "cumulative-depth") {
        const payload = state.runtimePayloads.get(
          entryCard.sourceCardId || entryCard.id,
        );
        if (!payload) continue;
        const model = createDepthModel(cardState, payload);
        const qualifier = model.current.targetReached
          ? `at or below ${formatUsd(model.current.clearingPrice)}`
          : `above ${formatUsd(model.priceDomain[1])}`;
        cardNodes.button.setAttribute(
          "aria-label",
          `Monitor ${title}, ${visualizationLabel(cardState.scale, entryCard)} chart mode, ${model.targetNodes} nodes ${qualifier}`,
        );
        paintGpuMarketDepthChart(cardNodes.artifact, model, {
          colors: cardPalette(displayState),
          compact: true,
          minimal: true,
          title,
          reducedMotion: true,
          interactive: false,
          decorative: true,
          view: depthViewMode(cardState.scale),
        });
        continue;
      }

      if (entryCard.renderer === "categorical-bar") {
        const payload = state.runtimePayloads.get(
          entryCard.sourceCardId || entryCard.id,
        );
        if (!payload) continue;
        const model = createGpuPriceBarModel(payload, entryCard, {
          layerIds: cardState.layers,
        });
        cardNodes.button.setAttribute(
          "aria-label",
          `Monitor ${title}, ${model.bars.length} accelerator prices from ` +
            `${formatUsd(model.bars.at(-1).value)} to ` +
            `${formatUsd(model.bars[0].value)} per GPU hour, observed ` +
            `${formatUtcDateTime(new Date(model.asOf * 1000))}`,
        );
        paintGpuPriceBarChart(cardNodes.artifact, model, {
          colors: cardPalette(displayState),
          compact: true,
          title,
          reducedMotion: true,
          interactive: false,
          decorative: true,
        });
        continue;
      }

      const cardSeries = cardState.layers
        .map((layerId) => createLayerSeries(layerId, {
          scale: cardState.scale,
          range: cardState.range,
          primaryLayerId: cardState.gpu,
          definition: entryCard,
        }))
        .filter((series) => series?.rows.length);
      const primary = cardSeries.find(
        (series) => series.layer.id === cardState.gpu,
      );
      const latest = primary?.rows.at(-1);
      if (!cardNodes || !primary?.rows.length || !latest) continue;

      const value = formatCardHeadline(latest.plotValue, cardState.scale);
      cardNodes.button.setAttribute(
        "aria-label",
        `Monitor ${title}, ${describeCatalogState(cardState, entryCard)}, ${value}`,
      );
      drawShareArtifact(cardNodes.artifact, cardSeries, cardState.gpu, {
        compact: true,
        scale: cardState.scale,
        range: cardState.range,
        title,
        palette: cardPalette(displayState),
        theme: displayState.theme,
      });
    }

    syncCatalogCardPositions();

    state.catalogDirty = false;
  }

  function cardPalette(cardState) {
    const accent =
      PALETTES.find((palette) => palette.id === cardState.palette)?.accent ||
      PALETTES[0].accent;
    const dark = cardState.theme === "dark";
    return {
      theme: dark ? "dark" : "light",
      paper: mixHex(accent, dark ? "#171717" : "#ffffff", dark ? 0.03 : 0.05),
      line: mixHex(accent, dark ? "#ffffff" : "#102635", dark ? 0.88 : 0.52),
      text: mixHex(
        accent,
        dark ? "#ffffff" : "#102635",
        dark ? 0.72 : 0.28,
      ),
      secondary: mixHex(accent, dark ? "#ffffff" : "#102635", 0.28),
      area: mixHex(accent, dark ? "#ffffff" : "#102635", 0.28),
    };
  }

  function mixHex(foreground, background, foregroundWeight) {
    const parse = (value) => [1, 3, 5].map((index) =>
      Number.parseInt(value.slice(index, index + 2), 16),
    );
    const foregroundRgb = parse(foreground);
    const backgroundRgb = parse(background);
    const mixed = foregroundRgb.map((channel, index) =>
      Math.round(
        channel * foregroundWeight +
        backgroundRgb[index] * (1 - foregroundWeight),
      ),
    );
    return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  }

  function activeLayerDefinitions() {
    return cardDefinition.layers.filter((layer) => state.layers.has(layer.id));
  }

  function activeSeries({ zoom = false } = {}) {
    return activeLayerDefinitions()
      .map((layer) => createLayerSeries(layer.id, { scale: state.scale, zoom }))
      .filter((series) => series?.rows.length);
  }

  function createLayerSeries(
    layerId,
    {
      scale = state.scale,
      zoom = false,
      range = state.range,
      primaryLayerId = state.selected,
      definition = cardDefinition,
    } = {},
  ) {
    const layer = getLayerDefinition(definition, layerId);
    const sourceRows = visibleRows(state.seriesByLayer.get(layerId) || [], range);
    if (!layer || !sourceRows.length) return null;
    const baseValue = sourceRows[0].value || 1;
    const selectedRows = zoom ? customZoomRows(sourceRows) : sourceRows;
    const rows = selectedRows.map((row) => {
      const indexed = scale === "index";
      return {
        ...row,
        plotValue: indexed ? (row.value / baseValue) * 100 : row.value,
        plotLower: indexed ? (row.lower / baseValue) * 100 : row.lower,
        plotUpper: indexed ? (row.upper / baseValue) * 100 : row.upper,
      };
    });
    return {
      layer,
      rows,
      primary: layerId === primaryLayerId,
    };
  }

  function updateRangeDates(rows) {
    const start = rows[0]?.date;
    const end = rows.at(-1)?.date;
    const format = d3.timeFormat("%d %b");
    updateRangeDate(nodes.rangeStart, start, format);
    updateRangeDate(nodes.rangeEnd, end, format);
  }

  function updateRangeDate(node, date, format) {
    if (!node) return;
    node.removeAttribute("aria-hidden");
    node.textContent = date ? format(date) : "pending";
    if (date) {
      node.setAttribute("datetime", date.toISOString());
    } else {
      node.removeAttribute("datetime");
    }
  }

  function renderShareArtifact(series) {
    drawShareArtifact(nodes.shareArtifactSvg, series, state.selected, {
      scale: state.scale,
      title: state.catalogName || undefined,
    });
  }

  function drawShareArtifact(
    svgNode,
    series,
    primaryLayerId,
    options = {},
  ) {
    if (!svgNode || !series.length) {
      return;
    }
    const primary =
      series.find((candidate) => candidate.layer.id === primaryLayerId) || series[0];
    const latest = primary.rows.at(-1);
    if (!latest) return;
    const isPrimary = (candidate) => candidate.layer.id === primary.layer.id;
    const svg = d3.select(svgNode);
    svg.selectAll("*").remove();
    svg.attr("viewBox", "0 0 1200 675");

    const palette = options.palette || {
      paper: currentPaperColor(),
      line: currentLineColor(),
      secondary: currentSecondaryLineColor(),
      area: currentAreaColor(),
    };
    const compact = options.compact === true;
    const scale = options.scale || state.scale;
    const range = options.range || state.range;
    const allRows = series.flatMap((candidate) => candidate.rows);
    const primaryTitle = String(
      options.title || primary.layer.shortLabel || primary.layer.label,
    ).slice(0, MAX_CATALOG_NAME_LENGTH);
    const hasComparisons = series.some((candidate) => !isPrimary(candidate));
    const typography = compact
      ? {
          family:
            primaryTitle.length > 24
              ? 36
              : primaryTitle.length > 16 || series.length > 1
                ? 36
                : 52,
          range: 36,
          price: 104,
        }
      : {
          family: 34,
          range: 32,
          price: 82,
        };
    svg
      .append("rect")
      .attr("width", 1200)
      .attr("height", 675)
      .attr("fill", palette.paper);

    appendShareText(svg, {
      x: 40,
      y: 54,
      text: primaryTitle,
      fill: palette.line,
      size: typography.family,
      weight: 600,
      family: "Geist, Avenir Next, sans-serif",
      spacing: 0.25,
    });
    appendShareText(svg, {
      x: 1160,
      y: 54,
      text: shareRangeLabel(primary.rows, range),
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
      text: formatCardHeadline(latest.plotValue, scale),
      fill: palette.line,
      size: typography.price,
      weight: 500,
      family: "Geist, Avenir Next, sans-serif",
      spacing: -2,
    });

    const chart = compact
      ? { x: 0, y: 204, width: 1200, height: 445 }
      : {
          x: 0,
          y: 158,
          width: 1200,
          height: 491,
        };
    let start = d3.min(allRows, (row) => row.date);
    let end = d3.max(allRows, (row) => row.date);
    if (+start === +end) {
      start = new Date(+start - 30 * 60 * 1000);
      end = new Date(+end + 30 * 60 * 1000);
    }
    const x = d3
      .scaleTime()
      .domain([start, end])
      .range([chart.x, chart.x + chart.width]);
    const y = d3
      .scaleLinear()
      .domain(
        chartYDomain(
          allRows.map((row) => row.plotValue),
          { scale },
        ),
      )
      .range([chart.y + chart.height, chart.y]);

    const line = d3
      .line()
      .x((row) => x(row.date))
      .y((row) => y(row.plotValue))
      .curve(d3.curveMonotoneX);
    const valueArea = d3
      .area()
      .x((row) => x(row.date))
      .y0(scale === "index" ? y(INDEX_BASELINE) : 675)
      .y1((row) => y(row.plotValue))
      .curve(d3.curveMonotoneX);
    if (scale === "index" || series.length === 1) {
      svg
        .append("path")
        .datum(primary.rows)
        .attr("d", valueArea)
        .attr("fill", palette.area)
        .attr("fill-opacity", scale === "index" ? 0.09 : 0.055);
    }
    if (scale === "index") {
      svg
        .append("line")
        .attr("x1", chart.x)
        .attr("x2", chart.x + chart.width)
        .attr("y1", y(INDEX_BASELINE))
        .attr("y2", y(INDEX_BASELINE))
        .attr("stroke", palette.line)
        .attr("stroke-opacity", 0.12)
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "2 8");
    }
    const orderedSeries = [...series].sort(
      (left, right) => Number(isPrimary(left)) - Number(isPrimary(right)),
    );
    orderedSeries.forEach((candidate) => {
      const candidateIsPrimary = isPrimary(candidate);
      const strokeWidth = candidateIsPrimary
        ? compact
          ? 6
          : 3.5
        : compact
          ? 3
          : 2;
      svg
        .append("path")
        .datum(candidate.rows)
        .attr("d", line)
        .attr("fill", "none")
        .attr("stroke", candidateIsPrimary ? palette.line : palette.secondary)
        .attr(
          "stroke-opacity",
          candidateIsPrimary
            ? 1
            : comparisonStrokeOpacity(options.theme || currentTheme()),
        )
        .attr(
          "stroke-dasharray",
          candidateIsPrimary ? null : candidate.layer.strokeDasharray || null,
        )
        .attr("stroke-linecap", "round")
        .attr("stroke-linejoin", "round")
        .attr("stroke-width", strokeWidth);
    });
    if (hasComparisons && !compact) {
      appendShareEndpointLabels(svg, series, palette, chart, x, y, isPrimary);
    }
  }

  function renderChart(series, drawAnimation) {
    const primary =
      series.find((candidate) => candidate.layer.id === state.selected) || series[0];
    const selectedRows = primary?.rows || [];
    const allRows = series.flatMap((candidate) => candidate.rows);
    if (!selectedRows.length || !allRows.length) return;
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
    let start = d3.min(allRows, (row) => row.date);
    let end = d3.max(allRows, (row) => row.date);
    if (+start === +end) {
      start = new Date(+start - 30 * 60 * 1000);
      end = new Date(+end + 30 * 60 * 1000);
    }

    const values =
      state.scale === "price"
        ? series.flatMap((candidate) =>
            candidate.primary
              ? candidate.rows.flatMap((row) => [
                  row.plotLower,
                  row.plotValue,
                  row.plotUpper,
                ])
              : candidate.rows.map((row) => row.plotValue),
          )
        : allRows.map((row) => row.plotValue);
    const x = d3.scaleTime().domain([start, end]).range([0, innerWidth]);
    const y = d3
      .scaleLinear()
      .domain(chartYDomain(values, { scale: state.scale }))
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
      .y0((row) => y(Math.min(row.plotLower, row.plotUpper)))
      .y1((row) => y(Math.max(row.plotLower, row.plotUpper)))
      .curve(d3.curveMonotoneX);
    if (state.scale === "price" && primary.layer.unit === "usd-hour") {
      plot
        .append("path")
        .datum(selectedRows)
        .attr("class", "gpu-benchmark__band")
        .attr("d", area);
    }

    if (state.scale === "index") {
      const indexArea = d3
        .area()
        .x((row) => x(row.date))
        .y0(y(INDEX_BASELINE))
        .y1((row) => y(row.plotValue))
        .curve(d3.curveMonotoneX);
      plot
        .append("path")
        .datum(selectedRows)
        .attr("class", "gpu-benchmark__value-area")
        .attr("aria-hidden", "true")
        .attr("d", indexArea);
      plot
        .append("line")
        .attr("class", "gpu-benchmark__reference-line")
        .attr("aria-hidden", "true")
        .attr("x1", 0)
        .attr("x2", innerWidth)
        .attr("y1", y(INDEX_BASELINE))
        .attr("y2", y(INDEX_BASELINE))
        .attr("stroke", currentLineColor());
    }

    const line = d3
      .line()
      .x((row) => x(row.date))
      .y((row) => y(row.plotValue))
      .curve(d3.curveMonotoneX);
    const orderedSeries = [...series].sort(
      (left, right) => Number(left.primary) - Number(right.primary),
    );
    orderedSeries.forEach((candidate) => {
      plot
        .append("path")
        .datum(candidate.rows)
        .attr(
          "class",
          `gpu-benchmark__line${candidate.primary ? " is-selected" : " is-layer"}`,
        )
        .attr("data-layer", candidate.layer.id)
        .attr("d", line)
        .attr(
          "stroke",
          candidate.primary
            ? currentLineColor()
            : currentSecondaryLineColor(),
        )
        .attr(
          "stroke-opacity",
          candidate.primary
            ? 1
            : comparisonStrokeOpacity(currentTheme()),
        )
        .attr(
          "stroke-dasharray",
          candidate.primary ? null : candidate.layer.strokeDasharray || null,
        )
        .attr("stroke-width", candidate.primary ? 2.4 : 1.35);
    });

    if (series.length > 1) {
      const labelPositions = spreadLineLabels(
        series
          .filter((candidate) => !candidate.primary)
          .map((candidate) => ({
            candidate,
            endpointX: x(candidate.rows.at(-1).date),
            lineY: y(candidate.rows.at(-1).plotValue),
          })),
        8,
        innerHeight - 8,
        16,
      );
      labelPositions.forEach(({ candidate, endpointX, lineY, labelY }) => {
        const stateClass = "is-layer";
        plot
          .append("path")
          .attr(
            "class",
            `gpu-benchmark__line-label-connector ${stateClass}`,
          )
          .attr("aria-hidden", "true")
          .attr(
            "d",
            `M${endpointX},${lineY}H${innerWidth - 8}V${labelY}`,
          )
          .attr(
            "stroke",
            currentSecondaryLineColor(),
          );
        plot
          .append("text")
          .attr("class", `gpu-benchmark__line-label ${stateClass}`)
          .attr("aria-hidden", "true")
          .attr("x", innerWidth - 12)
          .attr("y", labelY)
          .attr("dominant-baseline", "middle")
          .attr("text-anchor", "end")
          .attr(
            "fill",
            currentSecondaryLineColor(),
          )
          .text(candidate.layer.shortLabel || candidate.layer.label);
      });
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
        `${state.selected} main layer with ${series.length} ${series.length === 1 ? "layer" : "layers"}. Use left and right arrow keys to inspect observations.`,
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
      const pointY = y(selectedRow.plotValue);
      const tooltipRows = series
        .map((candidate) => {
          const row = nearestRow(candidate.rows, selectedRow.date);
          return row
            ? {
                ...row,
                layer: candidate.layer,
                primary: candidate.primary,
              }
            : null;
        })
        .filter(Boolean);
      crosshair.attr("x1", pointX).attr("x2", pointX);
      point.attr("cx", pointX).attr("cy", pointY);
      overlay
        .attr("aria-valuenow", focusIndex)
        .attr(
          "aria-valuetext",
          `${formatDateTime(selectedRow.date)}. ${tooltipRows
            .map(
              (row) =>
                `${row.layer.label} ${formatPlotValue(row.plotValue, state.scale)}`,
            )
            .join(". ")}.`,
        );
      renderTooltip(selectedRow.date, tooltipRows);
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
      if (row.primary) entry.dataset.selected = "true";
      const lineColor = row.primary
        ? currentLineColor()
        : currentSecondaryLineColor();
      const [dashLength = 4, gapLength = 3] = String(
        row.layer.strokeDasharray || "4 3",
      )
        .split(/\s+/)
        .map(Number);
      swatch.style.backgroundColor = row.primary ? lineColor : "transparent";
      if (!row.primary) {
        swatch.style.backgroundImage =
          `repeating-linear-gradient(90deg, ${lineColor} 0 ${dashLength}px, ` +
          `transparent ${dashLength}px ${dashLength + gapLength}px)`;
      }
      swatch.style.opacity = String(
        row.primary
          ? 1
          : comparisonStrokeOpacity(currentTheme()),
      );
      label.textContent = row.layer.shortLabel || row.layer.label;
      value.textContent = formatPlotValue(row.plotValue, state.scale);
      range.textContent =
        state.scale === "index"
          ? row.primary
            ? formatUsd(row.value)
            : ""
          : row.primary
          ? `${formatUsd(row.lower)} to ${formatUsd(row.upper)}`
          : "";
      entry.append(swatch, label, value, range);
      return entry;
    });
    nodes.tooltip.replaceChildren(date, ...entries);
    nodes.tooltip.hidden = false;
  }

  function nearestRow(rows, date) {
    if (!rows.length) return null;
    const index = d3.bisector((row) => row.date).left(rows, date);
    const before = rows[Math.max(0, index - 1)];
    const after = rows[Math.min(rows.length - 1, index)];
    return Math.abs(after.date - date) < Math.abs(before.date - date)
      ? after
      : before;
  }

  function visibleRows(rows, range = state.range) {
    const milliseconds = ranges[range]?.milliseconds;
    if (!milliseconds || !rows.length) return rows;
    const latest = d3.max(
      Array.from(state.seriesByLayer.values()).flatMap((series) => series),
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
    return svg
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

  function appendShareEndpointLabels(
    svg,
    series,
    palette,
    chart,
    x,
    y,
    isPrimary,
  ) {
    const labelPositions = spreadLineLabels(
      series
        .filter((candidate) => !isPrimary(candidate))
        .map((candidate) => ({
          candidate,
          endpointX: x(candidate.rows.at(-1).date),
          lineY: y(candidate.rows.at(-1).plotValue),
        })),
      chart.y + 12,
      chart.y + chart.height - 12,
      26,
    );
    const chartRight = chart.x + chart.width;
    for (const { candidate, endpointX, lineY, labelY } of labelPositions) {
      const color = palette.secondary;
      const opacity = comparisonStrokeOpacity(currentTheme());
      svg
        .append("path")
        .attr(
          "d",
          `M${endpointX},${lineY}H${chartRight - 8}V${labelY}`,
        )
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-opacity", opacity)
        .attr("stroke-width", 1.5)
        .attr(
          "stroke-dasharray",
          candidate.layer.strokeDasharray || null,
        )
        .attr("aria-hidden", "true");
      appendShareText(svg, {
        x: chartRight - 12,
        y: labelY + 6,
        text: candidate.layer.shortLabel || candidate.layer.label,
        fill: color,
        size: 18,
        weight: 500,
        family: "Geist Mono, monospace",
        anchor: "end",
        spacing: 0.3,
      })
        .attr("fill-opacity", opacity)
        .attr("paint-order", "stroke fill")
        .attr("stroke", palette.paper)
        .attr("stroke-width", 8)
        .attr("stroke-linejoin", "round")
        .attr("aria-hidden", "true");
    }
  }

  function formatUsd(value) {
    if (!Number.isFinite(Number(value))) return "pending";
    const number = Number(value);
    if (number < 1) return `$${number.toFixed(3)}`;
    if (number < 10) return `$${number.toFixed(2)}`;
    return `$${number.toFixed(1)}`;
  }

  function formatPlotValue(value, scale = state.scale) {
    if (scale === "price") return formatUsd(value);
    const number = Number(value);
    if (!Number.isFinite(number)) return "pending";
    return number.toFixed(number >= 100 ? 1 : 2);
  }

  function formatCardHeadline(value, scale = state.scale) {
    if (scale === "price") return formatUsd(value);
    const change = Number(value) - 100;
    if (!Number.isFinite(change)) return "pending";
    const rounded = Math.abs(change) < 0.05 ? 0 : change;
    return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}%`;
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

}
