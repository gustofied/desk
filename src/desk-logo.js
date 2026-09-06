import { animate as motionAnimate } from "motion";

// Decorative motion only. Each logo owns its playback and has no login state.
export function createDeskLogoMotion({
  root, reducedMotion = false, animate = motionAnimate,
  motionDocument = root?.ownerDocument ?? globalThis.document,
} = {}) {
  const baseInk = root?.querySelector?.("[data-desk-logo-base]");
  const revealInk = root?.querySelector?.("[data-desk-logo-reveal]");
  const query = "(prefers-reduced-motion: reduce)";
  const preference = motionDocument?.defaultView?.matchMedia?.(query) ?? globalThis.matchMedia?.(query);
  let requested = false;
  let destroyed = false;
  let animations = [];

  function clear() {
    animations.forEach(animation => animation.cancel());
    animations = [];
    for (const layer of [baseInk, revealInk]) {
      layer?.style.removeProperty("opacity");
      layer?.style.removeProperty("clip-path");
    }
  }

  function sync() {
    if (destroyed || !requested || !baseInk || !revealInk ||
      reducedMotion || preference?.matches || motionDocument?.hidden) {
      clear();
      return;
    }
    if (animations.length) return;
    // Reveal the original PNG over its silhouette; never move or redraw it.
    const settle = [0.32, 0.72, 0, 1];
    // Each interval is eased separately so the full seven-second cycle is intact.
    const timing = { duration: 7, times: [0, 0.04, 0.08, 0.36, 0.46, 0.9, 1],
      repeat: Infinity, ease: [settle, settle, [0.77, 0, 0.175, 1], settle, settle, settle] };
    const closed = "inset(0 100% 0 0)";
    const revealed = "inset(0 0% 0 0)";
    animations.push(animate(baseInk, {
      opacity: [1, 0.24, 0.24, 0.24, 1, 1, 1],
    }, timing));
    animations.push(animate(revealInk, {
      opacity: [0, 0, 1, 1, 0, 0, 0],
      clipPath: [closed, closed, closed, revealed, revealed, revealed, revealed],
    }, timing));
  }

  function start() {
    if (destroyed) return;
    requested = true;
    sync();
  }

  function stop() {
    requested = false;
    clear();
  }

  function destroy() {
    if (destroyed) return;
    stop();
    destroyed = true;
    motionDocument?.removeEventListener("visibilitychange", sync);
    preference?.removeEventListener("change", sync);
  }

  motionDocument?.addEventListener("visibilitychange", sync);
  preference?.addEventListener("change", sync);
  return { start, stop, destroy };
}
