// Use our own repeat cadence: macOS can reserve held letter keys for accents.
export function createHeldKeyNavigation({
  step,
  delay = 320,
  interval = 140,
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  let key = null;
  let timer = null;

  function stop() {
    if (timer !== null) cancel(timer);
    timer = null;
    key = null;
  }

  function tick() {
    timer = null;
    const current = key;
    if (current === null) return;
    if (step(current, { repeat: true }) === false) {
      stop();
    } else if (key === current) {
      timer = schedule(tick, interval);
    }
  }

  return {
    get key() { return key; },
    start(nextKey) {
      if (key === nextKey) return;
      stop();
      key = nextKey;
      if (step(nextKey, { repeat: false }) === false) stop();
      else if (key === nextKey) timer = schedule(tick, delay);
    },
    release(releasedKey) {
      if (key === releasedKey) stop();
    },
    stop,
  };
}

export function nextGalleryIndex(rects, current, key, { repeat = false, columnX } = {}) {
  if (!rects.length || !["a", "d", "w", "s"].includes(key)) return -1;
  if (current < 0 || current >= rects.length) {
    return key === "a" || key === "w" ? rects.length - 1 : 0;
  }
  if (key === "a" || key === "d") {
    const next = current + (key === "d" ? 1 : -1);
    // A fresh tap can wrap; a hold stops at the edge instead of jumping back.
    if (repeat && (next < 0 || next >= rects.length)) return current;
    return (next + rects.length) % rects.length;
  }

  const origin = rects[current];
  const x = columnX ?? origin.left + origin.width / 2;
  const y = origin.top + origin.height / 2;
  const direction = key === "s" ? 1 : -1;
  let next = current;
  let nearestRow = Infinity;
  let nearestColumn = Infinity;
  rects.forEach((rect, index) => {
    const rowDistance = (rect.top + rect.height / 2 - y) * direction;
    if (rowDistance <= 1) return;
    const columnDistance = Math.abs(rect.left + rect.width / 2 - x);
    if (
      rowDistance < nearestRow - 1 ||
      (Math.abs(rowDistance - nearestRow) <= 1 && columnDistance < nearestColumn)
    ) {
      next = index;
      nearestRow = rowDistance;
      nearestColumn = columnDistance;
    }
  });
  return next;
}
