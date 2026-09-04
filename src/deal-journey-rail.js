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
const PLAYBACK_DURATION = 7000;

export function createDealJourneyRail({ root, reducedMotion = false } = {}) {
  if (!root) return createEmptyRail();

  const nodes = {
    toggle: root.querySelector("[data-deal-journey-toggle]"),
    body: root.querySelector("[data-deal-journey-body]"),
    summary: root.querySelector("[data-deal-journey-summary]"),
    count: root.querySelector("[data-deal-journey-count]"),
    activity: root.querySelector("[data-deal-journey-events-list]"),
    status: root.querySelector("[data-deal-journey-status]"),
  };
  const controller = new AbortController();
  const listenerOptions = { signal: controller.signal };
  const view = root.ownerDocument.defaultView;
  let model = null;
  let open = false;
  let playbackFrame = 0;
  let playbackStartedAt = 0;
  let playbackElapsed = 0;
  let playbackIndex = -1;
  let playbackRunning = false;
  let pointerPaused = false;
  let focusPaused = false;
  let chartPaused = false;
  let touchPaused = false;
  let playbackSteps = [];

  if (reducedMotion) root.dataset.reducedMotion = "true";

  nodes.toggle?.addEventListener("click", () => {
    open = !open;
    if (open) touchPaused = false;
    syncOpenState();
    if (open && !canPlay()) revealCurrentEvent();
    announce(open ? "Activity opened" : "Activity closed");
  }, listenerOptions);

  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    open = false;
    syncOpenState();
    nodes.toggle?.focus({ preventScroll: true });
    announce("Activity closed");
  }, listenerOptions);

  nodes.activity?.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "touch") return;
    pointerPaused = true;
    syncPlayback();
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
    pointerPaused = false;
    syncPlayback();
  }, listenerOptions);
  nodes.activity?.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") return;
    touchPaused = true;
    syncPlayback();
  }, listenerOptions);
  nodes.activity?.addEventListener("focusin", (event) => {
    focusPaused = true;
    syncPlayback();
    selectActivityEvent(event.target, true);
  }, listenerOptions);
  nodes.activity?.addEventListener("focusout", (event) => {
    if (!nodes.activity?.contains(event.relatedTarget)) {
      focusPaused = false;
      clearActivitySelection();
      syncPlayback();
    }
  }, listenerOptions);
  nodes.activity?.addEventListener("click", (event) => {
    selectActivityEvent(event.target, true);
  }, listenerOptions);
  root.ownerDocument.addEventListener("desk:deal-revision-select", (event) => {
    if (String(event.detail?.dealId) !== String(model?.id)) return;
    chartPaused = true;
    syncPlayback();
    selectActivityByTimestamp(Number(event.detail?.timestamp));
  }, listenerOptions);
  root.ownerDocument.addEventListener("desk:deal-revision-clear", (event) => {
    if (String(event.detail?.dealId) !== String(model?.id)) return;
    chartPaused = false;
    clearActivitySelection({ dispatch: false });
    syncPlayback();
  }, listenerOptions);
  root.ownerDocument.addEventListener("visibilitychange", () => {
    syncPlayback();
  }, listenerOptions);

  setVisible(false);

  return Object.freeze({ setModel, setVisible, destroy });

  function setModel(nextModel) {
    stopPlayback({ reset: true });
    model = nextModel;
    if (!model) {
      open = false;
      clearContent();
      setVisible(false);
      return;
    }
    root.dataset.dealId = String(model.id);

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
      pointerPaused = false;
      focusPaused = false;
      chartPaused = false;
      touchPaused = false;
    }
    root.hidden = !show;
    root.toggleAttribute("inert", !show);
    syncOpenState();
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

      select.append(action, time);
      row.append(select);
      return row;
    });

    nodes.activity.replaceChildren(...rows);
    playbackSteps = buildPlaybackSteps();
  }

  function syncSummary() {
    if (!model) return;
    const summary = compactTermSummary(model);
    const count = eventsForModel().length;
    const eventCount = formatEvents(count);
    if (nodes.summary) nodes.summary.textContent = "";
    if (nodes.count) nodes.count.textContent = NUMBER_FORMATTER.format(count);
    root.setAttribute(
      "aria-label",
      `Deal activity. ${eventCount}. Current status: ${summary}.`,
    );
    nodes.toggle?.setAttribute(
      "aria-label",
      `${open ? "Close" : "Open"} deal activity. ${eventCount}. Current status: ${summary}.`,
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
    if (!open) clearActivitySelection();
    if (model) syncSummary();
    syncPlayback();
  }

  function revealCurrentEvent() {
    requestAnimationFrame(() => {
      const current = nodes.activity?.querySelector('[aria-current="step"]');
      revealActivityEvent(current);
    });
  }

  function revealActivityEvent(trigger, { smooth = false } = {}) {
    if (!trigger || !nodes.activity) return;
    const vertical = nodes.activity.scrollHeight > nodes.activity.clientHeight + 1;
    nodes.activity.scrollTo(vertical
      ? {
          top: Math.max(
            0,
            trigger.offsetTop - (nodes.activity.clientHeight - trigger.offsetHeight) / 2,
          ),
          behavior: smooth && !reducedMotion ? "smooth" : "auto",
        }
      : {
          left: Math.max(
            0,
            trigger.offsetLeft - (nodes.activity.clientWidth - trigger.offsetWidth) / 2,
          ),
          behavior: smooth && !reducedMotion ? "smooth" : "auto",
        });
  }

  function selectActivityEvent(target, announceSelection) {
    const trigger = target?.closest?.("[data-deal-event-timestamp]");
    if (!trigger || !nodes.activity?.contains(trigger)) return;
    alignPlaybackTo(trigger);
    applyActivitySelection(trigger, {
      announceSelection,
      dispatch: true,
    });
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
    alignPlaybackTo(nearest);
    applyActivitySelection(nearest, {
      dispatch: false,
      reveal: open,
    });
  }

  function applyActivitySelection(
    trigger,
    {
      announceSelection = false,
      dispatch = false,
      playback = false,
      reveal = false,
    } = {},
  ) {
    if (!trigger || !nodes.activity?.contains(trigger)) return;
    nodes.activity
      .querySelectorAll("[data-selected]")
      .forEach((node) => node.removeAttribute("data-selected"));
    trigger.dataset.selected = "true";
    if (reveal) revealActivityEvent(trigger, { smooth: playback });
    if (!dispatch || !model) return;
    root.dispatchEvent(new CustomEvent("desk:deal-event-select", {
      bubbles: true,
      detail: {
        dealId: model.id,
        timestamp: Number(trigger.dataset.dealEventTimestamp),
        announce: announceSelection,
        playback,
      },
    }));
  }

  function buildPlaybackSteps() {
    const triggers = Array.from(
      nodes.activity?.querySelectorAll("[data-deal-event-timestamp]") || [],
    );
    if (!triggers.length) return [];

    const revisionsByTimestamp = new Map();
    const revisions = Array.isArray(model?.quoteHistory)
      ? [...model.quoteHistory].sort(
        (left, right) => Number(left?.timestamp) - Number(right?.timestamp),
      )
      : [];
    revisions.forEach((revision) => {
      const timestamp = Number(revision?.timestamp);
      const buyerBid = Number(revision?.buyerBid);
      const sellerAsk = Number(revision?.sellerAsk);
      if (
        Number.isFinite(timestamp) &&
        Number.isFinite(buyerBid) &&
        Number.isFinite(sellerAsk)
      ) {
        revisionsByTimestamp.set(timestamp, { timestamp, buyerBid, sellerAsk });
      }
    });

    const distinctRevisions = Array.from(revisionsByTimestamp.values()).filter(
      (revision, index, rows) =>
        index === 0 ||
        revision.buyerBid !== rows[index - 1].buyerBid ||
        revision.sellerAsk !== rows[index - 1].sellerAsk,
    );
    const sampledRevisions = evenlySample(distinctRevisions, 9);
    const eventsByTimestamp = new Map();
    eventsForModel().forEach((dealEvent) => {
      const timestamp = Number(dealEvent?.timestamp);
      if (!Number.isFinite(timestamp)) return;
      const matches = eventsByTimestamp.get(timestamp) || [];
      matches.push(dealEvent);
      eventsByTimestamp.set(timestamp, matches);
    });
    const triggerById = new Map(
      triggers.map((trigger) => [trigger.dataset.dealEventId, trigger]),
    );
    const steps = sampledRevisions.flatMap((revision) => {
      const matches = eventsByTimestamp.get(revision.timestamp) || [];
      const dealEvent = matches.find((event) =>
        Number.isFinite(Number(event?.valueUsdGpuHour))
      ) || matches.find((event) =>
        /^(Target|Quote)\s+\$|^Rate agreed/i.test(optionalText(event?.label))
      ) || matches[0];
      const trigger = triggerById.get(dealEvent?.id);
      return trigger ? [{ trigger, timestamp: revision.timestamp }] : [];
    });
    const current = [...eventsForModel()].reverse().find(
      (dealEvent) => dealEvent.status === "current",
    );
    const currentTrigger = triggerById.get(current?.id);
    if (
      currentTrigger &&
      currentTrigger !== steps.at(-1)?.trigger
    ) {
      steps.push({
        trigger: currentTrigger,
        timestamp: Number(current.timestamp),
        coda: true,
      });
    }
    return steps;
  }

  function playbackTriggers() {
    return playbackSteps.map((step) => step.trigger);
  }

  function alignPlaybackTo(trigger) {
    const triggers = playbackTriggers();
    const index = triggers.indexOf(trigger);
    if (index < 0 || !triggers.length) return;
    playbackIndex = index;
    playbackElapsed = (index / triggers.length) * PLAYBACK_DURATION;
  }

  function canPlay() {
    return Boolean(
      model &&
      open &&
      !root.hidden &&
      !reducedMotion &&
      !root.ownerDocument.hidden &&
      !pointerPaused &&
      !focusPaused &&
      !chartPaused &&
      !touchPaused &&
      playbackSteps.filter((step) => !step.coda).length > 1
    );
  }

  function syncPlayback() {
    if (canPlay()) {
      startPlayback();
    } else {
      stopPlayback({ reset: !open || root.hidden });
    }
  }

  function startPlayback() {
    if (playbackRunning || !canPlay() || !view) return;
    playbackRunning = true;
    root.dataset.playing = "true";
    playbackStartedAt = view.performance.now() - playbackElapsed;
    playbackIndex = -1;
    stepPlayback(view.performance.now());
  }

  function stepPlayback(timestamp) {
    if (!playbackRunning || !canPlay() || !view) {
      stopPlayback();
      return;
    }
    const steps = playbackSteps;
    const elapsed = (timestamp - playbackStartedAt) % PLAYBACK_DURATION;
    const index = Math.min(
      steps.length - 1,
      Math.floor((elapsed / PLAYBACK_DURATION) * steps.length),
    );
    playbackElapsed = elapsed;
    if (index !== playbackIndex) {
      playbackIndex = index;
      applyActivitySelection(steps[index].trigger, {
        dispatch: true,
        playback: true,
        reveal: true,
      });
    }
    playbackFrame = view.requestAnimationFrame(stepPlayback);
  }

  function stopPlayback({ reset = false } = {}) {
    if (playbackRunning && view) {
      playbackElapsed = (
        view.performance.now() - playbackStartedAt
      ) % PLAYBACK_DURATION;
    }
    playbackRunning = false;
    if (playbackFrame && view) view.cancelAnimationFrame(playbackFrame);
    playbackFrame = 0;
    delete root.dataset.playing;
    if (reset) {
      playbackElapsed = 0;
      playbackIndex = -1;
    }
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
    stopPlayback({ reset: true });
    playbackSteps = [];
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
    stopPlayback({ reset: true });
    controller.abort();
    clearActivitySelection({ dispatch: false });
    clearContent();
    root.hidden = true;
    root.toggleAttribute("inert", true);
  }
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

function optionalText(value) {
  return String(value ?? "").trim();
}

function evenlySample(rows, limit) {
  if (!Array.isArray(rows) || rows.length <= limit) return rows || [];
  const indices = Array.from({ length: limit }, (_value, index) =>
    Math.round((index * (rows.length - 1)) / (limit - 1))
  );
  return indices.map((index) => rows[index]);
}

function createEmptyRail() {
  return Object.freeze({
    setModel() {},
    setVisible() {},
    destroy() {},
  });
}
