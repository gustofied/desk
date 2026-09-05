import { animate as motionAnimate } from "motion";

// A visual preview only: this does not authenticate or protect any data.
// Kept in memory so a page refresh lets the login mock be tried again.
export function createDeskEntry({
  entry, content, button, onReveal, reducedMotion = false, animate = motionAnimate,
  schedule = globalThis.setTimeout, cancel = globalThis.clearTimeout,
  motionDocument = globalThis.document,
}) {
  let unlocked = !entry || !content || !button;
  let opened = false;
  let revision = 0;
  let animations = [];
  let waiting = false;
  let waitTimer = null;
  let idleAnimations = [];
  let idleEnabled = false;
  const targets = new Set();
  const ink = [...(button?.querySelectorAll?.("[data-desk-logo-ink]") || [])];
  const label = button?.querySelector?.("[data-desk-login-label]");
  const motionPreference = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");

  function stopIdle() {
    idleAnimations.forEach(animation => animation.cancel());
    idleAnimations = [];
    ink.forEach(stroke => stroke.style.removeProperty("opacity"));
  }

  function startIdle() {
    stopIdle();
    if (!idleEnabled || !opened || unlocked || waiting || motionDocument?.hidden || !motionAllowed()) return;
    // Light only the original ink. The complete mark underneath never moves.
    ink.forEach((stroke, index) => {
      idleAnimations.push(animate(stroke, {
        opacity: [0, 1, 0, 0],
      }, { duration: 6, times: [0, 0.18, 0.36, 1], delay: index * 0.4,
        repeat: Infinity, ease: [0.32, 0.72, 0, 1] }));
    });
  }

  function onMotionEnvironmentChange() {
    if (motionDocument?.hidden || !motionAllowed()) stopIdle();
    else startIdle();
  }

  function setWaiting(value) {
    waiting = value;
    button?.setAttribute("aria-busy", String(value));
    button?.setAttribute("aria-disabled", String(value));
    button?.toggleAttribute("data-opening", value);
    if (label && (value || !unlocked)) label.textContent = value ? "Opening…" : "Log in";
  }

  function cancelWait() {
    if (waitTimer !== null) cancel(waitTimer);
    waitTimer = null;
    setWaiting(false);
  }

  function clearMotion() {
    revision++;
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
    entry.hidden = unlocked;
    entry.inert = unlocked;
    content.hidden = !unlocked;
    content.inert = !unlocked;
  }

  function motionAllowed() {
    return !reducedMotion && !motionPreference?.matches;
  }

  function open({ animateEntrance = false } = {}) {
    stopIdle();
    clearMotion();
    cancelWait();
    opened = true;
    idleEnabled = animateEntrance;
    sync();
    if (!unlocked && animateEntrance && motionAllowed()) {
      play(entry, { opacity: [0, 1] },
        { duration: 0.24, ease: [0.23, 1, 0.32, 1] });
      settle();
    }
    startIdle();
    return unlocked;
  }

  function reveal(event) {
    if (!opened || unlocked || waiting) return;
    clearMotion();
    // The delay exists only to demonstrate a waiting state in this mock.
    // Keyboard activation and reduced motion skip the simulated wait.
    if (!event.detail || !motionAllowed()) {
      stopIdle();
      revealMenu(false);
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

  function revealMenu(animateReveal) {
    stopIdle();
    clearMotion();
    unlocked = true;
    setWaiting(false);
    entry.inert = true;
    content.hidden = false;
    content.inert = false;
    onReveal?.();

    if (!animateReveal) {
      sync();
      return;
    }
    play(entry, { opacity: [1, 0] },
      { duration: 0.2, ease: [0.23, 1, 0.32, 1] });
    play(content, { opacity: [0, 1], transform: ["translateY(8px)", "translateY(0)"] },
      { duration: 0.28, ease: [0.23, 1, 0.32, 1] });
    // Only the initial visible options get choreography, never search updates.
    const rows = [...(content.querySelectorAll?.("[data-command-index]") || [])].slice(0, 6);
    rows.forEach((row, index) => {
      play(row, { opacity: [0, 1], transform: ["translateY(8px)", "translateY(0)"] },
        { duration: 0.24, delay: index * 0.03, ease: [0.23, 1, 0.32, 1] });
    });
    settle();
  }

  function close() {
    opened = false;
    idleEnabled = false;
    stopIdle();
    clearMotion();
    cancelWait();
    sync();
  }

  button?.addEventListener("click", reveal);
  motionDocument?.addEventListener("visibilitychange", onMotionEnvironmentChange);
  motionPreference?.addEventListener("change", onMotionEnvironmentChange);
  sync();
  return {
    open,
    close,
    get ready() { return unlocked; },
    destroy() {
      close();
      button?.removeEventListener("click", reveal);
      motionDocument?.removeEventListener("visibilitychange", onMotionEnvironmentChange);
      motionPreference?.removeEventListener("change", onMotionEnvironmentChange);
    },
  };
}
