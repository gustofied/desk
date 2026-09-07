import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { paintSandboxCostChart, renderSandboxCostSvg } from "../src/sandbox-cost-presentation.js";
import { createSandboxCostModel } from "../src/sandbox-cost-model.js";
import { getCardDefinition } from "../src/card-registry.js";

const colors = { paper: "#181818", line: "#ffffff", secondary: "#aaaaaa", area: "#ffffff" };
const day = 86400000;
const start = Date.parse("2026-08-01T00:00:00Z");
const names = ["Novita", "Daytona VM", "Blaxel", "E2B", "Modal VM", "Modal gVisor"];
function fixture(range = "now") {
  const providers = names.map((label, index) => {
    const value = (index + 1) * 0.001;
    return { id: `p${index}`, label, minimum: value / 2, p25: value * 0.8,
      median: value, p75: value * 1.2, maximum: value * 1.5,
      runtime: { median: 123.4 },
      history: [1, 2, 1.5].map((multiplier, n) => ({ time: start + n * day,
        value: value * multiplier, methodologyId: "method-a" })) };
  });
  return { range, asOf: start + 2 * day + 3600000, start, end: start + 2 * day,
    providers, primary: providers[0], latest: providers[0], rows: [0, 1, 2].map(n => ({ time: start + n * day })),
    sourceLabel: "Sandbox snapshot", sourceUrl: "https://example.invalid/benchmark" };
}
const render = (model, options = {}) => renderSandboxCostSvg(model, { colors, ...options });
const count = (markup, selector) => (markup.match(new RegExp(`${selector}=`, "g")) || []).length;
const rowValue = (markup, id) => markup.match(new RegExp(`<g data-sandbox-provider="${id}"[\\s\\S]*?data-sandbox-latest-value="[^"]*"[^>]*>([^<]*)<\\/text>`))?.[1];
const tags = (markup, marker) => [...markup.matchAll(new RegExp(`<[^>]+\\s${marker}="[^"]*"[^>]*>`, "g"))].map(match => match[0]);
const attribute = (tag, name) => tag.match(new RegExp(`(?:\\s|^)${name}="([^"]*)"`))?.[1];
const noSummary = markup => assert.doesNotMatch(markup, /data-sandbox-summary(?:-|=)/, "The top price strip is removed from every layout");
const observationCount = markup => tags(markup, "data-sandbox-history-segment")
  .reduce((sum, tag) => sum + Number(attribute(tag, "data-sandbox-history-observations")), 0);
const responsiveWidths = [286, 356, 480, 481, 582, 658, 956];
const renderedPixels = (tag, name, width) => Number(attribute(tag, name)) * width / 1200;
const near = (actual, expected, description, tolerance = 0.015) =>
  assert(Math.abs(actual - expected) <= tolerance, `${description}: expected ${expected}, got ${actual}`);
const pathPoints = tag => [...attribute(tag, "d").matchAll(/(-?[\d.]+),(-?[\d.]+)/g)]
  .map(point => [Number(point[1]), Number(point[2])]);
function assertReadableLabels(markup, width, expectedPixels) {
  for (const marker of ["data-sandbox-label", "data-sandbox-latest-value"]) {
    const labels = tags(markup, marker);
    assert.equal(labels.length, 6);
    for (const tag of labels) near(renderedPixels(tag, "font-size", width), expectedPixels,
      `${marker} at ${width}px stays readable in rendered pixels`);
  }
}

test("Latest renders six shared-axis distributions and exact cent medians", () => {
  const markup = render(fixture());
  assert.equal(count(markup, "data-sandbox-provider"), 6);
  noSummary(markup);
  assert.equal(count(markup, "data-sandbox-latest-value"), 6);
  for (const marker of ["whisker", "iqr", "median"]) assert.equal(count(markup, `data-sandbox-${marker}`), 6);
  for (const marker of ["whisker", "iqr"]) {
    for (const tag of tags(markup, `data-sandbox-${marker}`)) {
      assert.match(tag, /^<line\b/, "Original distribution marks are lines, not filled boxes or end-capped paths");
      assert.equal(attribute(tag, "stroke-linecap"), "round");
      assert.equal(Number(attribute(tag, "stroke-width")), marker === "iqr" ? 6 : 1.25);
    }
  }
  assert.equal(rowValue(markup, "p0"), "0.10¢");
  assert.match(markup, /Cost estimate in cents per job/);
  assert.doesNotMatch(markup, /data-sandbox-context|data-sandbox-as-of/);
  assert.match(markup, /viewBox="0 0 1200 600"/);
  assert.doesNotMatch(markup, /NaN|Infinity|data-sandbox-history-segment|<foreignObject/);
  const medians = [...markup.matchAll(/data-sandbox-median="" x1="([\d.]+)"/g)].map(match => Number(match[1]));
  const deltas = medians.slice(1).map((value, index) => value - medians[index]);
  assert(deltas.every(value => Math.abs(value - deltas[0]) < 0.02), "Equal costs use one shared linear x scale");
});

test("History rows show latest batch medians, not the Latest replicate medians", () => {
  for (const range of ["7d", "all"]) {
    const markup = render(fixture(range));
    noSummary(markup);
    assert.equal(rowValue(markup, "p0"), "0.15¢");
    assert.equal(count(markup, "data-sandbox-latest-value"), 6);
    assert.equal(count(markup, "data-sandbox-history-segment"), 6);
    assert.equal(count(markup, "data-sandbox-history-area"), 6);
    assert.equal(count(markup, "data-sandbox-iqr"), 0);
    assert.match(markup, /each provider has its own vertical scale/);
    for (const tag of tags(markup, "data-sandbox-history-area")) {
      assert.equal(attribute(tag, "aria-hidden"), "true", "Trailing shading is decorative, not a confidence band");
      assert.match(attribute(tag, "d"), /C/, "The original trailing area follows the monotone history line");
    }
  }
});

test("Primary selection gently emphasizes one provider without hiding comparisons", () => {
  const model = fixture("all");
  model.primary = model.providers[3];
  const markup = render(model);
  assert.equal(count(markup, "data-sandbox-provider"), 6);
  const rows = tags(markup, "data-sandbox-provider");
  assert.equal(attribute(rows.find(tag => attribute(tag, "data-sandbox-provider") === "p3"), "data-sandbox-primary"), "true");
  assert(rows.every(tag => !attribute(tag, "opacity") || attribute(tag, "opacity") === "1"), "Provider rows are not persistently dimmed");
  const lines = tags(markup, "data-sandbox-history");
  const width = id => Number(attribute(lines.find(tag => attribute(tag, "data-sandbox-history") === id), "stroke-width"));
  assert(width("p3") > width("p0"), "Highlight uses restrained stroke emphasis");
});

test("History lanes sort by final finite batch cost and preserve the right-hand value", () => {
  const model = fixture("all");
  model.providers[0].history.at(-1).value = 0.02;
  model.providers[0].history.push({ time: start + 3 * day, value: null });
  model.end = start + 3 * day;
  const markup = render(model);
  assert.deepEqual(tags(markup, "data-sandbox-provider").map(tag => attribute(tag, "data-sandbox-provider")), ["p1", "p2", "p3", "p4", "p5", "p0"]);
  assert.equal(rowValue(markup, "p0"), "2.00¢");
});

test("History shares time coordinates while scaling each provider lane independently", () => {
  const markup = render(fixture("all"));
  const paths = tags(markup, "data-sandbox-history-segment").map(tag =>
    [...attribute(tag, "d").matchAll(/([\d.]+),([\d.]+)/g)].map(point => [Number(point[1]), Number(point[2])]));
  assert.equal(paths.length, 6);
  for (const path of paths) {
    assert.deepEqual(path.map(point => point[0]), paths[0].map(point => point[0]));
    const span = points => Math.max(...points.map(point => point[1])) - Math.min(...points.map(point => point[1]));
    assert(Math.abs(span(path) - span(paths[0])) < 0.01);
  }
});

test("History connects recorded points without dotted guides, preserving explicit missing-value breaks", () => {
  const model = fixture("all");
  model.providers = [model.providers[0]];
  model.end = start + 8 * day;
  model.providers[0].history = [
    { time: start, value: 0.001, methodologyId: "a" },
    { time: start + day, value: null, methodologyId: "a" },
    { time: start + 2 * day, value: 0.002, methodologyId: "a" },
    { time: start + 4 * day, value: 0.003, methodologyId: "a", gapBefore: true },
    { time: start + 5 * day, value: 0.003, methodologyId: "b" },
    { time: start + 6 * day, value: 0.004, methodologyId: null },
    { time: start + 7 * day, value: 0.004, methodologyId: "b" },
    { time: start + 8 * day, value: 0.005, methodologyId: "b" },
  ];
  const markup = render(model);
  assert.equal(count(markup, "data-sandbox-history-segment"), 2);
  assert.equal(count(markup, "data-sandbox-history-guide"), 0);
  assert.equal(count(markup, "data-sandbox-observation"), 1, "Only an isolated observation needs a permanent dot");
  assert.equal(observationCount(markup), 7, "Monotone curves retain exactly the actual observations, with explicit nulls excluded");
  assert.doesNotMatch(markup, /stroke-dasharray|data-sandbox-context/);
  assert.doesNotMatch(markup, /NaN|Infinity/);
  assert.equal(rowValue(markup, "p0"), "0.50¢");
});

test("An empty history remains unavailable, never backfilled from the latest distribution", () => {
  const model = fixture("7d");
  model.providers[0].history = [];
  assert.equal(rowValue(render(model), "p0"), "Unavailable");
  assert.equal(count(render(model), "data-sandbox-history-segment"), 5);
});

test("Narrow layouts retain all six readable chart labels and prices without a summary strip", () => {
  for (const options of [{ compact: true, minimal: true }, { minimal: true }]) {
    for (const range of ["now", "all"]) {
      const markup = render(fixture(range), options);
      noSummary(markup);
      assert.equal(count(markup, "data-sandbox-provider"), 6);
      assert.equal(count(markup, "data-sandbox-latest-value"), 6);
      // Static exports use an explicit authored reference width in the absence
      // of a measured host: 320px compact/minimal, 390px standalone minimal.
      assertReadableLabels(markup, options.compact ? 320 : 390, 12);
      assert.match(markup, new RegExp(`viewBox="0 0 1200 ${options.compact ? 675 : 800}"`));
      assert.equal(Number(attribute(tags(markup, "data-sandbox-hit")[0], "y")), options.compact ? 128 : 0,
        "Only the artifact title reserves space above the plot");
    }
  }
});

test("Compact exports retain the Latest title and devote the remaining height to the plot", () => {
  const markup = render(fixture(), { compact: true });
  assert.match(markup, />LATEST<\/text>/);
  assert.doesNotMatch(markup, />NOW<\/text>/);
  noSummary(markup);
  assert.equal(count(markup, "data-sandbox-provider"), 6);
  assert.equal(Number(attribute(tags(markup, "data-sandbox-hit")[0], "y")), 128);
});

test("Zero and tiny positive costs are honest; invalid distributions are rejected", () => {
  const model = fixture();
  for (const field of ["minimum", "p25", "median", "p75", "maximum"]) model.providers[0][field] = 0;
  assert.equal(rowValue(render(model), "p0"), "0.00¢");
  for (const field of ["minimum", "p25", "median", "p75", "maximum"]) model.providers[0][field] = 0.000001;
  assert.equal(rowValue(render(model), "p0"), "&lt;0.01¢");
  model.providers[0].p25 = 99;
  assert.throws(() => render(model), /ordered finite/);
  assert.throws(() => render({ ...fixture(), asOf: NaN }), /Sandbox cost model/);
});

test("Text is escaped and decorative exports expose no chart role", () => {
  const model = fixture();
  model.providers[0].label = "A & <B>";
  const markup = render(model, { compact: true, decorative: true, title: 'Cost <script>"' });
  assert.match(markup, /aria-hidden="true"/);
  assert.doesNotMatch(markup, /role="img"|<script>/);
  assert.match(markup, /A &amp; &lt;B&gt;/);
});

function harness(width = 1200, height = 0) {
  const doc = { activeElement: null };
  const nodes = [];
  class Node extends EventTarget {
    constructor() { super(); this.attributes = new Map(); this.ownerDocument = doc; this.textContent = ""; nodes.push(this); }
    setAttribute(key, value) { this.attributes.set(key, String(value)); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    removeAttribute(key) { this.attributes.delete(key); }
    focus() { doc.activeElement = this; this.dispatchEvent(new Event("focus")); }
    remove() { this.removed = true; }
    animate(frames, options) { return { id: options.id, cancel() {} }; }
  }
  const svg = new Node();
  svg.clientWidth = width;
  svg.clientHeight = height;
  svg.sharedListeners = 0;
  const listen = svg.addEventListener.bind(svg);
  svg.addEventListener = (...args) => { svg.sharedListeners++; listen(...args); };
  svg.getAnimations = () => [];
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width, height });
  svg.parentElement = { untouched: true };
  Object.defineProperty(svg, "innerHTML", { set(value) {
    svg.markup = value;
    svg.targets = new Map();
    for (const key of ["chart", "readout", "readout-value", "readout-date", "active-marker", "tooltip", "tooltip-title", "tooltip-detail"]) svg.targets.set(`[data-sandbox-${key}]`, new Node());
    const markedNodes = marker => tags(value, marker).map(tag => {
      const node = new Node();
      node.setAttribute(marker, attribute(tag, marker));
      return node;
    });
    svg.hits = markedNodes("data-sandbox-hit");
    svg.history = markedNodes("data-sandbox-history");
  } });
  svg.querySelector = selector => svg.targets?.get(selector) ?? null;
  svg.querySelectorAll = selector => selector === "[data-sandbox-hit]" ? svg.hits : selector === "[data-sandbox-history]" ? svg.history : [];
  const key = (target, value) => { const event = new Event("keydown", { cancelable: true }); event.key = value; target.dispatchEvent(event); return event; };
  return { svg, doc, key };
}

test("Navigation belongs only to removable groups; repaint aborts old listeners and preserves selection", () => {
  const { svg, doc, key } = harness();
  paintSandboxCostChart(svg, fixture("all"), { colors, reducedMotion: true });
  const old = svg.querySelector("[data-sandbox-chart]");
  assert.equal(svg.getAttribute("tabindex"), null);
  assert.equal(svg.sharedListeners, 0);
  assert.equal(old.getAttribute("tabindex"), "0");
  old.focus();
  key(old, "Home");
  assert.equal(svg.querySelector("[data-sandbox-readout-value]").textContent, "0.10¢");
  assert.equal(svg.querySelector("[data-sandbox-tooltip-title]").textContent, "Novita");
  assert.equal(svg.querySelector("[data-sandbox-readout-date]").textContent, "01 AUG 2026");
  assert.doesNotMatch(old.getAttribute("aria-label"), /00:00/, "Date buckets are not described as midnight runs");
  key(old, "ArrowDown");
  key(old, "End");
  assert.equal(svg.querySelector("[data-sandbox-readout-value]").textContent, "0.30¢");
  assert.equal(svg.querySelector("[data-sandbox-tooltip-title]").textContent, "Daytona VM");
  paintSandboxCostChart(svg, fixture("all"), { colors, reducedMotion: true });
  const current = svg.querySelector("[data-sandbox-chart]");
  assert.equal(doc.activeElement, current);
  assert.equal(svg.querySelector("[data-sandbox-readout-value]").textContent, "0.30¢");
  assert.equal(key(old, "Home").defaultPrevented, false, "Replaced group listeners aborted");
  assert.equal(key(svg, "ArrowDown").defaultPrevented, false, "No shared SVG keyboard handler");
  assert.deepEqual(svg.parentElement, { untouched: true });
});

test("Anchored inspection shows original median and runtime detail, and clears hover dimming on leave", () => {
  const { svg } = harness();
  paintSandboxCostChart(svg, fixture(), { colors, reducedMotion: true });
  const latest = svg.querySelector("[data-sandbox-chart]");
  latest.focus();
  assert.equal(svg.querySelector("[data-sandbox-tooltip-title]").textContent, "Novita");
  assert.equal(svg.querySelector("[data-sandbox-readout-value]").textContent, "0.10¢ median");
  assert.equal(svg.querySelector("[data-sandbox-tooltip-detail]").textContent, "0.08¢ – 0.12¢\u2003123s");
  assert.match(svg.querySelector("[data-sandbox-tooltip]").getAttribute("transform"), /^translate\([\d.]+,[\d.]+\)$/);
  paintSandboxCostChart(svg, fixture("all"), { colors, reducedMotion: true });
  const history = svg.querySelector("[data-sandbox-chart]");
  assert.equal(svg.history[0].getAttribute("opacity"), "1");
  assert(svg.history.slice(1).every(node => Number(node.getAttribute("opacity")) < 1));
  history.dispatchEvent(new Event("pointerleave"));
  assert.equal(svg.querySelector("[data-sandbox-readout]").getAttribute("visibility"), "hidden");
  assert(svg.history.every(node => node.getAttribute("opacity") === "1"));
});

test("Touch release preserves the selected tooltip; mouse leave and blur still dismiss it", () => {
  for (const range of ["now", "all"]) {
    const { svg } = harness(362, 283);
    paintSandboxCostChart(svg, fixture(range), { colors, reducedMotion: true });
    const chart = svg.querySelector("[data-sandbox-chart]");
    const readout = svg.querySelector("[data-sandbox-readout]");
    const touch = new Event("pointerdown");
    Object.assign(touch, { pointerType: "touch", clientX: 200 });
    svg.hits[2].dispatchEvent(touch);
    assert.equal(readout.getAttribute("visibility"), "visible");
    assert.equal(svg.querySelector("[data-sandbox-tooltip-title]").textContent, "Blaxel");
    const leave = pointerType => chart.dispatchEvent(Object.assign(new Event("pointerleave"), { pointerType }));
    leave("touch");
    assert.equal(readout.getAttribute("visibility"), "visible", "Release must not dismiss a tapped observation");
    leave("mouse");
    assert.equal(readout.getAttribute("visibility"), "hidden");
    chart.focus();
    assert.equal(readout.getAttribute("visibility"), "visible");
    chart.dispatchEvent(new Event("blur"));
    assert.equal(readout.getAttribute("visibility"), "hidden");
  }
});

test("Measured mobile width keeps readable chart labels; decorative repaint removes interaction", () => {
  const { svg } = harness(390);
  paintSandboxCostChart(svg, fixture(), { colors, reducedMotion: true });
  noSummary(svg.markup);
  assertReadableLabels(svg.markup, 390, 12);
  assert.equal(svg.getAttribute("viewBox"), "0 0 1200 800");
  paintSandboxCostChart(svg, fixture(), { colors, decorative: true });
  assert.equal(svg.getAttribute("aria-hidden"), "true");
  assert.equal(svg.querySelector("[data-sandbox-chart]").getAttribute("tabindex"), null);
  assert(svg.hits.every(node => node.removed));
});

test("Compact labels retain twelve rendered pixels across all widths, including the 480px breakpoint", () => {
  for (const width of responsiveWidths) {
    for (const range of ["now", "all"]) {
      const { svg } = harness(width, 283);
      paintSandboxCostChart(svg, fixture(range), { colors, compact: true, reducedMotion: true });
      noSummary(svg.markup);
      assert.equal(count(svg.markup, "data-sandbox-provider"), 6);
      assertReadableLabels(svg.markup, width, 12);
      assert.equal(rowValue(svg.markup, "p0"), range === "now" ? "0.10¢" : "0.15¢");
      assert.equal(Number(attribute(tags(svg.markup, "data-sandbox-hit")[0], "y")), 128);
      assert.equal(svg.getAttribute("viewBox"), "0 0 1200 675", "Artifact geometry ignores the Monitor's measured height");
    }
  }
});

test("Measured Monitor labels use twelve mobile and fourteen desktop rendered pixels", () => {
  for (const width of responsiveWidths) {
    for (const range of ["now", "all"]) {
      const { svg } = harness(width, 283);
      paintSandboxCostChart(svg, fixture(range), { colors, reducedMotion: true });
      noSummary(svg.markup);
      assertReadableLabels(svg.markup, width, width < 640 ? 12 : 14);
      const height = Number(svg.getAttribute("viewBox").split(" ")[3]);
      near(height * width / 1200, 283, "Measured Monitor geometry fills its host height");
      assert.equal(attribute(tags(svg.markup, "data-sandbox-chart")[0], "data-sandbox-layout"), "full");
      near(Number(attribute(tags(svg.markup, "data-sandbox-canvas")[0], "height")), height,
        "The canvas matches the full viewBox height");
    }
  }
});

test("A 362 by 283 mobile Monitor fills the available height without letterboxing either view", () => {
  for (const range of ["now", "all"]) {
    const { svg } = harness(362, 283);
    paintSandboxCostChart(svg, fixture(range), { colors, reducedMotion: true });
    const height = Number(svg.getAttribute("viewBox").split(" ")[3]);
    near(height, 1200 * 283 / 362, "Mobile viewBox follows its measured aspect ratio");
    assert.equal(svg.getAttribute("preserveAspectRatio"), "xMidYMid meet");
    assertReadableLabels(svg.markup, 362, 12);
    const hits = tags(svg.markup, "data-sandbox-hit");
    assert.equal(Number(attribute(hits[0], "y")), 0);
    const last = hits.at(-1);
    const bottom = Number(attribute(last, "y")) + Number(attribute(last, "height"));
    if (range === "all") near(bottom, height, "History uses the entire mobile chart height");
    else near((height - bottom) * 362 / 1200, 36, "Latest reserves only its 12px axis plus 24px gutters");
  }
});

test("Latest distributions retain thin pixel-consistent IQR strokes and median ticks at every width", () => {
  for (const width of responsiveWidths) {
    for (const compact of [true, false]) {
      const { svg } = harness(width, 283);
      paintSandboxCostChart(svg, fixture(), { colors, compact, reducedMotion: true });
      const whiskers = tags(svg.markup, "data-sandbox-whisker");
      const bands = tags(svg.markup, "data-sandbox-iqr");
      const medians = tags(svg.markup, "data-sandbox-median");
      for (const [index, band] of bands.entries()) {
        assert.equal(Number(attribute(band, "stroke-width")), compact ? 4 : 6);
        assert.equal(attribute(band, "vector-effect"), "non-scaling-stroke");
        const median = medians[index];
        near((Number(attribute(median, "y2")) - Number(attribute(median, "y1"))) * width / 1200,
          compact ? 8 : 16, "Median tick length remains fixed in rendered pixels");
        assert.equal(attribute(median, "stroke-width"), "2");
        assert.equal(attribute(median, "vector-effect"), "non-scaling-stroke");
        const positions = [Number(attribute(whiskers[index], "x1")), Number(attribute(band, "x1")),
          Number(attribute(median, "x1")), Number(attribute(band, "x2")), Number(attribute(whiskers[index], "x2"))];
        assert(positions.every((position, i) => i === 0 || position >= positions[i - 1]),
          "The visual marks preserve min/P25/median/P75/max order");
      }
    }
  }
});

test("Small compact history keeps labels, shared sparkline bounds and values inline; larger histories are full bleed", () => {
  for (const width of responsiveWidths) {
    const { svg } = harness(width);
    paintSandboxCostChart(svg, fixture("all"), { colors, compact: true, reducedMotion: true });
    const inline = width < 480;
    assert.equal(attribute(tags(svg.markup, "data-sandbox-chart")[0], "data-sandbox-layout"), inline ? "inline" : "full");
    const paths = tags(svg.markup, "data-sandbox-history-segment").map(pathPoints);
    const labels = tags(svg.markup, "data-sandbox-label");
    const values = tags(svg.markup, "data-sandbox-latest-value");
    for (const [index, path] of paths.entries()) {
      assert.deepEqual(path.map(point => point[0]), paths[0].map(point => point[0]),
        "Every provider retains the same horizontal date mapping");
      const [first, last] = [path[0], path.at(-1)];
      if (inline) {
        assert(first[0] > 0 && last[0] < 1200, "Inline sparkline reserves room for both labels");
        near(Number(attribute(labels[index], "y")), Number(attribute(values[index], "y")), "Inline label and cost share a baseline");
        assert(Number(attribute(labels[index], "x")) < first[0], "Provider label ends before the sparkline");
        assert(Number(attribute(values[index], "x")) > last[0], "Cost occupies the right-hand gutter");
      } else {
        near(first[0], 0, "Larger history starts at the card edge");
        near(last[0], 1200, "Larger history ends at the card edge");
      }
    }
  }
});

test("Responsive history preserves explicit null breaks and never fills them with distribution medians", () => {
  const model = fixture("all");
  model.providers[0].history[1].value = null;
  for (const width of responsiveWidths) {
    const { svg } = harness(width, 283);
    paintSandboxCostChart(svg, model, { colors, compact: true, reducedMotion: true });
    const primarySegments = tags(svg.markup, "data-sandbox-history-segment")
      .filter(tag => attribute(tag, "data-sandbox-history") === "p0");
    assert.equal(primarySegments.length, 2, "The null remains a break in both inline and full-bleed layouts");
    assert(primarySegments.every(tag => attribute(tag, "data-sandbox-history-observations") === "1"));
    assert.equal(observationCount(svg.markup), 17, "No responsive layout synthesizes the missing observation");
    assert.equal(rowValue(svg.markup, "p0"), "0.15¢");
  }
});

const galleryWidths = [208, 225, 240, 286, 320, 356, 480, 582, 600];
const averageTag = markup => tags(markup, "data-sandbox-average")[0];
const averageHeadline = markup => markup.match(/<text\b[^>]*font-size="104"[^>]*>([^<]*)<\/text>/)?.[1];
const visibleTextTags = markup => [...markup.split('<g data-sandbox-readout=')[0]
  .matchAll(/<text\b[^>]*>[^<]*<\/text>/g)].map(match => match[0]);

test("Gallery shows one average-cost headline with the original header and no provider or axis labels", () => {
  for (const range of ["now", "7d", "all"]) {
    for (const width of galleryWidths) {
      const { svg } = harness(width);
      paintSandboxCostChart(svg, fixture(range), { colors, compact: true, gallery: true, reducedMotion: true });
      const markup = svg.markup;
      assert.equal(svg.getAttribute("viewBox"), "0 0 1200 675");
      assert.equal(attribute(tags(markup, "data-sandbox-chart")[0], "data-sandbox-layout"), "gallery");
      assert.equal(count(markup, "data-sandbox-average"), 1);
      assert.equal(count(markup, "data-view-artifact-header"), 1);
      assert.equal(count(markup, "data-sandbox-provider"), 6);
      assert.equal(count(markup, "data-sandbox-label"), 0);
      assert.equal(count(markup, "data-sandbox-latest-value"), 0);
      noSummary(markup);
      assert.doesNotMatch(markup, /NaN|Infinity|<foreignObject|<image|<use\b|data-sandbox-icon|data-sandbox-context/);
      const rangeLabel = range === "now" ? "LATEST" : range.toUpperCase();
      assert.match(markup, />Sandbox cost<\/text>/);
      assert.equal((markup.match(new RegExp(">" + rangeLabel + "<\\/text>", "g")) || []).length, 1);
      assert.equal((markup.match(/>AVG<\/text>/g) || []).length, 0);
      assert.equal(count(markup, "data-sandbox-average-label"), 0);
      const text = visibleTextTags(markup);
      assert.equal(text.length, 3, "Only title, range and numeric mean headline are visible");
      assert(text.every(tag => Number(attribute(tag, "y")) < 240), "No provider values or bottom axis labels remain in the plot");
      assert.equal(attribute(averageTag(markup), "data-method"), "mean-of-provider-medians");
      assert.equal(attribute(averageTag(markup), "data-provider-count"), "6");
      const mean = fixture(range).providers.reduce((sum, provider) => sum +
        (range === "now" ? provider.median : provider.history.at(-1).value) / 6, 0);
      near(Number(attribute(averageTag(markup), "data-value")), mean, "Average metadata stays in USD", 1e-14);
      assert.equal(averageHeadline(markup), (mean * 100).toFixed(2) + "¢");
      assert.match(markup, /unweighted mean of 6 displayed providers/);
      if (range !== "now") assert.match(markup, /last available batch medians/);
      const lanes = tags(markup, "data-sandbox-hit");
      assert.equal(Number(attribute(lanes[0], "y")), 240);
      const last = lanes.at(-1);
      near(Number(attribute(last, "y")) + Number(attribute(last, "height")), range === "now" ? 675 : 659,
        "Latest reaches the card bottom while history retains its existing inset");
    }
  }
});

test("Gallery Latest spans both card edges on one exact observed-cost scale without a vertical grid", () => {
  for (const width of galleryWidths) {
    const { svg } = harness(width);
    const model = fixture();
    paintSandboxCostChart(svg, model, { colors, compact: true, gallery: true, reducedMotion: true });
    const minimum = Math.min(...model.providers.map(provider => provider.minimum));
    const maximum = Math.max(...model.providers.map(provider => provider.maximum));
    const expectedX = value => (value - minimum) / (maximum - minimum) * 1200;
    const whiskers = tags(svg.markup, "data-sandbox-whisker");
    const bands = tags(svg.markup, "data-sandbox-iqr");
    const medians = tags(svg.markup, "data-sandbox-median");
    for (const marks of [whiskers, bands, medians]) assert.equal(marks.length, 6);
    const quietLines = tags(svg.markup, "stroke-opacity").filter(tag => /^<line\b/.test(tag) &&
      Number(attribute(tag, "stroke-opacity")) < 0.15);
    assert(quietLines.every(tag => attribute(tag, "y1") === attribute(tag, "y2")),
      "Gallery keeps quiet horizontal guides but removes all vertical grid lines");
    const rules = quietLines.filter(tag => attribute(tag, "x1") !== attribute(tag, "x2"));
    assert.equal(rules.length, 6);
    for (const [index, rule] of rules.entries()) {
      assert.equal(Number(attribute(rule, "x1")), 0);
      assert.equal(Number(attribute(rule, "x2")), 1200);
      const positions = [Number(attribute(whiskers[index], "x1")), Number(attribute(bands[index], "x1")),
        Number(attribute(medians[index], "x1")), Number(attribute(bands[index], "x2")), Number(attribute(whiskers[index], "x2"))];
      assert(positions.every((position, i) => Number.isFinite(position) && position >= 0 && position <= 1200 &&
        (i === 0 || position >= positions[i - 1])), "Every min/P25/median/P75/max mark retains its cost ordering");
      const provider = model.providers[index];
      for (const [positionIndex, field] of ["minimum", "p25", "median", "p75", "maximum"].entries()) {
        near(positions[positionIndex], expectedX(provider[field]),
          "Every provider uses the same exact observed min-to-max mapping without zero or nice padding");
      }
      assert.equal(attribute(bands[index], "stroke-width"), "3", "Gallery IQR has fixed three-pixel visual weight");
      assert.equal(attribute(bands[index], "stroke-opacity"), "0.88");
      assert.equal(attribute(whiskers[index], "stroke-opacity"), "0.64");
      assert.equal(attribute(bands[index], "vector-effect"), "non-scaling-stroke");
      assert.equal(attribute(medians[index], "stroke-width"), "1.5");
      near(Number(attribute(medians[index], "y2")) - Number(attribute(medians[index], "y1")), 24,
        "Gallery median ticks retain the polished authored height");
      assert(Number(attribute(medians[index], "y1")) > 240 && Number(attribute(medians[index], "y2")) < 675);
    }
    near(Math.min(...whiskers.map(tag => Number(attribute(tag, "x1")))), 0, "The observed minimum whisker touches the left edge");
    near(Math.max(...whiskers.map(tag => Number(attribute(tag, "x2")))), 1200, "The observed maximum whisker touches the right edge");
    const centers = medians.map(tag => Number(attribute(tag, "x1")));
    const delta = centers[1] - centers[0];
    assert(centers.slice(1).every((value, index) => Math.abs(value - centers[index] - delta) < 0.02),
      "Equal cost increments preserve one shared linear axis without visible tick labels");
  }
});

test("Gallery Latest derives its edge-to-edge extent only from displayed provider subsets", () => {
  const model = fixture();
  model.providers = [model.providers[1], model.providers[3]];
  model.primary = model.providers[1];
  model.latest = model.primary;
  const before = structuredClone(model);
  const markup = render(model, { compact: true, gallery: true });
  const whiskers = tags(markup, "data-sandbox-whisker");
  const medians = tags(markup, "data-sandbox-median");
  assert.equal(whiskers.length, 2);
  near(Number(attribute(whiskers[0], "x1")), 0, "The subset minimum, not an excluded provider's minimum, reaches the left edge");
  near(Number(attribute(whiskers[1], "x2")), 1200, "The subset maximum reaches the right edge");
  const minimum = model.providers[0].minimum;
  const maximum = model.providers[1].maximum;
  for (const [index, provider] of model.providers.entries()) near(Number(attribute(medians[index], "x1")),
    (provider.median - minimum) / (maximum - minimum) * 1200, "Subset medians retain the common scale");
  assert.equal(averageHeadline(markup), "0.30¢");
  assert.equal(attribute(averageTag(markup), "data-provider-count"), "2");
  assert.deepEqual(model, before, "Changing the displayed extent never changes source costs");
});

test("Gallery Latest handles equal positive and zero-cost extents with a finite shared fallback", () => {
  for (const cost of [0, 0.004]) {
    for (const providerCount of [1, 6]) {
      const model = fixture();
      model.providers = model.providers.slice(0, providerCount);
      for (const provider of model.providers) for (const field of ["minimum", "p25", "median", "p75", "maximum"]) {
        provider[field] = cost;
      }
      const before = structuredClone(model);
      for (const width of [208, 600]) {
        const { svg } = harness(width);
        paintSandboxCostChart(svg, model, { colors, compact: true, gallery: true, reducedMotion: true });
        assert.doesNotMatch(svg.markup, /NaN|Infinity/);
        assert.equal(averageHeadline(svg.markup), (cost * 100).toFixed(2) + "¢");
        const positions = ["whisker", "iqr", "median"].flatMap(marker => {
          const marks = tags(svg.markup, "data-sandbox-" + marker);
          assert.equal(marks.length, providerCount);
          return marks.flatMap(tag => [Number(attribute(tag, "x1")), Number(attribute(tag, "x2"))]);
        });
        assert(positions.every(position => Number.isFinite(position) && position >= 0 && position <= 1200));
        assert(positions.every(position => Math.abs(position - positions[0]) < 0.01),
          "Identical observed costs remain coincident for every provider and every distribution mark");
        near(positions[0], 600, "An equal-cost extent uses the finite midpoint of the shared plot");
      }
      assert.deepEqual(model, before);
    }
  }
});

test("Gallery history uses full-bleed shared dates and the complete unlabeled provider lanes", () => {
  for (const width of galleryWidths) {
    const { svg } = harness(width);
    paintSandboxCostChart(svg, fixture("all"), { colors, compact: true, gallery: true, reducedMotion: true });
    const lanes = tags(svg.markup, "data-sandbox-hit");
    const paths = tags(svg.markup, "data-sandbox-history-segment").map(pathPoints);
    assert.equal(paths.length, 6);
    assert.equal(observationCount(svg.markup), 18);
    for (const [index, points] of paths.entries()) {
      near(points[0][0], 0, "Gallery history starts at the card edge");
      near(points.at(-1)[0], 1200, "Gallery history ends at the card edge");
      assert.deepEqual(points.map(point => point[0]), paths[0].map(point => point[0]));
      const top = Number(attribute(lanes[index], "y"));
      const bottom = top + Number(attribute(lanes[index], "height"));
      assert(points.every(point => point[1] > top && point[1] < bottom), "History stays inside its own enlarged lane");
    }
  }
});

test("Gallery mean is unweighted across displayed providers, independent of primary and replicate counts", () => {
  const model = fixture();
  model.providers = [model.providers[0], model.providers[5]];
  model.providers[0].sampleCount = 1;
  model.providers[1].sampleCount = 100;
  model.primary = model.providers[1];
  model.latest = model.primary;
  const before = structuredClone(model);
  const markup = render(model, { compact: true, gallery: true });
  near(Number(attribute(averageTag(markup), "data-value")), 0.0035, "Both displayed providers get equal weight", 1e-14);
  assert.equal(averageHeadline(markup), "0.35¢");
  assert.equal(attribute(averageTag(markup), "data-provider-count"), "2");
  assert.equal(count(markup, "data-sandbox-provider"), 2);
  assert.match(markup, /unweighted mean of 2 displayed providers/);
  assert.deepEqual(model, before, "Sorting, averaging and drawing do not mutate source selections or values");
  model.providers = [model.providers[1]];
  const single = render(model, { compact: true, gallery: true });
  assert.equal(averageHeadline(single), "0.60¢");
  assert.equal(attribute(averageTag(single), "data-provider-count"), "1");
});

test("Gallery history averages last finite values only, excludes missing providers, and distinguishes zero from unavailable", () => {
  const model = fixture("all");
  model.providers = model.providers.slice(0, 4);
  model.providers[0].history[0].value = 0.001;
  model.providers[0].history[1].value = 0.003;
  model.providers[0].history[2].value = null;
  model.providers[1].history[0].value = 0.006;
  model.providers[1].history[1].value = 0.009;
  model.providers[1].history[2].value = null;
  model.providers[2].history = [];
  model.providers[3].history.forEach(point => { point.value = null; });
  const before = structuredClone(model);
  const markup = render(model, { compact: true, gallery: true });
  near(Number(attribute(averageTag(markup), "data-value")), 0.006, "Mean uses only the two last finite batch values", 1e-14);
  assert.equal(averageHeadline(markup), "0.60¢");
  assert.equal(attribute(averageTag(markup), "data-provider-count"), "2");
  assert.match(markup, /last available batch medians/);
  assert.deepEqual(model, before);
  model.providers.forEach(provider => { provider.history = []; });
  const empty = render(model, { compact: true, gallery: true });
  assert.equal(averageHeadline(empty), "—");
  assert.equal(attribute(averageTag(empty), "data-value"), "");
  assert.equal(attribute(averageTag(empty), "data-provider-count"), "0");
  assert.match(empty, /Average cost unavailable/);
  assert.equal(count(empty, "data-sandbox-history-segment"), 0);
  assert.doesNotMatch(empty, /NaN|Infinity/);
  const zero = fixture();
  for (const provider of zero.providers) for (const field of ["minimum", "p25", "median", "p75", "maximum"]) provider[field] = 0;
  const zeroMarkup = render(zero, { compact: true, gallery: true });
  assert.equal(averageHeadline(zeroMarkup), "0.00¢");
  assert.equal(attribute(averageTag(zeroMarkup), "data-provider-count"), "6");
});

test("Gallery shows the real 3.42-cent latest and 3.48-cent history means without losing observations", () => {
  const payload = JSON.parse(readFileSync(new URL("../data/sandbox-cost.json", import.meta.url), "utf8"));
  for (const range of ["now", "7d", "all"]) {
    const model = createSandboxCostModel(payload, getCardDefinition("sandbox-cost"), { range });
    const before = structuredClone(model);
    const mean = model.providers.reduce((sum, provider) => sum +
      (range === "now" ? provider.median : provider.history.at(-1).value) / 6, 0);
    for (const width of galleryWidths) {
      const { svg } = harness(width);
      paintSandboxCostChart(svg, model, { colors, compact: true, gallery: true, reducedMotion: true });
      assert.equal(averageHeadline(svg.markup), range === "now" ? "3.42¢" : "3.48¢");
      near(Number(attribute(averageTag(svg.markup), "data-value")), mean, "Raw mean preserves source precision", 1e-14);
      assert.equal(count(svg.markup, "data-sandbox-provider"), 6);
      if (range !== "now") assert.equal(observationCount(svg.markup),
        model.providers.reduce((sum, provider) => sum + provider.history.length, 0));
    }
    assert.deepEqual(model, before, "Actual source models remain unchanged through all Gallery sizes");
  }
  const missing = fixture("all");
  missing.providers[0].history[1].value = null;
  const { svg } = harness(208);
  paintSandboxCostChart(svg, missing, { colors, compact: true, gallery: true, reducedMotion: true });
  const primarySegments = tags(svg.markup, "data-sandbox-history-segment").filter(tag => attribute(tag, "data-sandbox-history") === "p0");
  assert.equal(primarySegments.length, 2);
  assert(primarySegments.every(tag => attribute(tag, "data-sandbox-history-observations") === "1"));
  assert.equal(observationCount(svg.markup), 17);
});

test("Gallery resize preserves the average, enlarged graphics and fixed visual stroke weights", () => {
  const { svg } = harness(225);
  paintSandboxCostChart(svg, fixture(), { colors, compact: true, gallery: true, reducedMotion: true });
  const before = svg.markup;
  svg.clientWidth = 582;
  paintSandboxCostChart(svg, fixture(), { colors, compact: true, gallery: true, reducedMotion: true });
  assert.equal(svg.markup, before);
  assert.equal(attribute(tags(svg.markup, "data-sandbox-iqr")[0], "stroke-width"), "3");
  assert.equal(svg.getAttribute("viewBox"), "0 0 1200 675");
});

test("Gallery changes none of the default Focus, Monitor, export and pinned-preview bytes", () => {
  // Protect exact default SVG output beyond the responsive geometry assertions.
  // The history baseline includes the accessibility-copy cleanup; geometry is unchanged.
  const baselines = {
    now: "08313aa9bc9b76a6618946dfcf08e608afae4c3fb4937cf9380ea0abf07085d6",
    all: "57ded879da19d8862fa616c9a9ee30c150d25b63560b80a895894efc5b407daf",
  };
  const surfaces = [
    {}, { minimal: true }, { compact: true },
    ...[286, 356, 480, 582].map(width => ({ compact: true, _pixelWidth: width, _mobile: width <= 480 })),
    { _pixelWidth: 362, _height: 1200 * 283 / 362, _mobile: true },
  ];
  for (const range of ["now", "all"]) {
    const outputs = surfaces.map(options => render(fixture(range), options));
    for (const output of outputs) assert.doesNotMatch(output, /not an uncertainty range/);
    assert.equal(createHash("sha256").update(JSON.stringify(outputs)).digest("hex"), baselines[range],
      "The Gallery option does not alter any pre-existing " + range + " surface");
    for (const [index, options] of surfaces.entries()) assert.equal(
      render(fixture(range), { ...options, gallery: false }), outputs[index]);
  }
});

test("The checked-in public snapshot renders its actual latest and historical model contracts", () => {
  const payload = JSON.parse(readFileSync(new URL("../data/sandbox-cost.json", import.meta.url), "utf8"));
  for (const range of ["now", "7d", "all"]) {
    const model = createSandboxCostModel(payload, getCardDefinition("sandbox-cost"), { range });
    const markup = render(model);
    assert.equal(count(markup, "data-sandbox-provider"), 6);
    noSummary(markup);
    assert.doesNotMatch(markup, /NaN|Infinity|>Unavailable<\/text>/);
    for (const provider of model.providers) {
      const value = range === "now" ? provider.median : provider.history.at(-1).value;
      assert.equal(rowValue(markup, provider.id), `${(value * 100).toFixed(2)}¢`);
    }
    if (range !== "now") {
      assert.equal(count(markup, "data-sandbox-history-guide"), 0);
      assert.equal(count(markup, "data-sandbox-history-segment"), 6);
      assert.equal(observationCount(markup),
        model.providers.reduce((sum, provider) => sum + provider.history.length, 0));
    }
    for (const width of responsiveWidths) {
      const { svg } = harness(width);
      paintSandboxCostChart(svg, model, { colors, compact: true, reducedMotion: true });
      for (const provider of model.providers) {
        const value = range === "now" ? provider.median : provider.history.at(-1).value;
        assert.equal(rowValue(svg.markup, provider.id), `${(value * 100).toFixed(2)}¢`,
          `The ${provider.id} source value is unchanged at ${width}px in ${range}`);
      }
      if (range !== "now") assert.equal(observationCount(svg.markup),
        model.providers.reduce((sum, provider) => sum + provider.history.length, 0));
    }
  }
});
