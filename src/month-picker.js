const months = Array.from({ length: 12 }, (_, index) =>
  new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(2026, index, 1))));

const monthIndex = value => {
  const [year, month] = value.split("-").map(Number);
  return year * 12 + month - 1;
};
const monthValue = index => `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}`;

export function createMonthPicker(input, id) {
  const minimum = monthIndex(input.min);
  const maximum = monthIndex(input.max);
  const picker = document.createElement("div");
  picker.className = "gpu-benchmark__month-picker";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "gpu-benchmark__month-trigger";
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", id);
  const panel = document.createElement("div");
  panel.id = id;
  panel.className = "gpu-benchmark__month-panel";
  panel.popover = "auto";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", input.getAttribute("aria-label"));
  const header = document.createElement("div");
  header.className = "gpu-benchmark__month-header";
  const yearLabel = document.createElement("span");
  yearLabel.setAttribute("aria-live", "polite");
  const yearButton = (label, text, direction) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", () => browse(focused + direction * 12));
    return button;
  };
  const previous = yearButton("Previous year", "‹", -1);
  const next = yearButton("Next year", "›", 1);
  header.append(previous, yearLabel, next);
  const grid = document.createElement("div");
  grid.className = "gpu-benchmark__month-grid";
  const buttons = months.map((month, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = month.slice(0, 3);
    button.addEventListener("click", () => {
      input.value = monthValue(year * 12 + index);
      input.dispatchEvent(new Event("change", { bubbles: true }));
      sync();
      close(true);
    });
    button.addEventListener("focus", () => { focused = year * 12 + index; });
    button.addEventListener("keydown", event => {
      const movements = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4, PageUp: -12, PageDown: 12 };
      let target = focused + (movements[event.key] ?? 0);
      if (event.key === "Home") target = year * 12;
      else if (event.key === "End") target = year * 12 + 11;
      else if (!(event.key in movements)) return;
      event.preventDefault();
      event.stopPropagation();
      browse(target);
    });
    return button;
  });
  grid.append(...buttons);
  panel.append(header, grid);
  picker.append(trigger, panel);
  input.hidden = true;
  let year;
  let focused;
  let opened = false;
  let openEvents;
  let pointerInside = false;

  function render() {
    yearLabel.textContent = String(year);
    previous.disabled = year <= Math.floor(minimum / 12);
    next.disabled = year >= Math.floor(maximum / 12);
    buttons.forEach((button, index) => {
      const value = year * 12 + index;
      button.disabled = value < minimum || value > maximum;
      button.tabIndex = value === focused ? 0 : -1;
      button.setAttribute("aria-label", `${months[index]} ${year}`);
      button.setAttribute("aria-pressed", String(monthValue(value) === input.value));
    });
  }

  function browse(value) {
    focused = Math.max(minimum, Math.min(maximum, value));
    year = Math.floor(focused / 12);
    render();
    buttons[focused % 12].focus({ preventScroll: true });
  }

  function position() {
    const anchor = trigger.getBoundingClientRect();
    const bounds = panel.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.right - bounds.width, innerWidth - bounds.width - 8));
    const below = anchor.bottom + 8;
    const top = below + bounds.height <= innerHeight - 8 ? below : Math.max(8, anchor.top - bounds.height - 8);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function resetOpenState() {
    opened = false;
    pointerInside = false;
    trigger.setAttribute("aria-expanded", "false");
    openEvents?.abort();
  }

  function close(returnFocus = false) {
    if (panel.matches(":popover-open")) panel.hidePopover();
    resetOpenState();
    if (returnFocus && trigger.isConnected) trigger.focus({ preventScroll: true });
  }

  function open() {
    if (trigger.disabled) return;
    if (opened) {
      buttons[focused % 12].focus({ preventScroll: true });
      return;
    }
    focused = Math.max(minimum, Math.min(maximum, monthIndex(input.value || input.min)));
    year = Math.floor(focused / 12);
    render();
    panel.showPopover();
    opened = true;
    trigger.setAttribute("aria-expanded", "true");
    position();
    buttons[focused % 12].focus({ preventScroll: true });
    openEvents = new AbortController();
    document.addEventListener("pointerdown", event => {
      pointerInside = picker.contains(event.target);
    }, { capture: true, signal: openEvents.signal });
    window.addEventListener("resize", position, { signal: openEvents.signal });
    document.addEventListener("scroll", position, { capture: true, passive: true, signal: openEvents.signal });
  }

  function sync() {
    const value = monthIndex(input.value || input.min);
    trigger.textContent = `${months[value % 12]} ${Math.floor(value / 12)}`;
    trigger.setAttribute("aria-label", `${input.getAttribute("aria-label")}, ${trigger.textContent}`);
    trigger.disabled = input.disabled;
    if (opened) render();
  }

  trigger.addEventListener("click", () => opened ? close(true) : open());
  trigger.addEventListener("keydown", event => {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    event.stopPropagation();
    open();
  });
  picker.addEventListener("keydown", event => {
    pointerInside = false;
    if (event.key !== "Escape" || !opened) return;
    event.preventDefault();
    event.stopPropagation();
    close(true);
  });
  picker.addEventListener("focusout", event => {
    // Safari moves focus to the containing article when clicking popup buttons.
    // Native popover dismissal handles pointer clicks outside it.
    if (opened && !pointerInside && !picker.contains(event.relatedTarget)) close();
  });
  panel.addEventListener("toggle", () => {
    if (!panel.matches(":popover-open")) resetOpenState();
  });
  sync();
  return { element: picker, sync, close, focus: () => trigger.focus(), destroy: () => close() };
}
