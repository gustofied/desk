export function createMonitorDataRail({ root, copyText, reducedMotion = false }) {
  if (!root) return createEmptyRail();

  const nodes = {
    toggle: root.querySelector("[data-monitor-data-toggle]"),
    label: root.querySelector("[data-monitor-data-label]"),
    summary: root.querySelector("[data-monitor-data-summary]"),
    count: root.querySelector("[data-monitor-data-count]"),
    asOf: root.querySelector("[data-monitor-data-time]"),
    body: root.querySelector("[data-monitor-data-body]"),
    tabButtons: Array.from(root.querySelectorAll("[data-monitor-data-tab]")),
    rowsPanel: root.querySelector("[data-monitor-data-panel='rows']"),
    commandPanel: root.querySelector("[data-monitor-data-panel='command']"),
    table: root.querySelector("[data-monitor-data-table]"),
    commandKind: root.querySelector("[data-monitor-data-command-kind]"),
    command: root.querySelector("[data-monitor-data-command]"),
    caption: root.querySelector("[data-monitor-data-table] caption"),
    copy: root.querySelector("[data-monitor-data-copy]"),
    status: root.querySelector("[data-monitor-data-status]"),
  };
  let model = null;
  let open = false;
  let activeTab = "rows";
  let bodyAnimation = null;
  let copyFeedbackTimer = null;

  nodes.toggle?.addEventListener("click", (event) => {
    open = !open;
    syncOpenState();
    if (open && event.detail === 0) {
      window.requestAnimationFrame(() => activeTabButton()?.focus());
    }
  });
  nodes.tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activeTab = button.dataset.monitorDataTab;
      open = true;
      renderActivePanel();
      syncOpenState();
    });
    button.addEventListener("keydown", handleTabKeydown);
  });
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    open = false;
    syncOpenState();
    nodes.toggle?.focus({ preventScroll: true });
  });
  nodes.copy?.addEventListener("click", async () => {
    const value = activeTab === "rows"
      ? rowsAsTsv(model)
      : activeTab === "sql"
        ? model?.sql
        : model?.curl;
    if (!value) return;
    let copied = false;
    try {
      copied = await copyText(value);
    } catch {}
    const copiedLabel = activeTab === "rows"
      ? "Rows copied"
      : activeTab === "sql"
        ? "SQL query copied"
        : "Curl command copied";
    announce(copied ? copiedLabel : "Copy unavailable in this browser");
    window.clearTimeout(copyFeedbackTimer);
    nodes.copy.textContent = copied ? "Copied" : "Unavailable";
    copyFeedbackTimer = window.setTimeout(() => {
      nodes.copy.textContent = "Copy";
    }, 1400);
  });

  setVisible(false);

  return Object.freeze({ setModel, setVisible });

  function setModel(nextModel) {
    if (model?.key === nextModel?.key) return;
    model = nextModel;
    if (!model) {
      setVisible(false);
      return;
    }
    if (!model.modes.includes(activeTab)) activeTab = model.modes[0] || "rows";
    nodes.label.textContent = model.label;
    nodes.summary.textContent = model.summary;
    nodes.count.textContent = formatRowCount(model.rowCount);
    if (model.asOf) {
      const date = model.asOf instanceof Date ? model.asOf : new Date(model.asOf);
      nodes.asOf.textContent = formatAsOf(date);
      nodes.asOf.dateTime = date.toISOString();
      nodes.asOf.hidden = false;
    } else {
      nodes.asOf.textContent = "";
      nodes.asOf.removeAttribute("datetime");
      nodes.asOf.hidden = true;
    }
    renderTable();
    renderActivePanel();
    syncOpenState();
  }

  function setVisible(visible) {
    const show = Boolean(visible && model);
    if (!show && open) {
      open = false;
      syncOpenState({ animateClose: false });
    }
    root.hidden = !show;
    root.toggleAttribute("inert", !show);
  }

  function handleTabKeydown(event) {
    const visibleTabs = nodes.tabButtons.filter((button) => !button.hidden);
    const currentIndex = visibleTabs.indexOf(event.currentTarget);
    let nextIndex = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % visibleTabs.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + visibleTabs.length) % visibleTabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = visibleTabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = visibleTabs[nextIndex];
    activeTab = next.dataset.monitorDataTab;
    renderActivePanel();
    next.focus();
  }

  function renderTable() {
    if (!nodes.table || !model) return;
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    model.columns.forEach((column) => {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = column.label;
      cell.dataset.align = column.align;
      headRow.append(cell);
    });
    head.append(headRow);

    const body = document.createElement("tbody");
    model.rows.forEach((row) => {
      const tr = document.createElement("tr");
      model.columns.forEach((column) => {
        const cell = document.createElement("td");
        cell.textContent = row[column.key] ?? "—";
        cell.dataset.align = column.align;
        tr.append(cell);
      });
      body.append(tr);
    });
    nodes.table.replaceChildren(
      ...(nodes.caption ? [nodes.caption] : []),
      head,
      body,
    );
  }

  function renderActivePanel() {
    if (!model) return;
    nodes.tabButtons.forEach((button) => {
      const tab = button.dataset.monitorDataTab;
      const available = model.modes.includes(tab);
      const selected = tab === activeTab;
      button.hidden = !available;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    const showRows = activeTab === "rows";
    setPanelVisibility(nodes.rowsPanel, showRows);
    setPanelVisibility(nodes.commandPanel, !showRows);
    if (!showRows) {
      const value = activeTab === "sql" ? model.sql : model.curl;
      nodes.commandKind.textContent = activeTab === "sql" ? "DuckDB SQL" : "Download";
      nodes.command.textContent = value;
      nodes.copy.setAttribute(
        "aria-label",
        activeTab === "sql" ? "Copy SQL query" : "Copy curl command",
      );
      nodes.commandPanel?.setAttribute("aria-labelledby", activeTabButton()?.id || "");
    } else {
      nodes.copy.setAttribute("aria-label", "Copy visible rows");
    }
  }

  function activeTabButton() {
    return nodes.tabButtons.find(
      (button) => button.dataset.monitorDataTab === activeTab,
    );
  }

  function syncOpenState({ animateClose = true } = {}) {
    nodes.toggle?.setAttribute("aria-expanded", String(open));
    if (nodes.body) {
      bodyAnimation?.cancel();
      bodyAnimation = null;
      nodes.body.toggleAttribute("inert", !open);
      if (open) {
        nodes.body.hidden = false;
      } else if (
        animateClose &&
        !reducedMotion &&
        !nodes.body.hidden &&
        typeof nodes.body.animate === "function"
      ) {
        bodyAnimation = nodes.body.animate(
          [
            { opacity: 1, transform: "translateY(0)" },
            { opacity: 0, transform: "translateY(-4px)" },
          ],
          {
            duration: 160,
            easing: "cubic-bezier(0.32, 0.72, 0, 1)",
          },
        );
        bodyAnimation.finished
          .catch(() => {})
          .finally(() => {
            if (!open) nodes.body.hidden = true;
          });
      } else {
        nodes.body.hidden = true;
      }
    }
    root.dataset.open = String(open);
  }

  function announce(message) {
    if (!nodes.status) return;
    nodes.status.textContent = "";
    window.requestAnimationFrame(() => {
      nodes.status.textContent = message;
    });
  }
}

function setPanelVisibility(panel, visible) {
  if (!panel) return;
  panel.hidden = !visible;
  panel.toggleAttribute("inert", !visible);
}

function formatRowCount(value) {
  const count = Number(value) || 0;
  return `${new Intl.NumberFormat("en-US").format(count)} ${count === 1 ? "row" : "rows"}`;
}

function formatAsOf(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.day} ${values.month} ${values.hour}:${values.minute} UTC`;
}

function rowsAsTsv(model) {
  if (!model) return "";
  const header = model.columns.map((column) => column.label).join("\t");
  const rows = model.rows.map((row) =>
    model.columns.map((column) => row[column.key] ?? "").join("\t")
  );
  return [header, ...rows].join("\n");
}

function createEmptyRail() {
  return Object.freeze({
    setModel() {},
    setVisible() {},
  });
}
