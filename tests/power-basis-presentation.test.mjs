import assert from "node:assert/strict";
import test from "node:test";
import { renderPowerBasisSvg } from "../src/power-basis-presentation.js";
import { createPowerBasisModel } from "../src/power-basis-model.js";
import { getCardDefinition } from "../src/card-registry.js";

const colors = { paper: "#181818", line: "#ffffff", secondary: "#aaaaaa", area: "#ffffff" };
const factor = 0.00153;
function fixture({ energy = false, negative = false, kind = "showcase" } = {}) {
  const raw = negative ? [[-12, -8], [-4.5, 2]] : [[46.73, 40.46], [43.36, 39.76]];
  const rows = raw.map(([realTime, dayAhead], index) => {
    const rawPrice = { realTime, dayAhead, basis: realTime - dayAhead };
    return { timestamp: 1788015600 + index * 3600,
      ...Object.fromEntries(Object.entries(rawPrice).map(([key, value]) => [key, value * (energy ? factor : 1)])),
      ...(energy ? { rawPrice } : {}) };
  });
  return { location: { label: "PJM West", market: "PJM", unit: "USD per MWh" },
    mode: energy ? "energy" : "price", kind: energy ? "estimate" : kind,
    unit: energy ? "USD per GPU-hour" : "USD per MWh", precision: energy ? 4 : 2,
    energy: energy ? { factor, unit: "USD per GPU-hour", precision: 4,
      provenance: { priceKind: "showcase" } } : null,
    range: "1d", rows, latest: rows.at(-1) };
}
const render = (model, options = {}) => renderPowerBasisSvg(model, { colors, ...options });
const paths = markup => [...markup.matchAll(/<path[^>]+d="([^"]+)"/g)].map(match => match[1]);

test("Power artifacts disclose Demo and /MWh without changing the compact frame", () => {
  const markup = render(fixture(), { compact: true });
  assert.match(markup, /viewBox="0 0 1200 675"/);
  assert.match(markup, />DEMO · 1D<\/text>/);
  assert.match(markup, />\$43\.36<\/text>/);
  assert.match(markup, /data-power-basis-unit=""[^>]*>\/MWh<\/text>/);
  assert.equal((markup.match(/data-power-basis-line=/g) || []).length, 2);
  assert.match(markup, /data-power-basis-area/);
  assert.doesNotMatch(markup, /data-power-basis-column/);
});

test("Energy artifacts show Estimate and four-decimal GPU-hour prices, never raw MWh prices", () => {
  const markup = render(fixture({ energy: true }), { compact: true });
  assert.match(markup, />ESTIMATE · 1D<\/text>/);
  assert.match(markup, />\$0\.0663<\/text>/);
  assert.match(markup, /data-power-basis-unit=""[^>]*>\/GPU-h<\/text>/);
  assert.doesNotMatch(markup, /43\.36|USD per MWh|>\/MWh</);
  assert.match(markup, /aria-label="Estimate\./);
  assert.match(markup, /USD per GPU-hour/);
});

test("Monitor readout and interactive observations share precision, units and attribution", () => {
  for (const energy of [false, true]) {
    const model = fixture({ energy });
    const markup = render(model);
    const rt = energy ? "$0.0663/GPU-h" : "$43.36/MWh";
    const da = energy ? "$0.0608/GPU-h" : "$39.76/MWh";
    const basis = energy ? "+$0.0055/GPU-h" : "+$3.60/MWh";
    for (const [name, value, prefix] of [["real-time", rt, "RT"], ["day-ahead", da, "DA"], ["basis", basis, "SPREAD"]]) {
      assert(markup.includes(`data-${name}="${value}"`), `Interactive ${name}`);
      assert(markup.includes(`>${prefix} ${value}</tspan>`), `Visible ${name}`);
    }
    assert(markup.includes(`data-date="${energy ? "ESTIMATE" : "DEMO"} ·`));
    assert.match(markup, /data-aria-label="[^\"]+USD per (?:GPU-hour|MWh)/);
  }
});

test("negative Energy costs and signed spreads remain visible at four decimals", () => {
  const model = fixture({ energy: true, negative: true });
  const markup = render(model);
  assert(markup.includes("RT −$0.0069/GPU-h"));
  assert(markup.includes("DA $0.0031/GPU-h"));
  assert(markup.includes("SPREAD −$0.0099/GPU-h"));
  const artifact = render(model, { compact: true });
  assert.match(artifact, />−\$0\.0069<\/text>/);
  assert.doesNotMatch(markup, /NaN|Infinity/);
});

test("Energy uses the same RT, DA and fill geometry as the underlying Power series", () => {
  for (const compact of [false, true]) {
    assert.deepEqual(paths(render(fixture({ energy: true }), { compact })), paths(render(fixture(), { compact })));
    assert.doesNotMatch(render(fixture({ energy: true }), { compact }), /data-power-basis-line="basis"/);
  }
});

test("existing basis mode keeps its single signed line and zero reference", () => {
  const markup = render(fixture({ negative: true }), { compact: true, mode: "basis" });
  assert.match(markup, />−\$6\.50<\/text>/);
  assert.match(markup, /class="power-basis__zero"/);
  assert.match(markup, /data-power-basis-line="basis"/);
  assert.doesNotMatch(markup, /data-power-basis-line="day-ahead"/);
});

test("minimal mobile charts retain quiet provenance and units without interactive columns", () => {
  for (const energy of [false, true]) {
    const markup = render(fixture({ energy }), { minimal: true });
    assert(markup.includes(`>${energy ? "ESTIMATE · /GPU-h" : "DEMO · /MWh"}</text>`));
    assert.doesNotMatch(markup, /data-power-basis-readout|data-power-basis-column|data-view-artifact-header/);
    assert.match(markup, /viewBox="0 0 1200 600"/);
  }
});

test("non-demo models are not falsely marked Demo; custom strings remain escaped", () => {
  const model = fixture({ kind: "historical" });
  const markup = render(model, { compact: true, title: "PJM <West>" });
  assert.doesNotMatch(markup, /DEMO|ESTIMATE/);
  assert.match(markup, /PJM &lt;West&gt;/);
  assert.match(markup, /role="img"/);
  assert.match(render(model, { decorative: true }), /aria-hidden="true"/);
});

test("the actual model contract keeps raw location units but renders converted Energy values", () => {
  const source = fixture({ negative: true });
  const payload = { version: 1, cardId: "power-basis", revision: "presentation-fixture",
    asOf: source.latest.timestamp, columns: ["timestamp", "realTime", "dayAhead", "basis"],
    locations: [{ ...source.location, id: "PJM-WEST", location: "Western Hub", currency: "USD",
      timezone: "America/New_York", intervalMinutes: 60 }],
    series: { "PJM-WEST": source.rows.map(row => [row.timestamp, row.realTime, row.dayAhead, row.basis]) },
    dataset: { kind: "showcase", cadence: "hourly", cadenceSeconds: 3600,
      start: source.rows[0].timestamp, end: source.latest.timestamp, observationCount: 2 } };
  const model = createPowerBasisModel(payload, getCardDefinition("power-basis"), { mode: "energy" });
  assert.equal(model.location.unit, "USD per MWh");
  assert.equal(model.unit, "USD per GPU-hour");
  const markup = render(model, { compact: true });
  assert.match(markup, />ESTIMATE · 1D<\/text>/);
  assert.match(markup, />−\$0\.0069<\/text>/);
  assert.match(markup, />\/GPU-h<\/text>/);
});
