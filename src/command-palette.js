import { createDeskEntry } from "./desk-entry.js";
import { createDeskSidecar } from "./desk-sidecar.js";

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
];
const maxRenderedCommands = 64;

export function createCommandPalette({ root, reducedMotion = false } = {}) {
  if (!root) return createNoopPalette();

  const input = root.querySelector("[data-command-input]");
  const results = root.querySelector("[data-command-results]");
  const status = root.querySelector("[data-command-status]");
  const closeButtons = [...root.querySelectorAll("[data-command-close]")];
  const loginButton = root.querySelector("[data-desk-login]");
  const dragHandle = root.querySelector("[data-sidecar-handle]");
  const registry = new Map();
  let commandSnapshot = [];
  let visibleCommands = [];
  let activeIndex = -1;
  let previousFocus = null;
  let renderFrame = null;
  let focusRevision = 0;
  let closeFocusTarget = null;
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
  const sidecar = root.hasAttribute("data-desk-sidecar") ? createDeskSidecar({
    root,
    toggle: document.querySelector("[data-command-open]"),
    dragHandle,
    reducedMotion,
    onOpen({ focus, animateEntrance }) {
      deskEntry.setPresentation(sidecar.presentation);
      deskEntry.open({ animateEntrance });
      commandSnapshot = createCommandSnapshot(registry);
      render();
      if (focus) focusEntry();
    },
    onClose() {
      focusRevision++;
      deskEntry.close();
    },
    onClosed() {
      const target = closeFocusTarget;
      closeFocusTarget = null;
      target?.focus({ preventScroll: true });
    },
    onDismiss: () => close(),
    onModeChange({ focus }) { if (focus) focusEntry(); },
    onPresentationChange({ presentation }) {
      deskEntry.setPresentation(presentation);
      refresh();
    },
  }) : null;

  if (sidecar) registry.set("workspace.sidebar-presentation", {
    id: "workspace.sidebar-presentation",
    title: () => sidecar.presentation === "sidebar" ? "Center menu" : "Show sidebar",
    keywords: ["Desk", "sidebar", "menu", "dock", "center"],
    group: "Workspace", order: -10, keepOpen: true, presentationCommand: true,
    run: () => sidecar.presentation === "sidebar" ? centerMenu() : showSidebar(),
  });

  document.addEventListener("keydown", handleGlobalShortcut);
  input?.addEventListener("input", scheduleRender);
  input?.addEventListener("keydown", handleInputKeydown);
  closeButtons.forEach(button => button.addEventListener("click", handleCloseClick));
  results?.addEventListener("pointermove", handleResultsPointerMove);
  results?.addEventListener("click", handleResultsClick);
  root.addEventListener("cancel", handleCancel);
  root.addEventListener("click", handleRootClick);
  root.addEventListener("keydown", handleRootKeydown);

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

  function handleCancel(event) {
    event.preventDefault();
    close();
  }

  function handleRootClick(event) {
    if (event.target !== root || (sidecar && !sidecar.modal)) return;
    const bounds = root.getBoundingClientRect();
    if (!sidecar || event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom) close();
  }

  function handleRootKeydown(event) {
    if (event.key !== "Escape" || event.defaultPrevented || event.isComposing ||
      document.querySelector("dialog[open]:not([data-command-palette])")) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }

  function handleResultsPointerMove(event) {
    setActiveIndex(commandIndexFromEvent(event), false);
  }

  function handleResultsClick(event) {
    runCommand(commandIndexFromEvent(event));
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
      document.querySelector("dialog[open]:not([data-command-palette])") ||
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
      if (current === focusRevision && (sidecar ? sidecar.isOpen : root.open)) {
        const target = sidecar?.presentation === "sidebar" ? dragHandle : deskEntry.commandsVisible ? input : loginButton;
        target?.focus({ preventScroll: true });
      }
    });
  }

  function open({ query = "", returnFocus = null, animateEntrance = false, animate = true, focus = true } = {}) {
    closeFocusTarget = null;
    root.removeAttribute("data-closing");
    if (returnFocus || !root.contains(document.activeElement)) previousFocus = returnFocus || document.activeElement;
    if (input) input.value = query;
    commandSnapshot = createCommandSnapshot(registry);
    visibleCommands = [];
    activeIndex = -1;
    if (sidecar) {
      const wasOpen = sidecar.isOpen;
      sidecar.open({ animate, focus, animateEntrance });
      render();
      if (wasOpen && focus) focusEntry();
      return;
    }
    deskEntry.open({ animateEntrance });
    if (!root.open) root.showModal();
    render();
    if (focus) focusEntry();
  }

  function toggle(options) {
    if (sidecar?.presentation === "sidebar") centerMenu();
    else if (sidecar ? sidecar.isOpen : root.open) close();
    else open(options);
  }

  function showSidebar() {
    if (!sidecar || !deskEntry.ready) return;
    closeFocusTarget = null;
    sidecar.showSidebar();
    refresh();
    focusEntry();
  }

  function centerMenu() {
    if (!sidecar) return open();
    closeFocusTarget = null;
    if (!root.contains(document.activeElement)) previousFocus = document.activeElement;
    sidecar.centerMenu();
    refresh();
    focusEntry();
  }

  function close({ restoreFocus = true } = {}) {
    if (sidecar) {
      if (!sidecar.isOpen) return;
      const hadFocus = root.contains(document.activeElement);
      const wasModal = sidecar.modal;
      window.cancelAnimationFrame(renderFrame);
      renderFrame = null;
      let target = null;
      if (restoreFocus && (hadFocus || wasModal)) {
        target = previousFocus?.isConnected && previousFocus !== document.body &&
          !root.contains(previousFocus) && !previousFocus.closest("[hidden], [inert]") &&
          !previousFocus.matches(":disabled")
          ? previousFocus : document.querySelector("[data-command-open]");
      }
      // The optional sidebar hides the outer controls until its closing spring
      // finishes, so restore focus only after onClosed has removed that layout.
      closeFocusTarget = target;
      sidecar.close();
      return;
    }
    if (!root.open || root.hasAttribute("data-closing")) return;
    focusRevision++;
    window.cancelAnimationFrame(renderFrame);
    renderFrame = null;
    deskEntry.close();
    root.setAttribute("data-closing", "");
    const finish = () => {
      root.close();
      root.removeAttribute("data-closing");
      if (restoreFocus && previousFocus instanceof HTMLElement) {
        previousFocus.focus({ preventScroll: true });
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
    const previousId = visibleCommands[activeIndex]?.id;
    const matches = commandSnapshot
      .map((command) => ({
        ...command,
        score: scoreCommand(command, query),
      }))
      .filter((command) => command.score >= 0)
      .sort(compareCommands);
    const matchCount = matches.length;
    visibleCommands = matches.slice(0, maxRenderedCommands);

    activeIndex = visibleCommands.findIndex(
      (command) => command.id === previousId && !command.disabled,
    );
    if (activeIndex < 0) {
      activeIndex = visibleCommands.findIndex((command) => !command.disabled);
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
      if (command.group !== currentGroup) {
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
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(index === activeIndex));
    row.setAttribute("aria-disabled", String(command.disabled));
    row.dataset.commandIndex = String(index);
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

    const meta = document.createElement("span");
    meta.className = "desk-command-menu__meta";
    meta.textContent = command.active ? "Active" : command.hint;
    if (meta.textContent) row.append(meta);

    return row;
  }

  function handleInputKeydown(event) {
    if (event.isComposing) return;
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
    const next = enabled[(current + direction + enabled.length) % enabled.length];
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
    if (index < 0 || visibleCommands[index]?.disabled || activeIndex === index) return;
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
    const desktopSidecar = sidecar?.presentation === "sidebar" && !sidecar.mobile;
    const mobileSidecar = sidecar?.presentation === "sidebar" && sidecar.mobile;
    if (!command.presentationCommand && (mobileSidecar || (!desktopSidecar && !command.keepOpen))) close({ restoreFocus: false });
    if (desktopSidecar && !command.presentationCommand && root.contains(document.activeElement)) focusWorkspace();
    try {
      Promise.resolve(command.run())
        .then(() => {
          if (command.presentationCommand) return;
          if (!deskEntry.commandsVisible) return;
          if (desktopSidecar) {
            refresh();
            if (root.contains(document.activeElement) && !document.querySelector("dialog[open]:not([data-command-palette])")) focusWorkspace();
          } else if (!mobileSidecar && command.keepOpen && root.open) input?.focus({ preventScroll: true });
        })
        .catch((error) => {
          console.error(`Desk command failed: ${command.id}`, error);
        });
    } catch (error) {
      console.error(`Desk command failed: ${command.id}`, error);
    }
  }

  function focusWorkspace() {
    const workspace = document.querySelector("[data-desk-workspace]") || document.querySelector(".desk-stage");
    if (!workspace) return;
    if (!workspace.hasAttribute("tabindex")) workspace.setAttribute("tabindex", "-1");
    workspace.focus({ preventScroll: true });
  }

  function destroy() {
    focusRevision++;
    window.cancelAnimationFrame(renderFrame);
    deskEntry.destroy();
    sidecar?.destroy();
    document.removeEventListener("keydown", handleGlobalShortcut);
    input?.removeEventListener("input", scheduleRender);
    input?.removeEventListener("keydown", handleInputKeydown);
    closeButtons.forEach(button => button.removeEventListener("click", handleCloseClick));
    results?.removeEventListener("pointermove", handleResultsPointerMove);
    results?.removeEventListener("click", handleResultsClick);
    root.removeEventListener("cancel", handleCancel);
    root.removeEventListener("click", handleRootClick);
    root.removeEventListener("keydown", handleRootKeydown);
    if (root.open) root.close();
    registry.clear();
    commandSnapshot = [];
    visibleCommands = [];
  }

  return { close, destroy, open, toggle, showSidebar, centerMenu, refresh, register, initializeSidecar: () => sidecar?.initialize() };
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
  if (command.active) score += 8;
  return score - command.order;
}

function compareCommands(left, right) {
  const leftGroup = groupIndex(left.group);
  const rightGroup = groupIndex(right.group);
  if (leftGroup !== rightGroup) return leftGroup - rightGroup;
  if (left.score !== right.score) return right.score - left.score;
  if (left.order !== right.order) return left.order - right.order;
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
    showSidebar() {},
    centerMenu() {},
    initializeSidecar() {},
    refresh() {},
    register() {
      return () => {};
    },
  };
}
