export function createMonitorDataRail({ root, copyText, reducedMotion = false }) {
  if (!root) return createEmptyRail();

  const nodes = {
    toggle: root.querySelector("[data-monitor-data-toggle]"),
    label: root.querySelector("[data-monitor-data-label]"),
    dataset: root.querySelector("[data-monitor-data-dataset]"),
    context: root.querySelector("[data-monitor-data-context]"),
    body: root.querySelector("[data-monitor-data-body]"),
    path: root.querySelector("[data-monitor-data-path]"),
    actionLabel: root.querySelector("[data-monitor-data-action-label]"),
    commandShell: root.querySelector("[data-monitor-data-command-shell]"),
    command: root.querySelector("[data-monitor-data-command]"),
    mode: root.querySelector("[data-monitor-data-mode]"),
    copy: root.querySelector("[data-monitor-data-copy]"),
    status: root.querySelector("[data-monitor-data-status]"),
  };
  let model = null;
  let open = false;
  let mode = "command";
  let bodyAnimation = null;
  let copyFeedbackTimer = null;

  nodes.toggle?.addEventListener("click", () => {
    open = !open;
    syncOpenState();
  });
  nodes.mode?.addEventListener("click", () => {
    mode = mode === "command" ? "sql" : "command";
    renderMode();
    announce(mode === "sql" ? "Showing DataFusion SQL" : "Showing Desk CLI command");
  });
  nodes.copy?.addEventListener("click", async () => {
    const copiedMode = mode;
    const value = copiedMode === "sql" ? model?.sql : model?.command;
    if (!value) return;
    let copied = false;
    try {
      copied = await copyText(value);
    } catch {}
    announce(
      copied
        ? copiedMode === "sql"
          ? "DataFusion SQL copied"
          : "Desk command copied"
        : "Copy unavailable in this browser",
    );
    window.clearTimeout(copyFeedbackTimer);
    nodes.copy.textContent = copied ? "Copied" : "Unavailable";
    copyFeedbackTimer = window.setTimeout(syncCopyLabel, 1400);
  });
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    open = false;
    syncOpenState();
    nodes.toggle?.focus({ preventScroll: true });
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
    nodes.label.textContent = "Desk API";
    nodes.dataset.textContent = model.label;
    nodes.context.textContent = model.summary;
    nodes.toggle?.setAttribute("aria-label", toggleLabel(model));
    renderPath();
    renderMode();
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

  function renderPath() {
    if (!nodes.path || !model) return;
    const items = model.breadcrumbs.map((label, index) => {
      const item = document.createElement("li");
      const text = document.createElement("span");
      text.textContent = label;
      if (index === model.breadcrumbs.length - 1) {
        text.setAttribute("aria-current", "page");
      }
      item.append(text);
      return item;
    });
    nodes.path.replaceChildren(...items);
  }

  function renderMode() {
    if (!model) return;
    const showingSql = mode === "sql";
    root.dataset.accessMode = mode;
    nodes.actionLabel.textContent = showingSql
      ? `Query ${sentenceLabel(model.label)}`
      : `Sync ${sentenceLabel(model.label)}`;
    renderCode(nodes.command, showingSql ? model.sql : model.command, {
      highlightSql: showingSql,
    });
    nodes.commandShell?.setAttribute(
      "aria-label",
      showingSql ? "DataFusion SQL query" : "Desk CLI command",
    );
    nodes.mode.textContent = showingSql ? "View CLI" : "View SQL";
    nodes.mode.setAttribute(
      "aria-label",
      showingSql ? "Show Desk CLI command" : "Show DataFusion SQL",
    );
    syncCopyLabel();
    nodes.command?.closest("pre")?.scrollTo({ top: 0, left: 0 });
  }

  function syncCopyLabel() {
    if (!nodes.copy) return;
    nodes.copy.textContent = mode === "sql" ? "Copy SQL" : "Copy command";
    nodes.copy.setAttribute(
      "aria-label",
      mode === "sql" ? "Copy DataFusion SQL" : "Copy Desk CLI command",
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

const SQL_KEYWORDS = new Set([
  "ALL",
  "AND",
  "AS",
  "ASC",
  "BY",
  "CREATE",
  "DESC",
  "EXTERNAL",
  "FALSE",
  "FILTER",
  "FROM",
  "FULL",
  "GROUP",
  "IF",
  "IN",
  "INNER",
  "JOIN",
  "LEFT",
  "LOCATION",
  "NOT",
  "NULL",
  "ON",
  "OPTIONS",
  "OR",
  "ORDER",
  "OVER",
  "PARTITION",
  "RIGHT",
  "SELECT",
  "STORED",
  "TABLE",
  "TRUE",
  "WHERE",
  "WITH",
]);

const SQL_FUNCTIONS = new Set([
  "FIRST_VALUE",
  "MAX",
  "MIN",
  "NULLIF",
  "ROUND",
  "TO_TIMESTAMP",
]);

const SQL_TOKEN_PATTERN = /(--[^\n]*|'(?:''|[^'])*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g;

function renderCode(node, value, { highlightSql = false } = {}) {
  if (!node) return;
  const source = String(value || "");
  if (!highlightSql) {
    node.textContent = source;
    return;
  }

  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const match of source.matchAll(SQL_TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      fragment.append(document.createTextNode(source.slice(cursor, index)));
    }

    const token = match[0];
    const tokenType = sqlTokenType(token);
    if (tokenType) {
      const span = document.createElement("span");
      span.className = `desk-data-rail__sql-token desk-data-rail__sql-token--${tokenType}`;
      span.textContent = token;
      fragment.append(span);
    } else {
      fragment.append(document.createTextNode(token));
    }
    cursor = index + token.length;
  }

  if (cursor < source.length) {
    fragment.append(document.createTextNode(source.slice(cursor)));
  }
  node.replaceChildren(fragment);
}

function sqlTokenType(token) {
  if (token.startsWith("--")) return "comment";
  if (token.startsWith("'")) return "string";
  if (/^\d/.test(token)) return "number";
  const normalized = token.toUpperCase();
  if (SQL_FUNCTIONS.has(normalized)) return "function";
  if (SQL_KEYWORDS.has(normalized)) return "keyword";
  return "";
}

function sentenceLabel(value) {
  const label = String(value || "dataset");
  if (/^[A-Z][A-Z0-9]/.test(label)) return label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

function toggleLabel(model) {
  const label = [
    "Desk API",
    model.label,
    model.summary,
    formatRowCount(model.rowCount),
  ];
  if (model.asOf) label.push(`observed ${formatAsOf(model.asOf)}`);
  return label.join(", ");
}

function formatRowCount(value) {
  const count = Number(value) || 0;
  return `${new Intl.NumberFormat("en-US").format(count)} ${count === 1 ? "row" : "rows"}`;
}

function formatAsOf(value) {
  const date = value instanceof Date ? value : new Date(value);
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

function createEmptyRail() {
  return Object.freeze({
    setModel() {},
    setVisible() {},
  });
}
