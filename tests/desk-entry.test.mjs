import assert from "node:assert/strict";
import test from "node:test";
import { createDeskEntry } from "../src/desk-entry.js";

function harness({ ink = [], ...options } = {}) {
  const panel = () => ({ hidden: false, inert: false, style: { removeProperty() {} } });
  const entry = panel();
  const content = panel();
  const button = new EventTarget();
  button.style = panel().style;
  const attributes = new Map();
  button.setAttribute = (name, value) => attributes.set(name, value);
  button.toggleAttribute = (name, value) => value ? attributes.set(name, "") : attributes.delete(name);
  const label = { textContent: "Log in" };
  button.querySelector = () => label;
  button.querySelectorAll = () => ink;
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

test("entry motion changes only opacity, keeping the supplied artwork stationary", () => {
  const ink = Array.from({ length: 3 }, () => ({ style: { removeProperty() {} } }));
  const h = harness({ ink });
  h.gate.open({ animateEntrance: true });
  assert.equal(h.motions.length, 4);
  assert.ok(h.motions.every(motion => Object.keys(motion.keyframes).join() === "opacity"));
  assert.ok(h.motions.every(motion => motion.timing.type !== "spring"));
  const loops = h.motions.filter(motion => motion.timing.repeat === Infinity);
  assert.deepEqual(loops.map(motion => motion.element), ink);
  assert.deepEqual(loops.map(motion => motion.timing.delay), [0, 0.4, 0.8]);
  h.gate.close();
});

test("reduced motion and keyboard activation keep the supplied mark intact", () => {
  const ink = Array.from({ length: 3 }, () => ({ style: { removeProperty() {} } }));
  for (const reducedMotion of [false, true]) {
    const h = harness({ ink, reducedMotion });
    h.gate.open();
    h.click(reducedMotion ? 1 : 0);
    assert.equal(h.motions.length, 0);
    assert.equal(h.waits.size, 0);
    assert.equal(h.gate.ready, true);
    assert.equal(h.attributes.has("data-opening"), false);
  }
});

test("ink passes continue through loading without restarting, then stop on reveal", () => {
  const ink = Array.from({ length: 3 }, () => ({ style: { removeProperty() {} } }));
  const h = harness({ ink });
  h.gate.open({ animateEntrance: true });
  const loops = h.motions.filter(motion => motion.timing.repeat === Infinity);
  assert.equal(loops.length, 3);
  assert.deepEqual(loops.map(motion => motion.element), ink);
  h.click();
  assert.ok(loops.every(motion => !motion.animation.cancelled));
  assert.equal(h.motions.filter(motion => ink.includes(motion.element)).length, 3);
  h.finishWait();
  assert.ok(loops.every(motion => motion.animation.cancelled));
  h.gate.close();
  assert.ok(h.motions.every(motion => motion.animation.cancelled));
});

test("hidden tabs stop idle motion and destroy removes the visibility listener", () => {
  const motionDocument = new EventTarget();
  motionDocument.hidden = false;
  const ink = Array.from({ length: 3 }, () => ({ style: { removeProperty() {} } }));
  const h = harness({ ink, motionDocument });
  h.gate.open({ animateEntrance: true });
  const loops = h.motions.filter(motion => motion.timing.repeat === Infinity);
  motionDocument.hidden = true;
  motionDocument.dispatchEvent(new Event("visibilitychange"));
  assert.ok(loops.every(motion => motion.animation.cancelled));
  motionDocument.hidden = false;
  motionDocument.dispatchEvent(new Event("visibilitychange"));
  assert.equal(h.motions.filter(motion => motion.timing.repeat === Infinity).length, 6);
  h.gate.destroy();
  const count = h.motions.length;
  motionDocument.dispatchEvent(new Event("visibilitychange"));
  assert.equal(h.motions.length, count);
  assert.ok(h.motions.every(motion => motion.animation.cancelled));
});

test("keyboard login cancels idle ink immediately without a waiting state", () => {
  const ink = Array.from({ length: 3 }, () => ({ style: { removeProperty() {} } }));
  const h = harness({ ink });
  h.gate.open({ animateEntrance: true });
  h.click(0);
  assert.ok(h.motions.every(motion => motion.animation.cancelled));
  assert.equal(h.waits.size, 0);
  assert.equal(h.gate.ready, true);
  h.gate.close();
});
