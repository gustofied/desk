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
  getCardDefinition,
  getLayerDefinition,
  normalizeCardState,
  CARD_REGISTRY,
  PALETTES,
  paletteIds,
  parseLayerIds,
  PUBLISHED_CARD_VERSION,
  publishedCardSharePath,
  RANGES,
  serializeLayerIds,
} from "./card-registry.js";
import { createGpuPriceBarModel } from "./gpu-price-bar-model.js";
import { paintGpuPriceBarChart } from "./gpu-price-bar-presentation.js";
import { createCommandPalette } from "./command-palette.js";
import {
  loadSavedCatalog,
  MAX_CATALOG_NAME_LENGTH,
  normalizeCatalogName,
  saveCatalogItem,
} from "./saved-catalog.js";
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
  root.dataset.cardId = cardId;
  root.dataset.cardRenderer = cardDefinition.renderer || "line";
  root
    .querySelector(".gpu-index-detail__body")
    ?.setAttribute("aria-label", cardDefinition.title);
  const craftDraftStorageKey = `desk.craft-draft.v1.${cardId}`;
  const catalogColorStorageKey = "desk.catalog-colors.v1";
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const families = cardDefinition.layers
    .filter((layer) => layer.unit === "usd-hour")
    .map((layer) => layer.id);
  const palettes = paletteIds();
  const ranges = RANGES;
  const requestedCard = params.get("card");
  const requestedView =
    requestedCard === cardId ? params.get("view") : null;
  const requestedLayout = params.get("layout");
  const initialMode =
    requestedView === "craft"
      ? "craft"
      : requestedView === "monitor" || requestedView === "full"
        ? "monitor"
        : "catalog";
  const initialView = initialMode === "catalog" ? "share" : "detail";
  const initialCraftEmpty =
    initialMode === "craft" && params.get("draft") === "new";
  const initialLayout =
    initialMode === "catalog" &&
    (requestedView === "gallery" || requestedLayout === "all")
      ? "all"
      : "focus";
  const selected = families.includes(params.get("gpu"))
    ? params.get("gpu")
    : cardDefinition.defaults.layer;
  const requestedLayers = params.has("layers")
    ? parseLayerIds(params.get("layers"), cardDefinition, [selected])
    : [...cardDefinition.defaults.layers];
  const requestedScale = cardDefinition.visualizations.some(
    (visualization) => visualization.id === params.get("scale"),
  )
    ? params.get("scale")
    : cardDefinition.defaults.scale;
  const initialScale = requestedLayers.some(
    (layerId) => getLayerDefinition(cardDefinition, layerId)?.unit === "index",
  )
    ? "index"
    : requestedScale;
  const initialLayers = new Set(
    initialScale === "price"
      ? requestedLayers.filter(
          (layerId) => getLayerDefinition(cardDefinition, layerId)?.unit === "usd-hour",
        )
      : requestedLayers,
  );
  initialLayers.add(selected);
  const initialCompositionLayers = initialCraftEmpty
    ? new Set([selected])
    : initialLayers;
  const initialCompositionScale = initialCraftEmpty ? "price" : initialScale;
  const initialRange = cardDefinition.ranges?.includes(params.get("range"))
    ? params.get("range")
    : cardDefinition.defaults.range;
  const savedCatalog = loadSavedCatalog(cardId);
  const hasCompleteCatalogSnapshot = [
    "gpu",
    "layers",
    "scale",
    "range",
    "palette",
    "theme",
  ].every((name) => params.has(name));
  const requestedCatalogItem =
    !initialCraftEmpty && hasCompleteCatalogSnapshot
      ? savedCatalog.find((item) => item.id === params.get("item")) || null
      : null;
  const initialCraftDraft =
    initialMode === "craft" ? null : loadCraftDraft(savedCatalog);
  const initialStateNeedsRepair =
    (params.has("gpu") && params.get("gpu") !== selected) ||
    (params.has("layers") &&
      params.get("layers") !==
        serializeLayerIds(initialCompositionLayers, cardDefinition)) ||
    (params.has("scale") && params.get("scale") !== initialCompositionScale) ||
    (params.has("range") && params.get("range") !== initialRange) ||
    (params.has("item") && !requestedCatalogItem) ||
    params.has("locked");
  const state = {
    seriesByLayer: new Map(),
    runtimePayload: null,
    mode: initialMode,
    panel: initialView,
    layout: initialLayout,
    selected,
    layers: initialCompositionLayers,
    scale: initialCompositionScale,
    range: initialRange,
    compareOpen: false,
    dataRevision: null,
    shareReady: false,
    resizeTimer: null,
    transitionPending: false,
    controlsReadyAt: 0,
    galleryAlignedId: null,
    catalogDirty: true,
    catalogColorMode: loadCatalogColorMode(),
    zoomWindow: null,
    savedCatalog,
    activeCatalogId: requestedCatalogItem?.id || null,
    catalogName: requestedCatalogItem?.name || "",
    craftEmpty: initialCraftEmpty,
    craftDirty: false,
    craftBaseline: null,
    craftDraft: initialCraftDraft,
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
    modeButtons: Array.from(document.querySelectorAll("[data-desk-mode]")),
    galleryToggle: document.querySelector("[data-index-gallery-toggle]"),
    workspaceTitle: root.querySelector("#desk-workspace-title"),
    detailPanel: root.querySelector("#gpu-index-detail"),
    focusPanel: root.querySelector("#desk-card-focus"),
    workspaceStatus: root.querySelector("[data-workspace-status]"),
    shareObserved: root.querySelector("[data-share-observed]"),
    shareStatus: root.querySelector("[data-share-status]"),
    shareArtifactSvg: root.querySelector("[data-share-artifact-svg]"),
    familyButtons: Array.from(root.querySelectorAll("[data-gpu-family]")),
    cardPresetButtons: Array.from(root.querySelectorAll("[data-card-preset]")),
    familyValues: new Map(
      Array.from(root.querySelectorAll("[data-gpu-family-value]")).map(
        (node) => [node.dataset.gpuFamilyValue, node],
      ),
    ),
    rangeButtons: Array.from(root.querySelectorAll("[data-gpu-range]")),
    zoomReset: root.querySelector("[data-gpu-zoom-reset]"),
    rangeStart: root.querySelector("[data-gpu-range-start]"),
    rangeEnd: root.querySelector("[data-gpu-range-end]"),
    layerGroup: root.querySelector("[data-card-layers]"),
    layerButtons: [],
    primaryGroup: root.querySelector("[data-card-primary-layers]"),
    primaryLabel: root.querySelector("[data-card-primary-label]"),
    primaryButtons: [],
    scaleButtons: Array.from(root.querySelectorAll("[data-card-scale]")),
    scaleControl: root.querySelector("[data-card-scale-control]"),
    layerLabel: root.querySelector("[data-card-layer-label]"),
    compareToggle: root.querySelector("[data-card-compare-toggle]"),
    comparePanel: root.querySelector("[data-card-compare-panel]"),
    compareCount: root.querySelector("[data-card-compare-count]"),
    dataLabel: root.querySelector("[data-card-data-label]"),
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
    saveDialog: document.querySelector("[data-save-dialog]"),
    saveForm: document.querySelector("[data-save-form]"),
    saveTitle: document.querySelector("[data-save-title]"),
    saveName: document.querySelector("[data-save-name]"),
    saveError: document.querySelector("[data-save-error]"),
    saveCancel: document.querySelector("[data-save-cancel]"),
    saveSubmit: document.querySelector("[data-save-submit]"),
    themeColor: document.querySelector('meta[name="theme-color"]'),
  };
  const commandPalette = createCommandPalette({
    root: nodes.commandPalette,
    reducedMotion,
  });
  const catalogCards = new Map();
  let unregisterSavedCatalogCommands = () => {};
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
    configureSaveControls();
    configureCommandPalette();
    syncSavedCatalogCommands();
    configureUtcClock();
    if (initialStateNeedsRepair) updateLocation();
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
    for (const button of nodes.modeButtons) {
      button.addEventListener("click", () => {
        const mode = button.dataset.deskMode;
        if (mode === "craft") openCraft(false);
        else switchWorkspaceMode(mode, false);
      });
    }
    nodes.galleryToggle?.addEventListener("click", (event) => {
      showPanel("share", true, "all", event.detail === 0, "catalog");
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
          !state.seriesByLayer.size ||
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

    configureChoiceButtons(
      nodes.scaleButtons,
      (button) => button.dataset.cardScale,
      selectScale,
      "aria-pressed",
      "buttons",
    );
  }

  function configureSaveControls() {
    nodes.saveButton?.addEventListener("click", openSaveDialog);
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

  function openSaveDialog() {
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
    const updating = Boolean(state.activeCatalogId);
    if (nodes.saveTitle) {
      nodes.saveTitle.textContent = updating ? "Update Catalog item" : "Save to Catalog";
    }
    if (nodes.saveSubmit) nodes.saveSubmit.textContent = updating ? "Update" : "Save";
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

    let saved;
    try {
      saved = saveCatalogItem({
        cardId,
        name,
        state: currentCardState(),
        itemId: state.activeCatalogId,
      });
      state.savedCatalog = loadSavedCatalog(cardId);
    } catch (error) {
      console.error("Catalog save failed", error);
      showSaveError(
        error instanceof TypeError ? error.message : "Could not save this item",
      );
      return;
    }

    state.activeCatalogId = saved.id;
    state.catalogName = saved.name;
    state.craftEmpty = false;
    state.craftDirty = false;
    state.craftBaseline = compositionKey(cardId, saved.state);
    state.craftDraft = null;
    clearStoredCraftDraft();
    nodes.saveDialog.close("saved");
    configureWorkspaceControls();
    syncSavedCatalogCommands();
    syncControls();
    await showPanel("share", true, "all", false, "catalog");
    const card = catalogCards.get(savedCatalogKey(cardId, saved.id));
    card?.button.focus({ preventScroll: true });
    card?.button.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "nearest",
      inline: "center",
    });
    announceWorkspace(`${saved.name} saved to Catalog`);
  }

  function suggestedCatalogName() {
    if (isBarCard) return "Accelerator prices";
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
            : nodes.layerButtons.find((button) => !button.disabled);
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
    if (state.mode === "monitor" && !state.craftEmpty) {
      state.craftDirty = state.craftBaseline
        ? compositionKey(cardId, currentCardState()) !== state.craftBaseline
        : true;
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
    state.craftEmpty = true;
    state.craftDirty = false;
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

    setCompareOpen(true, focusNavigation);
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
          scale: "price",
        })
      : setPrimaryLayer(cardId, base, layerId);
    mutateComposition(next, {
      message: wasEmpty
        ? `${layerId} added as the main series`
        : `${layerId} is now the main series`,
    });
  }

  function selectScale(scale) {
    if (state.mode !== "craft" || state.craftEmpty) return;
    const hadToken = state.layers.has("TOKEN");
    const next = setCompositionScale(cardId, currentCardState(), scale);
    mutateComposition(next, {
      message:
        scale === "price" && hadToken && !next.layers.includes("TOKEN")
          ? "Price view selected, Token Index removed"
          : `${scale === "index" ? "Index" : "Price"} view selected`,
    });
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
        keywords: ["catalog", "cards", "gallery", "market", "accelerator", "prices", "compute", "gpu"],
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
        title: "Show all cards",
        subtitle: "All cards",
        hint: "All",
        keywords: ["catalog", "cards", "all", "gallery", "export", "snapshot", "publish"],
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
        id: "actions.copy-card-link",
        group: "Actions",
        order: 0,
        title: "Copy card link",
        subtitle: "/actions/copy-card-link",
        hint: "Copy",
        keywords: ["share", "url", "clipboard"],
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
        title: "Save to Catalog",
        subtitle: "Name the current composition",
        hint: "Save",
        keywords: ["save", "keep", "catalog", "name", "composition"],
        disabled: () =>
          state.mode !== "craft" || state.craftEmpty || !state.shareReady,
        run: openSaveDialog,
      },
      ...families.map((family, index) => ({
        id: `gpu.${family.toLowerCase()}`,
        group: "Catalog",
        order: index + 1,
        title: `Open ${family} in Catalog`,
        subtitle: `${getCardDefinition("gpu-index").sharePath}/gpu/${family.toLowerCase()}`,
        hint: family,
        keywords: ["card", "catalog", "accelerator", "family", "chip"],
        active: () =>
          !isBarCard &&
          state.mode === "catalog" &&
          state.layout === "focus" &&
          state.selected === family,
        run: () => selectCardTab(family, { detail: 0 }),
      })),
      ...cardDefinition.layers.map((layer, index) => ({
        id: `layer.${layer.id.toLowerCase()}`,
        group: "Layers",
        order: index,
        title: () =>
          !state.craftEmpty && state.layers.has(layer.id)
            ? `Remove ${layer.shortLabel || layer.label}`
            : `Add ${layer.shortLabel || layer.label}`,
        subtitle: `${cardDefinition.sharePath}/layers/${layer.id.toLowerCase()}`,
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
      ...families.map((family, index) => ({
        id: `primary.${family.toLowerCase()}`,
        group: isBarCard ? "Highlight" : "Main data",
        order: index,
        title: isBarCard
          ? `Highlight ${family}`
          : `Use ${family} as main series`,
        subtitle: `${cardDefinition.sharePath}/main/${family.toLowerCase()}`,
        hint: isBarCard ? "Highlight" : "Main",
        keywords: ["primary", "main", "highlight", "series", "data", family],
        active: () =>
          state.mode === "craft" &&
          !state.craftEmpty &&
          state.selected === family,
        disabled: () => state.mode !== "craft",
        run: () => selectPrimaryData(family),
      })),
      ...cardDefinition.visualizations.map((visualization, index) => ({
        id: `scale.${visualization.id}`,
        group: "View",
        order: index,
        title: `Use ${visualization.label} view`,
        subtitle: `${cardDefinition.sharePath}/view/${visualization.id}`,
        hint: visualization.label,
        keywords: ["scale", "view", "price", "index", visualization.label],
        active: () =>
          state.mode === "craft" &&
          !state.craftEmpty &&
          state.scale === visualization.id,
        disabled: () => state.mode !== "craft" || state.craftEmpty,
        run: () => selectScale(visualization.id),
      })),
      ...(isBarCard ? [] : Object.keys(ranges)).map((range, index) => ({
        id: `range.${range}`,
        group: "Range",
        order: index,
        title:
          range === "1d"
            ? "Show one day"
            : range === "7d"
              ? "Show seven days"
              : "Show all history",
        subtitle: `${cardDefinition.sharePath}/range/${range}`,
        hint: ranges[range].label,
        keywords: ["date", "time", "history", "window"],
        active: () =>
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
        title: "Show card colors",
        subtitle: "Use each card’s saved appearance",
        hint: "Catalog",
        keywords: [
          "catalog",
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
      state.savedCatalog.map((item, index) => ({
        id: `catalog.saved.${item.id}`,
        group: "Catalog",
        order: 100 + index,
        title: item.name,
        subtitle: describeCatalogState(item.state),
        hint: "Saved",
        keywords: ["saved", "catalog", item.name, ...item.state.layers],
        disabled: () => !state.shareReady,
        active: () =>
          state.activeCatalogId === item.id && state.mode === "monitor",
        run: () =>
          monitorCatalogEntry(
            {
              key: savedCatalogKey(cardId, item.id),
              kind: "saved",
              cardId,
              item,
            },
            true,
          ),
      })),
    );
  }

  function describeCatalogState(cardState) {
    if (isBarCard) {
      return `${cardState.layers.length} accelerator price${cardState.layers.length === 1 ? "" : "s"}`;
    }
    const labels = orderedLayerLabels(cardState);
    const composition = labels.length > 1
      ? `${labels[0]} with ${labels.slice(1).join(" + ")}`
      : labels[0] || cardState.gpu;
    return `${composition} ${ranges[cardState.range].label}`;
  }

  function orderedLayerLabels(cardState) {
    const layerIds = [
      cardState.gpu,
      ...cardState.layers.filter((layerId) => layerId !== cardState.gpu),
    ];
    return layerIds.map((layerId) => {
      const layer = getLayerDefinition(cardDefinition, layerId);
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
        : "Catalog now shows each card’s colors",
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
    if (!state.seriesByLayer.size) return;
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
    state.catalogDirty = true;
    catalogCards.clear();
    const entries = catalogEntries();
    nodes.galleryGrid.dataset.cardCount = String(Math.min(entries.length, 5));
    const cards = entries.map((entry) => {
      const button = document.createElement("button");
      button.className = "desk-gallery-card compute-share-card-frame";
      button.type = "button";
      button.dataset.catalogId = entry.key;
      button.dataset.catalogKind = entry.kind;
      button.innerHTML = `
        <svg class="compute-share-artifact desk-gallery-card__artifact" viewBox="0 0 1200 675" aria-hidden="true" data-gallery-artifact></svg>`;
      button.addEventListener("click", (event) => {
        monitorCatalogEntry(entry, event.detail === 0);
      });
      catalogCards.set(entry.key, {
        entry,
        button,
        artifact: button.querySelector("[data-gallery-artifact]"),
      });
      return button;
    });
    nodes.galleryGrid.replaceChildren(...cards);
  }

  function catalogEntries() {
    const savedEntries = CARD_REGISTRY.flatMap((card) =>
      loadSavedCatalog(card.id).map((item) => ({
        key: savedCatalogKey(card.id, item.id),
        kind: "saved",
        cardId: card.id,
        item,
      })),
    );
    const lineCard = getCardDefinition("gpu-index");
    const barCard = getCardDefinition("gpu-price-snapshot");
    return [
      ...savedEntries,
      ...lineCard.layers
        .filter((layer) => layer.unit === "usd-hour")
        .map((layer) => ({
        key: presetCatalogKey(lineCard.id, layer.id),
        kind: "preset",
        cardId: lineCard.id,
        family: layer.id,
        state: normalizeCardState(lineCard.id, {
          ...lineCard.defaults,
          gpu: layer.id,
          layers: layer.id,
        }),
      })),
      {
        key: presetCatalogKey(barCard.id, "prices"),
        kind: "preset",
        cardId: barCard.id,
        family: "Prices",
        state: normalizeCardState(barCard.id, barCard.defaults),
      },
    ];
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
      : isBarCard
        ? presetCatalogKey(cardId, "prices")
        : presetCatalogKey(cardId, state.selected);
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
      const showRail = state.layout === "focus" && state.panel === "share";
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
        Array.from(catalogCards.values()).forEach(({ button }, index) => {
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

  function syncModeActions(animateChange) {
    const label = workspaceLabel();
    for (const button of nodes.modeButtons) {
      const mode = button.dataset.deskMode;
      const active = mode === state.mode;
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
      button.disabled =
        !state.shareReady || (mode === "monitor" && state.craftEmpty);
      if (mode === "catalog") {
        button.setAttribute(
          "aria-controls",
          state.layout === "all" ? "desk-card-gallery" : "desk-card-focus",
        );
      }
      button.setAttribute(
        "aria-label",
        mode === "catalog"
          ? `Open ${label} in Catalog`
          : mode === "monitor"
            ? `Monitor ${label}`
            : state.craftDraft
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
      showFailure("Benchmark history could not load.");
      signalReady();
      return;
    }

    try {
      const response = await fetch(cardDefinition.dataUrl);
      if (!response.ok) {
        throw new Error(`${response.status} ${cardDefinition.dataUrl}`);
      }
      const payload = await response.json();
      if (!Number.isInteger(payload?.version) || !payload?.series) {
        throw new Error(`Unsupported card data at ${cardDefinition.dataUrl}`);
      }
      if (typeof payload.revision !== "string" || !payload.revision.trim()) {
        throw new Error(`Missing card data revision at ${cardDefinition.dataUrl}`);
      }

      const sourceDefinition = getCardDefinition(
        cardDefinition.sourceCardId || cardDefinition.id,
      );
      state.runtimePayload = payload;
      state.dataRevision = payload.revision;
      state.seriesByLayer = new Map(
        sourceDefinition.layers
          .map((layer) => [
            layer.id,
            normalizeRuntimeSeries(payload.series[layer.id], layer.id),
          ])
          .filter(([, rows]) => rows.length),
      );
      root.dataset.cardDataVersion = String(payload.version);
      if (!state.seriesByLayer.has(state.selected)) {
        throw new Error(`Missing ${state.selected} data`);
      }
      setShareReady(true);
      updateFamilyQuoteNodes();
      render(true);
      if (state.mode === "craft" && state.craftEmpty) {
        setCompareOpen(true);
      }
    } catch (error) {
      setShareReady(false);
      console.error("GPU benchmark card failed to load", error);
      showFailure("Hourly benchmark history is temporarily unavailable.");
    } finally {
      signalReady();
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
  }

  function selectCardTab(family, event) {
    if (!families.includes(family)) return;
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
      if (nextCard.renderer === "categorical-bar") {
        preserveCraftDraft();
        applyCardState({
          ...nextCard.defaults,
          palette: currentPalette(),
          theme: currentTheme(),
          ...stateOverrides,
        });
        syncControls();
        showPanel("share", true, "focus", moveFocus, "catalog");
      }
      return;
    }

    preserveCraftDraft();
    const nextState = normalizeCardState(nextCard.id, {
      ...nextCard.defaults,
      palette: currentPalette(),
      theme: currentTheme(),
      ...stateOverrides,
    });
    window.location.assign(cardUrl(nextCard.id, view, nextState));
  }

  async function openPublishedCard(family, moveFocus) {
    if (!families.includes(family)) return;
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
  }

  function applyCompositionFields(nextState) {
    const next = normalizeCardState(cardId, nextState);
    state.selected = next.gpu;
    state.layers = new Set(next.layers);
    state.scale = next.scale;
    state.range = next.range;
    document.documentElement.dataset.palette = next.palette;
    document.documentElement.dataset.theme = next.theme;
    syncAppearanceControls();
    return next;
  }

  function selectRange(range) {
    if (Date.now() < state.controlsReadyAt) return;
    if (isBarCard) return;
    if (state.mode === "craft" && state.craftEmpty) return;
    if (!ranges[range] || range === state.range) return;
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
    if (nodes.focusPanel) {
      const labelledBy = isBarCard
        ? activePresetButton?.id
        : activeFamilyButton?.id;
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
      const unavailable = isBarCard || (state.mode === "craft" && state.craftEmpty);
      button.setAttribute("aria-pressed", String(selected));
      button.disabled = unavailable;
      button.tabIndex = unavailable ? -1 : 0;
    });
    if (nodes.zoomReset) {
      nodes.zoomReset.hidden = state.craftEmpty || !state.zoomWindow;
    }
    if (nodes.workspaceTitle) {
      const titleMode = state.mode === "craft" ? "Craft" : "Monitor";
      nodes.workspaceTitle.textContent = state.mode === "craft" && state.craftEmpty
        ? "Craft new composition"
        : `${titleMode} ${workspaceLabel()}${isBarCard ? "" : ` ${ranges[state.range].label}`}${state.craftDirty ? " edited" : ""}`;
    }
    updateFamilyQuoteNodes();
    syncModeActions(false);
    syncComposerControls();
  }

  function syncComposerControls() {
    const editing = state.mode === "craft";
    const empty = editing && state.craftEmpty;
    if (nodes.composer) {
      nodes.composer.hidden = !editing;
      nodes.composer.toggleAttribute("inert", !editing);
    }
    if (nodes.primaryGroup) {
      nodes.primaryGroup.setAttribute("aria-required", String(empty));
    }
    if (nodes.primaryLabel) nodes.primaryLabel.textContent = isBarCard ? "Highlight" : "Main";
    if (nodes.layerLabel) nodes.layerLabel.textContent = isBarCard ? "Bars" : "Compare";
    if (nodes.scaleControl) nodes.scaleControl.hidden = isBarCard;
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
        `Use ${button.dataset.cardScale === "index" ? "Index" : "Price"} view`,
      );
    });
    const dataCount = empty ? 0 : state.layers.size;
    const comparisonCount = Math.max(0, dataCount - 1);
    if (nodes.dataLabel) nodes.dataLabel.textContent = empty ? "Add data" : "Data";
    if (nodes.compareCount) {
      nodes.compareCount.textContent = String(dataCount);
      nodes.compareCount.hidden = dataCount === 0;
    }
    if (nodes.compareToggle) {
      nodes.compareToggle.setAttribute("aria-expanded", String(state.compareOpen));
      nodes.compareToggle.disabled = !state.shareReady;
      nodes.compareToggle.setAttribute(
        "aria-label",
        empty
          ? "Add data"
          : isBarCard
            ? `Data, ${dataCount} bar${dataCount === 1 ? "" : "s"}, ${state.selected} highlighted`
            : `Data, ${state.selected} main series, ${comparisonCount} comparison${comparisonCount === 1 ? "" : "s"}`,
      );
    }
    if (nodes.saveButton) {
      nodes.saveButton.disabled = !state.shareReady || empty;
      nodes.saveButton.setAttribute(
        "aria-label",
        state.activeCatalogId
          ? `Save changes to ${workspaceLabel()}`
          : "Save to Catalog",
      );
    }
    root.dataset.cardScale = state.scale;
    root.dataset.comparisonCount = String(comparisonCount);
    root.dataset.craftEmpty = String(empty);
    root.dataset.craftDirty = String(editing && state.craftDirty);
    if (nodes.craftEmpty) nodes.craftEmpty.hidden = !empty;
    if (nodes.svg) {
      nodes.svg.toggleAttribute("hidden", empty);
      if (empty) nodes.svg.setAttribute("aria-hidden", "true");
      else nodes.svg.removeAttribute("aria-hidden");
    }
    if (empty && nodes.tooltip) nodes.tooltip.hidden = true;
    if (empty && nodes.chartState) nodes.chartState.hidden = true;
    if (nodes.chartDescription && !empty) {
      const labels = activeLayerDefinitions().map((layer) => layer.label).join(", ");
      nodes.svg?.setAttribute(
        "aria-label",
        isBarCard
          ? `${labels} hourly price comparison`
          : state.scale === "index"
          ? `${labels} comparison index`
          : `${labels} price history`,
      );
      nodes.chartDescription.textContent =
        isBarCard
          ? `${labels} latest hourly benchmark prices. Each wider band shows the middle range of quotes.`
          : state.scale === "index"
          ? `${labels} rebased to 100 at the start of the selected range.`
          : `${labels} hourly prices. The band shows the middle range of quotes for ${state.selected}.`;
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
    for (const family of families) {
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
      if (node) node.textContent = value;
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
      if (focusNavigation) {
        nodes.modeButtons
          .find((button) => button.dataset.deskMode === mode)
          ?.focus({ preventScroll: true });
      }
      return;
    }
    if (mode === "catalog") {
      preserveCraftDraft();
      await showPanel(
        "share",
        true,
        state.activeCatalogId || state.craftDirty || state.craftDraft
          ? "all"
          : "focus",
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
      nextName === "share" && nextLayout === "all" ? "all" : "focus";
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
    return panel === "detail"
      ? nodes.detailPanel
      : isBarCard
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
    return state.catalogName || (isBarCard ? cardDefinition.title : state.selected);
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

  function currentCardState() {
    return {
      gpu: state.selected,
      layers: serializeLayerIds(state.layers, cardDefinition),
      scale: state.scale,
      range: state.range,
      palette: currentPalette(),
      theme: currentTheme(),
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
    const cardState =
      state.layout === "all" && !state.activeCatalogId && !isBarCard
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
    syncModeActions(false);
    syncComposerControls();
  }

  function render(drawAnimation) {
    if (state.mode === "craft" && state.craftEmpty) {
      syncComposerControls();
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
      !catalogCards.size ||
      !state.seriesByLayer.size
    ) {
      return;
    }

    for (const cardNodes of catalogCards.values()) {
      const { entry } = cardNodes;
      const entryCard = getCardDefinition(entry.cardId || cardId);
      const cardState = catalogEntryState(entry);
      const displayState = catalogEntryDisplayState(entry);
      const title = entry.kind === "saved"
        ? entry.item.name
        : entryCard.renderer === "categorical-bar"
          ? "Accelerator prices"
          : entry.family;
      const selected = entry.key === activeCatalogKey();
      cardNodes.button.dataset.selected = String(selected);

      if (entryCard.renderer === "categorical-bar") {
        if (!state.runtimePayload) continue;
        const model = createGpuPriceBarModel(state.runtimePayload, entryCard, {
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
        `Monitor ${title}, ${describeCatalogState(cardState)}, ${value}`,
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

    if (nodes.galleryStatus) {
      const entries = catalogEntries();
      const savedCount = entries.filter((entry) => entry.kind === "saved").length;
      nodes.galleryStatus.textContent =
        `${savedCount} saved ${entries.length - savedCount} market cards`;
    }
    if (
      state.layout === "all" &&
      state.galleryAlignedId !== activeCatalogKey() &&
      window.matchMedia("(max-width: 640px)").matches
    ) {
      state.galleryAlignedId = activeCatalogKey();
      window.requestAnimationFrame(() => {
        catalogCards.get(activeCatalogKey())?.button.scrollIntoView({
          behavior: "auto",
          block: "nearest",
          inline: "center",
        });
      });
    }
    state.catalogDirty = false;
  }

  function cardPalette(cardState) {
    const accent =
      PALETTES.find((palette) => palette.id === cardState.palette)?.accent ||
      PALETTES[0].accent;
    const dark = cardState.theme === "dark";
    return {
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
              ? 24
              : primaryTitle.length > 16 || series.length > 1
                ? 30
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
          width: hasComparisons ? 1040 : 1200,
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
    if (hasComparisons) {
      appendShareEndpointLabels(svg, series, palette, chart, y, isPrimary);
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
      right: series.length > 1 ? 64 : 0,
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
            lineY: y(candidate.rows.at(-1).plotValue),
          })),
        8,
        innerHeight - 8,
        16,
      );
      labelPositions.forEach(({ candidate, lineY, labelY }) => {
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
            `M${innerWidth - 4},${lineY}H${innerWidth + 2}` +
              `V${labelY}H${innerWidth + 6}`,
          )
          .attr(
            "stroke",
            currentSecondaryLineColor(),
          );
        plot
          .append("text")
          .attr("class", `gpu-benchmark__line-label ${stateClass}`)
          .attr("aria-hidden", "true")
          .attr("x", innerWidth + 8)
          .attr("y", labelY)
          .attr("dominant-baseline", "middle")
          .attr(
            "fill",
            currentSecondaryLineColor(),
          )
          .text(candidate.layer.id);
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
    y,
    isPrimary,
  ) {
    const labelPositions = spreadLineLabels(
      series
        .filter((candidate) => !isPrimary(candidate))
        .map((candidate) => ({
          candidate,
          lineY: y(candidate.rows.at(-1).plotValue),
        })),
      chart.y + 12,
      chart.y + chart.height - 12,
      26,
    );
    const chartRight = chart.x + chart.width;
    for (const { candidate, lineY, labelY } of labelPositions) {
      const color = palette.secondary;
      const opacity = comparisonStrokeOpacity(currentTheme());
      svg
        .append("path")
        .attr(
          "d",
          `M${chartRight - 4},${lineY}H${chartRight + 4}` +
            `V${labelY}H${chartRight + 12}`,
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
        x: chartRight + 20,
        y: labelY + 6,
        text: candidate.layer.shortLabel || candidate.layer.label,
        fill: color,
        size: 18,
        weight: 500,
        family: "Geist Mono, monospace",
        spacing: 0.3,
      })
        .attr("fill-opacity", opacity)
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
