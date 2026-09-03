export function createDealJourneyRail({
  root,
  reducedMotion = false,
  onStageChange = null,
}) {
  if (!root) return createEmptyRail();

  const nodes = {
    toggle: root.querySelector("[data-deal-journey-toggle]"),
    current: root.querySelector("[data-deal-journey-current]"),
    events: root.querySelector("[data-deal-journey-events]"),
    body: root.querySelector("[data-deal-journey-body]"),
    stages: root.querySelector("[data-deal-journey-stages]"),
    status: root.querySelector("[data-deal-journey-status]"),
  };
  let model = null;
  let activeStage = "";
  let open = false;
  let bodyAnimation = null;

  nodes.toggle?.addEventListener("click", () => {
    open = !open;
    syncOpenState();
  });
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    open = false;
    syncOpenState();
    nodes.toggle?.focus({ preventScroll: true });
  });

  setVisible(false);

  return Object.freeze({ setModel, setVisible });

  function setModel(nextModel) {
    model = nextModel;
    if (!model) {
      activeStage = "";
      setVisible(false);
      return;
    }

    activeStage = model.activeStage;
    renderStages();
    syncSummary();
    syncOpenState();
  }

  function setVisible(visible) {
    const show = Boolean(visible && model);
    if (!show && open) {
      open = false;
      syncOpenState({ animateClose: false });
    }
    root.hidden = !show;
    root.toggleAttribute("inert", !show);
  }

  function renderStages() {
    if (!nodes.stages || !model) return;
    const rows = model.stages.map((stage, index) => {
      const row = document.createElement("li");
      row.className = "deal-journey-rail__item";
      row.dataset.dealJourneyItem = stage.id;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "deal-journey-rail__button";
      button.dataset.dealJourneyStage = stage.id;
      const stageData = dataForStage(stage.id);
      button.setAttribute(
        "aria-label",
        `${stage.label}. ${stageData.value}. ${stageData.detail}. ${stage.status}`,
      );
      button.addEventListener("click", () => selectStage(stage.id));

      const position = document.createElement("span");
      position.className = "deal-journey-rail__index";
      position.textContent = String(index + 1).padStart(2, "0");

      const name = document.createElement("span");
      name.className = "deal-journey-rail__name";
      name.textContent = stage.label;

      const value = document.createElement("strong");
      value.className = "deal-journey-rail__data";
      value.textContent = stageData.value;

      const detail = document.createElement("span");
      detail.className = "deal-journey-rail__detail";
      detail.textContent = stageData.detail;

      const status = document.createElement("small");
      status.className = "deal-journey-rail__status";
      status.textContent = stage.status;

      button.append(position, name, value, detail, status);
      row.append(button);
      return row;
    });
    nodes.stages.replaceChildren(...rows);
    syncCurrentStage();
  }

  function selectStage(stageId) {
    if (!model?.stages.some((stage) => stage.id === stageId)) return;
    activeStage = stageId;
    syncCurrentStage();
    syncSummary();
    if (typeof onStageChange === "function") onStageChange(stageId);
    announce(`${stageLabel(stageId)} opened`);
  }

  function syncCurrentStage() {
    nodes.stages?.querySelectorAll("[data-deal-journey-item]").forEach((row) => {
      const button = row.querySelector("[data-deal-journey-stage]");
      if (!button) return;
      const current = button.dataset.dealJourneyStage === activeStage;
      row.dataset.active = String(current);
      if (current) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    });
  }

  function syncSummary() {
    if (!model) return;
    const label = stageLabel(activeStage);
    const events = formatEvents(model.events);
    if (nodes.current) nodes.current.textContent = label;
    if (nodes.events) nodes.events.textContent = events;
    root.setAttribute("aria-label", `Deal journey. ${label}. ${events}`);
    nodes.toggle?.setAttribute(
      "aria-label",
      `${open ? "Close" : "Open"} deal journey. ${label}. ${events}`,
    );
  }

  function stageLabel(stageId) {
    return model?.stages.find((stage) => stage.id === stageId)?.label || stageId;
  }

  function dataForStage(stageId) {
    if (stageId === "spec") {
      return { value: model.title, detail: model.subtitle };
    }
    if (stageId === "diligence") {
      return {
        value: model.quote.formatted,
        detail: `${formatNumber(model.quote.prepayPercent)}% prepay`,
      };
    }
    return { value: model.rfs, detail: model.nextAction };
  }

  function syncOpenState({ animateClose = true } = {}) {
    nodes.toggle?.setAttribute("aria-expanded", String(open));
    if (nodes.body) {
      bodyAnimation?.cancel();
      bodyAnimation = null;
      nodes.body.toggleAttribute("inert", !open);
      if (open) {
        nodes.body.hidden = false;
      } else if (
        animateClose &&
        !reducedMotion &&
        !nodes.body.hidden &&
        typeof nodes.body.animate === "function"
      ) {
        bodyAnimation = nodes.body.animate(
          [
            { opacity: 1, transform: "translateY(0)" },
            { opacity: 0, transform: "translateY(-4px)" },
          ],
          {
            duration: 240,
            easing: "cubic-bezier(0.32, 0.72, 0, 1)",
          },
        );
        bodyAnimation.finished
          .catch(() => {})
          .finally(() => {
            if (!open) nodes.body.hidden = true;
          });
      } else {
        nodes.body.hidden = true;
      }
    }
    root.dataset.open = String(open);
    syncSummary();
  }

  function announce(message) {
    if (!nodes.status) return;
    nodes.status.textContent = "";
    window.requestAnimationFrame(() => {
      nodes.status.textContent = message;
    });
  }
}

function formatEvents(value) {
  const count = Number(value) || 0;
  return `${new Intl.NumberFormat("en-US").format(count)} ${
    count === 1 ? "event" : "events"
  }`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(
    Number(value) || 0,
  );
}

function createEmptyRail() {
  return Object.freeze({
    setModel() {},
    setVisible() {},
  });
}
