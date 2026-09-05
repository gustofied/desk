import assert from "node:assert/strict";
import test from "node:test";
import { createHeldKeyNavigation, nextGalleryIndex } from "../src/view-key-navigation.js";

function clock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  return {
    schedule(callback, delay) {
      const id = ++nextId;
      timers.set(id, { callback, due: now + delay });
      return id;
    },
    cancel(id) { timers.delete(id); },
    advance(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers].sort((a, b) => a[1].due - b[1].due)[0];
        if (!next || next[1].due > end) break;
        now = next[1].due;
        timers.delete(next[0]);
        next[1].callback();
      }
      now = end;
    },
    get pending() { return timers.size; },
  };
}

test("a tap steps immediately; a hold repeats at a steady cadence without native repeats", () => {
  const time = clock();
  const steps = [];
  const keys = createHeldKeyNavigation({ ...time, step: (key, options) => steps.push([key, options.repeat]) });
  keys.start("d");
  assert.deepEqual(steps, [["d", false]]);
  time.advance(319);
  assert.equal(steps.length, 1);
  time.advance(1);
  assert.deepEqual(steps[1], ["d", true]);
  time.advance(280);
  assert.equal(steps.length, 4);
  keys.release("d");
  time.advance(2000);
  assert.equal(steps.length, 4);
  assert.equal(time.pending, 0);
});

test("duplicate keydowns do not double-step or reset the hold delay", () => {
  const time = clock();
  let count = 0;
  const keys = createHeldKeyNavigation({ ...time, step: () => { count++; } });
  keys.start("a");
  time.advance(200);
  keys.start("a");
  time.advance(120);
  assert.equal(count, 2);
  keys.stop();
});

test("switching direction cancels the previous timer", () => {
  const time = clock();
  const steps = [];
  const keys = createHeldKeyNavigation({ ...time, step: (key) => steps.push(key) });
  keys.start("d");
  time.advance(200);
  keys.start("a");
  keys.release("d");
  time.advance(320);
  assert.deepEqual(steps, ["d", "a", "a"]);
  keys.stop();
  time.advance(2000);
  assert.equal(steps.length, 3);
});

test("a blocked surface or boundary stops a held key with no queued movement", () => {
  const time = clock();
  let allowed = true;
  let count = 0;
  const keys = createHeldKeyNavigation({ ...time, step: () => {
    if (!allowed) return false;
    count++;
  } });
  keys.start("s");
  allowed = false;
  time.advance(2000);
  assert.equal(count, 1);
  assert.equal(keys.key, null);
  assert.equal(time.pending, 0);
});

const grid = Array.from({ length: 9 }, (_, i) => ({
  left: (i % 4) * 112,
  top: Math.floor(i / 4) * 72,
  width: 100,
  height: 60,
}));

test("A/D traverse display order, wrapping only on fresh taps", () => {
  assert.equal(nextGalleryIndex(grid, 3, "d"), 4);
  assert.equal(nextGalleryIndex(grid, 4, "a"), 3);
  assert.equal(nextGalleryIndex(grid, 8, "d"), 0);
  assert.equal(nextGalleryIndex(grid, 0, "a"), 8);
  assert.equal(nextGalleryIndex(grid, 8, "d", { repeat: true }), 8);
  assert.equal(nextGalleryIndex(grid, 0, "a", { repeat: true }), 0);
});

test("W/S follow real rows and keep the intended column across a short last row", () => {
  assert.equal(nextGalleryIndex(grid, 1, "s"), 5);
  assert.equal(nextGalleryIndex(grid, 5, "w"), 1);
  assert.equal(nextGalleryIndex(grid, 5, "s"), 8);
  assert.equal(nextGalleryIndex(grid, 8, "w", { columnX: 162 }), 5);
  assert.equal(nextGalleryIndex(grid, 1, "w"), 1);
  assert.equal(nextGalleryIndex(grid, 8, "s"), 8);
});

test("single-column, empty and single-card galleries are safe", () => {
  const column = grid.slice(0, 3).map((rect, i) => ({ ...rect, left: 0, top: i * 72 }));
  assert.equal(nextGalleryIndex(column, 1, "s"), 2);
  assert.equal(nextGalleryIndex(column, 1, "w"), 0);
  assert.equal(nextGalleryIndex([], -1, "d"), -1);
  assert.equal(nextGalleryIndex(grid.slice(0, 1), 0, "s"), 0);
  assert.equal(nextGalleryIndex(grid, -1, "d"), 0);
  assert.equal(nextGalleryIndex(grid, -1, "w"), 8);
  assert.equal(nextGalleryIndex(grid, 0, "ArrowRight"), -1);
});
