import { animate } from "motion";

const DEFAULT_VISIBLE_ROWS = 3;
const DEFAULT_ADVANCE_DELAY_MS = 4200;
const reducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

export function createCardFeed(
  root,
  {
    links = false,
    visibleRows = DEFAULT_VISIBLE_ROWS,
    advanceDelayMs = DEFAULT_ADVANCE_DELAY_MS,
    motion = "glide",
    pauseOnHover = true,
  } = {},
) {
  if (!root) return { setItems() {} };

  const track = root.querySelector("[data-card-feed-track]");
  let items = [];
  let cursor = 0;
  let timer = 0;
  let paused = false;
  let advancing = false;

  if (pauseOnHover) {
    root.addEventListener("pointerenter", pause);
    root.addEventListener("pointerleave", resume);
  }
  root.addEventListener("focusin", pause);
  root.addEventListener("focusout", (event) => {
    if (!root.contains(event.relatedTarget)) resume();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
    else resume();
  });

  return { setItems };

  function setItems(nextItems) {
    items = (Array.isArray(nextItems) ? nextItems : [])
      .map((item) => normalizeItem(item, links))
      .filter(Boolean);
    cursor = 0;
    advancing = false;
    window.clearTimeout(timer);
    render();
    schedule();
  }

  function pause() {
    paused = true;
    window.clearTimeout(timer);
  }

  function resume() {
    paused = false;
    schedule();
  }

  function schedule() {
    window.clearTimeout(timer);
    if (
      reducedMotion ||
      paused ||
      document.hidden ||
      items.length <= visibleRows
    ) {
      return;
    }
    timer = window.setTimeout(advance, advanceDelayMs);
  }

  async function advance() {
    if (advancing || paused || document.hidden || !track) {
      schedule();
      return;
    }
    advancing = true;
    const rows = Array.from(track.children);
    const first = rows[0];
    const incoming = rows[visibleRows];
    const distance = first?.offsetHeight || 22;
    const snapping = motion === "snap";

    if (!first || !incoming) {
      advancing = false;
      schedule();
      return;
    }

    await Promise.all([
      animate(
        track,
        { y: [0, -distance] },
        {
          duration: snapping ? 0.16 : 0.46,
          ease: snapping ? [0.32, 0.72, 0, 1] : [0.77, 0, 0.175, 1],
        },
      ),
      animate(
        first,
        { opacity: [1, 0] },
        {
          duration: snapping ? 0.08 : 0.28,
          ease: [0.4, 0, 1, 1],
        },
      ),
      animate(
        incoming,
        { opacity: [0, 1] },
        {
          delay: snapping ? 0.02 : 0.08,
          duration: snapping ? 0.1 : 0.3,
          ease: [0, 0, 0.2, 1],
        },
      ),
    ]);

    cursor = (cursor + 1) % items.length;
    render();
    advancing = false;
    schedule();
  }

  function render() {
    if (!track) return;
    track.style.removeProperty("transform");
    const rowCount = Math.min(
      items.length,
      items.length > visibleRows ? visibleRows + 1 : visibleRows,
    );
    const rows = [];

    if (!items.length) {
      rows.push(
        rowElement({
          label: "Waiting for evidence",
          value: "pending",
          href: "",
          title: "The market feed is loading.",
        }),
      );
    } else {
      for (let offset = 0; offset < rowCount; offset += 1) {
        const item = items[(cursor + offset) % items.length];
        const row = rowElement(item);
        if (offset >= visibleRows) {
          row.style.opacity = "0";
          row.setAttribute("aria-hidden", "true");
        }
        rows.push(row);
      }
    }

    track.replaceChildren(...rows);
  }
}

function normalizeItem(item, links) {
  const label = String(item?.label || "").trim();
  const value = String(item?.value || "").trim();
  if (!label || !value) return null;
  return {
    label,
    value,
    href: links ? String(item?.href || "").trim() : "",
    title: String(item?.title || `${label}: ${value}`).trim(),
  };
}

function rowElement(item) {
  const row = document.createElement(item.href ? "a" : "span");
  row.className = "compute-card-feed__row";
  row.title = item.title;
  if (item.href) {
    row.href = item.href;
    row.target = "_blank";
    row.rel = "noopener noreferrer";
  }

  const icon = document.createElement("span");
  icon.className = "compute-card-feed__icon";
  icon.setAttribute("aria-hidden", "true");
  icon.append(activityIcon());

  const label = document.createElement("span");
  label.className = "compute-card-feed__name";
  label.textContent = item.label;

  const value = document.createElement("span");
  value.className = "compute-card-feed__value";
  value.textContent = item.value;

  row.append(icon, label, value);
  return row;
}

function activityIcon() {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  const path = document.createElementNS(namespace, "path");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "11");
  svg.setAttribute("height", "11");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  path.setAttribute("d", "M3 12h4l3-8 4 16 3-8h4");
  svg.append(path);
  return svg;
}
