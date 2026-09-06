import {
  VIEW_EASE,
  VIEW_REVEAL_DURATION,
  VIEW_SUPPORT_DURATION,
} from "./view-motion.js";

// Chart entrances never own navigation or hit targets. Keep them independently
// cancellable so another view can replace a draw immediately.
export function chartAnimations(root) {
  return (root?.getAnimations?.({ subtree: true }) || []).filter(
    (animation) => animation.id.startsWith("desk-chart-"),
  );
}

export function cancelChartMotion(root) {
  chartAnimations(root).forEach((animation) => animation.cancel());
}

export function animateChartDraw(path, { from = "left", ...options } = {}) {
  if (!path?.animate) return null;
  // A horizontal reveal preserves dashed strokes and has the same progress at
  // every SVG scale, including charts with non-scaling strokes. The small bleed
  // keeps thick lines and round end caps intact along the plot edges.
  return path.animate(
    [
      { clipPath: from === "right"
        ? "inset(-12px -12px -12px calc(100% + 12px)) fill-box"
        : "inset(-12px calc(100% + 12px) -12px -12px) fill-box" },
      { clipPath: "inset(-12px -12px -12px -12px) fill-box" },
    ],
    {
      id: "desk-chart-draw",
      duration: VIEW_REVEAL_DURATION,
      easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
      fill: "backwards",
      ...options,
    },
  );
}

export function animateChartSupport(node, options = {}, frames) {
  if (!node?.animate) return null;
  // Fade to the authored opacity (e.g. a translucent area), never an opaque fill.
  const opacity = node.ownerDocument?.defaultView?.getComputedStyle(node).opacity || "1";
  return node.animate(frames || [{ opacity: 0 }, { opacity }], {
    id: "desk-chart-support",
    duration: VIEW_SUPPORT_DURATION,
    easing: VIEW_EASE,
    fill: "backwards",
    ...options,
  }) || null;
}
