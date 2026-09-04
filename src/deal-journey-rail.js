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
    summary: root.querySelector("[data-deal-journey-summary]"),
    count: root.querySelector("[data-deal-journey-count]"),
    states: root.querySelector("[data-deal-journey-states]"),
    terms: root.querySelector("[data-deal-journey-terms]"),
    activity: root.querySelector("[data-deal-journey-events-list]"),
    status: root.querySelector("[data-deal-journey-status]"),
  };
  const controller = new AbortController();
  const listenerOptions = { signal: controller.signal };
  let model = null;
  let open = false;

  if (reducedMotion) root.dataset.reducedMotion = "true";

  nodes.toggle?.addEventListener("click", () => {
    open = !open;
    syncOpenState();
    if (open) revealCurrentEvent();
    announce(open ? "Deal details opened" : "Deal details closed");
  }, listenerOptions);

  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    open = false;
    syncOpenState();
    nodes.toggle?.focus({ preventScroll: true });
    announce("Deal details closed");
  }, listenerOptions);

  nodes.activity?.addEventListener("pointerover", (event) => {
    if (event.pointerType === "touch") return;
    const trigger = event.target?.closest?.("[data-deal-event-timestamp]");
    if (trigger?.contains(event.relatedTarget)) return;
    selectActivityEvent(event.target, false);
  }, listenerOptions);
  nodes.activity?.addEventListener("pointerleave", (event) => {
    if (
      event.pointerType !== "touch" &&
      !nodes.activity?.contains(root.ownerDocument.activeElement)
    ) {
      clearActivitySelection();
    }
  }, listenerOptions);
  nodes.activity?.addEventListener("focusin", (event) => {
    selectActivityEvent(event.target, true);
  }, listenerOptions);
  nodes.activity?.addEventListener("focusout", (event) => {
    if (!nodes.activity?.contains(event.relatedTarget)) clearActivitySelection();
  }, listenerOptions);
  nodes.activity?.addEventListener("click", (event) => {
    selectActivityEvent(event.target, true);
  }, listenerOptions);
  root.ownerDocument.addEventListener("desk:deal-revision-select", (event) => {
    if (String(event.detail?.dealId) !== String(model?.id)) return;
    selectActivityByTimestamp(Number(event.detail?.timestamp));
  }, listenerOptions);
  root.ownerDocument.addEventListener("desk:deal-revision-clear", (event) => {
    if (String(event.detail?.dealId) !== String(model?.id)) return;
    clearActivitySelection({ dispatch: false });
  }, listenerOptions);

  setVisible(false);

  return Object.freeze({ setModel, setVisible, destroy });

  function setModel(nextModel) {
    model = nextModel;
    if (!model) {
      open = false;
      clearContent();
      setVisible(false);
      return;
    }
    root.dataset.dealId = String(model.id);

    renderStates();
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

  function renderStates() {
    if (!nodes.states) return;
    const fragment = root.ownerDocument.createDocumentFragment();
    dealStates(model).forEach(({ label, value, current }) => {
      const item = root.ownerDocument.createElement("div");
      item.className = "deal-journey-rail__state";
      if (current) item.dataset.current = "true";

      const name = root.ownerDocument.createElement("dt");
      name.textContent = label;

      const detail = root.ownerDocument.createElement("dd");
      detail.textContent = value;

      item.append(name, detail);
      fragment.append(item);
    });
    nodes.states.replaceChildren(fragment);
  }

  function renderTerms() {
    if (!nodes.terms) return;
    const rows = dealTerms(model).map(({ label, value }) => {
      const row = root.ownerDocument.createElement("div");
      row.className = "deal-journey-rail__term";

      const name = root.ownerDocument.createElement("dt");
      name.className = "deal-journey-rail__term-label";
      name.textContent = label;

      const detail = root.ownerDocument.createElement("dd");
      detail.className = "deal-journey-rail__term-value";
      detail.textContent = value;

      row.append(name, detail);
      return row;
    });
    nodes.terms.replaceChildren(...rows);
  }

  function renderActivity() {
    if (!nodes.activity) return;
    const rows = eventsForModel().map((dealEvent) => {
      const row = root.ownerDocument.createElement("li");
      row.className = "deal-journey-rail__activity-item";
      row.dataset.stage = dealEvent.stage;
      row.dataset.status = dealEvent.status;
      const select = root.ownerDocument.createElement("button");
      select.className = "deal-journey-rail__activity-select";
      select.type = "button";
      select.dataset.dealEventTimestamp = String(dealEvent.timestamp);
      select.dataset.dealEventId = dealEvent.id;
      if (dealEvent.status === "current") {
        select.setAttribute("aria-current", "step");
      }
      select.setAttribute(
        "aria-label",
        `${dealEvent.status === "current" ? "Current event, " : ""}${compactEventLabel(dealEvent)}, ${compactActor(dealEvent.actor)}, ${formatEventTime(dealEvent.timestamp)} UTC`,
      );

      const time = root.ownerDocument.createElement("time");
      time.className = "deal-journey-rail__activity-time";
      time.dateTime = new Date(dealEvent.timestamp * 1000).toISOString();
      time.textContent = formatEventTime(dealEvent.timestamp);

      const action = root.ownerDocument.createElement("strong");
      action.className = "deal-journey-rail__activity-action";
      action.textContent = compactEventLabel(dealEvent);

      const actor = root.ownerDocument.createElement("span");
      actor.className = "deal-journey-rail__activity-actor";
      actor.textContent = compactActor(dealEvent.actor);

      select.append(time, action, actor);
      row.append(select);
      return row;
    });

    nodes.activity.replaceChildren(...rows);
  }

  function syncSummary() {
    if (!model) return;
    const summary = compactTermSummary(model);
    const eventCount = formatEvents(eventsForModel().length);
    if (nodes.summary) nodes.summary.textContent = summary;
    if (nodes.count) nodes.count.textContent = eventCount;
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

  function revealCurrentEvent() {
    requestAnimationFrame(() => {
      const current = nodes.activity?.querySelector('[aria-current="step"]');
      const scrollLeft = current
        ? current.offsetLeft - (nodes.activity.clientWidth - current.offsetWidth) / 2
        : 0;
      nodes.activity?.scrollTo({
        left: Math.max(0, scrollLeft),
        behavior: "auto",
      });
    });
  }

  function selectActivityEvent(target, announceSelection) {
    const trigger = target?.closest?.("[data-deal-event-timestamp]");
    if (!trigger || !nodes.activity?.contains(trigger)) return;
    nodes.activity
      .querySelectorAll("[data-selected]")
      .forEach((node) => node.removeAttribute("data-selected"));
    trigger.dataset.selected = "true";
    root.dispatchEvent(new CustomEvent("desk:deal-event-select", {
      bubbles: true,
      detail: {
        dealId: model.id,
        timestamp: Number(trigger.dataset.dealEventTimestamp),
        announce: announceSelection,
      },
    }));
  }

  function selectActivityByTimestamp(timestamp) {
    if (!Number.isFinite(timestamp)) return;
    const triggers = Array.from(
      nodes.activity?.querySelectorAll("[data-deal-event-timestamp]") || [],
    );
    const nearest = triggers.reduce((closest, trigger) => {
      const distance = Math.abs(
        Number(trigger.dataset.dealEventTimestamp) - timestamp,
      );
      return !closest || distance < closest.distance
        ? { trigger, distance }
        : closest;
    }, null)?.trigger;
    if (!nearest) return;
    triggers.forEach((trigger) => trigger.removeAttribute("data-selected"));
    nearest.dataset.selected = "true";
  }

  function clearActivitySelection({ dispatch = true } = {}) {
    nodes.activity
      ?.querySelectorAll("[data-selected]")
      .forEach((node) => node.removeAttribute("data-selected"));
    if (dispatch && model) {
      root.dispatchEvent(new CustomEvent("desk:deal-event-clear", {
        bubbles: true,
        detail: { dealId: model.id },
      }));
    }
  }

  function clearContent() {
    nodes.states?.replaceChildren();
    nodes.terms?.replaceChildren();
    nodes.activity?.replaceChildren();
    delete root.dataset.dealId;
    if (nodes.summary) nodes.summary.textContent = "";
    if (nodes.count) nodes.count.textContent = "";
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

  function destroy() {
    controller.abort();
    clearActivitySelection({ dispatch: false });
    clearContent();
    root.hidden = true;
    root.toggleAttribute("inert", true);
  }
}

function dealStates(model) {
  const states = [
    {
      label: "Rate",
      value: optionalText(model?.priceStatusLabel) || "Open",
    },
    {
      label: "Capacity",
      value: optionalText(model?.checksStatusLabel) || "Pending",
    },
    {
      label: "Contract",
      value: optionalText(model?.contractStatusLabel) || "Draft",
    },
    {
      label: "Delivery",
      value: optionalText(model?.deliveryStatusLabel) || "Not scheduled",
    },
  ];
  const complete = [
    ["Rate agreed", "Agreed", "Complete"].includes(states[0].value),
    ["Confirmed", "Complete"].includes(states[1].value),
    ["Signed", "Complete"].includes(states[2].value),
    ["Complete"].includes(states[3].value),
  ];
  const firstOpen = complete.findIndex((finished) => !finished);
  const currentIndex = firstOpen < 0 ? states.length - 1 : firstOpen;
  return states.map((state, index) => ({
    ...state,
    current: index === currentIndex,
  }));
}

function dealTerms(model) {
  const rows = [
    {
      label: "Structure",
      value: [optionalText(model?.sideLabel), optionalText(model?.type)]
        .filter(Boolean)
        .join(" / "),
    },
    {
      label: "Capacity",
      value: optionalText(
        model?.quantityFormatted && model?.asset && model?.nodesLabel
          ? `${model.nodesLabel} / ${model.quantityFormatted} ${model.asset}`
          : model?.capacityLabel,
      ),
    },
    {
      label: "Deployment",
      value: [model?.region, model?.fabric, compactService(model?.service)]
        .map(optionalText)
        .filter(Boolean)
        .join(" / "),
    },
    {
      label: "Window",
      value: [
        optionalText(model?.rfsLabel ?? model?.rfs),
        optionalText(model?.termLabel),
      ]
        .filter(Boolean)
        .join(" / "),
    },
    {
      label: "Rate",
      value: [
        optionalText(model?.rateLabel)?.replace("GPU hour", "GPU-hr"),
        Number.isFinite(Number(model?.quote?.prepayPercent))
          ? `${NUMBER_FORMATTER.format(Number(model.quote.prepayPercent))}% prepay`
          : "",
      ]
        .filter(Boolean)
        .join(" / "),
    },
  ];

  return rows.filter((row) => row.value);
}

function compactTermSummary(model) {
  return optionalText(model?.contractStatusLabel) ||
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
    "mandate-opened": "Mandate opened",
    "rfq-sent": "RFQ sent",
    "ask-opened": "Quote opened",
    "price-agreed": "Rate agreed",
    "capacity-verified": "Capacity confirmed",
    "agreement-sent": "Draft sent",
    "service-terms-open": "Terms review",
  };
  return labels[dealEvent?.id] || optionalText(dealEvent?.label);
}

function compactActor(actor) {
  return optionalText(actor)
    .replace(/^Broker$/i, "Desk")
    .replace(/^Seller$/i, "Provider")
    .replace(/^Buyer and seller$/i, "Buyer + Provider");
}

function compactService(service) {
  return optionalText(service).replace(/^Dedicated\s+/i, "");
}

function optionalText(value) {
  return String(value ?? "").trim();
}

function createEmptyRail() {
  return Object.freeze({
    setModel() {},
    setVisible() {},
    destroy() {},
  });
}
