import { animate as motionAnimate } from "motion";

export function resolveSidecarWidth(viewportWidth, mobile = viewportWidth <= 960) {
  const viewport = Math.max(1, Number(viewportWidth) || 1200);
  const width = mobile ? 320 : Math.max(240, Math.min(320, viewport * 0.2));
  return Math.min(width, Math.max(0, viewport - 24));
}

// Owns presentation only. The command registry, chart, and login state stay mounted.
export function createDeskSidecar({
  root, toggle, dragHandle, reducedMotion = false,
  onOpen, onClose, onClosed, onDismiss, onModeChange, onPresentationChange,
  document: ownerDocument = root.ownerDocument,
  window: ownerWindow = ownerDocument.defaultView,
  animate = motionAnimate,
}) {
  const viewport = ownerWindow.matchMedia("(max-width: 960px)");
  const motionPreference = ownerWindow.matchMedia("(prefers-reduced-motion: reduce)");
  const html = ownerDocument.documentElement;
  let mobile = viewport.matches;
  let width = resolveSidecarWidth(ownerWindow.innerWidth, mobile);
  let position = 0;
  let velocity = 0;
  let lastFrame = 0;
  let desiredOpen = false;
  let presentation = "menu";
  let initialized = false;
  let destroyed = false;
  let animation = null;
  let revision = 0;
  let drag = null;
  let suppressClick = false;
  let deferredModal = false;
  let migrationQueued = false;

  function otherDialogOpen() {
    return Boolean(ownerDocument.querySelector?.("dialog[open]:not([data-desk-sidecar])"));
  }

  function wantsModal() {
    return presentation === "menu" || mobile;
  }

  function draw(value) {
    position = Math.max(0, Math.min(width, value));
    html.style.setProperty("--desk-sidecar-width", `${width}px`);
    const sidebar = presentation === "sidebar";
    html.dataset.deskSidebar = String(sidebar && (desiredOpen || position > 0));
    html.style.setProperty("--desk-sidecar-space", `${sidebar && !mobile ? position : 0}px`);
    html.style.setProperty("--desk-sidecar-progress", String(sidebar && width > 0 ? position / width : 0));
    root.dataset.presentation = presentation;
    if (sidebar) root.style.transform = `translateX(${position - width}px)`;
    else root.style.removeProperty("transform");
  }

  function stopAnimation() {
    revision++;
    animation?.stop();
    animation = null;
  }

  function settle(target, animateMotion) {
    stopAnimation();
    const currentRevision = revision;
    const finish = () => {
      if (currentRevision !== revision || destroyed) return;
      draw(target);
      velocity = 0;
      animation = null;
      if (!desiredOpen) {
        if (root.open) root.close();
        presentation = "menu";
        root.removeAttribute("data-closing");
        draw(0);
        onPresentationChange?.({ presentation });
        onClosed?.();
      }
    };
    if (!animateMotion || reducedMotion || motionPreference.matches || Math.abs(target - position) < 0.5) {
      finish();
      return;
    }
    lastFrame = ownerWindow.performance.now();
    animation = animate(position, target, {
      // Duration-based Motion springs discard velocity. These equivalent,
      // critically damped settings keep the ~300ms settle and the handoff.
      type: "spring", stiffness: 950, damping: 2 * Math.sqrt(950), mass: 1,
      restDelta: 0.5, restSpeed: 10, velocity,
      onUpdate(value) {
        if (currentRevision !== revision || destroyed) return;
        const now = ownerWindow.performance.now();
        if (now > lastFrame) velocity = Math.max(-3000, Math.min(3000, (value - position) * 1000 / (now - lastFrame)));
        lastFrame = now;
        draw(value);
      },
      onComplete: finish,
    });
  }

  function showDialog() {
    // Both dialog methods perform focusing steps. Focus is explicitly restored
    // after migration so changing presentation cannot reset the current input.
    root.inert = true;
    deferredModal = wantsModal() && otherDialogOpen();
    const modal = wantsModal() && !deferredModal;
    if (modal) root.showModal();
    else root.show();
    root.inert = false;
    root.setAttribute("aria-modal", String(modal));
  }

  function finishDeferredModal() {
    if (!deferredModal || migrationQueued || destroyed) return;
    migrationQueued = true;
    // Wait until the existing modal's close handlers have restored focus or
    // opened their next dialog before deciding whether the sidecar may be modal.
    queueMicrotask(() => {
      migrationQueued = false;
      if (destroyed || !deferredModal || !desiredOpen || !wantsModal() || otherDialogOpen()) return;
      const focused = ownerDocument.activeElement;
      if (root.open) root.close();
      showDialog();
      if (root.contains(focused)) focused.focus({ preventScroll: true });
      else onModeChange?.({ mobile, focus: true });
    });
  }

  function open({ presentation: nextPresentation = "menu", animate: animateMotion = true, focus = true, animateEntrance = false } = {}) {
    if (destroyed) return;
    if (!initialized) initialize();
    const changed = !desiredOpen;
    const changedPresentation = presentation !== nextPresentation;
    const focused = ownerDocument.activeElement;
    stopDrag();
    if (changedPresentation) {
      stopAnimation();
      if (root.open) root.close();
      presentation = nextPresentation === "sidebar" ? "sidebar" : "menu";
      position = 0;
      velocity = 0;
    }
    desiredOpen = true;
    root.removeAttribute("data-closing");
    html.dataset.sidecarOpen = "true";
    toggle?.setAttribute("aria-expanded", "true");
    draw(position);
    if (!root.open) showDialog();
    root.inert = false;
    if (changed) onOpen?.({ focus, animateEntrance });
    else if (changedPresentation && focused && root.contains(focused)) focused.focus({ preventScroll: true });
    if (changedPresentation) onPresentationChange?.({ presentation });
    settle(presentation === "sidebar" ? width : 0, animateMotion && presentation === "sidebar");
  }

  function close({ animate: animateMotion = true } = {}) {
    if (destroyed || !desiredOpen) return;
    stopDrag();
    desiredOpen = false;
    deferredModal = false;
    html.dataset.sidecarOpen = "false";
    toggle?.setAttribute("aria-expanded", "false");
    root.setAttribute("data-closing", "");
    root.inert = true;
    onClose?.();
    settle(0, animateMotion && presentation === "sidebar");
  }

  function initialize() {
    if (initialized || destroyed) return;
    initialized = true;
    root.inert = true;
    root.setAttribute("aria-modal", "true");
    html.dataset.sidecarOpen = "false";
    toggle?.setAttribute("aria-expanded", "false");
    draw(0);
    onPresentationChange?.({ presentation });
  }

  function updateViewport() {
    if (!initialized || destroyed) return;
    stopDrag();
    stopAnimation();
    const closing = !desiredOpen && root.open;
    const nextMobile = viewport.matches;
    const changedMode = presentation === "sidebar" && mobile !== nextMobile;
    const focused = ownerDocument.activeElement;
    if (changedMode && root.open) root.close();
    mobile = nextMobile;
    width = resolveSidecarWidth(ownerWindow.innerWidth, mobile);
    if (changedMode && desiredOpen) {
      showDialog();
      if (focused && root.contains(focused)) focused.focus({ preventScroll: true });
      else if (!mobile || deferredModal) focused?.focus?.({ preventScroll: true });
      onModeChange?.({ mobile, focus: mobile && !deferredModal && !root.contains(focused) });
    }
    velocity = 0;
    draw(desiredOpen && presentation === "sidebar" ? width : 0);
    if (closing) settle(0, false);
  }

  function updateMotionPreference() {
    if (motionPreference.matches) {
      stopDrag();
      settle(desiredOpen && presentation === "sidebar" ? width : 0, false);
    }
  }

  function stopDrag() {
    if (!drag) return;
    const previous = drag;
    drag = null;
    suppressClick ||= previous.moved;
    delete html.dataset.sidecarDragging;
    if (dragHandle.hasPointerCapture?.(previous.pointerId)) dragHandle.releasePointerCapture(previous.pointerId);
    return previous;
  }

  function pointerDown(event) {
    if (!desiredOpen || presentation !== "sidebar" || drag || otherDialogOpen() ||
      event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault();
    stopAnimation();
    velocity = 0;
    suppressClick = false;
    // Grab the presentation position, including midway through a snap spring.
    drag = {
      pointerId: event.pointerId, x: event.clientX, position, moved: false,
      samples: [{ position, time: event.timeStamp }],
    };
    html.dataset.sidecarDragging = "true";
    dragHandle.focus({ preventScroll: true });
    dragHandle.setPointerCapture(event.pointerId);
  }

  function pointerMove(event) {
    if (drag?.pointerId !== event.pointerId) return;
    event.preventDefault();
    let closeIntent = false;
    if (Number.isFinite(event.clientX)) {
      const delta = event.clientX - drag.x;
      drag.moved ||= Math.abs(delta) >= 6;
      closeIntent = delta <= -6;
      draw(drag.position + delta);
    }
    drag.samples.push({ position, time: event.timeStamp });
    while (drag.samples.length > 1 && drag.samples[0].time < event.timeStamp - 100) drag.samples.shift();
    const first = drag.samples[0];
    const elapsed = event.timeStamp - first.time;
    velocity = elapsed > 0 ? Math.max(-3000, Math.min(3000, (position - first.position) * 1000 / elapsed)) : 0;
    // A left pull is a close command, not a resize or a partially open state.
    // Hand the live position and velocity straight to the closing spring.
    if (closeIntent) dismiss();
  }

  function pointerEnd(event) {
    if (drag?.pointerId !== event.pointerId) return;
    pointerMove(event);
    // pointerMove may already have committed the close and released capture.
    if (!drag) return;
    stopDrag();
    settle(width, true);
  }

  function cancelDrag(event) {
    if (!drag || (event.pointerId !== undefined && drag.pointerId !== event.pointerId)) return;
    stopDrag();
    velocity = 0;
    if (desiredOpen && presentation === "sidebar") settle(width, true);
  }

  function dismiss() {
    if (destroyed || !desiredOpen || presentation !== "sidebar" || otherDialogOpen()) return false;
    if (onDismiss) onDismiss();
    else close();
    return true;
  }

  function handleClick(event) {
    // Pointer capture still produces a click after dragging. Only a native tap
    // or keyboard activation should act as this button's close action.
    if (suppressClick && event.detail !== 0) {
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    dismiss();
  }

  viewport.addEventListener("change", updateViewport);
  motionPreference.addEventListener("change", updateMotionPreference);
  ownerWindow.addEventListener("resize", updateViewport);
  ownerWindow.addEventListener("blur", cancelDrag);
  ownerDocument.addEventListener?.("close", finishDeferredModal, true);
  dragHandle?.addEventListener("pointerdown", pointerDown);
  dragHandle?.addEventListener("pointermove", pointerMove);
  dragHandle?.addEventListener("pointerup", pointerEnd);
  dragHandle?.addEventListener("pointercancel", cancelDrag);
  dragHandle?.addEventListener("lostpointercapture", cancelDrag);
  dragHandle?.addEventListener("click", handleClick);

  return {
    initialize, open, close,
    showSidebar: options => open({ ...options, presentation: "sidebar" }),
    centerMenu: options => open({ ...options, presentation: "menu" }),
    get isOpen() { return desiredOpen; },
    get presentation() { return presentation; },
    get modal() { return wantsModal() && !deferredModal; },
    get mobile() { return mobile; },
    destroy() {
      stopDrag();
      stopAnimation();
      destroyed = true;
      desiredOpen = false;
      presentation = "menu";
      root.inert = true;
      if (root.open) root.close();
      html.dataset.sidecarOpen = "false";
      draw(0);
      viewport.removeEventListener("change", updateViewport);
      motionPreference.removeEventListener("change", updateMotionPreference);
      ownerWindow.removeEventListener("resize", updateViewport);
      ownerWindow.removeEventListener("blur", cancelDrag);
      ownerDocument.removeEventListener?.("close", finishDeferredModal, true);
      dragHandle?.removeEventListener("pointerdown", pointerDown);
      dragHandle?.removeEventListener("pointermove", pointerMove);
      dragHandle?.removeEventListener("pointerup", pointerEnd);
      dragHandle?.removeEventListener("pointercancel", cancelDrag);
      dragHandle?.removeEventListener("lostpointercapture", cancelDrag);
      dragHandle?.removeEventListener("click", handleClick);
    },
  };
}
