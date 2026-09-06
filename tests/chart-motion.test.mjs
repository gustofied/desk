import assert from "node:assert/strict";
import test from "node:test";
import { animateChartDraw, animateChartSupport, cancelChartMotion } from "../src/chart-motion.js";

function nodeFixture(attributes = {}, opacity = "1") {
  const attrs = new Map(Object.entries(attributes));
  const animations = [];
  const node = {
    getAttribute: (name) => attrs.get(name) ?? null,
    setAttribute: (name, value) => attrs.set(name, value),
    removeAttribute: (name) => attrs.delete(name),
    ownerDocument: { defaultView: { getComputedStyle: () => ({ opacity }) } },
    animate(frames, options) {
      const animation = new EventTarget();
      Object.assign(animation, { frames, options, id: options.id });
      animation.cancel = () => { animation.cancelled = true; animation.dispatchEvent(new Event("cancel")); };
      animations.push(animation);
      return animation;
    },
    getAnimations: () => animations,
  };
  return node;
}

test("chart draws share timing without changing authored geometry", () => {
  const path = nodeFixture();
  const animation = animateChartDraw(path);
  assert.equal(animation.id, "desk-chart-draw");
  assert.equal(animation.options.duration, 680);
  assert.equal(animation.options.fill, "backwards");
  assert.equal(path.getAttribute("pathLength"), null);
  assert.match(animation.frames[0].clipPath, /100%/);
  assert.match(animation.frames.at(-1).clipPath, /fill-box/);
  animation.dispatchEvent(new Event("finish"));
  assert.equal(path.getAttribute("pathLength"), null);
});

test("cancelling a chart leaves its authored normalized length untouched", () => {
  const path = nodeFixture({ pathLength: "1", "stroke-dasharray": "1" });
  animateChartDraw(path);
  cancelChartMotion(path);
  assert.equal(path.getAttribute("pathLength"), "1");
  assert.equal(path.getAttribute("stroke-dasharray"), "1");
  assert.equal(path.getAnimations()[0].cancelled, true);
});

test("Quote asks can build from the right toward the bid", () => {
  const animation = animateChartDraw(nodeFixture(), { from: "right" });
  assert.equal(animation.frames[0].clipPath, "inset(-12px -12px -12px calc(100% + 12px)) fill-box");
  assert.equal(animation.options.from, undefined);
});

test("fills fade to their authored opacity without a persistent override", () => {
  const area = nodeFixture({}, "0.32");
  const animation = animateChartSupport(area);
  assert.equal(animation.id, "desk-chart-support");
  assert.equal(animation.options.duration, 420);
  assert.equal(animation.options.fill, "backwards");
  assert.equal(animation.frames.at(-1).opacity, "0.32");
});

test("chart cancellation does not cancel hover or page motion", () => {
  const path = nodeFixture();
  const draw = animateChartDraw(path);
  const hover = path.animate([], { id: "hover" });
  cancelChartMotion(path);
  assert.equal(draw.cancelled, true);
  assert.equal(hover.cancelled, undefined);
});

test("static renderers without animation APIs remain usable", () => {
  assert.equal(animateChartDraw(null), null);
  assert.equal(animateChartDraw({}), null);
  assert.equal(animateChartSupport({}), null);
  assert.doesNotThrow(() => cancelChartMotion({}));
});
