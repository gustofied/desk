// Center the toolbar in the existing space, with an inset for short viewports.
export function toolbarCenterY(contentTop, toolbarHeight, inset = 8) {
  return Math.max(contentTop / 2, toolbarHeight / 2 + inset);
}

export function alignWorkspaceToolbar({ stage, toolbar, mobileViewport }) {
  if (!stage || !toolbar) return;
  let frame = 0;
  let previousCenter = null;

  function update() {
    frame = 0;
    if (mobileViewport.matches) return;
    // Use document coordinates so scrolling doesn't pull the fixed toolbar up.
    const contentTop = stage.getBoundingClientRect().top + window.scrollY;
    const center = toolbarCenterY(contentTop, toolbar.offsetHeight);
    if (center === previousCenter) return;
    previousCenter = center;
    toolbar.style.setProperty("--desk-toolbar-center", `${center}px`);
  }

  function schedule() {
    if (!frame) frame = window.requestAnimationFrame(update);
  }

  const observer = new ResizeObserver(schedule);
  observer.observe(stage);
  observer.observe(toolbar);
  observer.observe(document.body);
  window.addEventListener("resize", schedule);
  mobileViewport.addEventListener("change", schedule);
  document.fonts.ready.then(schedule);
  // A view change can reposition the stage without changing its dimensions.
  const viewObserver = new MutationObserver(schedule);
  viewObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-desk-layout", "data-desk-view", "data-display-toolbar"],
  });
  update();
}
