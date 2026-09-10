import { createDeskEntry } from "./desk-entry.js";
import { createDeskSidecar } from "./desk-sidecar.js";
import { createDeskLogoMotion } from "./desk-logo.js";

const defaultGroups = [
  "Workspace",
  "Catalog",
  "Catalogs",
  "Catalog views",
  "Actions",
  "Layers",
  "Main data",
  "Highlight",
  "Chart",
  "Range",
  "Compare",
  "Desk appearance",
  "Theme",
  "Palette",
  "Chart colors",
];
const maxRenderedCommands = 64;

export function createCommandPalette({ root, reducedMotion = false } = {}) {
  if (!root) return createNoopPalette();

  const input = root.querySelector("[data-command-input]");
  const results = root.querySelector("[data-command-results]");
  const status = root.querySelector("[data-command-status]");
  const backButton = root.querySelector("[data-command-back]");
  const closeButtons = [...root.querySelectorAll("[data-command-close]")];
  const loginButton = root.querySelector("[data-desk-login]");
  const sidebarRoot = document.querySelector("[data-desk-sidecar]");
  const dragHandle = sidebarRoot?.querySelector("[data-sidecar-handle]");
  const trigger = document.querySelector("[data-command-open]");
  const sidebarLogo = createDeskLogoMotion({ root: sidebarRoot, reducedMotion });
  const registry = new Map();
  let commandSnapshot = [];
  let visibleCommands = [];
  let activeIndex = -1;
  let section = null;
  let renderedQuery = null;
  let previousFocus = null;
  let renderFrame = null;
  let focusRevision = 0;
  let sidebarReturnFocus = null;
  let viewportEvents = null;
  let viewportFrame = 0;
  const deskEntry = createDeskEntry({
    entry: root.querySelector("[data-desk-entry]"),
    content: root.querySelector("[data-command-content]"),
    button: loginButton,
    reducedMotion,
    onReveal: () => {
      render();
      focusEntry();
    },
    onLogout: () => focusEntry(),
  });
  const sidecar = sidebarRoot ? createDeskSidecar({
    root: sidebarRoot,
    dragHandle,
    reducedMotion,
    modalOnMobile: false,
    onOpen() { sidebarLogo.start(); },
    onClosed() {
      sidebarLogo.stop();
      const target = sidebarReturnFocus;
      sidebarReturnFocus = null;
      if (!root.open && !otherModalOpen()) target?.focus({ preventScroll: true });
    },
    onDismiss: () => hideSidebar(),
  }) : null;

  if (sidecar) registry.set("workspace.sidebar-presentation", {
    id: "workspace.sidebar-presentation",
    title: () => sidecar.isOpen ? "Hide sidebar" : "Show sidebar",
    keywords: ["Desk", "sidebar", "menu", "dock", "hide", "show"],
    group: "Workspace", order: -10, keepOpen: true, presentationCommand: true,
    run: () => sidecar.isOpen ? hideSidebar() : showSidebar(),
  });

  document.addEventListener("keydown", handleGlobalShortcut);
  input?.addEventListener("input", scheduleRender);
  input?.addEventListener("keydown", handleCommandKeydown);
  backButton?.addEventListener("click", handleBack);
  closeButtons.forEach(button => button.addEventListener("click", handleCloseClick));
  results?.addEventListener("pointerdown", handleResultsPointerDown);
  results?.addEventListener("pointermove", handleResultsPointerMove);
  results?.addEventListener("click", handleResultsClick);
  results?.addEventListener("focusin", handleResultsFocus);
  results?.addEventListener("keydown", handleCommandKeydown);
  root.addEventListener("cancel", handleCancel);
  root.addEventListener("click", handleRootClick);
  root.addEventListener("keydown", handleRootKeydown);
  sidebarRoot?.addEventListener("keydown", handleSidebarKeydown);

  function otherModalOpen() {
    return Boolean(document.querySelector("dialog[open]:not([data-command-palette]):not([data-desk-sidecar])"));
  }

  function register(commands) {
    const entries = Array.isArray(commands) ? commands : [commands];
    const ids = [];
    for (const command of entries) {
      if (!command?.id || typeof command.run !== "function") continue;
      registry.set(command.id, command);
      ids.push(command.id);
    }
    if (root.open) refresh();
    return () => {
      ids.forEach((id) => registry.delete(id));
      if (root.open) refresh();
    };
  }

  function handleCloseClick() {
    close();
  }

  function handleBack() {
    showSection(null);
  }

  function showSection(next) {
    section = next;
    root.dataset.commandSection = section || "commands";
    if (backButton) backButton.hidden = !section;
    if (input) {
      input.value = "";
      input.placeholder = section ? "Appearance" : "Search views and commands";
      input.setAttribute("aria-label", section ? "Search appearance" : "Search views and commands");
    }
    renderedQuery = null;
    refresh();
    input?.focus({ preventScroll: true });
  }

  function handleCancel(event) {
    event.preventDefault();
    close();
  }

  function handleRootClick(event) {
    if (event.target !== root) return;
    const bounds = root.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom) close();
  }

  function handleRootKeydown(event) {
    if (event.key !== "Escape" || event.defaultPrevented || event.isComposing ||
      otherModalOpen()) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }

  function handleSidebarKeydown(event) {
    if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || root.open || otherModalOpen()) return;
    event.preventDefault();
    event.stopPropagation();
    hideSidebar();
  }

  function handleResultsPointerMove(event) {
    if (event.pointerType === "touch") return;
    setActiveIndex(commandIndexFromEvent(event), false);
  }

  function handleResultsPointerDown(event) {
    const index = commandIndexFromEvent(event);
    if (event.button !== 0 || !visibleCommands[index] || visibleCommands[index].disabled) return;
    // Let a touch complete as a native click (or scroll). Cancelling its
    // pointerdown suppresses that click in WebKit.
    if (event.pointerType === "touch") return;
    // The combobox owns focus; option buttons only supply the active descendant.
    event.preventDefault();
    setActiveIndex(index, false);
    input?.focus({ preventScroll: true });
  }

  function handleResultsFocus(event) {
    const index = commandIndexFromEvent(event);
    if (!visibleCommands[index] || visibleCommands[index].disabled) return;
    setActiveIndex(index, false);
    input?.focus({ preventScroll: true });
  }

  function handleResultsClick(event) {
    const index = commandIndexFromEvent(event);
    if (!visibleCommands[index] || visibleCommands[index].disabled) return;
    setActiveIndex(index, false);
    input?.focus({ preventScroll: true });
    runCommand(index);
  }

  function commandIndexFromEvent(event) {
    const row = event.target instanceof Element
      ? event.target.closest("[data-command-index]")
      : null;
    if (!row || !results?.contains(row)) return -1;
    return Number(row.dataset.commandIndex);
  }

  function handleGlobalShortcut(event) {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      otherModalOpen() ||
      !event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey ||
      event.key.toLowerCase() !== "g"
    ) {
      return;
    }
    event.preventDefault();
    toggle();
  }

  function focusEntry() {
    const current = ++focusRevision;
    window.requestAnimationFrame(() => {
      if (current === focusRevision && root.open) {
        const target = deskEntry.commandsVisible ? input : loginButton;
        target?.focus({ preventScroll: true });
      }
    });
  }

  function syncViewport() {
    const viewport = window.visualViewport;
    if (root.open && viewport && window.matchMedia("(max-width: 640px), (max-width: 960px) and (max-height: 500px) and (pointer: coarse)").matches) {
      // iOS keeps the layout viewport tall when the keyboard opens. Size the
      // command list to the visible viewport so its final results stay reachable.
      root.style.setProperty("--desk-command-viewport-height", `${viewport.height}px`);
      root.style.setProperty("--desk-command-viewport-top", `${viewport.offsetTop}px`);
    } else {
      root.style.removeProperty("--desk-command-viewport-height");
      root.style.removeProperty("--desk-command-viewport-top");
    }
  }

  function queueViewport() {
    if (viewportFrame) return;
    viewportFrame = window.requestAnimationFrame(() => {
      viewportFrame = 0;
      syncViewport();
    });
  }

  function observeViewport() {
    syncViewport();
    if (viewportEvents) return;
    viewportEvents = new AbortController();
    const { signal } = viewportEvents;
    window.addEventListener("resize", queueViewport, { signal });
    window.visualViewport?.addEventListener("resize", queueViewport, { signal });
    window.visualViewport?.addEventListener("scroll", queueViewport, { passive: true, signal });
  }

  function releaseViewport() {
    viewportEvents?.abort();
    viewportEvents = null;
    window.cancelAnimationFrame(viewportFrame);
    viewportFrame = 0;
    root.style.removeProperty("--desk-command-viewport-height");
    root.style.removeProperty("--desk-command-viewport-top");
  }

  function open({ query = "", returnFocus = null, animateEntrance = false, focus = true } = {}) {
    if (otherModalOpen()) return;
    root.removeAttribute("data-closing");
    if (returnFocus || !root.contains(document.activeElement)) previousFocus = returnFocus || document.activeElement;
    section = null;
    root.dataset.commandSection = "commands";
    if (backButton) backButton.hidden = true;
    if (input) {
      input.value = query;
      input.placeholder = "Search views and commands";
      input.setAttribute("aria-label", "Search views and commands");
    }
    commandSnapshot = createCommandSnapshot(registry);
    visibleCommands = [];
    activeIndex = -1;
    deskEntry.open({ animateEntrance });
    if (!root.open) root.showModal();
    observeViewport();
    trigger?.setAttribute("aria-expanded", "true");
    render();
    if (results) results.scrollTop = 0;
    if (focus) focusEntry();
  }

  function toggle(options) {
    if (root.open) close();
    else open(options);
  }

  function showSidebar() {
    if (!sidecar || !deskEntry.ready) return;
    sidebarReturnFocus = null;
    close({ restoreFocus: false });
    sidecar.showSidebar({ focus: false });
    refresh();
    dragHandle?.focus({ preventScroll: true });
  }

  function centerMenu() {
    open();
  }

  function hideSidebar() {
    if (!sidecar?.isOpen) return;
    sidebarReturnFocus = sidebarRoot.contains(document.activeElement) ? trigger : null;
    sidecar.close();
    refresh();
    if (root.open) focusEntry();
  }

  function close({ restoreFocus = true } = {}) {
    if (!root.open || root.hasAttribute("data-closing")) return;
    focusRevision++;
    window.cancelAnimationFrame(renderFrame);
    renderFrame = null;
    deskEntry.close();
    trigger?.setAttribute("aria-expanded", "false");
    root.setAttribute("data-closing", "");
    const finish = () => {
      root.close();
      releaseViewport();
      root.removeAttribute("data-closing");
      if (restoreFocus) {
        const target = previousFocus?.isConnected && previousFocus !== document.body &&
          !root.contains(previousFocus) && !previousFocus.closest("[hidden], [inert]") &&
          !previousFocus.matches(":disabled") && (!sidebarRoot?.contains(previousFocus) || sidecar?.isOpen)
          ? previousFocus : trigger;
        target?.focus({ preventScroll: true });
      }
    };
    finish();
  }

  function scheduleRender() {
    if (renderFrame !== null) return;
    renderFrame = window.requestAnimationFrame(() => {
      renderFrame = null;
      render();
    });
  }

  function flushRender() {
    if (renderFrame === null) return;
    window.cancelAnimationFrame(renderFrame);
    renderFrame = null;
    render();
  }

  function refresh() {
    commandSnapshot = createCommandSnapshot(registry);
    if (root.open) render();
  }

  function render() {
    if (!results || !input || !deskEntry.commandsVisible) return;
    const query = createQuery(input.value);
    const queryChanged = query.value !== renderedQuery;
    const previousId = queryChanged ? null : visibleCommands[activeIndex]?.id;
    renderedQuery = query.value;
    const matches = commandSnapshot
      .filter(command => section ? command.section === section : query.value || !command.section)
      .map((command) => ({
        ...command,
        score: scoreCommand(command, query),
      }))
      .filter((command) => command.score >= 0)
      .sort((left, right) => compareCommands(left, right, Boolean(query.value)));
    const matchCount = matches.length;
    visibleCommands = matches.slice(0, maxRenderedCommands);

    activeIndex = visibleCommands.findIndex(
      (command) => command.id === previousId && !command.disabled,
    );
    if (activeIndex < 0) {
      activeIndex = section ? visibleCommands.findIndex(command => command.active && !command.disabled) : -1;
      if (activeIndex < 0) activeIndex = visibleCommands.findIndex((command) => !command.disabled);
    }

    const fragment = document.createDocumentFragment();
    if (!visibleCommands.length) {
      const empty = document.createElement("p");
      empty.className = "desk-command-menu__empty";
      empty.textContent = "No views or commands found";
      fragment.append(empty);
      results.replaceChildren(fragment);
      input.removeAttribute("aria-activedescendant");
      if (status) status.textContent = "No commands found";
      return;
    }

    let currentGroup = null;
    visibleCommands.forEach((command, index) => {
      if ((!query.value || section) && command.group !== currentGroup) {
        currentGroup = command.group;
        const label = document.createElement("p");
        label.className = "desk-command-menu__group";
        label.setAttribute("role", "presentation");
        label.textContent = currentGroup;
        fragment.append(label);
      }
      fragment.append(createCommandRow(command, index));
    });
    results.replaceChildren(fragment);
    if (queryChanged) results.scrollTop = 0;

    syncActiveRow(false);
    if (status) {
      status.textContent = matchCount > maxRenderedCommands
        ? `Showing ${maxRenderedCommands} of ${matchCount} commands`
        : `${matchCount} ${matchCount === 1 ? "command" : "commands"} available`;
    }
  }

  function createCommandRow(command, index) {
    const row = document.createElement("button");
    const optionId = `desk-command-${safeId(command.id)}`;
    row.className = "desk-command-menu__option";
    row.id = optionId;
    row.type = "button";
    row.tabIndex = -1;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(index === activeIndex));
    row.setAttribute("aria-disabled", String(command.disabled));
    row.dataset.commandIndex = String(index);
    if (command.choice) {
      row.dataset.choice = command.choice;
      row.dataset.current = String(command.active);
      row.setAttribute("aria-label", `${command.title}${command.active ? ", selected" : ""}`);
    }
    if (command.disabled) row.disabled = true;

    const copy = document.createElement("span");
    copy.className = "desk-command-menu__copy";
    const title = document.createElement("strong");
    title.textContent = command.title;
    copy.append(title);
    if (command.subtitle) {
      const subtitle = document.createElement("small");
      subtitle.textContent = command.subtitle;
      copy.append(subtitle);
    }
    row.append(copy);

    if (command.preview) {
      const preview = document.createElement("span");
      preview.className = "desk-command-menu__swatch";
      preview.setAttribute("aria-hidden", "true");
      preview.style.backgroundImage = command.preview;
      row.append(preview);
    }

    const meta = document.createElement("span");
    meta.className = "desk-command-menu__meta";
    const hint = normalize(command.hint).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const titleText = normalize(command.title).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const hintRepeatsTitle = hint && ` ${titleText} `.includes(` ${hint} `);
    if (command.choice) {
      meta.classList.add("desk-command-menu__check");
      meta.setAttribute("aria-hidden", "true");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 16 16");
      const path = document.createElementNS(svg.namespaceURI, "path");
      path.setAttribute("d", "M3 8l3 3 7-7");
      svg.append(path);
      meta.append(svg);
      row.append(meta);
    } else {
      meta.textContent = command.active ? "Active" : hintRepeatsTitle ? "" : command.hint;
      if (meta.textContent) row.append(meta);
    }

    return row;
  }

  function handleCommandKeydown(event) {
    if (event.defaultPrevented || event.isComposing || otherModalOpen()) return;
    const rowIndex = commandIndexFromEvent(event);
    if (rowIndex >= 0) {
      setActiveIndex(rowIndex, false);
      input?.focus({ preventScroll: true });
    }
    if (["ArrowDown", "ArrowUp", "Home", "End", "Enter"].includes(event.key)) {
      flushRender();
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveToEdge(1);
    } else if (event.key === "End") {
      event.preventDefault();
      moveToEdge(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      runCommand(activeIndex);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }

  function moveActive(direction) {
    const enabled = visibleCommands
      .map((command, index) => ({ command, index }))
      .filter(({ command }) => !command.disabled)
      .map(({ index }) => index);
    if (!enabled.length) return;
    const current = enabled.indexOf(activeIndex);
    const next = current < 0
      ? enabled[direction > 0 ? 0 : enabled.length - 1]
      : enabled[(current + direction + enabled.length) % enabled.length];
    setActiveIndex(next, true);
  }

  function moveToEdge(direction) {
    let index = visibleCommands.findIndex((command) => !command.disabled);
    if (direction < 0) {
      index = -1;
      for (let candidate = visibleCommands.length - 1; candidate >= 0; candidate -= 1) {
        if (!visibleCommands[candidate].disabled) {
          index = candidate;
          break;
        }
      }
    }
    if (index >= 0) setActiveIndex(index, true);
  }

  function setActiveIndex(index, scroll) {
    if (!visibleCommands[index] || visibleCommands[index].disabled || activeIndex === index) return;
    activeIndex = index;
    syncActiveRow(scroll);
  }

  function syncActiveRow(scroll) {
    const rows = results.querySelectorAll("[data-command-index]");
    rows.forEach((row) => {
      const selected = Number(row.dataset.commandIndex) === activeIndex;
      row.setAttribute("aria-selected", String(selected));
      if (selected && scroll) row.scrollIntoView({ block: "nearest" });
    });
    const active = visibleCommands[activeIndex];
    if (active) {
      input.setAttribute("aria-activedescendant", `desk-command-${safeId(active.id)}`);
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function runCommand(index) {
    if (!deskEntry.commandsVisible) return;
    const command = visibleCommands[index];
    if (!command || command.disabled) return;
    if (!command.presentationCommand && !command.keepOpen) {
      close({ restoreFocus: false });
      // A menu opened from the sidebar edge otherwise returns keyboard focus
      // to that edge. View commands should hand control back to the workspace.
      if (sidebarRoot?.contains(document.activeElement)) {
        const workspace = document.querySelector("[data-desk-workspace]");
        if (workspace) {
          if (!workspace.hasAttribute("tabindex")) workspace.setAttribute("tabindex", "-1");
          workspace.focus({ preventScroll: true });
        }
      }
    }
    try {
      Promise.resolve(command.run())
        .then(() => {
          if (command.presentationCommand) return;
          if (!deskEntry.commandsVisible) return;
          if (command.keepOpen && root.open && !otherModalOpen()) {
            refresh();
            input?.focus({ preventScroll: true });
          }
        })
        .catch((error) => {
          console.error(`Desk command failed: ${command.id}`, error);
        });
    } catch (error) {
      console.error(`Desk command failed: ${command.id}`, error);
    }
  }

  function destroy() {
    focusRevision++;
    window.cancelAnimationFrame(renderFrame);
    releaseViewport();
    deskEntry.destroy();
    sidebarLogo.destroy();
    sidecar?.destroy();
    document.removeEventListener("keydown", handleGlobalShortcut);
    input?.removeEventListener("input", scheduleRender);
    input?.removeEventListener("keydown", handleCommandKeydown);
    backButton?.removeEventListener("click", handleBack);
    closeButtons.forEach(button => button.removeEventListener("click", handleCloseClick));
    results?.removeEventListener("pointerdown", handleResultsPointerDown);
    results?.removeEventListener("pointermove", handleResultsPointerMove);
    results?.removeEventListener("click", handleResultsClick);
    results?.removeEventListener("focusin", handleResultsFocus);
    results?.removeEventListener("keydown", handleCommandKeydown);
    root.removeEventListener("cancel", handleCancel);
    root.removeEventListener("click", handleRootClick);
    root.removeEventListener("keydown", handleRootKeydown);
    sidebarRoot?.removeEventListener("keydown", handleSidebarKeydown);
    if (root.open) root.close();
    registry.clear();
    commandSnapshot = [];
    visibleCommands = [];
  }

  return { close, destroy, open, toggle, showSection, showSidebar, hideSidebar, centerMenu, refresh, register, initializeSidecar: () => {
    sidecar?.initialize();
    trigger?.setAttribute("aria-expanded", String(root.open));
  } };
}

function createCommandSnapshot(registry) {
  return Array.from(registry.values()).map((command, registryIndex) => {
    const resolved = resolveCommand(command);
    const title = normalize(resolved.title);
    const subtitle = normalize(resolved.subtitle);
    const keywords = normalize(
      Array.isArray(resolved.keywords)
        ? resolved.keywords.join(" ")
        : resolved.keywords,
    );
    const group = normalize(resolved.group);
    const haystack = `${title} ${subtitle} ${keywords} ${group}`;
    return {
      ...resolved,
      registryIndex,
      search: {
        title,
        titleWords: title.split(" ").filter(Boolean),
        subtitle,
        keywords,
        haystack,
        words: haystack.split(/[\s/._-]+/).filter(Boolean),
      },
    };
  });
}

function createQuery(value) {
  const normalized = normalize(value);
  return {
    value: normalized,
    tokens: normalized.split(" ").filter(Boolean),
  };
}

function resolveCommand(command) {
  return {
    ...command,
    title: resolveValue(command.title, "Untitled command"),
    subtitle: resolveValue(command.subtitle, ""),
    group: resolveValue(command.group, "Actions"),
    hint: resolveValue(command.hint, ""),
    preview: resolveValue(command.preview, ""),
    keywords: resolveValue(command.keywords, []),
    active: Boolean(resolveValue(command.active, false)),
    disabled: Boolean(resolveValue(command.disabled, false)),
    order: Number(resolveValue(command.order, 0)) || 0,
  };
}

function resolveValue(value, fallback) {
  const resolved = typeof value === "function" ? value() : value;
  return resolved ?? fallback;
}

function scoreCommand(command, query) {
  if (!query.value) return 1000 - command.order;
  const { title, titleWords, subtitle, keywords, haystack, words } = command.search;
  if (
    !query.tokens.every(
      (token) =>
        haystack.includes(token) ||
        (token.length >= 3 && words.some((word) => isSubsequence(token, word))),
    )
  ) {
    return -1;
  }

  let score = 0;
  if (title === query.value) score += 1200;
  if (title.startsWith(query.value)) score += 800;
  if (title.includes(query.value)) score += 600;
  for (const token of query.tokens) {
    if (titleWords.some((word) => word.startsWith(token))) score += 240;
    else if (title.includes(token)) score += 160;
    else if (keywords.includes(token)) score += 96;
    else if (subtitle.includes(token)) score += 64;
    else score += 24;
  }
  return score;
}

function compareCommands(left, right, searching) {
  if (searching && left.score !== right.score) return right.score - left.score;
  const leftGroup = groupIndex(left.group);
  const rightGroup = groupIndex(right.group);
  if (leftGroup !== rightGroup) return leftGroup - rightGroup;
  if (left.score !== right.score) return right.score - left.score;
  if (left.order !== right.order) return left.order - right.order;
  if (searching && left.active !== right.active) return Number(right.active) - Number(left.active);
  return left.registryIndex - right.registryIndex;
}

function groupIndex(group) {
  const index = defaultGroups.indexOf(group);
  return index < 0 ? defaultGroups.length : index;
}

function normalize(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function isSubsequence(needle, haystack) {
  let index = 0;
  for (const character of haystack) {
    if (character === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return false;
}

function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "-");
}

function createNoopPalette() {
  return {
    close() {},
    destroy() {},
    open() {},
    toggle() {},
    showSection() {},
    showSidebar() {},
    hideSidebar() {},
    centerMenu() {},
    initializeSidecar() {},
    refresh() {},
    register() {
      return () => {};
    },
  };
}
