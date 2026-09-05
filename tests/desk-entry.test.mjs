import assert from "node:assert/strict";
import test from "node:test";
import { createDeskEntry } from "../src/desk-entry.js";

function harness({ baseInk = null, revealInk = null, ...options } = {}) {
  const panel = () => ({ hidden: false, inert: false, style: { removeProperty() {} } });
  const entry = panel();
  const content = panel();
  const button = new EventTarget();
  button.style = panel().style;
  const attributes = new Map();
  button.setAttribute = (name, value) => attributes.set(name, value);
  button.toggleAttribute = (name, value) => value ? attributes.set(name, "") : attributes.delete(name);
  const label = { textContent: "Log in" };
  button.querySelector = selector => {
    if (selector === "[data-desk-login-label]") return label;
    if (selector === "[data-desk-logo-base]") return baseInk;
    if (selector === "[data-desk-logo-reveal]") return revealInk;
    return null;
  };
  const motions = [];
  const waits = new Map();
  let timerId = 0;
  let reveals = 0;
  const gate = createDeskEntry({
    entry, content, button,
    onReveal: () => reveals++,
    schedule(callback, delay) {
      waits.set(++timerId, { callback, delay });
      return timerId;
    },
    cancel(id) { waits.delete(id); },
    animate(element, keyframes, timing) {
      let finish;
      const animation = new Promise(resolve => { finish = resolve; });
      animation.cancel = () => { animation.cancelled = true; };
      motions.push({ element, keyframes, timing, animation, finish });
      return animation;
    },
    ...options,
  });
  function click(detail = 1) {
    const event = new Event("click");
    Object.defineProperty(event, "detail", { value: detail });
    button.dispatchEvent(event);
  }
  function finishWait() {
    const pending = [...waits.values()];
    waits.clear();
    pending.forEach(wait => wait.callback());
  }
  return { gate, entry, content, motions, click, finishWait, waits, label, attributes, get reveals() { return reveals; } };
}

test("entry hides and disables commands until the mock login is clicked", () => {
  const h = harness();
  assert.equal(h.gate.open(), false);
  assert.equal(h.entry.hidden, false);
  assert.equal(h.content.hidden, true);
  assert.equal(h.content.inert, true);
  h.click(0);
  assert.equal(h.reveals, 1);
  assert.equal(h.gate.ready, true);
  assert.equal(h.content.hidden, false);
  assert.equal(h.content.inert, false);
  assert.equal(h.entry.hidden, true);
});

test("keyboard and reduced-motion entry are instant", () => {
  const keyboard = harness();
  keyboard.gate.open();
  keyboard.click(0);
  assert.equal(keyboard.motions.length, 0);
  assert.equal(keyboard.waits.size, 0);
  const reduced = harness({ reducedMotion: true });
  reduced.gate.open({ animateEntrance: true });
  reduced.click();
  assert.equal(reduced.motions.length, 0);
  assert.equal(reduced.waits.size, 0);
});

test("pointer login reveals once and settles with only commands visible", async () => {
  const h = harness();
  h.gate.open({ animateEntrance: true });
  h.click();
  h.click();
  assert.equal(h.reveals, 0);
  assert.equal(h.waits.size, 1);
  assert.equal(h.label.textContent, "Opening…");
  assert.equal(h.attributes.get("aria-busy"), "true");
  assert.equal([...h.waits.values()][0].delay, 600);
  h.finishWait();
  assert.equal(h.reveals, 1);
  assert.equal(h.attributes.get("aria-busy"), "false");
  assert.equal(h.motions.length, 3);
  assert.equal(h.motions[0].animation.cancelled, true);
  h.motions.forEach(motion => motion.finish());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.entry.hidden, true);
  assert.equal(h.content.hidden, false);
});

test("closing mid-reveal cancels motion; reopening keeps the menu accessible", async () => {
  const h = harness();
  h.gate.open();
  h.click();
  h.finishWait();
  h.gate.close();
  assert.equal(h.motions.every(motion => motion.animation.cancelled), true);
  assert.equal(h.gate.open({ animateEntrance: true }), true);
  h.motions.forEach(motion => motion.finish());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.entry.hidden, true);
  assert.equal(h.content.hidden, false);
  assert.equal(h.content.inert, false);
  assert.equal(h.motions.length, 2);
});

test("closing without login preserves the entry and a fresh instance resets the mock", () => {
  const h = harness();
  h.gate.open();
  h.gate.close();
  h.click();
  assert.equal(h.reveals, 0);
  assert.equal(h.gate.open(), false);
  h.click(0);
  assert.equal(h.gate.ready, true);
  assert.equal(harness().gate.open(), false);
});

test("destroy removes the login listener", () => {
  const h = harness();
  h.gate.open();
  h.gate.destroy();
  h.click();
  assert.equal(h.reveals, 0);
});

test("login staggers only six options and cancels every layer on close", () => {
  const h = harness();
  const rows = Array.from({ length: 20 }, () => ({ style: { removeProperty() {} } }));
  h.content.querySelectorAll = () => rows;
  h.gate.open();
  h.click();
  h.finishWait();
  const rowMotions = h.motions.filter(motion => rows.includes(motion.element));
  assert.equal(rowMotions.length, 6);
  assert.deepEqual(rowMotions.map(motion => motion.timing.delay), [0, 0.03, 0.06, 0.09, 0.12, 0.15]);
  h.gate.close();
  assert.equal(h.motions.every(motion => motion.animation.cancelled), true);
});

test("closing while waiting cancels login and reopening starts cleanly", () => {
  const h = harness();
  h.gate.open();
  h.click();
  const staleCallback = [...h.waits.values()][0].callback;
  h.gate.close();
  assert.equal(h.waits.size, 0);
  assert.equal(h.gate.ready, false);
  assert.equal(h.label.textContent, "Log in");
  assert.equal(h.attributes.get("aria-busy"), "false");
  assert.equal(h.attributes.get("aria-disabled"), "false");
  h.gate.open();
  staleCallback();
  assert.equal(h.reveals, 0);
  assert.equal(h.content.hidden, true);
  h.click();
  h.finishWait();
  assert.equal(h.reveals, 1);
});

test("destroy while waiting cancels its timer", () => {
  const h = harness();
  h.gate.open();
  h.click();
  h.gate.destroy();
  assert.equal(h.waits.size, 0);
  assert.equal(h.motions.every(motion => motion.animation.cancelled), true);
  h.finishWait();
  assert.equal(h.reveals, 0);
});

function logoLayer() {
  const values = new Map();
  return {
    style: {
      setProperty: (name, value) => values.set(name, String(value)),
      getPropertyValue: name => values.get(name) || "",
      removeProperty: name => values.delete(name),
    },
  };
}

function logoHarness(options = {}) {
  const baseInk = logoLayer();
  const revealInk = logoLayer();
  return { ...harness({ baseInk, revealInk, ...options }), baseInk, revealInk };
}

function assertLogoStylesCleared(h) {
  for (const layer of [h.baseInk, h.revealInk]) {
    assert.equal(layer.style.getPropertyValue("opacity"), "");
    assert.equal(layer.style.getPropertyValue("clip-path"), "");
  }
}

test("default keyboard opening starts only the two logo loops without entrance motion or waiting", () => {
  const h = logoHarness();
  assert.equal(h.gate.open(), false);
  assert.equal(h.motions.length, 2);
  assert.ok(h.motions.every(motion => motion.timing.repeat === Infinity));
  assert.equal(h.motions.filter(motion => motion.element === h.baseInk).length, 1);
  assert.equal(h.motions.filter(motion => motion.element === h.revealInk).length, 1);
  assert.equal(h.waits.size, 0);
  assert.equal(h.label.textContent, "Log in");
  assert.equal(h.entry.hidden, false);
  assert.equal(h.content.hidden, true);
  h.gate.destroy();
});

test("pointer entrance finishes without stopping the logo loops", async () => {
  const h = logoHarness();
  h.gate.open({ animateEntrance: true });
  assert.equal(h.motions.length, 3);
  const entrance = h.motions.find(motion => motion.element === h.entry);
  assert.deepEqual(entrance.keyframes, { opacity: [0, 1] });
  const loops = h.motions.filter(motion => motion.timing.repeat === Infinity);
  assert.equal(loops.length, 2);
  entrance.finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(loops.every(motion => !motion.animation.cancelled));
  assert.equal(h.entry.hidden, false);
  h.gate.destroy();
});

test("the original PNG reveals left to right and rests with the complete base visible", () => {
  const h = logoHarness();
  h.gate.open();
  const base = h.motions.find(motion => motion.element === h.baseInk);
  const reveal = h.motions.find(motion => motion.element === h.revealInk);
  assert.deepEqual(base.keyframes, { opacity: [1, 0.24, 0.24, 0.24, 1, 1, 1] });
  assert.deepEqual(reveal.keyframes, {
    opacity: [0, 0, 1, 1, 0, 0, 0],
    clipPath: [
      "inset(0 100% 0 0)", "inset(0 100% 0 0)", "inset(0 100% 0 0)",
      "inset(0 0% 0 0)", "inset(0 0% 0 0)", "inset(0 0% 0 0)", "inset(0 0% 0 0)",
    ],
  });
  for (const motion of [base, reveal]) {
    assert.equal(motion.timing.duration, 7);
    assert.equal(motion.timing.repeat, Infinity);
    assert.deepEqual(motion.timing.times, [0, 0.04, 0.08, 0.36, 0.46, 0.9, 1]);
    assert.equal(motion.timing.ease.length, 6, "ease each interval without warping the full seven-second timeline");
    assert.ok(motion.timing.ease.every(easing => Array.isArray(easing) && easing.length === 4));
    assert.deepEqual(motion.timing.ease[2], [0.77, 0, 0.175, 1], "the reveal interval has its own easing curve");
    assert.equal(motion.timing.delay || 0, 0);
  }
  assert.ok(base.timing.duration * (1 - base.timing.times[4]) >= 3);
  h.gate.destroy();
});

test("missing either logo layer keeps the available artwork static and login usable", () => {
  for (const layers of [{}, { baseInk: logoLayer() }, { revealInk: logoLayer() }]) {
    const h = harness(layers);
    h.gate.open();
    assert.equal(h.motions.length, 0);
    h.gate.close();
    h.gate.open({ animateEntrance: true });
    assert.equal(h.motions.length, 1);
    assert.equal(h.motions[0].element, h.entry);
    h.click(0);
    assert.equal(h.gate.ready, true);
    assert.equal(h.waits.size, 0);
    assert.equal(h.content.hidden, false);
    h.gate.destroy();
  }
});

for (const exit of ["close", "keyboard login", "pointer login", "hidden tab", "destroy"]) {
  test(`${exit} cancels both logo loops and clears opacity and clipping`, () => {
    const motionDocument = new EventTarget();
    motionDocument.hidden = false;
    const h = logoHarness({ motionDocument });
    h.gate.open();
    const loops = h.motions.filter(motion => motion.timing.repeat === Infinity);
    assert.equal(loops.length, 2);
    for (const layer of [h.baseInk, h.revealInk]) {
      layer.style.setProperty("opacity", 0.5);
      layer.style.setProperty("clip-path", "inset(0 50% 0 0)");
    }
    if (exit === "keyboard login") h.click(0);
    else if (exit === "pointer login") {
      h.click();
      assert.ok(loops.every(motion => !motion.animation.cancelled));
      h.finishWait();
    } else if (exit === "hidden tab") {
      motionDocument.hidden = true;
      motionDocument.dispatchEvent(new Event("visibilitychange"));
    } else h.gate[exit]();
    assert.ok(loops.every(motion => motion.animation.cancelled));
    assertLogoStylesCleared(h);
    h.gate.destroy();
  });
}

test("reduced motion keeps both logo layers static for pointer and keyboard entry", () => {
  for (const animateEntrance of [false, true]) {
    const h = logoHarness({ reducedMotion: true });
    h.gate.open({ animateEntrance });
    assert.equal(h.motions.length, 0);
    assertLogoStylesCleared(h);
    h.click(animateEntrance ? 1 : 0);
    assert.equal(h.waits.size, 0);
    assert.equal(h.gate.ready, true);
    assert.equal(h.attributes.has("data-opening"), false);
    h.gate.destroy();
  }
});

test("logo loops continue through mock loading without restarting, then stop on reveal", () => {
  const h = logoHarness();
  h.gate.open();
  const loops = h.motions.filter(motion => motion.timing.repeat === Infinity);
  assert.equal(loops.length, 2);
  h.click();
  assert.ok(loops.every(motion => !motion.animation.cancelled));
  assert.equal(h.motions.length, 2);
  assert.equal(h.waits.size, 1);
  h.finishWait();
  assert.ok(loops.every(motion => motion.animation.cancelled));
  assert.equal(h.gate.ready, true);
  h.gate.close();
  assert.ok(h.motions.every(motion => motion.animation.cancelled));
  const count = h.motions.length;
  h.gate.open();
  assert.equal(h.motions.length, count, "an unlocked entry never restarts its decorative loops");
  h.gate.destroy();
});

test("visibility resumes both logo loops after keyboard opening and destroy removes the listener", () => {
  const motionDocument = new EventTarget();
  motionDocument.hidden = false;
  const h = logoHarness({ motionDocument });
  h.gate.open();
  assert.equal(h.motions.length, 2);
  motionDocument.hidden = true;
  motionDocument.dispatchEvent(new Event("visibilitychange"));
  assert.ok(h.motions.every(motion => motion.animation.cancelled));
  motionDocument.hidden = false;
  motionDocument.dispatchEvent(new Event("visibilitychange"));
  assert.equal(h.motions.length, 4);
  assert.ok(h.motions.slice(2).every(motion => !motion.animation.cancelled));
  h.gate.destroy();
  motionDocument.dispatchEvent(new Event("visibilitychange"));
  assert.equal(h.motions.length, 4);
  assert.ok(h.motions.every(motion => motion.animation.cancelled));
});

test("close and reopen restart both loops while keyboard login ends them instantly", () => {
  const h = logoHarness();
  h.gate.open();
  h.gate.close();
  assert.ok(h.motions.every(motion => motion.animation.cancelled));
  assert.equal(h.gate.open(), false);
  assert.equal(h.motions.length, 4);
  assert.ok(h.motions.slice(2).every(motion => !motion.animation.cancelled));
  h.click(0);
  assert.ok(h.motions.every(motion => motion.animation.cancelled));
  assert.equal(h.waits.size, 0);
  assert.equal(h.motions.length, 4, "keyboard login does not animate the panels");
  assert.equal(h.gate.ready, true);
  assert.equal(h.content.hidden, false);
  h.gate.destroy();
});

test("a live reduced-motion preference cancels both loops and prevents late restarts", () => {
  const preference = new EventTarget();
  preference.matches = false;
  const previousMatchMedia = Object.getOwnPropertyDescriptor(globalThis, "matchMedia");
  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true,
    value: () => preference,
  });
  let h;
  try {
    h = logoHarness();
  } finally {
    if (previousMatchMedia) Object.defineProperty(globalThis, "matchMedia", previousMatchMedia);
    else delete globalThis.matchMedia;
  }
  h.gate.open();
  assert.equal(h.motions.length, 2);
  h.baseInk.style.setProperty("opacity", 0.24);
  h.revealInk.style.setProperty("clip-path", "inset(0 50% 0 0)");
  preference.matches = true;
  preference.dispatchEvent(new Event("change"));
  assert.ok(h.motions.every(motion => motion.animation.cancelled));
  assertLogoStylesCleared(h);
  h.gate.close();
  h.gate.open({ animateEntrance: true });
  assert.equal(h.motions.length, 2);
  preference.matches = false;
  preference.dispatchEvent(new Event("change"));
  assert.equal(h.motions.length, 4);
  h.gate.destroy();
  preference.dispatchEvent(new Event("change"));
  assert.equal(h.motions.length, 4);
});
