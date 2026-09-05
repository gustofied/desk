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
      const name = part.trim();
      if (name === "[hidden]") return this.hidden;
      if (name === "[inert]") return this.inert;
      if (name === ":disabled") return this.disabled;
      if (!/^\[[\w-]+\]$/.test(name)) return false;
      const attribute = name.slice(1, -1);
      const dataKey = attribute.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      return this.hasAttribute(attribute) || (attribute.startsWith("data-") && dataKey in this.dataset);
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [
      ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  show() { this.open = true; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() {
    // The external Desk button is hidden by CSS for the entire sidebar settle.
    const hiddenBySidebar = this.hasAttribute("data-command-open") &&
      this.ownerDocument.documentElement.dataset.deskSidebar === "true";
    this.focusCalls.push({ hiddenBySidebar });
    if (!hiddenBySidebar && !this.disabled && !this.closest("[hidden], [inert]")) {
      this.ownerDocument.activeElement = this;
    }
  }
  scrollIntoView() {}
}

function harness(t, { reducedMotion = true } = {}) {
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
  root.setAttribute("data-desk-sidecar", "");
  const entry = make("data-desk-entry");
  const login = make("data-desk-login", "button");
  login.append(make("data-desk-login-label", "span"));
  entry.append(login);
  const content = make("data-command-content");
  const input = make("data-command-input", "input");
  const results = make("data-command-results");
  content.append(input, results, make("data-command-status"));
  const handle = make("data-sidecar-handle", "button");
  root.append(entry, content, handle);
  body.append(toggle, root);
  document.activeElement = toggle;
  document.createElement = tagName => make(null, tagName);
  document.createDocumentFragment = () => make(null, "fragment");
  document.querySelector = selector => selector.startsWith("dialog[open]")
    ? null : html.querySelector(selector);

  const viewport = Object.assign(new EventTarget(), { matches: false });
  const motion = Object.assign(new EventTarget(), { matches: true });
  window.innerWidth = 1200;
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
    palette, document, html, root, toggle, entry, login, content, input, results, handle,
    dispatch, flushFrames, logIn,
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
  assert.equal(h.html.dataset.deskSidebar, "false");

  h.palette.open();
  h.flushFrames();
  h.palette.showSidebar();
  h.flushFrames();
  assert.equal(h.root.dataset.presentation, "menu");
  assert.equal(h.document.activeElement, h.login);
  assert.equal(h.content.hidden, true);
  assert.deepEqual(h.commandTitles(), []);
});

test("authenticated Show sidebar command docks and focuses the handle, not the passive logo", t => {
  const h = harness(t);
  h.logIn();
  assert.ok(h.commandTitles().includes("Show sidebar"));
  h.setQuery("sidebar");
  const loginFocusCount = h.login.focusCalls.length;
  h.dispatch(h.input, "keydown", { key: "Enter" });
  h.flushFrames();

  assert.equal(h.root.dataset.presentation, "sidebar");
  assert.equal(h.content.hidden, true);
  assert.equal(h.entry.hidden, false);
  assert.equal(h.login.disabled, true);
  assert.equal(h.login.inert, true);
  assert.equal(h.login.getAttribute("tabindex"), "-1");
  assert.equal(h.login.getAttribute("aria-hidden"), "true");
  assert.equal(h.document.activeElement, h.handle);
  assert.equal(h.login.focusCalls.length, loginFocusCount);
});

test("API docking and centering preserve the query, authentication, and input focus", t => {
  const h = harness(t);
  h.palette.register({ id: "catalog.open", title: "Open catalog", run() {} });
  h.logIn();
  h.setQuery("catalog");
  h.palette.showSidebar();
  h.flushFrames();
  assert.equal(h.root.dataset.presentation, "sidebar");
  assert.equal(h.document.activeElement, h.handle);
  assert.equal(h.input.value, "catalog");

  // Even a synthetic activation of the passive logo must not log the user out.
  h.dispatch(h.login, "click", { detail: 0 });
  h.palette.centerMenu();
  h.flushFrames();
  assert.equal(h.root.dataset.presentation, "menu");
  assert.equal(h.entry.hidden, true);
  assert.equal(h.content.hidden, false);
  assert.equal(h.input.value, "catalog");
  assert.equal(h.document.activeElement, h.input);
  assert.deepEqual(h.commandTitles(), ["Open catalog"]);
});

test("sidebar dismissal restores focus only after the drawer closes and layout reveals Desk", t => {
  const h = harness(t, { reducedMotion: false });
  h.logIn();
  h.palette.showSidebar();
  h.flushFrames();
  assert.equal(h.document.activeElement, h.handle);
  h.setMotionReduced(false);
  const priorFocusCalls = h.toggle.focusCalls.length;

  h.palette.close();
  assert.equal(h.root.open, true, "the closing spring is still pending");
  assert.equal(h.root.hasAttribute("data-closing"), true);
  assert.equal(h.html.dataset.deskSidebar, "true");
  assert.equal(h.toggle.focusCalls.length, priorFocusCalls, "do not attempt to focus CSS-hidden Desk");

  h.setMotionReduced(true);
  assert.equal(h.root.open, false);
  assert.equal(h.html.dataset.deskSidebar, "false");
  assert.equal(h.document.activeElement, h.toggle);
  assert.equal(h.toggle.focusCalls.length, priorFocusCalls + 1);
  assert.deepEqual(h.toggle.focusCalls.at(-1), { hiddenBySidebar: false });
});
