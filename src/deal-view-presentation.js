const VALID_VARIANTS = Object.freeze(["static", "focus", "full"]);
let dealViewInstance = 0;

/**
 * Mounts a semantic Deal view into `host`.
 *
 * `static` and `focus` contain no controls, so they are safe inside a Catalog
 * tile button. `full` exposes accessible stage tabs for Monitor and Craft.
 */
export function mountDealView(
  host,
  model,
  {
    variant = "static",
    palette,
    reducedMotion = false,
    onStageChange = null,
  } = {},
) {
  assertHost(host);
  assertModel(model);
  const normalizedVariant = VALID_VARIANTS.includes(variant)
    ? variant
    : "static";
  const colors = normalizePalette(palette);
  const interactive = normalizedVariant === "full";
  const instanceId = `deal-view-${++dealViewInstance}`;

  ensureDealViewStyles(host.ownerDocument || document);

  const mount = document.createElement("div");
  mount.className = "deal-view-mount";
  mount.dataset.dealViewMount = "";
  mount.dataset.variant = normalizedVariant;
  mount.dataset.stage = model.activeStage;
  mount.style.setProperty("--deal-paper", colors.paper);
  mount.style.setProperty("--deal-line", colors.line);
  mount.style.setProperty("--deal-text", colors.text);
  mount.style.setProperty("--deal-secondary", colors.secondary);
  mount.style.setProperty("--deal-area", colors.area);
  if (reducedMotion) mount.dataset.reducedMotion = "true";
  mount.innerHTML = dealViewMarkup(model, {
    variant: normalizedVariant,
    instanceId,
  });

  host.replaceChildren(mount);

  let activeStage = model.activeStage;
  const tabs = interactive
    ? Array.from(mount.querySelectorAll("[data-deal-view-tab]"))
    : [];
  const panels = Array.from(mount.querySelectorAll("[data-deal-view-panel]"));

  const activateStage = (stageId, { focus = false, notify = false } = {}) => {
    if (!model.stages.some((stage) => stage.id === stageId)) return;
    activeStage = stageId;
    mount.dataset.stage = stageId;
    mount
      .querySelector("[data-deal-view]")
      ?.setAttribute(
        "aria-label",
        model.ariaLabels?.[stageId] || model.ariaLabel,
      );
    tabs.forEach((tab) => {
      const selected = tab.dataset.dealViewTab === stageId;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    });
    panels.forEach((panel) => {
      const selected = panel.dataset.dealViewPanel === stageId;
      panel.classList.toggle("is-active", selected);
      panel.setAttribute("aria-hidden", String(!selected));
    });
    mount.querySelectorAll("[data-deal-view-stage-mark]").forEach((mark) => {
      mark.dataset.active = String(mark.dataset.dealViewStageMark === stageId);
    });
    if (notify && typeof onStageChange === "function") {
      onStageChange(stageId);
    }
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => {
      activateStage(tab.dataset.dealViewTab, { notify: true });
    });
    tab.addEventListener("keydown", (event) => {
      let nextIndex = index;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") {
        nextIndex = (index - 1 + tabs.length) % tabs.length;
      } else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = tabs.length - 1;
      else return;
      event.preventDefault();
      activateStage(tabs[nextIndex].dataset.dealViewTab, {
        focus: true,
        notify: true,
      });
    });
  });

  activateStage(activeStage);
  return Object.freeze({
    host,
    element: mount,
    get stage() {
      return activeStage;
    },
    setStage(stageId, options = {}) {
      activateStage(stageId, {
        focus: Boolean(options.focus),
        notify: Boolean(options.notify),
      });
    },
    destroy() {
      if (mount.parentNode === host) host.replaceChildren();
    },
  });
}

export const renderDealView = mountDealView;

function dealViewMarkup(model, { variant, instanceId }) {
  const interactive = variant === "full";
  const tabs = interactive
    ? interactiveTabsMarkup(model, instanceId)
    : passiveStagesMarkup(model);
  const panels = interactive
    ? model.stages.map((stage) => stagePanelMarkup(stage, model, instanceId)).join("")
    : stagePanelMarkup(
        model.stages.find((stage) => stage.id === model.activeStage),
        model,
        instanceId,
        true,
      );
  const market = marketMarkup(model);

  return `
    <article class="deal-view deal-view--${variant}" aria-label="${escapeHtml(model.ariaLabel)}"
      data-deal-view="">
      <div class="deal-view__shell">
        <svg class="deal-view__trace" viewBox="0 0 100 100" preserveAspectRatio="none"
          aria-hidden="true" focusable="false">
          <rect x="0" y="0" width="100" height="100" rx="0.5" pathLength="100"></rect>
        </svg>
        <div class="deal-view__surface">
          <header class="deal-view__head">
            <div class="deal-view__identity">
              <span>${escapeHtml(model.label)} / ${escapeHtml(model.type)}</span>
              <strong>${escapeHtml(model.title)}</strong>
              <small>${escapeHtml(model.subtitle)}</small>
            </div>
            <div class="deal-view__quote">
              <span>${escapeHtml(model.quote.formatted)}</span>
              <small>GPU / HR</small>
            </div>
            <div class="deal-view__rfs">
              <small>RFS</small>
              <b>${escapeHtml(model.rfs)}</b>
            </div>
          </header>
          ${market}
          ${tabs}
          <div class="deal-view__panels">${panels}</div>
          <footer class="deal-view__meta">
            <span>${padCount(model.parties)} parties</span>
            <span>${padCount(model.events)} events</span>
            <span>Next / ${escapeHtml(model.nextAction)}</span>
          </footer>
        </div>
      </div>
    </article>`;
}

function interactiveTabsMarkup(model, instanceId) {
  return `
    <div class="deal-view__tabs" role="tablist" aria-label="Deal stages">
      ${model.stages
        .map((stage) => {
          const selected = stage.id === model.activeStage;
          return `<button id="${instanceId}-tab-${stage.id}" type="button" role="tab"
            aria-selected="${selected}" aria-controls="${instanceId}-panel-${stage.id}"
            tabindex="${selected ? "0" : "-1"}" data-deal-view-tab="${stage.id}">
            ${escapeHtml(stage.label)}
          </button>`;
        })
        .join("")}
    </div>`;
}

function passiveStagesMarkup(model) {
  return `
    <div class="deal-view__stages" aria-label="Current stage: ${escapeHtml(
      model.stages.find((stage) => stage.id === model.activeStage)?.label || "",
    )}">
      ${model.stages
        .map((stage) => {
          const active = stage.id === model.activeStage;
          return `<span data-deal-view-stage-mark="${stage.id}" data-active="${active}">
            ${escapeHtml(stage.label)}
          </span>`;
        })
        .join("")}
    </div>`;
}

function stagePanelMarkup(stage, model, instanceId, onlyPanel = false) {
  const active = stage.id === model.activeStage;
  const id = `${instanceId}-panel-${stage.id}`;
  const labelledBy = `${instanceId}-tab-${stage.id}`;
  const relationship = onlyPanel
    ? `aria-label="${escapeHtml(stage.label)}"`
    : `id="${id}" role="tabpanel" aria-labelledby="${labelledBy}"`;
  return `
    <section class="deal-view__panel${active ? " is-active" : ""}" ${relationship}
      aria-hidden="${!active}" data-deal-view-panel="${stage.id}">
      <p>
        <span class="deal-view__copy-full">${escapeHtml(stage.copy)}</span>
        <span class="deal-view__copy-compact">${escapeHtml(stage.compactCopy)}</span>
      </p>
      <footer>
        <span>${escapeHtml(stage.owner)}</span>
        <strong>${escapeHtml(stage.status)}</strong>
      </footer>
    </section>`;
}

function marketMarkup(model) {
  if (!model.market) return "";
  return `
    <aside class="deal-view__market" aria-label="${escapeHtml(
      `${model.asset} market context. Benchmark ${model.market.benchmarkFormatted}. ` +
        `Basis ${model.market.basisFormatted}.`,
    )}">
      <span><small>${escapeHtml(model.asset)} ref</small><b>${escapeHtml(
        model.market.benchmarkFormatted,
      )}</b></span>
      <span><small>Basis</small><b>${escapeHtml(
        model.market.basisFormatted,
      )}</b></span>
    </aside>`;
}

const dealViewStyles = `
  .deal-view-mount {
    --deal-rule: color-mix(in srgb, var(--deal-line) 22%, transparent);
    --deal-rule-strong: color-mix(in srgb, var(--deal-line) 52%, transparent);
    --deal-wash: color-mix(in srgb, var(--deal-area) 48%, var(--deal-paper));
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
  .deal-view-mount .deal-view__trace {
    position: absolute;
    inset: -1px;
    z-index: 2;
    width: calc(100% + 2px);
    height: calc(100% + 2px);
    overflow: visible;
    pointer-events: none;
  }
  .deal-view__trace rect {
    fill: none;
    stroke: var(--deal-line);
    stroke-width: 2px;
    stroke-dasharray: 8 92;
    stroke-linecap: square;
    vector-effect: non-scaling-stroke;
    animation: deal-view-trace 6s cubic-bezier(0.32, 0.72, 0, 1) infinite;
  }
  .deal-view__surface {
    position: relative;
    z-index: 1;
    overflow: hidden;
    border-radius: 3px;
    background: var(--deal-paper);
  }
  .deal-view__head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 24px;
    min-height: 80px;
    padding: 16px;
    border-bottom: 1px solid var(--deal-rule);
  }
  .deal-view__identity {
    display: grid;
    min-width: 0;
    gap: 4px;
  }
  .deal-view__identity > span,
  .deal-view__identity > small,
  .deal-view__quote small,
  .deal-view__rfs,
  .deal-view__market,
  .deal-view__tabs,
  .deal-view__stages,
  .deal-view__panel footer,
  .deal-view__meta {
    font-family: "Geist Mono", ui-monospace, monospace;
    font-variant-numeric: tabular-nums;
  }
  .deal-view__identity > span,
  .deal-view__identity > small,
  .deal-view__quote small,
  .deal-view__rfs small {
    overflow: hidden;
    color: var(--deal-secondary);
    font-size: 12px;
    font-weight: 600;
    line-height: 16px;
    letter-spacing: 0.04em;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .deal-view__identity strong {
    overflow: hidden;
    color: var(--deal-text);
    font-size: 20px;
    font-weight: 600;
    line-height: 24px;
    letter-spacing: -0.02em;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .deal-view__quote,
  .deal-view__rfs {
    display: grid;
    gap: 4px;
    text-align: right;
  }
  .deal-view__quote span {
    color: var(--deal-line);
    font-size: 24px;
    font-weight: 600;
    line-height: 24px;
    letter-spacing: -0.03em;
  }
  .deal-view__rfs b {
    color: var(--deal-line);
    font-size: 12px;
    font-weight: 600;
    line-height: 16px;
  }
  .deal-view__market {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    border-bottom: 1px solid var(--deal-rule);
  }
  .deal-view__market > span {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
    padding: 8px 16px;
  }
  .deal-view__market > span + span { border-left: 1px solid var(--deal-rule); }
  .deal-view__market small {
    overflow: hidden;
    color: var(--deal-secondary);
    font-size: 12px;
    line-height: 16px;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .deal-view__market b {
    color: var(--deal-text);
    font-size: 12px;
    font-weight: 600;
    line-height: 16px;
  }
  .deal-view__tabs,
  .deal-view__stages {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    border-bottom: 1px solid var(--deal-rule);
  }
  .deal-view__tabs button,
  .deal-view__stages > span {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 40px;
    padding: 0 12px;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--deal-secondary);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .deal-view__tabs button + button,
  .deal-view__stages > span + span { border-left: 1px solid var(--deal-rule); }
  .deal-view__tabs button { cursor: pointer; }
  .deal-view__tabs button::after,
  .deal-view__stages > span::after {
    position: absolute;
    right: 12px;
    bottom: -1px;
    left: 12px;
    height: 2px;
    background: var(--deal-line);
    content: "";
    opacity: 0;
    transform: scaleX(0.4);
    transition:
      opacity 180ms cubic-bezier(0.32, 0.72, 0, 1),
      transform 240ms cubic-bezier(0.32, 0.72, 0, 1);
  }
  .deal-view__tabs button:hover { color: var(--deal-text); }
  .deal-view__tabs button:active { transform: scale(0.98); }
  .deal-view__tabs button:focus-visible {
    outline: 2px solid var(--deal-line);
    outline-offset: -4px;
  }
  .deal-view__tabs button[aria-selected="true"],
  .deal-view__stages > span[data-active="true"] { color: var(--deal-line); }
  .deal-view__tabs button[aria-selected="true"]::after,
  .deal-view__stages > span[data-active="true"]::after {
    opacity: 1;
    transform: scaleX(1);
  }
  .deal-view__panels {
    display: grid;
    min-height: 144px;
  }
  .deal-view__panel {
    grid-area: 1 / 1;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 24px;
    padding: 24px 16px 16px;
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
    transform: translateY(4px);
    transition:
      opacity 180ms cubic-bezier(0.32, 0.72, 0, 1),
      transform 180ms cubic-bezier(0.32, 0.72, 0, 1),
      visibility 0s 180ms;
  }
  .deal-view__panel.is-active {
    visibility: visible;
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
    transition-delay: 0s;
  }
  .deal-view__panel p {
    max-width: 52ch;
    margin: 0;
    color: var(--deal-text);
    font-size: 16px;
    font-weight: 500;
    line-height: 24px;
    letter-spacing: -0.01em;
  }
  .deal-view__copy-compact { display: none; }
  .deal-view__panel footer,
  .deal-view__meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    color: var(--deal-secondary);
    font-size: 12px;
    line-height: 16px;
  }
  .deal-view__panel footer strong {
    color: var(--deal-line);
    font-weight: 600;
  }
  .deal-view__meta {
    min-height: 40px;
    padding: 8px 16px;
    border-top: 1px solid var(--deal-rule);
    background: var(--deal-wash);
  }
  .deal-view__meta span:last-child {
    margin-left: auto;
    color: var(--deal-line);
  }
  .deal-view--static .deal-view__shell { box-shadow: none; }
  .deal-view--static .deal-view__head {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    min-height: 64px;
    padding: 12px;
  }
  .deal-view--static .deal-view__identity > span,
  .deal-view--static .deal-view__identity > small { display: none; }
  .deal-view--static .deal-view__identity strong { font-size: 16px; line-height: 20px; }
  .deal-view--static .deal-view__quote span { font-size: 20px; line-height: 20px; }
  .deal-view--static .deal-view__rfs { display: none; }
  .deal-view--static .deal-view__market > span { padding: 8px 12px; }
  .deal-view--static .deal-view__market {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .deal-view--static .deal-view__stages > span {
    min-height: 32px;
    padding: 0 8px;
  }
  .deal-view--static .deal-view__panels { min-height: 104px; }
  .deal-view--static .deal-view__panel {
    gap: 12px;
    padding: 16px 12px 12px;
  }
  .deal-view--static .deal-view__copy-full { display: none; }
  .deal-view--static .deal-view__copy-compact { display: inline; }
  .deal-view--static .deal-view__panel p { font-size: 16px; line-height: 20px; }
  .deal-view--static .deal-view__panel footer span { display: none; }
  .deal-view--static .deal-view__meta {
    min-height: 32px;
    padding: 8px 12px;
  }
  .deal-view--static .deal-view__meta span:first-child { display: none; }
  .deal-view--static .deal-view__meta span:last-child { max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .deal-view--focus .deal-view__shell { box-shadow: none; }
  @keyframes deal-view-trace { to { stroke-dashoffset: -100; } }
  @media (max-width: 620px) {
    .deal-view__head {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      padding: 12px;
    }
    .deal-view__identity > small { display: none; }
    .deal-view__identity strong { font-size: 16px; line-height: 20px; }
    .deal-view__quote span { font-size: 20px; line-height: 20px; }
    .deal-view__rfs { display: none; }
    .deal-view__market > span { padding: 8px 12px; }
    .deal-view__tabs button, .deal-view__stages > span {
      min-height: 36px;
      padding: 0 8px;
      letter-spacing: 0;
    }
    .deal-view__panels { min-height: 120px; }
    .deal-view__panel { gap: 16px; padding: 16px 12px 12px; }
    .deal-view__copy-full { display: none; }
    .deal-view__copy-compact { display: inline; }
    .deal-view__meta { padding: 8px 12px; }
    .deal-view__meta span:first-child { display: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .deal-view__trace rect { animation: none; opacity: 0; }
    .deal-view__tabs button::after,
    .deal-view__stages > span::after,
    .deal-view__panel { transition: none; }
  }
  .deal-view-mount[data-reduced-motion="true"] .deal-view__trace rect {
    animation: none;
    opacity: 0;
  }
  .deal-view-mount[data-reduced-motion="true"] .deal-view__tabs button::after,
  .deal-view-mount[data-reduced-motion="true"] .deal-view__stages > span::after,
  .deal-view-mount[data-reduced-motion="true"] .deal-view__panel { transition: none; }
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

function padCount(value) {
  return String(value).padStart(2, "0");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
