import assert from "node:assert/strict";
import test from "node:test";
import { createDeskLogoMotion } from "../src/desk-logo.js";

class TrackedEvents extends EventTarget {
  listeners = new Map();
  addEventListener(type, listener, options) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
    super.addEventListener(type, listener, options);
  }
  removeEventListener(type, listener, options) {
    this.listeners.get(type)?.delete(listener);
    super.removeEventListener(type, listener, options);
  }
  listenerCount(type) { return this.listeners.get(type)?.size ?? 0; }
}

function environment({ hidden = false, reduced = false } = {}) {
  const preference = Object.assign(new TrackedEvents(), { matches: reduced });
  const document = Object.assign(new TrackedEvents(), {
    hidden,
    defaultView: {
      matchMedia(query) {
        assert.equal(this, document.defaultView, "matchMedia retains its owning window");
        assert.equal(query, "(prefers-reduced-motion: reduce)");
        return preference;
      },
    },
  });
  return {
    document, preference,
    setHidden(value) { document.hidden = value; document.dispatchEvent(new Event("visibilitychange")); },
    setReduced(value) { preference.matches = value; preference.dispatchEvent(new Event("change")); },
  };
}

function harness(t, { env = environment(), missing = [], reducedMotion = false, noRoot = false } = {}) {
  const layer = () => ({ style: {
    values: new Map(),
    setProperty(name, value) { this.values.set(name, value); },
    removeProperty(name) { this.values.delete(name); },
  } });
  const base = layer();
  const reveal = layer();
  const root = noRoot ? null : {
    ownerDocument: env.document,
    querySelector(selector) {
      if (selector === "[data-desk-logo-base]" && !missing.includes("base")) return base;
      if (selector === "[data-desk-logo-reveal]" && !missing.includes("reveal")) return reveal;
      return null;
    },
  };
  const motions = [];
  const logo = createDeskLogoMotion({
    root, reducedMotion, ...(noRoot ? { motionDocument: env.document } : {}),
    animate(target, keyframes, timing) {
      const animation = { cancellations: 0, cancel() { this.cancellations++; } };
      motions.push({ target, keyframes, timing, animation });
      return animation;
    },
  });
  t.after(() => logo.destroy());
  return { logo, motions, base, reveal, ...env };
}

test("start is idempotent and preserves the two original seven-second PNG ink loops", t => {
  const h = harness(t);
  assert.equal(h.motions.length, 0);
  h.logo.start();
  h.logo.start();
  assert.equal(h.motions.length, 2);
  assert.equal(h.motions[0].target, h.base);
  assert.equal(h.motions[1].target, h.reveal);
  assert.deepEqual(h.motions[0].keyframes, { opacity: [1, 0.24, 0.24, 0.24, 1, 1, 1] });
  const closed = "inset(0 100% 0 0)";
  const revealed = "inset(0 0% 0 0)";
  assert.deepEqual(h.motions[1].keyframes, {
    opacity: [0, 0, 1, 1, 0, 0, 0],
    clipPath: [closed, closed, closed, revealed, revealed, revealed, revealed],
  });
  const settle = [0.32, 0.72, 0, 1];
  for (const motion of h.motions) {
    assert.deepEqual(motion.timing, {
      duration: 7, repeat: Infinity, times: [0, 0.04, 0.08, 0.36, 0.46, 0.9, 1],
      ease: [settle, settle, [0.77, 0, 0.175, 1], settle, settle, settle],
    });
    assert.equal(motion.animation.cancellations, 0);
  }
});

test("a requested hidden logo waits, pauses, and resumes without restarting an active loop", t => {
  const h = harness(t, { env: environment({ hidden: true }) });
  h.logo.start();
  assert.equal(h.motions.length, 0);
  h.setHidden(false);
  assert.equal(h.motions.length, 2);
  h.setHidden(false);
  assert.equal(h.motions.length, 2);
  h.setHidden(true);
  assert.ok(h.motions.every(motion => motion.animation.cancellations === 1));
  h.setHidden(false);
  assert.equal(h.motions.length, 4);
  assert.ok(h.motions.slice(2).every(motion => motion.animation.cancellations === 0));
});

test("live reduced motion pauses both loops and resumes only when visible and allowed", t => {
  const h = harness(t, { env: environment({ reduced: true }) });
  h.logo.start();
  assert.equal(h.motions.length, 0);
  h.setReduced(false);
  assert.equal(h.motions.length, 2);
  h.setReduced(true);
  assert.ok(h.motions.every(motion => motion.animation.cancellations === 1));
  h.setHidden(true);
  h.setReduced(false);
  assert.equal(h.motions.length, 2);
  h.setHidden(false);
  assert.equal(h.motions.length, 4);
  h.setReduced(false);
  assert.equal(h.motions.length, 4);
});

test("explicit reduced motion prevents animation regardless of environment changes", t => {
  const h = harness(t, { reducedMotion: true });
  h.logo.start();
  h.setReduced(true);
  h.setReduced(false);
  h.setHidden(true);
  h.setHidden(false);
  h.logo.start();
  assert.equal(h.motions.length, 0);
});

test("stop cancels, clears only owned ink styles, and disables automatic resume", t => {
  const h = harness(t);
  h.logo.start();
  for (const target of [h.base, h.reveal]) {
    target.style.setProperty("opacity", "0.24");
    target.style.setProperty("clip-path", "inset(0 50% 0 0)");
    target.style.setProperty("transform", "scale(1)");
  }
  h.logo.stop();
  h.logo.stop();
  for (const target of [h.base, h.reveal]) {
    assert.equal(target.style.values.has("opacity"), false);
    assert.equal(target.style.values.has("clip-path"), false);
    assert.equal(target.style.values.get("transform"), "scale(1)");
  }
  assert.ok(h.motions.every(motion => motion.animation.cancellations === 1));
  h.setHidden(true);
  h.setHidden(false);
  h.setReduced(true);
  h.setReduced(false);
  assert.equal(h.motions.length, 2);
  h.logo.start();
  assert.equal(h.motions.length, 4);
});

test("stopping a pending hidden start prevents later visibility from starting it", t => {
  const h = harness(t, { env: environment({ hidden: true }) });
  h.logo.start();
  h.logo.stop();
  h.setHidden(false);
  assert.equal(h.motions.length, 0);
  h.logo.start();
  assert.equal(h.motions.length, 2);
});

test("destroy permanently stops motion and removes both environment listeners", t => {
  const h = harness(t);
  h.logo.start();
  assert.equal(h.document.listenerCount("visibilitychange"), 1);
  assert.equal(h.preference.listenerCount("change"), 1);
  h.logo.destroy();
  h.logo.destroy();
  assert.equal(h.document.listenerCount("visibilitychange"), 0);
  assert.equal(h.preference.listenerCount("change"), 0);
  assert.ok(h.motions.every(motion => motion.animation.cancellations === 1));
  h.setHidden(true);
  h.setHidden(false);
  h.setReduced(true);
  h.setReduced(false);
  h.logo.start();
  assert.equal(h.motions.length, 2);
});

test("missing roots or either ink layer remain safe across the full lifecycle", t => {
  for (const options of [{ noRoot: true }, { missing: ["base"] }, { missing: ["reveal"] }, { missing: ["base", "reveal"] }]) {
    const h = harness(t, options);
    h.logo.start();
    h.setHidden(true);
    h.setHidden(false);
    h.setReduced(true);
    h.setReduced(false);
    h.logo.stop();
    h.logo.destroy();
    h.logo.start();
    assert.equal(h.motions.length, 0);
  }
});

test("separate logo instances share preferences but retain independent lifecycle and layers", t => {
  const env = environment();
  const first = harness(t, { env });
  const second = harness(t, { env });
  first.logo.start();
  second.logo.start();
  assert.notEqual(first.base, second.base);
  assert.equal(env.document.listenerCount("visibilitychange"), 2);
  first.logo.stop();
  assert.ok(first.motions.every(motion => motion.animation.cancellations === 1));
  assert.ok(second.motions.every(motion => motion.animation.cancellations === 0));
  env.setHidden(true);
  env.setHidden(false);
  assert.equal(first.motions.length, 2);
  assert.equal(second.motions.length, 4);
  first.logo.start();
  second.logo.destroy();
  assert.equal(env.document.listenerCount("visibilitychange"), 1);
  assert.equal(env.preference.listenerCount("change"), 1);
  assert.ok(first.motions.slice(2).every(motion => motion.animation.cancellations === 0));
  assert.ok(second.motions.every(motion => motion.animation.cancellations === 1));
});

test("global matchMedia is a fallback when the owning document has no window", t => {
  const env = environment({ reduced: true });
  delete env.document.defaultView;
  const original = Object.getOwnPropertyDescriptor(globalThis, "matchMedia");
  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true, value: () => env.preference,
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "matchMedia", original);
    else delete globalThis.matchMedia;
  });
  const h = harness(t, { env });
  h.logo.start();
  assert.equal(h.motions.length, 0);
  env.setReduced(false);
  assert.equal(h.motions.length, 2);
});
