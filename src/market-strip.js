import { createMarketStripModel } from "./market-strip-model.js";
import { createMarketStripPreview } from "./market-strip-preview.js";

const SPEED = 14; // Pixels per second; only scroll when the complete row won't fit.
const RESUME_DURATION = 200;

export function createMarketStrip(root, { renderPreview, onSelect, onRemove } = {}) {
  if (!root) return { update() {}, notice() {}, unavailable() {}, destroy() {} };
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const viewport = root.querySelector("[data-market-strip-viewport]");
  const track = root.querySelector("[data-market-strip-track]");
  const status = doc.createElement("span");
  status.className = "desk-market-strip__notice";
  status.setAttribute("role", "status");
  status.hidden = true;
  root.append(status);
  let noticeTimer = 0;
  const media = win.matchMedia("(prefers-reduced-motion: reduce)");
  const touchMedia = win.matchMedia("(hover: none), (pointer: coarse)");
  let model = null;
  let group = null;
  let copy = null;
  let distance = 0;
  let motion = null;
  let resumeFrame = 0;
  let measureFrame = 0;
  let hovered = false;
  let focused = false;
  let pointerFocus = false;
  let manualInteraction = false;
  let pageHidden = false;
  let overflowing = false;
  let destroyed = false;
  let previewActive = false;
  const preview = renderPreview && onSelect ? createMarketStripPreview(root, {
    getItem: (id) => model?.items.find((item) => item.id === id),
    render: renderPreview,
    onSelect,
    onRemove,
    onActiveChange(active) { previewActive = active; syncMotion(); },
  }) : null;

  function element(tag, className, text) {
    const node = doc.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function update(payloads) {
    const next = payloads?.items ? payloads : createMarketStripModel(payloads);
    if (next.key === model?.key) return;
    const hadListFocus = viewport.contains(doc.activeElement);
    const focusedId = doc.activeElement?.dataset.marketTarget;
    const previousOffset = offset();
    preview?.close();
    model = next;
    clearMotion();
    track.replaceChildren();
    group = null;
    copy = null;
    viewport.scrollLeft = 0;
    root.dataset.state = next.items.length ? "ready" : next.empty ? "empty" : "unavailable";
    if (!next.items.length) {
      track.append(element("span", "desk-market-strip__empty", next.empty ? "No pinned charts" : "Prices unavailable"));
      measure();
      if (hadListFocus) viewport.focus({ preventScroll: true });
      return;
    }
    group = element("ul", "desk-market-strip__group");
    for (const item of next.items) {
      const entry = element("li", "desk-market-strip__item");
      entry.dataset.marketInstrument = item.id;
      const unit = item.displayUnit ?? (item.unit === "USD per GPU-hour" ? "/GPU-h" : "/MWh");
      const price = item.displayValue ?? new Intl.NumberFormat("en-US", {
        style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
      }).format(item.value);
      entry.dataset.observedAt = item.observedAt;
      entry.dataset.kind = item.kind;
      const trigger = element(preview ? "button" : "span", "desk-market-strip__link");
      if (preview) {
        trigger.type = "button";
        trigger.dataset.marketTarget = item.id;
        trigger.setAttribute("aria-label", `${item.label}, ${price} ${unit}. Open in Monitor`);
      }
      trigger.append(
        element("span", "desk-market-strip__name", item.label),
        element("strong", "desk-market-strip__price", price),
        element("span", "desk-market-strip__unit", unit),
      );
      entry.append(trigger);
      group.append(entry);
    }
    const stamp = element("li", "desk-market-strip__stamp", next.observationLabel);
    group.append(stamp);
    track.append(group);
    copy = group.cloneNode(true);
    copy.setAttribute("aria-hidden", "true");
    copy.hidden = true;
    // Pointer users can open the visible repeated prices. Keep only the original
    // buttons in the keyboard/accessibility tree, with no hidden focus targets.
    copy.querySelectorAll("button").forEach((button) => {
      const duplicate = element("span", button.className);
      duplicate.dataset.marketTarget = button.dataset.marketTarget;
      duplicate.append(...button.childNodes);
      button.replaceWith(duplicate);
    });
    // Only the real list exposes instrument hooks and accessible content.
    copy.querySelectorAll("[data-market-instrument]").forEach((node) => node.removeAttribute("data-market-instrument"));
    track.append(copy);
    measure(previousOffset);
    if (hadListFocus) {
      const retained = [...group.querySelectorAll("button")].find(button => button.dataset.marketTarget === focusedId);
      (retained || group.querySelector("button") || viewport).focus({ preventScroll: true });
    }
  }

  function manualMode() { return media.matches || touchMedia.matches; }

  function offset() {
    const animated = motion ? Number(motion.currentTime || 0) * SPEED / 1000 : 0;
    return distance ? (animated + viewport.scrollLeft) % distance : 0;
  }

  function hold() {
    win.cancelAnimationFrame(resumeFrame);
    resumeFrame = 0;
    motion?.pause();
    root.dataset.moving = "false";
  }

  function clearMotion() {
    hold();
    motion?.cancel();
    motion = null;
  }

  function canMove() {
    return overflowing && !manualMode() && !hovered && !focused && !previewActive &&
      !manualInteraction && !doc.hidden && !pageHidden && !destroyed;
  }

  function createMotion(at) {
    motion = track.animate([
      { transform: "translate3d(0,0,0)" },
      { transform: `translate3d(${-distance}px,0,0)` },
    ], { duration: distance / SPEED * 1000, iterations: Infinity, easing: "linear" });
    motion.id = "desk-market-scroll";
    motion.pause();
    motion.currentTime = at / SPEED * 1000;
    viewport.scrollLeft = 0;
  }

  function resume() {
    if (resumeFrame || motion.playState === "running") return;
    const animation = motion;
    animation.playbackRate = 0;
    animation.play();
    const started = win.performance.now();
    // Only the brief speed ramp runs in JS. The steady loop is a compositor
    // transform: no per-frame scrolling, geometry reads, or DOM reconstruction.
    function accelerate(time) {
      resumeFrame = 0;
      if (!canMove() || motion !== animation) { hold(); return; }
      const progress = Math.max(0, Math.min(1, (time - started) / RESUME_DURATION));
      animation.updatePlaybackRate(1 - (1 - progress) ** 3);
      if (progress < 1) resumeFrame = win.requestAnimationFrame(accelerate);
    }
    resumeFrame = win.requestAnimationFrame(accelerate);
  }

  function syncMotion() {
    if (destroyed) return;
    root.dataset.paused = String(hovered || focused || previewActive || manualInteraction);
    if (!canMove()) { hold(); return; }
    const at = offset();
    if (!motion) createMotion(at);
    else if (viewport.scrollLeft) {
      motion.currentTime = at / SPEED * 1000;
      viewport.scrollLeft = 0;
    }
    resume();
    root.dataset.moving = "true";
  }

  function measure(previousOffset = offset()) {
    if (destroyed) return;
    clearMotion();
    distance = group?.getBoundingClientRect().width || 0;
    overflowing = distance > viewport.clientWidth + 1;
    root.dataset.overflow = String(overflowing);
    root.dataset.motion = manualMode() ? "manual" : "auto";
    if (copy) copy.hidden = !overflowing || manualMode();
    viewport.tabIndex = overflowing ? 0 : -1;
    const at = overflowing ? previousOffset % distance : 0;
    if (overflowing && !manualMode() && !focused && !manualInteraction) createMotion(at);
    else viewport.scrollLeft = at;
    syncMotion();
  }

  function scheduleMeasure() {
    if (!measureFrame) measureFrame = win.requestAnimationFrame(() => {
      measureFrame = 0;
      measure();
    });
  }

  function useNativeScroll() {
    const at = offset();
    clearMotion();
    viewport.scrollLeft = at;
  }

  const onEnter = (event) => { if (event.pointerType !== "touch") { hovered = true; syncMotion(); } };
  const onLeave = () => { hovered = manualInteraction = false; syncMotion(); };
  const onFocus = (event) => {
    focused = !pointerFocus;
    if (focused && viewport.contains(event.target)) {
      useNativeScroll();
      // Focused originals must remain reachable even when their visual duplicate
      // was passing through the viewport before keyboard navigation began.
      if (event.target !== viewport) event.target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    }
    syncMotion();
  };
  const onBlur = (event) => {
    focused = !pointerFocus && root.contains(event.relatedTarget);
    if (!focused) manualInteraction = false;
    syncMotion();
  };
  const onPointerDown = () => { pointerFocus = true; focused = false; syncMotion(); };
  const onKey = () => { pointerFocus = false; if (root.contains(doc.activeElement)) { focused = true; useNativeScroll(); syncMotion(); } };
  const onWheel = () => {
    if (!overflowing) return;
    manualInteraction = true;
    useNativeScroll();
    syncMotion();
  };
  const onPageHide = () => { pageHidden = true; hold(); };
  const onPageShow = () => { pageHidden = false; syncMotion(); };
  root.addEventListener("pointerenter", onEnter);
  root.addEventListener("pointerleave", onLeave);
  root.addEventListener("focusin", onFocus, true);
  root.addEventListener("focusout", onBlur);
  root.addEventListener("pointerdown", onPointerDown, true);
  viewport.addEventListener("wheel", onWheel, { passive: true });
  doc.addEventListener("keydown", onKey, true);
  doc.addEventListener("visibilitychange", syncMotion);
  win.addEventListener("pagehide", onPageHide);
  win.addEventListener("pageshow", onPageShow);
  media.addEventListener("change", scheduleMeasure);
  touchMedia.addEventListener("change", scheduleMeasure);
  const observer = new win.ResizeObserver(scheduleMeasure);
  observer.observe(root);
  observer.observe(viewport);
  doc.fonts.ready.then(() => { if (!destroyed) scheduleMeasure(); });

  return {
    update,
    notice(message) {
      win.clearTimeout(noticeTimer);
      status.textContent = message;
      status.hidden = false;
      noticeTimer = win.setTimeout(() => { status.hidden = true; }, 6000);
    },
    unavailable() { if (!model) update(); },
    destroy() {
      destroyed = true;
      win.clearTimeout(noticeTimer);
      status.remove();
      preview?.destroy();
      clearMotion();
      win.cancelAnimationFrame(measureFrame);
      observer.disconnect();
      root.removeEventListener("pointerenter", onEnter);
      root.removeEventListener("pointerleave", onLeave);
      root.removeEventListener("focusin", onFocus, true);
      root.removeEventListener("focusout", onBlur);
      root.removeEventListener("pointerdown", onPointerDown, true);
      viewport.removeEventListener("wheel", onWheel);
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("visibilitychange", syncMotion);
      win.removeEventListener("pagehide", onPageHide);
      win.removeEventListener("pageshow", onPageShow);
      media.removeEventListener("change", scheduleMeasure);
      touchMedia.removeEventListener("change", scheduleMeasure);
    },
  };
}
