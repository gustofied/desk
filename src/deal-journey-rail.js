const DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
});

const TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

const NUMBER_FORMATTER = new Intl.NumberFormat("en-US");

export function createDealJourneyRail({ root, reducedMotion = false } = {}) {
  if (!root) return createEmptyRail();

  const nodes = {
    toggle: root.querySelector("[data-deal-journey-toggle]"),
    body: root.querySelector("[data-deal-journey-body]"),
    terms: root.querySelector("[data-deal-journey-terms]"),
    activity: root.querySelector("[data-deal-journey-events-list]"),
    status: root.querySelector("[data-deal-journey-status]"),
  };
  let model = null;
  let open = false;

  if (reducedMotion) root.dataset.reducedMotion = "true";

  nodes.toggle?.addEventListener("click", () => {
    open = !open;
    syncOpenState();
    announce(open ? "Deal details opened" : "Deal details closed");
  });

  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    open = false;
    syncOpenState();
    nodes.toggle?.focus({ preventScroll: true });
    announce("Deal details closed");
  });

  setVisible(false);

  return Object.freeze({ setModel, setVisible });

  function setModel(nextModel) {
    model = nextModel;
    if (!model) {
      open = false;
      clearContent();
      setVisible(false);
      return;
    }

    renderTerms();
    renderActivity();
    syncSummary();
    syncOpenState();
  }

  function setVisible(visible) {
    const show = Boolean(visible && model);
    if (!show) {
      if (root.contains(root.ownerDocument.activeElement)) {
        root.ownerDocument.activeElement?.blur?.();
      }
      open = false;
    }
    root.hidden = !show;
    root.toggleAttribute("inert", !show);
    syncOpenState();
  }

  function renderTerms() {
    if (!nodes.terms) return;
    const rows = dealTerms(model).map(({ label, value }) => {
      const row = document.createElement("div");
      row.className = "deal-journey-rail__term";

      const name = document.createElement("dt");
      name.className = "deal-journey-rail__term-label";
      name.textContent = label;

      const detail = document.createElement("dd");
      detail.className = "deal-journey-rail__term-value";
      detail.textContent = value;

      row.append(name, detail);
      return row;
    });
    nodes.terms.replaceChildren(...rows);
  }

  function renderActivity() {
    if (!nodes.activity) return;
    const eventLog = eventsForModel();
    const rows = [...eventLog].slice(-4).reverse().map((dealEvent) => {
      const row = document.createElement("li");
      row.className = "deal-journey-rail__activity-item";
      row.dataset.stage = dealEvent.stage;
      row.dataset.status = dealEvent.status;
      if (dealEvent.status === "current") {
        row.setAttribute("aria-current", "step");
      }

      const time = document.createElement("time");
      time.className = "deal-journey-rail__activity-time";
      time.dateTime = new Date(dealEvent.timestamp * 1000).toISOString();
      time.textContent = formatEventTime(dealEvent.timestamp);

      const action = document.createElement("strong");
      action.className = "deal-journey-rail__activity-action";
      action.textContent = compactEventLabel(dealEvent);

      const actor = document.createElement("span");
      actor.className = "deal-journey-rail__activity-actor";
      actor.textContent = compactActor(dealEvent.actor);

      if (dealEvent.status === "current") {
        const current = document.createElement("span");
        current.className = "desk-data-rail__sr-only";
        current.textContent = "Current event. ";
        action.prepend(current);
      }

      row.append(time, action, actor);
      return row;
    });

    nodes.activity.replaceChildren(...rows);
  }

  function syncSummary() {
    if (!model) return;
    const summary = compactTermSummary(model);
    const eventCount = formatEvents(eventsForModel().length);
    root.setAttribute(
      "aria-label",
      `Deal details. ${summary}. ${eventCount}.`,
    );
    nodes.toggle?.setAttribute(
      "aria-label",
      `${open ? "Close" : "Open"} deal details. ${summary}.`,
    );
  }

  function syncOpenState() {
    nodes.toggle?.setAttribute("aria-expanded", String(open));
    if (nodes.body) {
      if (!open && nodes.body.contains(root.ownerDocument.activeElement)) {
        nodes.toggle?.focus({ preventScroll: true });
      }
      nodes.body.hidden = !open;
      nodes.body.toggleAttribute("inert", !open);
    }
    root.dataset.open = String(open);
    if (model) syncSummary();
  }

  function clearContent() {
    nodes.terms?.replaceChildren();
    nodes.activity?.replaceChildren();
  }

  function eventsForModel() {
    return Array.isArray(model?.eventLog) ? model.eventLog : [];
  }

  function announce(message) {
    if (!nodes.status) return;
    nodes.status.textContent = "";
    requestAnimationFrame(() => {
      nodes.status.textContent = message;
    });
  }
}

function dealTerms(model) {
  const rows = [
    {
      label: "Capacity",
      value: optionalText(
        model?.quantityFormatted && model?.asset
          ? `${model.quantityFormatted} ${model.asset}`
          : model?.capacityLabel,
      ),
    },
    { label: "Region", value: optionalText(model?.region) },
    { label: "Fabric", value: optionalText(model?.fabric) },
    { label: "Term", value: optionalText(model?.termLabel) },
    { label: "RFS", value: optionalText(model?.rfsLabel ?? model?.rfs) },
    {
      label: "Prepay",
      value: Number.isFinite(Number(model?.quote?.prepayPercent))
        ? `${NUMBER_FORMATTER.format(Number(model.quote.prepayPercent))}%`
        : "",
    },
  ];

  return rows.filter((row) => row.value);
}

function compactTermSummary(model) {
  return optionalText(model?.nextAction) ||
    optionalText(model?.workflowStatusLabel) ||
    optionalText(model?.statusLabel);
}

function formatEvents(value) {
  const count = Number(value) || 0;
  return `${NUMBER_FORMATTER.format(count)} ${count === 1 ? "event" : "events"}`;
}

function formatDate(timestamp) {
  return DATE_FORMATTER.format(new Date(Number(timestamp) * 1000)).toUpperCase();
}

function formatTime(timestamp) {
  return TIME_FORMATTER.format(new Date(Number(timestamp) * 1000));
}

function formatEventTime(timestamp) {
  return `${formatDate(timestamp)} ${formatTime(timestamp)}`;
}

function compactEventLabel(dealEvent) {
  const labels = {
    "agreement-sent": "Agreement sent",
    "service-terms-open": "Terms review",
  };
  return labels[dealEvent?.id] || optionalText(dealEvent?.label);
}

function compactActor(actor) {
  return optionalText(actor).replace(/^Buyer and seller$/i, "Buyer + Seller");
}

function optionalText(value) {
  return String(value ?? "").trim();
}

function createEmptyRail() {
  return Object.freeze({
    setModel() {},
    setVisible() {},
  });
}
