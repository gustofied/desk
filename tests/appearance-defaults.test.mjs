import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { CARD_REGISTRY, DEFAULT_PALETTE, DEFAULT_THEME, normalizeCardState } from "../src/card-registry.js";
import { normalizeCardVisualization } from "../src/card-document.js";
import { createSharedDesk, decodeSharedDesk, encodeSharedDesk } from "../src/shared-desk.js";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert(bootstrap, "The first-paint bootstrap is present in the document head");

test("every card and built-in preset defaults to Linen light without changing explicit appearance", () => {
  assert.equal(DEFAULT_PALETTE, "linen");
  assert.equal(DEFAULT_THEME, "light");
  for (const card of CARD_REGISTRY) {
    assert.equal(card.defaults.palette, "linen", card.id);
    assert.equal(card.defaults.theme, "light", card.id);
    for (const state of [{}, ...(card.catalogPresets || []).map(preset => preset.state)]) {
      const normalized = normalizeCardState(card.id, state);
      assert.equal(normalized.palette, state?.palette || "linen", card.id);
      assert.equal(normalized.theme, state?.theme || "light", card.id);
    }
    const explicit = { palette: "sage", theme: "dark" };
    for (const state of [normalizeCardState(card.id, explicit), normalizeCardVisualization(card.id, explicit)]) {
      assert.equal(state.palette, "sage", card.id);
      assert.equal(state.theme, "dark", card.id);
    }
    assert.deepEqual(explicit, { palette: "sage", theme: "dark" });
  }
});

test("shared desks default to Linen light and preserve explicitly authored dark themes", () => {
  const entries = CARD_REGISTRY.map(card => ({ cardId: card.id, name: card.title, state: {} }));
  const light = createSharedDesk({ name: "Default appearance", entries }, { includePrivate: true });
  assert.equal(light.palette, "linen");
  assert.equal(light.theme, "light");
  assert(light.entries.every(entry => entry.state.palette === "linen" && entry.state.theme === "light"));
  assert.deepEqual(decodeSharedDesk(encodeSharedDesk(light)), light);
  const dark = createSharedDesk({ name: "Authored appearance", palette: "sand", theme: "dark",
    entries: entries.map(entry => ({ ...entry, state: { palette: "azure", theme: "dark" } })),
  }, { includePrivate: true });
  assert.equal(dark.palette, "sand");
  assert.equal(dark.theme, "dark");
  assert(dark.entries.every(entry => entry.state.palette === "azure" && entry.state.theme === "dark"));
  assert.deepEqual(decodeSharedDesk(encodeSharedDesk(dark)), dark);
});

test("first paint uses Linen light for fresh, invalid, or unavailable appearance storage", () => {
  assert.match(html, /<meta\s+name="theme-color"\s+content="#ffffff"/);
  for (const options of [{}, { search: "?theme=invalid&palette=invalid" },
    { saved: { "desk-theme": "invalid", "desk-palette": "invalid" } }, { denyStorage: true }]) {
    assert.deepEqual(firstPaint(options), { palette: "linen", theme: "light", color: "#ffffff" });
  }
});

test("first paint preserves explicit URLs and saved preferences with the existing saved-first precedence", () => {
  assert.deepEqual(firstPaint({ search: "?theme=dark&palette=azure" }),
    { palette: "azure", theme: "dark", color: "#181818" });
  assert.deepEqual(firstPaint({ search: "?theme=dark&palette=sand", denyStorage: true }),
    { palette: "sand", theme: "dark", color: "#181818" });
  assert.deepEqual(firstPaint({ search: "?theme=light&palette=azure",
    saved: { "desk-theme": "dark", "desk-palette": "sage" } }),
    { palette: "sage", theme: "dark", color: "#181818" });
  assert.deepEqual(firstPaint({ saved: { "desk-theme": "dark" } }),
    { palette: "linen", theme: "dark", color: "#181818" });
  assert.deepEqual(firstPaint({ saved: { "desk-palette": "sand" } }),
    { palette: "sand", theme: "light", color: "#ffffff" });
});

function firstPaint({ search = "", saved = {}, denyStorage = false } = {}) {
  const dataset = {};
  let color;
  const original = { ...saved };
  runInNewContext(bootstrap, {
    URL,
    window: {
      location: { href: `https://desk.adamsioud.com/${search}`, hash: "" },
      matchMedia: () => ({ matches: false }),
      get localStorage() {
        if (denyStorage) throw new Error("Storage unavailable");
        return { getItem: key => saved[key] ?? null };
      },
    },
    document: {
      documentElement: { dataset },
      querySelector: selector => selector === 'meta[name="theme-color"]'
        ? { setAttribute: (name, value) => { if (name === "content") color = value; } } : null,
    },
  }, { timeout: 1000 });
  assert.deepEqual(saved, original, "First paint must not rewrite appearance preferences");
  return { palette: dataset.palette, theme: dataset.theme, color };
}
