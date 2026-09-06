import assert from "node:assert/strict";
import test from "node:test";
import { createCommandPalette } from "../src/command-palette.js";

// Only the DOM operations used by the palette: rendering, dialog state, and
// focusability. Motion stays real; its media preference can finish a pending
// numeric drawer animation without timers or a browser animation loop.
class FakeElement extends EventTarget {
  attributes = new Map();
  dataset = {};
  children = [];
  hidden = false;
  inert = false;
  disabled = false;
  open = false;
  modal = false;
  dialogReturnFocus = null;
  value = "";
  focusCalls = [];
  style = {
    values: new Map(),
    setProperty(name, value) { this.values.set(name, value); },
    removeProperty(name) { this.values.delete(name); delete this[name]; },
  };

  constructor(document, tagName = "div") {
    super();
    this.ownerDocument = document;
    this.tagName = tagName;
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  toggleAttribute(name, force) {
    if (force ?? !this.hasAttribute(name)) this.setAttribute(name, "");
    else this.removeAttribute(name);
  }
  append(...nodes) {
    for (const node of nodes) {
      if (node.tagName === "fragment") this.append(...node.children);
      else { node.parentElement = this; this.children.push(node); }
    }
  }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  contains(target) { return target === this || this.children.some(child => child.contains(target)); }
  get isConnected() { return this.ownerDocument.documentElement.contains(this); }
  matches(selector) {
    return selector.split(",").some(part => {
      let name = part.trim();
      const exclusions = [...name.matchAll(/:not\(([^)]+)\)/g)].map(match => match[1]);
      if (exclusions.some(excluded => this.matches(excluded))) return false;
      name = name.replace(/:not\([^)]+\)/g, "");
      if (name === "[hidden]") return this.hidden;
      if (name === "[inert]") return this.inert;
      if (name === ":disabled") return this.disabled;
      if (name.includes(":modal")) {
        if (!this.modal || !this.open) return false;
        name = name.replace(":modal", "");
      }
      const tag = name.match(/^[a-z]+/i)?.[0];
      if (tag) {
        if (this.tagName.toLowerCase() !== tag.toLowerCase()) return false;
        name = name.slice(tag.length);
      }
      const attributes = [...name.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)];
      if (name.replace(/\[[^\]]+\]/g, "")) return false;
      return attributes.every(([, attribute, value]) => {
        if (attribute === "open") return this.open;
        if (attribute === "hidden") return this.hidden;
        if (attribute === "inert") return this.inert;
        const dataKey = attribute.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        const actual = this.getAttribute(attribute) ?? (attribute.startsWith("data-") ? this.dataset[dataKey] : undefined);
        return value === undefined ? actual !== undefined && actual !== null : actual === value;
      });
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [
      ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  show() { this.open = true; this.modal = false; }
  showModal() {
    if (!this.open) this.dialogReturnFocus = this.ownerDocument.activeElement;
    this.open = true;
    this.modal = true;
  }
  close() {
    const wasModal = this.modal;
    this.open = false;
    this.modal = false;
    if (this.contains(this.ownerDocument.activeElement)) {
      this.ownerDocument.activeElement = this.ownerDocument.body;
      if (wasModal) this.dialogReturnFocus?.focus();
    }
  }
  focus() {
    const modal = this.ownerDocument.querySelector("dialog:modal");
    const blockedByModal = Boolean(modal && !modal.contains(this));
    const closedDialog = this.closest("dialog") && !this.closest("dialog").open;
    this.focusCalls.push({ blockedByModal, closedDialog: Boolean(closedDialog) });
    if (!blockedByModal && !closedDialog && !this.disabled && !this.closest("[hidden], [inert]")) {
      this.ownerDocument.activeElement = this;
    }
  }
  scrollIntoView() {}
}

function harness(t, { reducedMotion = true, mobile = false } = {}) {
  const document = new EventTarget();
  const window = new EventTarget();
  document.defaultView = window;
  const make = (attribute, tagName) => {
    const element = new FakeElement(document, tagName);
    if (attribute) element.setAttribute(attribute, "");
    return element;
  };
  const html = document.documentElement = make();
  const body = document.body = make();
  html.append(body);
  const toggle = make("data-command-open", "button");
  const root = make("data-command-palette", "dialog");
  const entry = make("data-desk-entry");
  const login = make("data-desk-login", "button");
  login.append(make("data-desk-login-label", "span"));
  entry.append(login);
  const content = make("data-command-content");
  const input = make("data-command-input", "input");
  const results = make("data-command-results");
  content.append(input, results, make("data-command-status"));
  const handle = make("data-sidecar-handle", "button");
  handle.setAttribute("aria-label", "Close sidebar");
  const sidebar = make("data-desk-sidecar", "dialog");
  const logo = make("data-sidebar-logo");
  sidebar.append(logo, handle);
  const workspace = make("data-desk-workspace", "main");
  const unrelatedDialog = make("data-unrelated-dialog", "dialog");
  const unrelatedInput = make(null, "input");
  unrelatedDialog.append(unrelatedInput);
  root.append(entry, content);
  body.append(toggle, workspace, root, sidebar, unrelatedDialog);
  document.activeElement = toggle;
  document.createElement = tagName => make(null, tagName);
  document.createDocumentFragment = () => make(null, "fragment");
  document.querySelector = selector => html.querySelector(selector);
  document.querySelectorAll = selector => html.querySelectorAll(selector);

  const viewport = Object.assign(new EventTarget(), { matches: mobile });
  const motion = Object.assign(new EventTarget(), { matches: true });
  window.innerWidth = mobile ? 390 : 1200;
  window.performance = globalThis.performance;
  window.matchMedia = query => query.includes("960px") ? viewport : motion;
  let frameId = 0;
  const frames = new Map();
  window.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
  window.cancelAnimationFrame = id => frames.delete(id);

  const replacements = {
    document, window, Element: FakeElement, HTMLElement: FakeElement,
    SVGElement: class {}, matchMedia: window.matchMedia,
  };
  const originals = Object.fromEntries(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(replacements)) {
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  }
  const palette = createCommandPalette({ root, reducedMotion });
  t.after(() => {
    palette.destroy();
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  palette.initializeSidecar();

  function dispatch(target, type, properties = {}) {
    const event = new Event(type, { cancelable: true });
    for (const [key, value] of Object.entries(properties)) Object.defineProperty(event, key, { value });
    target.dispatchEvent(event);
  }
  function flushFrames() {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback());
  }
  function logIn() {
    palette.open();
    flushFrames();
    dispatch(login, "click", { detail: 0 });
    flushFrames();
  }
  return {
    palette, document, html, root, sidebar, logo, toggle, workspace, entry, login, content, input, results, handle,
    unrelatedDialog, unrelatedInput,
    dispatch, flushFrames, logIn,
    shortcut() { dispatch(document, "keydown", { key: "g", metaKey: true }); flushFrames(); },
    enter() { dispatch(input, "keydown", { key: "Enter" }); flushFrames(); },
    setQuery(value) { input.value = value; dispatch(input, "input"); flushFrames(); },
    setMotionReduced(value) { motion.matches = value; motion.dispatchEvent(new Event("change")); },
    commandTitles() { return results.querySelectorAll("[data-command-index]").map(row => row.children[0].children[0].textContent); },
  };
}

test("sidebar API cannot bypass the centered mock login", t => {
  const h = harness(t);
  h.palette.showSidebar();
  h.flushFrames();
  assert.equal(h.root.open, false);
  assert.equal(h.sidebar.open, false);
  assert.equal(h.html.dataset.deskSidebar, "false");

  h.palette.open();
  h.flushFrames();
  h.palette.showSidebar();
  h.flushFrames();
  assert.equal(h.root.open, true);
  assert.equal(h.root.modal, true);
  assert.equal(h.sidebar.open, false);
  assert.equal(h.document.activeElement, h.login);
  assert.equal(h.content.hidden, true);
  assert.deepEqual(h.commandTitles(), []);
});

for (const mobile of [false, true]) {
  test(`authenticated Show sidebar opens a separate nonmodal logo panel on ${mobile ? "mobile" : "desktop"}`, t => {
    const h = harness(t, { mobile });
    assert.equal(h.root.hasAttribute("data-desk-sidecar"), false);
    assert.equal(h.sidebar.open, false);
    h.logIn();
    assert.ok(h.commandTitles().includes("Show sidebar"));
    h.setQuery("sidebar");
    const loginFocusCount = h.login.focusCalls.length;
    h.enter();

    assert.equal(h.root.open, false, "choosing Show sidebar dismisses only the centered menu");
    assert.equal(h.sidebar.open, true);
    assert.equal(h.sidebar.modal, false, "sidebar is never a modal, including mobile");
    assert.equal(h.sidebar.getAttribute("aria-modal"), "false");
    assert.equal(h.html.dataset.deskSidebar, "true");
    assert.equal(h.document.activeElement, h.handle);
    assert.equal(h.login.focusCalls.length, loginFocusCount);
    assert.equal(h.input.value, "sidebar");
    assert.equal(h.logo.focusCalls.length, 0);
    assert.equal(h.sidebar.querySelector("[data-desk-login]"), null);
  });
}

test("centering preserves the independent sidebar, authentication, and input node with a fresh search", t => {
  const h = harness(t);
  h.palette.register({ id: "catalog.open", title: "Open catalog", run() {} });
  h.logIn();
  h.setQuery("catalog");
  h.palette.showSidebar();
  h.flushFrames();
  assert.equal(h.root.open, false);
  assert.equal(h.sidebar.open, true);
  assert.equal(h.document.activeElement, h.handle);
  assert.equal(h.input.value, "catalog");

  h.dispatch(h.logo, "click", { detail: 0 });
  h.palette.centerMenu();
  h.flushFrames();
  assert.equal(h.root.open, true);
  assert.equal(h.root.modal, true);
  assert.equal(h.sidebar.open, true, "centering must not replace or hide the sidebar");
  assert.equal(h.sidebar.modal, false);
  assert.equal(h.entry.hidden, true);
  assert.equal(h.content.hidden, false);
  assert.equal(h.input.value, "");
  assert.equal(h.document.activeElement, h.input);
  assert.equal(h.root.querySelector("[data-command-input]"), h.input);
  assert.deepEqual(h.commandTitles(), ["Hide sidebar", "Open catalog"]);
});

test("CmdG reopens with a fresh search while the sidebar and input remain mounted", t => {
  const h = harness(t);
  h.logIn();
  h.setQuery("sidebar");
  h.palette.showSidebar();
  h.flushFrames();
  h.shortcut();
  assert.equal(h.root.open, true);
  assert.equal(h.sidebar.open, true);
  assert.equal(h.input.value, "");
  assert.deepEqual(h.commandTitles(), ["Hide sidebar"]);
  assert.equal(h.document.activeElement, h.input);
  h.setQuery("side");
  h.shortcut();
  assert.equal(h.root.open, false);
  assert.equal(h.sidebar.open, true);
  assert.equal(h.document.activeElement, h.handle);
  h.shortcut();
  assert.equal(h.root.open, true);
  assert.equal(h.sidebar.open, true);
  assert.equal(h.entry.hidden, true);
  assert.equal(h.input.value, "");
  assert.equal(h.root.querySelector("[data-command-input]"), h.input);
});

test("open, close, and toggle APIs never change sidebar visibility", t => {
  const h = harness(t);
  h.logIn();
  h.palette.showSidebar();
  h.flushFrames();
  h.palette.open({ query: "sidebar" });
  h.flushFrames();
  assert.equal(h.sidebar.open, true);
  assert.equal(h.input.value, "sidebar");
  h.palette.close();
  assert.equal(h.root.open, false);
  assert.equal(h.sidebar.open, true);
  h.palette.toggle();
  h.flushFrames();
  assert.equal(h.root.open, true);
  assert.equal(h.sidebar.open, true);
  assert.equal(h.input.value, "");
  h.palette.toggle();
  assert.equal(h.root.open, false);
  assert.equal(h.sidebar.open, true);
});

for (const reopen of ["open", "shortcut"]) {
  test(`${reopen} reopening clears the previous search and restores the default list and first command`, t => {
    const h = harness(t);
    h.palette.register([
      { id: "example.alpha", title: "Example alpha", run() {} },
      { id: "example.beta", title: "Example beta", run() {} },
    ]);
    h.logIn();
    const defaults = h.commandTitles();
    assert.deepEqual(defaults, ["Show sidebar", "Example alpha", "Example beta"]);
    h.setQuery("example");
    h.dispatch(h.input, "keydown", { key: "End" });
    assert.equal(h.input.getAttribute("aria-activedescendant"), "desk-command-example-beta");
    h.results.scrollTop = 160;

    if (reopen === "shortcut") {
      h.shortcut();
      assert.equal(h.root.open, false);
      h.shortcut();
    } else {
      h.palette.close();
      h.palette.open();
      h.flushFrames();
    }

    assert.equal(h.root.open, true);
    assert.equal(h.content.hidden, false);
    assert.equal(h.input.value, "");
    assert.equal(h.results.scrollTop, 0);
    assert.deepEqual(h.commandTitles(), defaults);
    const first = h.results.querySelector("[data-command-index]");
    assert.equal(first.getAttribute("aria-selected"), "true");
    assert.equal(h.input.getAttribute("aria-activedescendant"), first.id);
    assert.equal(h.results.querySelectorAll('[aria-selected="true"]').length, 1);
    assert.equal(h.document.activeElement, h.input);
  });
}

test("an explicit open query is respected when reopening and retargeting an open menu", t => {
  const h = harness(t);
  h.palette.register([
    { id: "example.alpha", title: "Example alpha", run() {} },
    { id: "example.beta", title: "Example beta", run() {} },
  ]);
  h.logIn();
  h.setQuery("sidebar");
  h.palette.close();
  h.palette.open({ query: "beta" });
  h.flushFrames();
  assert.equal(h.input.value, "beta");
  assert.deepEqual(h.commandTitles(), ["Example beta"]);
  assert.equal(h.input.getAttribute("aria-activedescendant"), "desk-command-example-beta");

  h.palette.open({ query: "alpha" });
  h.flushFrames();
  assert.equal(h.input.value, "alpha");
  assert.deepEqual(h.commandTitles(), ["Example alpha"]);
  assert.equal(h.document.activeElement, h.input);
});

test("refreshing an open menu preserves typing and its selected command", t => {
  const h = harness(t);
  h.palette.register([
    { id: "example.alpha", title: "Example alpha", run() {} },
    { id: "example.beta", title: "Example beta", run() {} },
  ]);
  h.logIn();
  h.setQuery("example");
  h.dispatch(h.input, "keydown", { key: "End" });
  h.results.scrollTop = 80;
  h.palette.refresh();
  h.flushFrames();
  assert.equal(h.root.open, true);
  assert.equal(h.input.value, "example");
  assert.equal(h.results.scrollTop, 80);
  assert.deepEqual(h.commandTitles(), ["Example alpha", "Example beta"]);
  assert.equal(h.input.getAttribute("aria-activedescendant"), "desk-command-example-beta");
  assert.equal(h.document.activeElement, h.input);
});

test("Hide sidebar command leaves the centered menu authenticated and focused", t => {
  const h = harness(t);
  h.logIn();
  h.palette.showSidebar();
  h.flushFrames();
  h.palette.centerMenu();
  h.flushFrames();
  h.setQuery("sidebar");
  assert.deepEqual(h.commandTitles(), ["Hide sidebar"]);
  h.enter();
  assert.equal(h.sidebar.open, false);
  assert.equal(h.html.dataset.deskSidebar, "false");
  assert.equal(h.root.open, true);
  assert.equal(h.root.modal, true);
  assert.equal(h.content.hidden, false);
  assert.equal(h.entry.hidden, true);
  assert.equal(h.document.activeElement, h.input);
  assert.equal(h.input.value, "sidebar");
  assert.deepEqual(h.commandTitles(), ["Show sidebar"]);
});

test("edge dismissal hides only the sidebar and returns focus to the visible Desk trigger", t => {
  const h = harness(t);
  h.logIn();
  h.palette.showSidebar();
  h.flushFrames();
  h.dispatch(h.handle, "click", { detail: 0 });
  h.flushFrames();
  assert.equal(h.sidebar.open, false);
  assert.equal(h.root.open, false);
  assert.equal(h.document.activeElement, h.toggle);
  h.palette.open();
  h.flushFrames();
  assert.equal(h.entry.hidden, true, "edge dismissal must not log out");
});

test("Escape from the sidebar handle hides only the sidebar and restores Desk focus", t => {
  const h = harness(t);
  h.logIn();
  h.palette.showSidebar();
  h.flushFrames();
  assert.equal(h.document.activeElement, h.handle);
  h.dispatch(h.sidebar, "keydown", { key: "Escape" });
  h.flushFrames();
  assert.equal(h.sidebar.open, false);
  assert.equal(h.root.open, false);
  assert.equal(h.document.activeElement, h.toggle);
});

test("sidebar Escape respects the centered menu, other modals, composition, and prevented events", t => {
  const h = harness(t);
  h.logIn();
  h.palette.showSidebar();
  h.flushFrames();
  h.palette.centerMenu();
  h.flushFrames();
  h.dispatch(h.sidebar, "keydown", { key: "Escape" });
  assert.equal(h.sidebar.open, true);
  assert.equal(h.root.open, true);
  h.dispatch(h.root, "keydown", { key: "Escape" });
  assert.equal(h.root.open, false);
  assert.equal(h.sidebar.open, true, "Escape in centered menu must leave sidebar alone");
  h.unrelatedDialog.showModal();
  h.unrelatedInput.focus();
  h.dispatch(h.sidebar, "keydown", { key: "Escape" });
  assert.equal(h.sidebar.open, true);
  assert.equal(h.document.activeElement, h.unrelatedInput);
  h.unrelatedDialog.close();
  h.handle.focus();
  h.dispatch(h.sidebar, "keydown", { key: "Escape", isComposing: true });
  assert.equal(h.sidebar.open, true);
  h.dispatch(h.sidebar, "keydown", { key: "Escape", defaultPrevented: true });
  assert.equal(h.sidebar.open, true);
  h.dispatch(h.sidebar, "keydown", { key: "Escape" });
  assert.equal(h.sidebar.open, false);
});

test("handle-initiated sidebar dismissal returns focus only after the closing spring finishes", t => {
  const h = harness(t, { reducedMotion: false });
  h.logIn();
  h.palette.showSidebar();
  h.flushFrames();
  assert.equal(h.document.activeElement, h.handle);
  h.setMotionReduced(false);
  const priorFocusCalls = h.toggle.focusCalls.length;

  h.dispatch(h.handle, "click", { detail: 0 });
  assert.equal(h.sidebar.open, true, "the closing spring is still pending");
  assert.equal(h.sidebar.hasAttribute("data-closing"), true);
  assert.equal(h.html.dataset.deskSidebar, "true");
  assert.equal(h.toggle.focusCalls.length, priorFocusCalls, "focus stays owned by the closing sidebar until its endpoint");

  h.setMotionReduced(true);
  assert.equal(h.root.open, false);
  assert.equal(h.sidebar.open, false);
  assert.equal(h.html.dataset.deskSidebar, "false");
  assert.equal(h.document.activeElement, h.toggle);
  assert.equal(h.toggle.focusCalls.length, priorFocusCalls + 1);
  assert.deepEqual(h.toggle.focusCalls.at(-1), { blockedByModal: false, closedDialog: false });
});

test("a sidebar close finishing after the centered menu opens cannot steal input focus", t => {
  const h = harness(t, { reducedMotion: false });
  h.logIn();
  h.setQuery("sidebar");
  h.palette.showSidebar();
  h.flushFrames();
  h.setMotionReduced(false);
  h.palette.hideSidebar();
  assert.equal(h.sidebar.open, true);
  h.palette.centerMenu();
  h.flushFrames();
  assert.equal(h.document.activeElement, h.input);
  const focusCalls = h.toggle.focusCalls.length;
  h.setMotionReduced(true);
  assert.equal(h.sidebar.open, false);
  assert.equal(h.root.open, true);
  assert.equal(h.document.activeElement, h.input);
  assert.equal(h.toggle.focusCalls.length, focusCalls, "do not even attempt to focus behind the centered modal");
  assert.equal(h.input.value, "");
});

for (const keepOpen of [false, true]) {
  test(`${keepOpen ? "persistent" : "ordinary"} workspace commands leave the sidebar alone`, async t => {
    const h = harness(t);
    let runs = 0;
    h.palette.register({ id: "example.run", title: "Run example", keepOpen, run() { runs++; } });
    h.logIn();
    h.palette.showSidebar();
    h.flushFrames();
    h.palette.centerMenu();
    h.flushFrames();
    h.setQuery("Run example");
    h.enter();
    await Promise.resolve();
    h.flushFrames();
    assert.equal(runs, 1);
    assert.equal(h.sidebar.open, true);
    assert.equal(h.sidebar.modal, false);
    assert.equal(h.root.open, keepOpen);
    assert.equal(h.content.hidden, false, "command execution does not discard authentication");
    if (keepOpen) assert.equal(h.document.activeElement, h.input);
    else assert.equal(h.document.activeElement, h.workspace, "a normal command must not leave native-restored focus on the sidebar handle");
  });
}

test("a separate real modal blocks CmdG, but the nonmodal sidebar does not", t => {
  const h = harness(t);
  h.logIn();
  h.palette.showSidebar();
  h.flushFrames();
  h.unrelatedDialog.showModal();
  h.unrelatedInput.focus();
  h.shortcut();
  assert.equal(h.root.open, false);
  assert.equal(h.sidebar.open, true);
  assert.equal(h.document.activeElement, h.unrelatedInput);
  h.unrelatedDialog.close();
  h.shortcut();
  assert.equal(h.root.open, true);
  assert.equal(h.sidebar.open, true);
  assert.equal(h.document.activeElement, h.input);
});
