const OPEN_DELAY = 180;
const CLOSE_DELAY = 140;

/** A single, reusable card above the ticker; never a second workspace renderer. */
export function createMarketStripPreview(root, { getItem, render, onSelect, onRemove, onActiveChange }) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const reduced = win.matchMedia("(prefers-reduced-motion: reduce)");
  const preview = doc.createElement("div");
  preview.className = "desk-market-preview";
  preview.dataset.marketPreview = "";
  preview.hidden = true;
  const open = doc.createElement("button");
  open.type = "button";
  open.className = "desk-market-preview__chart";
  open.dataset.marketPreviewOpen = "";
  const artifact = doc.createElement("span");
  artifact.className = "desk-market-preview__artifact";
  artifact.setAttribute("aria-hidden", "true");
  open.append(artifact);
  const actions = doc.createElement("div");
  actions.className = "desk-market-preview__actions";
  const remove = doc.createElement("button");
  remove.type = "button";
  remove.textContent = "Unpin";
  remove.dataset.marketPreviewRemove = "";
  remove.hidden = !onRemove;
  actions.append(remove);
  preview.append(open, actions);
  root.append(preview);
  let anchor = null;
  let activeItem = null;
  let openTimer = 0;
  let closeTimer = 0;
  let motion = null;
  let touch = false;
  let pointerFocus = false;
  let closing = false;
  let restoringFocus = false;
  let releaseArtifact = null;

  function clearTimers() {
    win.clearTimeout(openTimer);
    win.clearTimeout(closeTimer);
    openTimer = closeTimer = 0;
  }

  function close(animate = false) {
    if (animate === true && !preview.hidden && !reduced.matches) {
      if (closing) return;
      clearTimers();
      const opacity = win.getComputedStyle(preview).opacity;
      motion?.cancel();
      closing = true;
      motion = preview.animate([{ opacity }, { opacity: 0 }], {
        duration: 125, easing: "cubic-bezier(.23,1,.32,1)", fill: "forwards",
      });
      motion.onfinish = () => close();
      return;
    }
    const wasOpen = !preview.hidden;
    const returnFocus = preview.contains(doc.activeElement) ? anchor : null;
    clearTimers();
    motion?.cancel();
    closing = false;
    releaseArtifact?.();
    releaseArtifact = null;
    preview.hidden = true;
    anchor?.removeAttribute("data-preview-open");
    anchor = activeItem = null;
    if (wasOpen) onActiveChange(false);
    if (returnFocus?.isConnected) {
      restoringFocus = true;
      returnFocus.focus({ preventScroll: true });
      restoringFocus = false;
    }
  }

  function position() {
    if (preview.hidden || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    if (rect.right < 0 || rect.left > win.innerWidth) { close(); return; }
    const width = preview.getBoundingClientRect().width;
    const left = Math.max(12, Math.min(win.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2));
    preview.style.left = `${left}px`;
    preview.style.bottom = `${win.innerHeight - root.getBoundingClientRect().top + 10}px`;
  }

  function show(target, keyboard = false) {
    clearTimers();
    const item = getItem(target.dataset.marketTarget);
    if (!item || !target.isConnected) return;
    const wasOpen = !preview.hidden;
    const wasClosing = closing;
    const opacity = wasClosing ? win.getComputedStyle(preview).opacity : "0";
    const sameItem = wasOpen && activeItem?.id === item.id;
    motion?.cancel();
    closing = false;
    anchor?.removeAttribute("data-preview-open");
    anchor = target;
    activeItem = item;
    preview.hidden = false;
    open.setAttribute("aria-label", `Open ${item.label} in Monitor`);
    remove.setAttribute("aria-label", `Unpin ${item.label} from strip`);
    preview.dataset.instrument = item.id;
    if (!sameItem) {
      releaseArtifact?.();
      releaseArtifact = null;
      artifact.replaceChildren();
      const result = render(artifact, item);
      if (result === false) { close(); return; }
      if (typeof result === "function") releaseArtifact = result;
    }
    position();
    if (preview.hidden || !anchor) return;
    anchor.dataset.previewOpen = "true";
    onActiveChange(true);
    // Adjacent previews and keyboard actions are immediate; only the initial
    // pointer entry fades in. Reversing an exit continues from its current alpha.
    if (!reduced.matches && !keyboard && (!wasOpen || wasClosing)) {
      motion = preview.animate(
        wasClosing ? [{ opacity }, { opacity: 1 }] :
          [{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "translateY(0)" }],
        { duration: 180, easing: "cubic-bezier(.23,1,.32,1)" },
      );
    }
  }

  function schedule(target, immediate = false) {
    clearTimers();
    if (target === anchor && !preview.hidden && !closing) return;
    if (immediate || !preview.hidden) show(target, immediate);
    else openTimer = win.setTimeout(() => show(target), OPEN_DELAY);
  }

  function leave() {
    clearTimers();
    closeTimer = win.setTimeout(() => {
      if (pointerFocus || (!preview.contains(doc.activeElement) && !anchor?.contains(doc.activeElement))) close(true);
    }, CLOSE_DELAY);
  }

  function targetFor(event) {
    return event.target.closest?.("[data-market-target]");
  }
  function onOver(event) {
    if (event.pointerType === "touch") return;
    touch = false;
    if (preview.contains(event.target)) {
      clearTimers();
      if (closing && anchor) show(anchor);
      return;
    }
    const target = targetFor(event);
    if (target && !target.contains(event.relatedTarget)) schedule(target);
  }
  function onOut(event) {
    if (event.pointerType === "touch") return;
    if (targetFor(event)?.contains(event.relatedTarget)) return;
    if (preview.contains(event.relatedTarget) || anchor?.contains(event.relatedTarget)) return;
    if (targetFor(event) || preview.contains(event.target)) leave();
  }
  function onFocus(event) {
    if (restoringFocus) return;
    const target = targetFor(event);
    if (target && !touch) schedule(target, true);
    else if (preview.contains(event.target)) clearTimers();
  }
  function onBlur(event) {
    if (!preview.contains(event.relatedTarget) && !anchor?.contains(event.relatedTarget)) leave();
  }
  function onClick(event) {
    const target = targetFor(event);
    const removing = remove.contains(event.target);
    const item = target ? getItem(target.dataset.marketTarget) : open.contains(event.target) || removing ? activeItem : null;
    if (!item) return;
    close();
    if (removing) onRemove?.(item);
    else onSelect(item, event.detail === 0);
  }
  function onPointerDown(event) {
    pointerFocus = true;
    touch = event.pointerType === "touch";
    if (!root.contains(event.target) || (touch && !preview.contains(event.target))) close();
  }
  function onKey(event) {
    pointerFocus = false;
    touch = false;
    if (event.key === "Escape" && (!preview.hidden || openTimer)) {
      if (preview.contains(doc.activeElement)) anchor?.focus({ preventScroll: true });
      close();
      event.preventDefault();
      event.stopPropagation();
    } else if (event.metaKey || event.ctrlKey) close();
  }
  function onVisibility() { if (doc.hidden) close(); }
  const viewport = root.querySelector("[data-market-strip-viewport]");
  root.addEventListener("pointerover", onOver);
  root.addEventListener("pointerout", onOut);
  root.addEventListener("focusin", onFocus);
  root.addEventListener("focusout", onBlur);
  root.addEventListener("click", onClick);
  doc.addEventListener("pointerdown", onPointerDown, true);
  doc.addEventListener("keydown", onKey, true);
  doc.addEventListener("visibilitychange", onVisibility);
  viewport.addEventListener("scroll", position, { passive: true });
  win.addEventListener("resize", close);
  return {
    close,
    destroy() {
      close();
      root.removeEventListener("pointerover", onOver);
      root.removeEventListener("pointerout", onOut);
      root.removeEventListener("focusin", onFocus);
      root.removeEventListener("focusout", onBlur);
      root.removeEventListener("click", onClick);
      doc.removeEventListener("pointerdown", onPointerDown, true);
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("visibilitychange", onVisibility);
      viewport.removeEventListener("scroll", position);
      win.removeEventListener("resize", close);
      preview.remove();
    },
  };
}
