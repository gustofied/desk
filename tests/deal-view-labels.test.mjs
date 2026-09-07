import assert from "node:assert/strict";
import test from "node:test";
import { createDealViewModel, DEAL_041_PAYLOAD } from "../src/deal-view-model.js";

test("saved quote names replace the example reference in visual and accessible headings", () => {
  const first = createDealViewModel(DEAL_041_PAYLOAD, { kind: "quote", viewName: "Training cluster" });
  const second = createDealViewModel(DEAL_041_PAYLOAD, { kind: "quote", viewName: "Inference reserve" });
  assert.equal(first.label, "Training cluster");
  assert.equal(second.label, "Inference reserve");
  for (const model of [first, second]) {
    assert(model.ariaLabel.startsWith(`${model.label},`));
    for (const label of Object.values(model.ariaLabels)) {
      assert(label.startsWith(`${model.label},`));
      assert(!label.includes("Quote 041"));
    }
    assert.equal(model.id, "041", "Display names must not rewrite source identity");
  }
  assert.deepEqual(first.quote, second.quote);
  assert.deepEqual(first.quoteHistory, second.quoteHistory);
});

test("unnamed quotes use their selected GPU without inventing a quote reference", () => {
  for (const asset of ["H100", "H200", "B200", "B300"]) {
    const model = createDealViewModel(DEAL_041_PAYLOAD, { kind: "quote", overrides: { gpu: asset } });
    assert.equal(model.label, `Quote ${asset}`);
    assert(model.ariaLabel.startsWith(`Quote ${asset},`));
  }
  assert.equal(createDealViewModel(DEAL_041_PAYLOAD, { kind: "quote", viewName: "  " }).label, "Quote B200");
});

test("quote display names preserve authored text and do not affect the Deal example", () => {
  const name = '  Research <B200> & "reserve"  ';
  const quote = createDealViewModel(DEAL_041_PAYLOAD, { kind: "quote", viewName: name });
  assert.equal(quote.label, name.trim());
  const deal = createDealViewModel(DEAL_041_PAYLOAD, { viewName: "Quote name" });
  assert.equal(deal.label, "Deal 041");
  assert(deal.ariaLabel.startsWith("Deal 041,"));
});
