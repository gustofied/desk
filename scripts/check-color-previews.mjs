import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";
import {
  CARD_REGISTRY,
  DEFAULT_PALETTE,
  DEFAULT_THEME,
  getCardDefinition,
  normalizeCardState,
  publishedCardSharePath,
  SITE_ORIGIN,
} from "../src/card-registry.js";
import { CHART_COLORMAPS } from "../src/chart-colors.js";
import { CATALOG_SHARE_CARD_IDS } from "../src/catalog-share-previews.js";
import { isPublishedPreviewPath } from "./published-preview-archive.mjs";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// A small post-build sample exercises every renderer, plus the alternate paths
// with distinct rendering or state. It does not regenerate the preview catalog.
export async function checkColorPreviews({ projectRoot = defaultRoot } = {}) {
  const samples = CARD_REGISTRY.map(card => ({ card, seed: card.defaults }));
  for (const [cardId, presetId] of [
    ["gpu-index", "compute-market"],
    ["gpu-index", "h200-b300-spread"],
    ["gpu-market-depth", "h100-history"],
    ["power-basis", "pjm-west-spread"],
    ["power-basis", "gpu-energy"],
    ["equities", "nvidia-compute-bars"],
    ["forward-prices", "h100-curve"],
    ["gpu-hedge", "seller"],
    ["gpu-hedge", "coverage"],
  ]) {
    const card = getCardDefinition(cardId);
    const preset = card.catalogPresets.find(item => item.id === presetId);
    assert.ok(preset, `Missing preview check preset: ${cardId}/${presetId}`);
    samples.push({ card, seed: preset.state || {} });
  }
  const appearances = [
    { palette: DEFAULT_PALETTE, theme: DEFAULT_THEME },
    { palette: "sage", theme: "dark" },
  ];
  let pages = 0;
  for (const { card, seed } of samples) {
    for (const appearance of appearances) {
      const imagePaths = new Set();
      const imageDigests = new Set();
      for (const { id: colormap } of CHART_COLORMAPS) {
        const state = normalizeCardState(card.id, { ...seed, ...appearance, colormap });
        const pageHref = publishedCardSharePath(card.id, state);
        const html = await readFile(localFile(projectRoot, `${pageHref}index.html`), "utf8");
        const image = verifyPage(html, card, state, pageHref);
        const bytes = await readFile(localFile(projectRoot, image.pathname));
        const metadata = await sharp(bytes).metadata();
        assert.deepEqual([metadata.format, metadata.width, metadata.height],
          ["png", 1200, 630], `${pageHref}: invalid social image dimensions`);
        const digest = createHash("sha256").update(bytes).digest("hex");
        assert.ok(image.pathname.endsWith(`--${digest.slice(0, 16)}.png`),
          `${pageHref}: image must have its immutable content hash`);
        imagePaths.add(image.pathname);
        imageDigests.add(digest);
        pages += 1;
      }
      assert.equal(imagePaths.size, CHART_COLORMAPS.length, `${card.id}: maps reuse an image URL`);
      assert.equal(imageDigests.size, CHART_COLORMAPS.length, `${card.id}: maps render identical PNGs`);
    }
  }

  // Historical depth routes predate the colormap option and must remain Current.
  // Derive their prefix/terms from the registry, substituting only the old range
  // spelling that normalizeCardState intentionally migrates to history/now.
  const depth = getCardDefinition("gpu-market-depth");
  let aliases = 0;
  for (const appearance of appearances) {
    for (const target of depth.stateOptions.find(option => option.id === "target").values) {
      const state = normalizeCardState(depth.id, { ...appearance, target, scale: "history", colormap: "current" });
      const currentPath = publishedCardSharePath(depth.id, state);
      const currentHtml = await readFile(localFile(projectRoot, `${currentPath}index.html`), "utf8");
      for (const range of ["1d", "7d"]) {
        const aliasPath = currentPath.replace("/history/", "/depth/").replace("/now/", `/${range}/`);
        assert.notEqual(aliasPath, currentPath);
        const html = await readFile(localFile(projectRoot, `${aliasPath}index.html`), "utf8");
        assert.equal(html, currentHtml, `${aliasPath}: legacy alias no longer matches Current`);
        verifyPage(html, depth, state, currentPath);
        aliases += 1;
      }
    }
  }
  return { cards: CARD_REGISTRY.length, pages, aliases };
}

function verifyPage(html, card, state, pageHref) {
  const tags = new Map();
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = Object.fromEntries([...tag[0].matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)]
      .map(([, name, value]) => [name.toLowerCase(), unescapeHtml(value)]));
    tags.set(attrs.property || attrs.name, attrs.content);
  }
  assert.equal(tags.get("twitter:card"), "summary_large_image", `${pageHref}: missing large-image card`);
  const imageHref = tags.get("og:image");
  assert.ok(imageHref, `${pageHref}: missing Open Graph image`);
  assert.equal(tags.get("twitter:image"), imageHref, `${pageHref}: Twitter and OG images differ`);
  assert.equal(tags.get("og:image:secure_url"), imageHref, `${pageHref}: secure image differs`);
  const image = new URL(imageHref);
  assert.equal(image.origin, SITE_ORIGIN, `${pageHref}: image must use the public Desk origin`);
  assert.ok(isPublishedPreviewPath(image.pathname.slice(1)), `${pageHref}: image is not a retained published PNG`);
  assert.ok(image.pathname.startsWith(`/${card.previewImageDir}/published/`), `${pageHref}: wrong card image`);
  assert.equal(new URL(tags.get("og:url")).pathname, pageHref, `${pageHref}: wrong canonical preview route`);
  assert.deepEqual([tags.get("og:image:width"), tags.get("og:image:height")], ["1200", "630"]);
  const redirect = html.match(/new URL\(("(?:[^"\\]|\\.)*")\s*,\s*window\.location\.origin\)/);
  assert.ok(redirect, `${pageHref}: missing explicit chart redirect`);
  const destination = new URL(JSON.parse(redirect[1]), SITE_ORIGIN);
  assert.equal(destination.origin, SITE_ORIGIN);
  assert.equal(destination.pathname, "/");
  assert.equal(destination.hash, `#${card.hash}`);
  assert.equal(destination.searchParams.get("card"), card.id);
  assert.equal(destination.searchParams.get("view"), CATALOG_SHARE_CARD_IDS.includes(card.id) ? "monitor" : "card");
  if (state.colormap !== "current") {
    assert.equal(destination.searchParams.get("colormap"), state.colormap, `${pageHref}: redirect lost colors`);
  }
  assert.deepEqual(normalizeCardState(card.id, Object.fromEntries(destination.searchParams)), state,
    `${pageHref}: redirect changed the selected composition`);
  return image;
}

function localFile(root, publicPath) {
  assert.ok(publicPath.startsWith("/") && !publicPath.startsWith("//"));
  const file = resolve(root, publicPath.slice(1));
  assert.ok(file.startsWith(`${resolve(root)}/`), "Preview path escapes the site root");
  return file;
}

function unescapeHtml(value) {
  return value.replace(/&(amp|quot|apos|lt|gt);/g,
    (_, entity) => ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" })[entity]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { cards, pages, aliases } = await checkColorPreviews();
  console.log(`Checked ${cards} card types, ${pages} colored preview pages and ${aliases} legacy depth aliases.`);
}
