import { animate as motionAnimate } from "motion";
import { createDeskLogoMotion } from "./desk-logo.js";

// A visual preview only: this does not authenticate or protect any data.
// Kept in memory so a page refresh lets the login mock be tried again.
export function createDeskEntry({
  entry, content, button, onReveal, onLogout, reducedMotion = false, animate = motionAnimate,
  motionDocument = globalThis.document,
}) {
  let unlocked = !entry || !content || !button;
  let opened = false;
  let presentation = "menu";
  let revision = 0;
  let animations = [];
  let logoutFading = false;
  const targets = new Set();
  const buttonTabIndex = button?.getAttribute?.("tabindex") ?? null;
  const entryLabel = entry?.getAttribute?.("aria-label") || "Desk login";
  const motionPreference = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
  const logoMotion = createDeskLogoMotion({ root: button, reducedMotion, animate, motionDocument });

  function stopIdle() {
    logoMotion.stop();
  }

  function startIdle() {
    if (!opened || (unlocked && presentation !== "sidebar")) logoMotion.stop();
    else logoMotion.start();
  }

  function onMotionPreferenceChange() {
    if (logoutFading && !motionAllowed()) {
      clearMotion();
      sync();
    }
  }

  function syncButton() {
    if (!button) return;
    const passive = presentation === "sidebar";
    button.disabled = passive;
    button.inert = passive;
    button.setAttribute("aria-disabled", String(passive));
    if (passive) {
      button.setAttribute("aria-hidden", "true");
      button.setAttribute("tabindex", "-1");
    } else {
      button.removeAttribute("aria-hidden");
      if (buttonTabIndex === null) button.removeAttribute("tabindex");
      else button.setAttribute("tabindex", buttonTabIndex);
    }
  }

  function clearMotion() {
    revision++;
    logoutFading = false;
    animations.forEach(animation => animation.cancel());
    animations = [];
    for (const panel of targets) {
      panel?.style.removeProperty("opacity");
      panel?.style.removeProperty("transform");
    }
    targets.clear();
  }

  function play(target, keyframes, timing) {
    targets.add(target);
    animations.push(animate(target, keyframes, timing));
  }

  function settle() {
    const current = revision;
    Promise.all(animations).then(() => {
      if (current !== revision) return;
      clearMotion();
      sync();
    });
  }

  function sync() {
    if (!entry || !content) return;
    const showCommands = unlocked && presentation !== "sidebar";
    entry.hidden = showCommands;
    entry.inert = showCommands;
    content.hidden = !showCommands;
    content.inert = !showCommands;
    entry.setAttribute("aria-label", presentation === "sidebar" ? "Desk" : entryLabel);
    syncButton();
  }

  function setPresentation(value) {
    const next = value === "sidebar" ? "sidebar" : "menu";
    if (next === presentation) return;
    stopIdle();
    clearMotion();
    presentation = next;
    sync();
    startIdle();
  }

  function motionAllowed() {
    return !reducedMotion && !motionPreference?.matches;
  }

  function opacityOf(panel) {
    if (panel.hidden) return 0;
    const opacity = Number.parseFloat(motionDocument?.defaultView?.getComputedStyle(panel).opacity);
    return Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1;
  }

  function open({ animateEntrance = false } = {}) {
    stopIdle();
    clearMotion();
    opened = true;
    sync();
    if (!unlocked && presentation !== "sidebar" && animateEntrance && motionAllowed()) {
      play(entry, { opacity: [0, 1] },
        { duration: 0.24, ease: [0.23, 1, 0.32, 1] });
      settle();
    }
    startIdle();
    return unlocked;
  }

  function reveal(event) {
    if (!opened || presentation === "sidebar" || unlocked) return;
    const returning = logoutFading
      ? { entry: opacityOf(entry), content: opacityOf(content) }
      : null;
    // Pointer activation begins the reveal immediately; keyboard and reduced
    // motion activation settle directly into the command menu.
    revealMenu(Boolean(event.detail) && motionAllowed(), returning);
  }

  function revealMenu(animateReveal, returning = null) {
    stopIdle();
    clearMotion();
    unlocked = true;
    entry.inert = true;
    content.hidden = false;
    content.inert = false;
    const current = revision;
    onReveal?.();
    if (!opened || !unlocked || current !== revision) return;

    if (!animateReveal) {
      sync();
      return;
    }
    play(entry, { opacity: [returning?.entry ?? 1, 0] },
      { duration: 0.2, ease: [0.23, 1, 0.32, 1] });
    play(content, returning
      ? { opacity: [returning.content, 1] }
      : { opacity: [0, 1], transform: ["translateY(8px)", "translateY(0)"] },
      { duration: 0.28, ease: [0.23, 1, 0.32, 1] });
    // Only the initial visible options get choreography, never search updates.
    const rows = returning ? [] : [...(content.querySelectorAll?.("[data-command-index]") || [])].slice(0, 6);
    rows.forEach((row, index) => {
      play(row, { opacity: [0, 1], transform: ["translateY(8px)", "translateY(0)"] },
        { duration: 0.24, delay: index * 0.03, ease: [0.23, 1, 0.32, 1] });
    });
    settle();
  }

  function logout({ animate: animateReturn = true } = {}) {
    if (!opened || presentation === "sidebar" || !entry || !content || !button || !unlocked) return false;
    const from = { entry: opacityOf(entry), content: opacityOf(content) };
    stopIdle();
    clearMotion();
    unlocked = false;
    content.inert = true;
    entry.hidden = false;
    entry.inert = false;
    const current = revision;
    onLogout?.();
    if (!opened || unlocked || current !== revision) return true;
    if (animateReturn && motionAllowed() && !content.hidden) {
      logoutFading = true;
      play(content, { opacity: [from.content, 0] },
        { duration: 0.18, ease: [0.23, 1, 0.32, 1] });
      play(entry, { opacity: [from.entry, 1] },
        { duration: 0.18, ease: [0.23, 1, 0.32, 1] });
      settle();
    } else sync();
    startIdle();
    return true;
  }

  function close() {
    opened = false;
    stopIdle();
    clearMotion();
    sync();
  }

  button?.addEventListener("click", reveal);
  motionPreference?.addEventListener("change", onMotionPreferenceChange);
  sync();
  return {
    open,
    close,
    logout,
    setPresentation,
    get ready() { return unlocked; },
    get commandsVisible() { return unlocked && presentation !== "sidebar"; },
    destroy() {
      close();
      logoMotion.destroy();
      button?.removeEventListener("click", reveal);
      motionPreference?.removeEventListener("change", onMotionPreferenceChange);
    },
  };
}
