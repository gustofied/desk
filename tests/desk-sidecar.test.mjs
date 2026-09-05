import assert from "node:assert/strict";
import test from "node:test";
import { spring } from "motion";
import { createDeskSidecar, resolveSidecarWidth } from "../src/desk-sidecar.js";

class FakeElement extends EventTarget {
  attributes = new Map();
  dataset = {};
  open = false;
  inert = false;
  style = {
    values: new Map(),
    setProperty(name, value) { this.values.set(name, value); },
    removeProperty(name) { this.values.delete(name); delete this[name]; },
  };
  shown = [];
  closeCount = 0;
  children = new Set();
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  contains(target) { return target === this || this.children.has(target); }
  show() { this.shown.push({ modal: false, inert: this.inert }); this.open = true; }
  showModal() { this.shown.push({ modal: true, inert: this.inert }); this.open = true; }
  close() { this.open = false; this.closeCount++; }
  focus() { this.ownerDocument.activeElement = this; }
  setPointerCapture(id) { this.captured = id; }
  hasPointerCapture(id) { return this.captured === id; }
  releasePointerCapture() { this.captured = null; }
}

function harness({ viewportWidth = 1200, saved, reducedMotion = false, storageError = false } = {}) {
  const html = new FakeElement();
  const root = new FakeElement();
  const toggle = new FakeElement();
  const dragHandle = new FakeElement();
  const workspace = new FakeElement();
  const document = Object.assign(new EventTarget(), { documentElement: html, activeElement: workspace });
  for (const node of [html, root, toggle, dragHandle, workspace]) node.ownerDocument = document;
  root.children.add(dragHandle);
  const window = new EventTarget();
  const viewport = new EventTarget();
  viewport.matches = viewportWidth <= 960;
  const motion = new EventTarget();
  motion.matches = reducedMotion;
  window.innerWidth = viewportWidth;
  let time = 0;
  window.performance = { now: () => time += 16 };
  window.matchMedia = query => query.includes("960px") ? viewport : motion;
  document.defaultView = window;
  const savedValues = new Map(saved === undefined ? [] : [["desk-sidecar", saved]]);
  const writes = [];
  const storage = {
    getItem(key) { if (storageError) throw Error("unavailable"); return savedValues.get(key); },
    setItem(key, value) { if (storageError) throw Error("unavailable"); savedValues.set(key, value); writes.push(value); },
  };
  let storageReads = 0;
  Object.defineProperty(window, "localStorage", { get() {
    storageReads++;
    if (storageError) throw Error("unavailable");
    return storage;
  } });
  const animations = [];
  const opens = [];
  const modes = [];
  let closes = 0;
  let closed = 0;
  let dismissals = 0;
  const sidecar = createDeskSidecar({
    root, toggle, dragHandle, document, window,
    onOpen: options => opens.push(options), onClose: () => closes++, onClosed: () => closed++,
    onDismiss() { dismissals++; sidecar.close(); },
    onModeChange: options => modes.push(options),
    animate(from, to, options) {
      const animation = { from, to, options, stopped: false, stop() { this.stopped = true; } };
      animations.push(animation);
      return animation;
    },
  });
  function resizeViewport(width) {
    window.innerWidth = width;
    viewport.matches = width <= 960;
    window.dispatchEvent(new Event("resize"));
  }
  function dispatch(target, type, properties = {}) {
    const event = new Event(type, { cancelable: true });
    for (const [key, value] of Object.entries({ timeStamp: time += 16, ...properties })) Object.defineProperty(event, key, { value });
    target.dispatchEvent(event);
    return event;
  }
  return {
    sidecar, root, toggle, dragHandle, workspace, document, window, html,
    viewport, motion, animations, opens, modes, writes, savedValues,
    resizeViewport, dispatch, get closes() { return closes; }, get closed() { return closed; },
    get dismissals() { return dismissals; }, get storageReads() { return storageReads; },
    pointer(type, x, timeStamp, pointerId = 1) {
      return dispatch(dragHandle, type, { button: 0, pointerId, clientX: x, timeStamp });
    },
  };
}

test("fixed responsive widths never exceed the current maximum or narrow viewport", () => {
  assert.equal(resolveSidecarWidth(1200), 240);
  assert.equal(resolveSidecarWidth(1440), 288);
  assert.equal(resolveSidecarWidth(2000), 320);
  assert.equal(resolveSidecarWidth(1000), 240);
  assert.equal(resolveSidecarWidth(1400), 280);
  assert.equal(resolveSidecarWidth(390), 320);
  assert.equal(resolveSidecarWidth(320), 296);
  assert.equal(resolveSidecarWidth(240), 216);
});

test("legacy widths, malformed preferences, and denied storage are never read or written", () => {
  for (const saved of ["bad", "null", "[]", '{"open":true,"width":440}', '{"width":240}']) {
    const h = harness({ saved });
    h.sidecar.showSidebar({ animate: false });
    assert.equal(h.html.style.values.get("--desk-sidecar-width"), "240px");
    assert.equal(h.storageReads, 0);
    h.sidecar.close({ animate: false });
    h.sidecar.destroy();
    assert.equal(h.writes.length, 0);
  }
  const h = harness({ storageError: true });
  h.sidecar.initialize();
  h.sidecar.close({ animate: false });
  h.sidecar.open({ animate: false });
  assert.equal(h.sidecar.isOpen, true);
  assert.equal(h.storageReads, 0);
  h.sidecar.destroy();
});

test("every page starts closed in the original menu presentation despite legacy saved open", () => {
  for (const viewportWidth of [390, 1200]) {
    for (const saved of [undefined, '{"open":true,"width":350}', '{"open":false,"width":350}']) {
      const h = harness({ viewportWidth, saved });
      h.sidecar.initialize();
      h.sidecar.initialize();
      assert.equal(h.sidecar.isOpen, false);
      assert.equal(h.sidecar.presentation, "menu");
      assert.equal(h.root.dataset.presentation, "menu");
      assert.equal(h.html.dataset.deskSidebar, "false");
      assert.deepEqual(h.root.shown, []);
      assert.deepEqual(h.opens, []);
      assert.equal(h.document.activeElement, h.workspace);
      assert.equal(h.root.inert, true);
      assert.equal(h.html.style.values.get("--desk-sidecar-space"), "0px");
      assert.equal(h.root.style.transform, undefined);
      assert.equal(h.animations.length, 0);
      assert.equal(h.writes.length, 0);
      h.sidecar.destroy();
    }
  }
});

test("default opening remains a centered modal without reading old width preferences", () => {
  const h = harness({ saved: '{"open":false,"width":350}' });
  h.sidecar.initialize();
  assert.equal(h.root.open, false);
  assert.equal(h.root.inert, true);
  assert.equal(h.html.style.values.get("--desk-sidecar-width"), "240px");
  assert.equal(h.html.style.values.get("--desk-sidecar-space"), "0px");
  h.sidecar.open({ animate: false });
  assert.deepEqual(h.root.shown, [{ modal: true, inert: true }]);
  assert.equal(h.sidecar.presentation, "menu");
  assert.equal(h.root.attributes.get("aria-modal"), "true");
  assert.equal(h.html.style.values.get("--desk-sidecar-space"), "0px");
  assert.equal(h.root.style.transform, undefined);
  h.sidecar.close({ animate: false });
  assert.equal(h.writes.length, 0);
  h.sidecar.showSidebar({ animate: false });
  assert.equal(h.html.style.values.get("--desk-sidecar-width"), "240px");
  assert.equal(h.storageReads, 0);
  h.sidecar.destroy();
});

test("the optional mobile sidebar opens modal and never pushes the workspace", () => {
  const h = harness({ viewportWidth: 390 });
  h.sidecar.initialize();
  assert.equal(h.root.open, false);
  h.sidecar.showSidebar({ animate: false });
  assert.deepEqual(h.root.shown, [{ modal: true, inert: true }]);
  assert.equal(h.root.attributes.get("aria-modal"), "true");
  assert.equal(h.html.style.values.get("--desk-sidecar-space"), "0px");
  assert.equal(h.html.style.values.get("--desk-sidecar-width"), "320px");
  h.sidecar.close({ animate: false });
  assert.equal(h.root.open, false);
  assert.equal(h.root.inert, true);
  assert.equal(h.closed, 1);
  assert.equal(h.writes.length, 0);
  h.sidecar.destroy();
});

test("menu and sidebar use the same dialog without reopening or closing login state", () => {
  const h = harness();
  h.sidecar.initialize();
  h.sidecar.open();
  const input = new FakeElement();
  input.ownerDocument = h.document;
  input.value = "GPU";
  h.root.children.add(input);
  input.focus();
  h.sidecar.showSidebar({ animate: false });
  assert.equal(h.sidecar.presentation, "sidebar");
  assert.equal(h.root.dataset.presentation, "sidebar");
  assert.equal(h.html.dataset.deskSidebar, "true");
  assert.equal(h.root.attributes.get("aria-modal"), "false");
  assert.equal(h.html.style.values.get("--desk-sidecar-space"), "240px");
  h.sidecar.centerMenu();
  assert.equal(h.sidecar.presentation, "menu");
  assert.equal(h.root.attributes.get("aria-modal"), "true");
  assert.equal(h.html.dataset.deskSidebar, "false");
  assert.equal(h.html.style.values.get("--desk-sidecar-space"), "0px");
  assert.equal(h.root.style.transform, undefined);
  assert.equal(h.document.activeElement, input);
  assert.equal(input.value, "GPU");
  assert.equal(h.opens.length, 1);
  assert.equal(h.closes, 0);
  assert.deepEqual(h.root.shown.map(shown => shown.modal), [true, false, true]);
  h.sidecar.destroy();
});

test("a sidebar stays inset while closing and the next ordinary open is centered", () => {
  const h = harness();
  h.sidecar.showSidebar({ animate: false });
  h.sidecar.close();
  const closing = h.animations.at(-1);
  closing.options.onUpdate(80);
  assert.equal(h.html.dataset.deskSidebar, "true");
  assert.equal(h.html.style.values.get("--desk-sidecar-space"), "80px");
  closing.options.onComplete();
  assert.equal(h.html.dataset.deskSidebar, "false");
  assert.equal(h.root.dataset.presentation, "menu");
  assert.equal(h.root.open, false);
  h.sidecar.open();
  assert.equal(h.root.attributes.get("aria-modal"), "true");
  assert.equal(h.html.style.values.get("--desk-sidecar-space"), "0px");
  h.sidecar.destroy();
});

test("centering during a closing spring ignores stale callbacks and clears sidebar layout", () => {
  const h = harness();
  h.sidecar.showSidebar({ animate: false });
  h.sidecar.close();
  const closing = h.animations.at(-1);
  closing.options.onUpdate(100);
  h.sidecar.centerMenu();
  closing.options.onUpdate(60);
  closing.options.onComplete();
  assert.equal(closing.stopped, true);
  assert.equal(h.root.open, true);
  assert.equal(h.root.attributes.get("aria-modal"), "true");
  assert.equal(h.html.dataset.deskSidebar, "false");
  assert.equal(h.html.style.values.get("--desk-sidecar-space"), "0px");
  assert.equal(h.root.style.transform, undefined);
  h.sidecar.destroy();
});

test("centered menus remain modal across breakpoints and ignore the sidebar handle", () => {
  const h = harness();
  h.sidecar.open();
  h.dispatch(h.dragHandle, "click", { detail: 0 });
  h.pointer("pointerdown", 240, 0);
  h.resizeViewport(390);
  h.resizeViewport(1400);
  assert.equal(h.root.shown.length, 1);
  assert.equal(h.root.closeCount, 0);
  assert.equal(h.root.attributes.get("aria-modal"), "true");
  assert.equal(h.html.dataset.deskSidebar, "false");
  assert.equal(h.html.style.values.get("--desk-sidecar-space"), "0px");
  assert.equal(h.dragHandle.captured, undefined);
  assert.equal(h.writes.length, 0);
  assert.equal(h.modes.length, 0);
  h.sidecar.destroy();
});

test("reversing close starts from the visible position and ignores stale completion", () => {
  const h = harness();
  h.sidecar.initialize();
  h.sidecar.showSidebar({ animate: false });
  h.sidecar.close();
  const closing = h.animations.at(-1);
  assert.equal(closing.from, 240);
  closing.options.onUpdate(120);
  assert.equal(h.html.style.values.get("--desk-sidecar-space"), "120px");
  h.sidecar.showSidebar();
  const opening = h.animations.at(-1);
  assert.equal(closing.stopped, true);
  assert.equal(opening.from, 120);
  assert.equal(opening.to, 240);
  assert.equal(opening.options.damping, 2 * Math.sqrt(opening.options.stiffness * opening.options.mass));
  closing.options.onComplete();
  closing.options.onUpdate(0);
  assert.equal(h.root.open, true);
  assert.equal(h.root.inert, false);
  assert.equal(h.html.style.values.get("--desk-sidecar-space"), "120px");
  opening.options.onComplete();
  assert.equal(h.html.style.values.get("--desk-sidecar-space"), "240px");
  h.sidecar.destroy();
});

test("micro movement tracks directly on desktop and mobile without enlarging or closing", () => {
  for (const viewportWidth of [1200, 390]) {
    const h = harness({ viewportWidth });
    const width = resolveSidecarWidth(viewportWidth);
    h.sidecar.showSidebar({ animate: false });
    h.pointer("pointerdown", width, 0);
    assert.equal(h.dragHandle.captured, 1);
    assert.equal(h.html.dataset.sidecarDragging, "true");
    h.pointer("pointermove", width - 4, 150);
    assert.equal(h.root.style.transform, "translateX(-4px)");
    assert.equal(h.html.style.values.get("--desk-sidecar-width"), `${width}px`);
    assert.equal(h.html.style.values.get("--desk-sidecar-space"), `${viewportWidth > 960 ? width - 4 : 0}px`);
    assert.equal(Number(h.html.style.values.get("--desk-sidecar-progress")), (width - 4) / width);
    assert.equal(h.dismissals, 0);
    assert.equal(h.animations.length, 0);
    h.pointer("pointermove", width + 80, 300);
    assert.equal(h.root.style.transform, "translateX(0px)");
    assert.equal(h.html.style.values.get("--desk-sidecar-width"), `${width}px`);
    h.pointer("pointerup", width + 80, 450);
    assert.equal(h.sidecar.isOpen, true);
    assert.equal(h.dragHandle.captured, null);
    assert.equal(h.html.dataset.sidecarDragging, undefined);
    assert.equal(h.dispatch(h.dragHandle, "click", { detail: 1 }).defaultPrevented, true);
    assert.equal(h.dismissals, 0);
    assert.equal(h.writes.length, 0);
    h.sidecar.destroy();
  }
});

test("a six-pixel slow left pull starts the full close before release and suppresses its click", () => {
  const h = harness();
  h.sidecar.showSidebar({ animate: false });
  h.pointer("pointerdown", 240, 0);
  h.pointer("pointermove", 235, 150);
  assert.equal(h.dismissals, 0);
  h.pointer("pointermove", 234, 300);
  assert.equal(h.dismissals, 1);
  assert.equal(h.sidecar.isOpen, false);
  assert.equal(h.dragHandle.captured, null);
  const snap = h.animations.at(-1);
  assert.equal(snap.from, 234);
  assert.equal(snap.to, 0);
  assert.equal(snap.options.velocity, 0);
  h.pointer("pointerup", 234, 450);
  const click = h.dispatch(h.dragHandle, "click", { detail: 1 });
  assert.equal(click.defaultPrevented, true);
  assert.equal(h.dismissals, 1);
  snap.options.onComplete();
  assert.equal(h.html.style.values.get("--desk-sidecar-space"), "0px");
  assert.equal(h.root.open, false);
  // A later ordinary tap is not swallowed by the earlier drag.
  h.sidecar.showSidebar({ animate: false });
  h.pointer("pointerdown", 240, 600);
  h.pointer("pointerup", 240, 650);
  h.dispatch(h.dragHandle, "click", { detail: 1 });
  assert.equal(h.dismissals, 2);
  h.sidecar.destroy();
});

test("a deliberate left pull dismisses through its owner and never rests partly open", () => {
  for (const viewportWidth of [1200, 390]) {
    const h = harness({ viewportWidth });
    const width = resolveSidecarWidth(viewportWidth);
    h.sidecar.showSidebar({ animate: false });
    h.pointer("pointerdown", width, 0);
    h.pointer("pointermove", width * 0.3, 300);
    assert.equal(h.dismissals, 1);
    assert.equal(h.sidecar.isOpen, false);
    h.pointer("pointerup", width * 0.3, 450);
    assert.equal(h.dismissals, 1);
    assert.equal(h.closes, 1);
    assert.equal(h.sidecar.isOpen, false);
    assert.equal(h.root.inert, true);
    assert.equal(h.animations.at(-1).to, 0);
    assert.equal(h.html.style.values.get("--desk-sidecar-width"), `${width}px`);
    h.dispatch(h.dragHandle, "click", { detail: 1 });
    assert.equal(h.dismissals, 1);
    h.animations.at(-1).options.onComplete();
    assert.equal(h.root.open, false);
    assert.equal(h.html.style.values.get("--desk-sidecar-space"), "0px");
    assert.equal(h.html.style.values.get("--desk-sidecar-progress"), "0");
    assert.equal(h.closed, 1);
    h.sidecar.destroy();
  }
});

test("a left flick hands its live velocity to the immediate closing spring", () => {
  const h = harness();
  h.sidecar.showSidebar({ animate: false });
  h.pointer("pointerdown", 240, 0);
  h.pointer("pointermove", 180, 40);
  assert.equal(h.dismissals, 1);
  const snap = h.animations.at(-1);
  assert.equal(snap.from, 180);
  assert.equal(snap.to, 0);
  assert.equal(snap.options.velocity, -1500);
  assert.equal(snap.options.damping, 2 * Math.sqrt(snap.options.stiffness * snap.options.mass));
  const actualSpring = spring({ ...snap.options, keyframes: [snap.from, snap.to] });
  assert.equal(actualSpring.velocity(0), -1500);
  h.pointer("pointerup", 180, 50);
  assert.equal(h.dismissals, 1);
  h.sidecar.destroy();
});

test("once left dismissal commits, later pointer events cannot reverse or retrigger it", () => {
  const h = harness();
  h.sidecar.showSidebar({ animate: false });
  h.pointer("pointerdown", 240, 0);
  h.pointer("pointermove", 234, 150);
  const snap = h.animations.at(-1);
  assert.equal(snap.from, 234);
  assert.equal(snap.to, 0);
  h.pointer("pointermove", 300, 180);
  h.pointer("pointercancel", 300, 185);
  h.pointer("lostpointercapture", 300, 190);
  h.pointer("pointerup", 300, 195);
  h.window.dispatchEvent(new Event("blur"));
  assert.equal(h.animations.at(-1), snap);
  assert.equal(snap.stopped, false);
  assert.equal(h.dismissals, 1);
  snap.options.onComplete();
  assert.equal(h.html.style.values.get("--desk-sidecar-space"), "0px");
  assert.equal(h.root.open, false);
  h.sidecar.destroy();
});

test("a moving panel can be grabbed at its visible position without changing its width", () => {
  const h = harness();
  h.sidecar.showSidebar();
  const opening = h.animations.at(-1);
  opening.options.onUpdate(120);
  h.pointer("pointerdown", 120, 0);
  assert.equal(opening.stopped, true);
  assert.equal(h.html.style.values.get("--desk-sidecar-space"), "120px");
  h.pointer("pointermove", 118, 150);
  assert.equal(h.html.style.values.get("--desk-sidecar-space"), "118px");
  assert.equal(h.html.style.values.get("--desk-sidecar-width"), "240px");
  opening.options.onUpdate(240);
  opening.options.onComplete();
  assert.equal(h.html.style.values.get("--desk-sidecar-space"), "118px");
  h.pointer("pointercancel", 118, 200);
  const snap = h.animations.at(-1);
  assert.equal(snap.from, 118);
  assert.equal(snap.to, 240);
  snap.options.onUpdate(180);
  h.pointer("pointerdown", 180, 300);
  assert.equal(snap.stopped, true);
  h.pointer("pointermove", 178, 400);
  assert.equal(h.html.style.values.get("--desk-sidecar-space"), "178px");
  h.sidecar.destroy();
});

test("cancel, capture loss, and window blur return uncommitted movement fully open", () => {
  for (const type of ["pointercancel", "lostpointercapture", "blur"]) {
    const h = harness();
    h.sidecar.showSidebar({ animate: false });
    h.pointer("pointerdown", 240, 0);
    h.pointer("pointermove", 236, 150);
    if (type === "blur") h.window.dispatchEvent(new Event("blur"));
    else h.pointer(type, 236, 200);
    assert.equal(h.dismissals, 0);
    assert.equal(h.dragHandle.captured, null);
    assert.equal(h.html.dataset.sidecarDragging, undefined);
    const snap = h.animations.at(-1);
    assert.equal(snap.to, 240);
    assert.equal(snap.options.velocity, 0);
    h.pointer("pointerup", 0, 210);
    snap.options.onComplete();
    assert.equal(h.root.style.transform, "translateX(0px)");
    h.sidecar.destroy();
  }
});

test("the native button closes by tap or keyboard click, without keyboard resizing", () => {
  for (const detail of [0, 1]) {
    const h = harness();
    h.sidecar.showSidebar({ animate: false });
    for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) {
      assert.equal(h.dispatch(h.dragHandle, "keydown", { key }).defaultPrevented, false);
    }
    assert.equal(h.dragHandle.attributes.has("aria-valuenow"), false);
    assert.equal(h.html.style.values.get("--desk-sidecar-width"), "240px");
    h.dispatch(h.dragHandle, "click", { detail });
    assert.equal(h.dismissals, 1);
    assert.equal(h.closes, 1);
    h.sidecar.destroy();
  }
});

test("breakpoint changes migrate dialog mode without reopening login state", () => {
  const h = harness();
  h.sidecar.initialize();
  h.sidecar.showSidebar({ animate: false });
  h.resizeViewport(390);
  assert.equal(h.sidecar.mobile, true);
  assert.equal(h.root.attributes.get("aria-modal"), "true");
  assert.equal(h.html.style.values.get("--desk-sidecar-space"), "0px");
  assert.deepEqual(h.modes, [{ mobile: true, focus: true }]);
  h.resizeViewport(1400);
  assert.equal(h.sidecar.mobile, false);
  assert.equal(h.root.attributes.get("aria-modal"), "false");
  assert.equal(h.html.style.values.get("--desk-sidecar-space"), "280px");
  assert.equal(h.opens.length, 1);
  assert.equal(h.closes, 0);
  h.sidecar.destroy();
});

test("viewport changes use the fixed responsive width and cancel an active drag", () => {
  const h = harness({ saved: '{"open":true,"width":440}' });
  h.sidecar.showSidebar({ animate: false });
  h.pointer("pointerdown", 240, 0);
  h.pointer("pointermove", 236, 100);
  h.resizeViewport(390);
  assert.equal(h.dragHandle.captured, null);
  assert.equal(h.html.dataset.sidecarDragging, undefined);
  assert.equal(h.html.style.values.get("--desk-sidecar-width"), "320px");
  assert.equal(h.root.style.transform, "translateX(0px)");
  h.pointer("pointerup", 0, 150);
  assert.equal(h.dismissals, 0);
  h.resizeViewport(1000);
  assert.equal(h.html.style.values.get("--desk-sidecar-width"), "240px");
  h.resizeViewport(1600);
  assert.equal(h.html.style.values.get("--desk-sidecar-width"), "320px");
  assert.equal(h.storageReads, 0);
  assert.equal(h.writes.length, 0);
  h.sidecar.destroy();
});

test("a breakpoint during dismissal finishes the close lifecycle exactly once", () => {
  const h = harness();
  h.sidecar.showSidebar({ animate: false });
  h.dispatch(h.dragHandle, "click", { detail: 0 });
  const closing = h.animations.at(-1);
  closing.options.onUpdate(100);
  h.resizeViewport(390);
  assert.equal(h.closed, 1);
  assert.equal(h.root.open, false);
  assert.equal(h.sidecar.presentation, "menu");
  assert.equal(h.html.style.values.get("--desk-sidecar-progress"), "0");
  closing.options.onComplete();
  assert.equal(h.closed, 1);
  h.sidecar.destroy();
});

test("non-primary pointers and another modal cannot dismiss or strand the sidebar", () => {
  const h = harness();
  h.sidecar.showSidebar({ animate: false });
  h.dispatch(h.dragHandle, "pointerdown", { button: 2, pointerId: 1, clientX: 240 });
  h.dispatch(h.dragHandle, "pointerdown", { button: 0, pointerId: 2, clientX: 240, isPrimary: false });
  assert.equal(h.dragHandle.captured, undefined);
  h.pointer("pointerdown", 240, 0);
  h.pointer("pointermove", 100, 150, 2);
  assert.equal(h.root.style.transform, "translateX(0px)");
  h.document.querySelector = () => ({});
  h.pointer("pointermove", 60, 300);
  h.pointer("pointerup", 60, 450);
  assert.equal(h.dismissals, 0);
  assert.equal(h.animations.at(-1).to, 240);
  h.animations.at(-1).options.onComplete();
  h.pointer("pointerdown", 240, 500);
  assert.equal(h.dragHandle.captured, null);
  h.dispatch(h.dragHandle, "click", { detail: 0 });
  assert.equal(h.dismissals, 0);
  h.sidecar.destroy();
});

test("a save dialog retains priority during mobile migration until it closes", async () => {
  const h = harness();
  const saveDialog = new FakeElement();
  saveDialog.ownerDocument = h.document;
  saveDialog.open = true;
  h.document.querySelector = () => saveDialog.open ? saveDialog : null;
  h.sidecar.initialize();
  h.sidecar.showSidebar({ animate: false });
  const saveInput = new FakeElement();
  saveInput.ownerDocument = h.document;
  h.document.activeElement = saveInput;
  h.root.show = () => {
    FakeElement.prototype.show.call(h.root);
    // Native dialog migration may move focus even though another modal remains.
    h.document.activeElement = h.workspace;
  };
  h.resizeViewport(390);
  assert.equal(h.root.attributes.get("aria-modal"), "false");
  assert.equal(h.root.shown.at(-1).modal, false);
  assert.equal(h.document.activeElement, saveInput);
  assert.deepEqual(h.modes, [{ mobile: true, focus: false }]);
  assert.equal(h.opens.length, 1);
  saveDialog.open = false;
  h.document.dispatchEvent(new Event("close"));
  await Promise.resolve();
  assert.equal(h.root.attributes.get("aria-modal"), "true");
  assert.equal(h.root.shown.at(-1).modal, true);
  assert.deepEqual(h.modes.at(-1), { mobile: true, focus: true });
  assert.equal(h.opens.length, 1);
  h.sidecar.destroy();
});

test("a dismissed sidecar never reopens when a modal with deferred priority closes", async () => {
  const h = harness();
  let otherOpen = true;
  h.document.querySelector = () => otherOpen ? {} : null;
  h.sidecar.initialize();
  h.sidecar.showSidebar({ animate: false });
  h.resizeViewport(390);
  h.sidecar.close({ animate: false });
  otherOpen = false;
  h.document.dispatchEvent(new Event("close"));
  await Promise.resolve();
  assert.equal(h.root.open, false);
  assert.equal(h.sidecar.isOpen, false);
  h.sidecar.destroy();
});

test("reduced motion settles immediately, including when changed during animation", () => {
  const h = harness();
  h.sidecar.initialize();
  h.sidecar.showSidebar({ animate: false });
  h.sidecar.close();
  const closing = h.animations.at(-1);
  closing.options.onUpdate(100);
  h.motion.matches = true;
  h.motion.dispatchEvent(new Event("change"));
  assert.equal(closing.stopped, true);
  assert.equal(h.root.open, false);
  assert.equal(h.html.style.values.get("--desk-sidecar-space"), "0px");
  h.sidecar.showSidebar();
  assert.equal(h.animations.length, 1);
  assert.equal(h.html.style.values.get("--desk-sidecar-space"), "240px");
  h.sidecar.destroy();
});

test("reduced motion keeps micro movement direct and committed dismissal immediate", () => {
  const h = harness({ reducedMotion: true });
  h.sidecar.showSidebar();
  h.pointer("pointerdown", 240, 0);
  h.pointer("pointermove", 238, 150);
  assert.equal(h.root.style.transform, "translateX(-2px)");
  assert.equal(h.dismissals, 0);
  h.pointer("pointerup", 238, 300);
  assert.equal(h.root.style.transform, "translateX(0px)");
  h.pointer("pointerdown", 240, 450);
  h.pointer("pointermove", 234, 600);
  assert.equal(h.root.open, false);
  assert.equal(h.dismissals, 1);
  h.pointer("pointerup", 234, 750);
  assert.equal(h.dismissals, 1);
  assert.equal(h.animations.length, 0);
  h.sidecar.destroy();
});

test("destroy removes listeners and prevents animation callbacks from reviving the drawer", () => {
  const h = harness();
  h.sidecar.initialize();
  h.sidecar.showSidebar({ animate: false });
  h.sidecar.close();
  const closing = h.animations.at(-1);
  h.sidecar.destroy();
  closing.options.onUpdate(200);
  closing.options.onComplete();
  h.resizeViewport(390);
  h.sidecar.open();
  assert.equal(h.root.open, false);
  assert.equal(h.root.inert, true);
  assert.equal(h.html.style.values.get("--desk-sidecar-space"), "0px");
});
