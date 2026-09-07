import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";
import { renderCatalogShareArtifact } from "../scripts/catalog-share-artifacts.mjs";
import { getCardDefinition, normalizeCardState } from "../src/card-registry.js";
import { normalizeCardVisualization } from "../src/card-document.js";
import { createDealViewModel, DEAL_041_PAYLOAD } from "../src/deal-view-model.js";
import { mountDealView, renderDealViewSvg } from "../src/deal-view-presentation.js";

const DAY = 86400;
const START = Date.parse("2026-08-24T00:00:00Z") / 1000;
const colors = { paper: "#181818", line: "#efede4", secondary: "#9b9b9b", text: "#efede4", area: "#9b9b9b" };
const history = values => values.map((value, index) => [START + index * DAY, value, value, value]);
const equity = {
  version: 2, cardId: "equities", revision: "equity-r1", asOf: START + 4 * DAY,
  dataset: { kind: "demo", status: "ready", currency: "USD", priceBasis: "demo-close" },
  series: { NVDA: history([100, 110, 105, 112, 115]), CRWV: history([50, 55, 52, 51, 60]), NBIS: history([80, 79, 82, 83, 88]) },
};
const gpu = {
  version: 2, cardId: "gpu-index", revision: "gpu-r1", asOf: START + 8 * DAY,
  series: {
    H100: [...history([2, 2.1, 2.2, 2.3, 2.4]).flatMap(row => [row, [row[0] + 3600, row[1] + 0.1, 1, 4]]), [START + 8 * DAY, 4, 3, 5]],
    H200: history([3, 3.1, 3.3, 3.2, 3.6]),
  },
};
const sandbox = JSON.parse(readFileSync(new URL("../data/sandbox-cost.json", import.meta.url), "utf8"));
const deal = { ...DEAL_041_PAYLOAD, cardId: "deal-view", revision: "deal-r1" };
const payloads = new Map([["equities", equity], ["gpu-index", gpu], ["sandbox-cost", sandbox], ["deal-view", deal]]);
const mixedState = { symbol: "CRWV", layers: ["CRWV", "NBIS", "H100", "H200"], scale: "index", range: "90d" };
const pathAttribute = (svg, id, name) => {
  const path = svg.match(new RegExp(`<path data-share-series="${id}"[^>]*>`))?.[0];
  assert(path, `Missing series ${id}`);
  return path.match(new RegExp(`${name}="([^"]*)"`))?.[1];
};

test("equity price exports use real selected values, USD-per-share headlines, canonical state and destinations", () => {
  const result = renderCatalogShareArtifact("equities", { symbol: "nvda", layers: ["NVDA"], scale: "price", range: "7d", name: "Secret name", notes: "Secret notes" }, payloads);
  assert.equal(result.title, "NVDA");
  assert(result.svg.includes(">$115.00</text>"));
  assert.match(result.imageAlt, /115\.00 per share/);
  assert.match(result.description, /Synthetic equity history/);
  assert.equal(pathAttribute(result.svg, "NVDA", "data-first-value"), "100");
  assert.equal(pathAttribute(result.svg, "NVDA", "data-last-value"), "115");
  assert.deepEqual(result.state, normalizeCardVisualization("equities", { symbol: "NVDA", range: "7d" }));
  const destination = new URL(result.destination);
  assert.equal(destination.origin, "https://desk.adamsioud.com");
  assert.equal(destination.searchParams.get("view"), "monitor");
  assert.equal(destination.searchParams.get("symbol"), "NVDA");
  assert.equal(destination.searchParams.has("gpu"), false);
  assert(!JSON.stringify(result).includes("Secret"));
});

test("equity index headline is percentage change, not a base-100 level or a dollar price", () => {
  const result = renderCatalogShareArtifact("equities", { symbol: "NVDA", layers: ["NVDA"], scale: "index", range: "1y" }, payloads);
  assert(result.svg.includes(">+15.00%</text>"));
  assert(!result.svg.includes(">$115.00</text>"));
  assert.equal(pathAttribute(result.svg, "NVDA", "data-last-value"), "114.99999999999999");
  assert.match(result.svg, /data-share-baseline="100"/);
});

test("CRWV, NBIS, H100 and H200 export uses one shared daily calendar and return baseline", () => {
  const result = renderCatalogShareArtifact("equities", { ...mixedState, scale: "price" }, payloads);
  assert.equal(result.title, "CRWV + NBIS + H100 + H200");
  assert.equal(result.state.symbol, "CRWV");
  assert.equal(result.state.scale, "index", "Mixed hourly and share prices cannot use a dollar scale");
  assert(result.svg.includes(">+20.00%</text>"));
  for (const id of mixedState.layers) {
    assert.equal(pathAttribute(result.svg, id, "data-first-value"), "100");
    assert.equal(pathAttribute(result.svg, id, "data-observation-count"), "5");
    assert.equal(Number(pathAttribute(result.svg, id, "data-start")), START * 1000);
    assert.equal(Number(pathAttribute(result.svg, id, "data-end")), (START + 4 * DAY) * 1000);
  }
  assert.equal(Number(pathAttribute(result.svg, "H100", "data-last-value")), 2.5 / 2.1 * 100, "Use the last observed hourly price of each UTC date");
  assert.match(result.svg, /data-share-series="H100"[^>]*stroke-dasharray="6 4"/);
  assert.match(result.svg, /data-share-series="H200"[^>]*stroke-dasharray="10 4"/);
});

test("share revisions are deterministic, state-sensitive, and depend on every used source only", () => {
  const initial = renderCatalogShareArtifact("equities", mixedState, payloads);
  assert.deepEqual(renderCatalogShareArtifact("equities", mixedState, Object.fromEntries(payloads)), initial);
  for (const id of ["equities", "gpu-index"]) {
    const changed = new Map(payloads);
    changed.set(id, { ...changed.get(id), revision: "new-revision" });
    assert.notEqual(renderCatalogShareArtifact("equities", mixedState, changed).revision, initial.revision);
  }
  const unrelated = new Map(payloads);
  unrelated.set("sandbox-cost", { ...sandbox, revision: "other-revision" });
  assert.equal(renderCatalogShareArtifact("equities", mixedState, unrelated).revision, initial.revision);
  assert.notEqual(renderCatalogShareArtifact("equities", { ...mixedState, palette: "sand" }, payloads).revision, initial.revision);
  const changedValues = structuredClone(equity);
  changedValues.series.CRWV.at(-1)[1] = 61;
  const repriced = new Map(payloads).set("equities", changedValues);
  assert.notEqual(renderCatalogShareArtifact("equities", mixedState, repriced).revision, initial.revision, "Changed output cannot reuse an image hash even if upstream forgot to bump revision");
});

test("missing, unavailable, nonpositive and nonoverlapping equity data fails closed", () => {
  assert.throws(() => renderCatalogShareArtifact("gpu-index", {}, payloads), /Unsupported/);
  assert.throws(() => renderCatalogShareArtifact("equities", mixedState, new Map([["equities", equity]])), /gpu-index/);
  const variants = [
    { ...equity, dataset: { ...equity.dataset, status: "unavailable" } },
    { ...equity, series: { ...equity.series, CRWV: [] } },
    { ...equity, series: { ...equity.series, CRWV: history([0, 1, 2]) } },
    { ...equity, series: { ...equity.series, CRWV: [[START - 100 * DAY, 10], [START - 99 * DAY, 11]] } },
  ];
  for (const invalid of variants) {
    assert.throws(() => renderCatalogShareArtifact("equities", mixedState, new Map(payloads).set("equities", invalid)), /required|observations/);
  }
});

test("Sandbox latest retains all six exact provider medians and no summary price tiles", () => {
  const result = renderCatalogShareArtifact("sandbox-cost", {}, payloads);
  assert.equal(result.title, "Sandbox cost");
  assert.equal((result.svg.match(/data-sandbox-distribution=/g) || []).length, 6);
  assert.equal((result.svg.match(/data-sandbox-label=/g) || []).length, 6);
  for (const cents of ["1.33", "1.48", "1.51", "2.78", "4.35", "9.04"]) assert(result.svg.includes(`>${cents}¢</text>`));
  assert(!result.svg.includes("data-sandbox-average"));
  assert.match(result.description, /measured runtime and provider rates/);
});

test("Sandbox history preserves actual observations, selected providers and separate daily-batch semantics", () => {
  const result = renderCatalogShareArtifact("sandbox-cost", { provider: "novita", layers: ["novita", "e2b"], range: "7d" }, payloads);
  assert.deepEqual(result.state.layers, ["novita", "e2b"]);
  assert.match(result.description, /Daily medians.*benchmark batches/);
  assert.match(result.imageAlt, /own price scale/);
  assert.equal((result.svg.match(/data-sandbox-provider=/g) || []).length, 2);
  assert(!result.svg.includes("data-sandbox-distribution"));
  assert(result.svg.includes('data-sandbox-chart="7d"'));
  assert(!result.imageAlt.includes("Modal"));
});

test("private previews expose only canonical supported terms, not payload parties or custom metadata", () => {
  const privatePayload = { ...deal, id: "secret-contract", region: "Secret region", buyerName: "Secret buyer", sellerName: "Secret seller", note: "Secret note" };
  const privateSources = new Map(payloads).set("deal-view", privatePayload);
  for (const id of ["quote-view", "deal-view"]) {
    const result = renderCatalogShareArtifact(id, { gpu: "H200", layers: ["H200"], quote: 2.85, quantity: 128, rfs: "2027-02", name: "Secret title", party: "Secret party" }, privateSources);
    assert.equal(result.state.quote, 2.85);
    assert.equal(result.title, id === "quote-view" ? "Quote H200" : "Deal 041");
    assert(result.svg.includes(">$2.85</text>"));
    assert(result.svg.includes(">RATE AGREED</text>"));
    assert.match(result.imageAlt, /128 H200 GPUs.*2027-02/);
    assert(!JSON.stringify(result).includes("Secret"));
    assert(!JSON.stringify(result).includes("secret-contract"));
    assert(!result.destination.includes("name="));
  }
});

test("pure Deal and Quote SVG exports reuse exact mounted step paths without sequence-dependent output", () => {
  const document = {
    getElementById: () => ({}),
    createElement: () => ({ dataset: {}, style: { setProperty() {} }, querySelector: () => null }),
  };
  const host = { ownerDocument: document, replaceChildren() {} };
  for (const kind of ["quote", "deal"]) {
    const model = createDealViewModel(deal, { kind });
    const before = JSON.stringify(model);
    const first = renderDealViewSvg(model, { palette: colors });
    const mounted = mountDealView(host, model, { palette: colors, reducedMotion: true });
    for (const role of ["bid", "ask"]) {
      const actual = first.match(new RegExp(`data-deal-export-${role}="" d="([^"]+)"`))?.[1];
      const existing = mounted.element.innerHTML.match(new RegExp(`class="deal-view__negotiation-line deal-view__negotiation-line--${role}" d="([^"]+)"`))?.[1];
      assert(actual);
      assert.equal(actual, existing);
    }
    assert.equal(renderDealViewSvg(model, { palette: colors }), first);
    assert.equal(JSON.stringify(model), before);
  }
});

test("exports escape display text and never mutate state or runtime snapshots", () => {
  const model = createDealViewModel(deal, { kind: "quote" });
  const escaped = renderDealViewSvg({ ...model, label: '<script>alert("x")</script>', ariaLabel: '" onload="alert(1)' }, { palette: colors });
  assert(!escaped.includes("<script>"));
  assert(!escaped.includes('aria-label="" onload='));
  assert(escaped.includes("&lt;script&gt;"));
  const sourceBefore = JSON.stringify(Object.fromEntries(payloads));
  const state = Object.freeze({ ...mixedState, layers: Object.freeze([...mixedState.layers]) });
  renderCatalogShareArtifact("equities", state, payloads);
  renderCatalogShareArtifact("sandbox-cost", { range: "all" }, payloads);
  assert.equal(JSON.stringify(Object.fromEntries(payloads)), sourceBefore);
  assert.deepEqual(state, mixedState);
});

test("each new type rasterizes to a valid 1200 by 630 social image", async () => {
  for (const [id, state] of [["equities", mixedState], ["sandbox-cost", {}], ["quote-view", {}], ["deal-view", {}]]) {
    const result = renderCatalogShareArtifact(id, state, payloads);
    assert.match(result.svg, /width="1200" height="630" viewBox="0 0 1200 630"/);
    assert(!/\bNaN\b|\bInfinity\b|<foreignObject|<script/.test(result.svg));
    const image = await sharp(Buffer.from(result.svg)).png().toBuffer();
    const metadata = await sharp(image).metadata();
    assert.equal(metadata.width, 1200);
    assert.equal(metadata.height, 630);
  }
});
