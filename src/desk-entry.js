import { animate as motionAnimate } from "motion";
import { createDeskLogoMotion } from "./desk-logo.js";

// A visual preview only: this does not authenticate or protect any data.
// Kept in memory so a page refresh lets the login mock be tried again.
export function createDeskEntry({
  entry, content, button, onReveal, onLogout, reducedMotion = false, animate = motionAnimate,
  schedule = globalThis.setTimeout, cancel = globalThis.clearTimeout,
  motionDocument = globalThis.document,
}) {
  let unlocked = !entry || !content || !button;
  let opened = false;
  let presentation = "menu";
  let revision = 0;
  let animations = [];
  let waiting = false;
  let logoutFading = false;
  let waitTimer = null;
  const targets = new Set();
  const label = button?.querySelector?.("[data-desk-login-label]");
  const buttonTabIndex = button?.getAttribute?.("tabindex") ?? null;
  const entryLabel = entry?.getAttribute?.("aria-label") || "Desk login";
  const motionPreference = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
  const logoMotion = createDeskLogoMotion({ root: button, reducedMotion, animate, motionDocument });

  function stopIdle() {
    logoMotion.stop();
  }

  function startIdle() {
    if (!opened || (unlocked && presentation !== "sidebar") || waiting) logoMotion.stop();
    else logoMotion.start();
  }

  function onMotionPreferenceChange() {
    if (logoutFading && !motionAllowed()) {
      clearMotion();
      sync();
    }
  }

  function setWaiting(value) {
    waiting = value;
    button?.setAttribute("aria-busy", String(value));
    button?.toggleAttribute("data-opening", value);
    syncButton();
  }

  function syncButton() {
    if (!button) return;
    const passive = presentation === "sidebar";
    button.disabled = passive;
    button.inert = passive;
    button.setAttribute("aria-disabled", String(passive || waiting));
    if (passive) {
      button.setAttribute("aria-hidden", "true");
      button.setAttribute("tabindex", "-1");
    } else {
      button.removeAttribute("aria-hidden");
      if (buttonTabIndex === null) button.removeAttribute("tabindex");
      else button.setAttribute("tabindex", buttonTabIndex);
    }
    if (label) label.textContent = waiting ? "Opening…" : "Log in";
  }

  function cancelWait() {
    if (waitTimer !== null) cancel(waitTimer);
    waitTimer = null;
    setWaiting(false);
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
    cancelWait();
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
    cancelWait();
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
    if (!opened || presentation === "sidebar" || unlocked || waiting) return;
    const returning = logoutFading
      ? { entry: opacityOf(entry), content: opacityOf(content) }
      : null;
    clearMotion();
    // The delay exists only to demonstrate a waiting state in this mock.
    // Keyboard activation and reduced motion skip the simulated wait.
    if (!event.detail || !motionAllowed()) {
      stopIdle();
      revealMenu(false);
      return;
    }
    if (returning) {
      revealMenu(true, returning);
      return;
    }
    setWaiting(true);
    // Let the quiet ink pass continue through the mock wait without restarting.
    const current = revision;
    waitTimer = schedule(() => {
      waitTimer = null;
      if (!opened || current !== revision) return;
      revealMenu(motionAllowed());
    }, 600);
  }

  function revealMenu(animateReveal, returning = null) {
    stopIdle();
    clearMotion();
    unlocked = true;
    setWaiting(false);
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
    if (!opened || presentation === "sidebar" || !entry || !content || !button || (!unlocked && !waiting)) return false;
    const from = { entry: opacityOf(entry), content: opacityOf(content) };
    stopIdle();
    clearMotion();
    unlocked = false;
    cancelWait();
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
    cancelWait();
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
