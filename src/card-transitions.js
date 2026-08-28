import { animate } from "motion";

export function bindCardCover({ cover, activate }) {
  if (!cover || typeof activate !== "function") return;

  cover.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.target.closest("a, button")) return;
    activate();
  });
  cover.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    activate();
  });
}

export async function copyTextToClipboard(value) {
  if (!value) return false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Some browsers expose the API but deny it outside a trusted gesture.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.inset = "-9999px auto auto -9999px";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

export async function swapCardPanels({
  root,
  previous,
  next,
  reducedMotion,
  effect = "resize",
  onPrepare,
}) {
  previous.setAttribute("inert", "");
  next.hidden = false;
  next.setAttribute("inert", "");

  if (reducedMotion) {
    previous.hidden = true;
    next.removeAttribute("inert");
    await onPrepare?.();
    return;
  }

  const fromHeight = previous.offsetHeight;
  root.style.position = "relative";
  root.style.height = `${fromHeight}px`;
  root.style.overflow = "clip";
  root.style.willChange = "height";
  setTransitionLayout(previous);
  setTransitionLayout(next);
  next.style.visibility = "hidden";
  await onPrepare?.();
  const toHeight = await settledPanelHeight(next);
  next.style.visibility = "";
  const expanding = toHeight >= fromHeight;
  const heightDelta = Math.abs(toHeight - fromHeight);
  const snapping = effect === "snap";
  const duration = snapping
    ? 0.16
    : Math.min(0.48, Math.max(0.38, 0.35 + heightDelta / 8000));
  const ease = [0.32, 0.72, 0, 1];
  const turning = effect === "turn";

  await Promise.all([
    animate(
      root,
      { height: [`${fromHeight}px`, `${toHeight}px`] },
      {
        duration,
        ease,
      },
    ),
    animate(
      previous,
      snapping
        ? {
            opacity: [1, 0],
            scale: [1, 0.992],
          }
        : turning
        ? {
            opacity: [1, 0],
            rotateY: [0, -7],
            x: [0, -6],
          }
        : {
            opacity: [1, 0],
            y: [0, expanding ? -6 : 6],
          },
      {
        duration: snapping
          ? 0.07
          : turning
            ? Math.min(0.24, duration * 0.62)
            : Math.min(0.18, duration * 0.44),
        ease: snapping || turning ? ease : [0.4, 0, 1, 1],
      },
    ),
    animate(
      next,
      snapping
        ? {
            opacity: [0, 1],
            scale: [0.992, 1],
          }
        : turning
        ? {
            opacity: [0, 1],
            rotateY: [7, 0],
            x: [6, 0],
          }
        : {
            opacity: [0, 1],
            y: [expanding ? 10 : -6, 0],
          },
      {
        delay: snapping ? 0.01 : turning ? 0.045 : 0.025,
        duration: snapping ? 0.12 : Math.max(0.3, duration - 0.025),
        ease,
      },
    ),
  ]);

  previous.hidden = true;
  next.removeAttribute("inert");
  clearTransitionLayout(previous);
  clearTransitionLayout(next);
  root.style.height = `${next.offsetHeight}px`;
  await nextFrame();
  root.style.removeProperty("height");
  root.style.removeProperty("overflow");
  root.style.removeProperty("position");
  root.style.removeProperty("will-change");
}

export async function resizeCardContent({
  container,
  update,
  reducedMotion,
}) {
  if (!container || reducedMotion) {
    update();
    return;
  }
  const fromHeight = container.offsetHeight;
  container.style.height = `${fromHeight}px`;
  container.style.overflow = "clip";
  update();
  const toHeight = Math.ceil(container.scrollHeight);
  await animate(
    container,
    {
      height: [`${fromHeight}px`, `${toHeight}px`],
      opacity: [0.72, 1],
    },
    {
      duration: 0.34,
      ease: [0.32, 0.72, 0, 1],
    },
  );
  container.style.removeProperty("height");
  container.style.removeProperty("overflow");
  container.style.removeProperty("opacity");
}

function setTransitionLayout(panel) {
  panel.style.position = "absolute";
  panel.style.inset = "0 auto auto 0";
  panel.style.width = "100%";
}

function clearTransitionLayout(panel) {
  [
    "position",
    "inset",
    "width",
    "opacity",
    "transform",
    "visibility",
  ].forEach((property) => panel.style.removeProperty(property));
}

async function settledPanelHeight(panel) {
  if (document.fonts?.ready) {
    await Promise.race([
      document.fonts.ready,
      new Promise((resolve) => window.setTimeout(resolve, 250)),
    ]);
  }

  let height = panel.offsetHeight;
  let stableFrames = 0;
  for (let frame = 0; frame < 10 && stableFrames < 2; frame += 1) {
    await nextFrame();
    const nextHeight = panel.offsetHeight;
    stableFrames = Math.abs(nextHeight - height) <= 1 ? stableFrames + 1 : 0;
    height = nextHeight;
  }
  return height;
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}
