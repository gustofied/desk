import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { PUBLISHED_CARD_VERSION, SITE_ORIGIN } from "../src/card-registry.js";
import { renderCatalogSharePage } from "../scripts/catalog-share-page.mjs";

const pagePath = "/cards/equities/published/crwv/index/crwv~nbis~h100~h200/90d/sage/light/";
const imagePath = "/assets/social/equities/published/v17/equity-and-gpu-revision/crwv/index/crwv~nbis~h100~h200/90d/sage-light.png";
const artifact = {
  title: "CRWV + NBIS + H100 + H200",
  description: "Share prices and GPU rental rates compared as percentage changes over shared dates.",
  imageAlt: "CRWV with NBIS, H100 and H200 over 90 days. Synthetic equity history.",
  revision: "equity-and-gpu-revision",
  state: { theme: "light" },
  destination: `${SITE_ORIGIN}/?card=equities&view=monitor&symbol=CRWV&layers=CRWV%2CNBIS%2CH100%2CH200&scale=index&range=90d&palette=sage&theme=light#gpu-benchmark-card`,
};

test("catalog share pages contain complete static Open Graph and Twitter metadata", () => {
  const html = renderCatalogSharePage(artifact, pagePath, imagePath, "image-bytes-revision");
  const head = html.slice(0, html.indexOf("<script>"));
  const canonical = new URL(pagePath, SITE_ORIGIN);
  canonical.searchParams.set("v", `${PUBLISHED_CARD_VERSION}-${artifact.revision}`);
  const image = new URL(imagePath, SITE_ORIGIN);
  image.searchParams.set("v", "image-bytes-revision");
  const expected = {
    description: artifact.description,
    "og:title": artifact.title,
    "og:description": artifact.description,
    "og:type": "website",
    "og:site_name": "Desk",
    "og:url": canonical.href,
    "og:image": image.href,
    "og:image:secure_url": image.href,
    "og:image:type": "image/png",
    "og:image:width": "1200",
    "og:image:height": "630",
    "og:image:alt": artifact.imageAlt,
    "twitter:card": "summary_large_image",
    "twitter:title": artifact.title,
    "twitter:description": artifact.description,
    "twitter:image": image.href,
    "twitter:image:alt": artifact.imageAlt,
  };
  for (const [name, value] of Object.entries(expected)) assert.equal(metadata(head, name), value, name);
  assert.equal(attribute(head.match(/<link\b[^>]*rel="canonical"[^>]*>/)?.[0], "href"), canonical.href);
  assert.match(head, /<title>CRWV \+ NBIS \+ H100 \+ H200 \| Desk<\/title>/);
  assert.doesNotMatch(head, /desk-comparison\.png|undefined|\[object Object\]/);
});

test("the no-JavaScript link and relative script redirect preserve the exact chart destination", () => {
  const html = renderCatalogSharePage(artifact, pagePath, imagePath, "image-revision");
  const destination = new URL(artifact.destination);
  const target = `${destination.pathname}${destination.search}${destination.hash}`;
  const anchor = html.match(/<a\b[^>]*>Open view<\/a>/)?.[0];
  assert(anchor, "The page must remain navigable without JavaScript");
  assert.equal(attribute(anchor, "href"), target);
  assert.doesNotMatch(html, /http-equiv=["']refresh/i);
  for (const origin of [SITE_ORIGIN, "http://127.0.0.1:4173"]) {
    const redirects = [];
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    assert.equal(scripts.length, 1);
    runInNewContext(scripts[0][1], {
      URL,
      window: { location: { origin, replace: url => redirects.push(url.href) } },
    }, { timeout: 1000 });
    assert.deepEqual(redirects, [new URL(target, origin).href]);
    const actual = new URL(redirects[0]);
    assert.equal(actual.origin, origin, "Preview mirrors must not force navigation to production");
    assert.equal(actual.search, destination.search);
    assert.equal(actual.hash, destination.hash);
  }
});

test("titles, descriptions, alt text and destinations are escaped without changing their values", () => {
  const text = `Quotes " & apostrophes ' <script>notExecutable()</script> <img src=x onerror=fail()>`;
  const destination = new URL(artifact.destination);
  destination.searchParams.set("name", text);
  destination.hash = "#<script>notExecutable()</script>";
  const input = Object.freeze({ ...artifact, title: text, description: text, imageAlt: text,
    destination: destination.href, state: Object.freeze({ theme: "dark" }) });
  const before = JSON.stringify(input);
  const html = renderCatalogSharePage(input, `${pagePath}?ref=a&other=b`, `${imagePath}?ref=a&other=b`, 'revision&"');
  for (const name of ["og:title", "og:description", "og:image:alt", "twitter:title", "twitter:description", "twitter:image:alt"]) {
    assert.equal(metadata(html, name), text, name);
  }
  assert.match(html, /&quot; &amp; apostrophes &#39; &lt;script&gt;/);
  assert.equal((html.match(/<script>/g) || []).length, 1);
  assert.equal((html.match(/<\/script>/g) || []).length, 1);
  assert.doesNotMatch(html, /<img\b|<script>notExecutable/);
  const target = `${destination.pathname}${destination.search}${destination.hash}`;
  assert.equal(attribute(html.match(/<a\b[^>]*>/)?.[0], "href"), target);
  const redirects = [];
  runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], {
    URL, window: { location: { origin: SITE_ORIGIN, replace: url => redirects.push(url.href) } },
  }, { timeout: 1000 });
  assert.deepEqual(redirects, [destination.href]);
  assert.equal(new URL(metadata(html, "og:image")).searchParams.get("v"), 'revision&"');
  assert.equal(metadata(html, "theme-color"), "#1c1c1c");
  assert.equal(JSON.stringify(input), before);
});

test("catalog share metadata rejects offsite, protocol-relative and disguised offsite paths", () => {
  const invalidPaths = [
    "https://example.com/image.png", "//example.com/image.png", "relative/image.png",
    "/\\example.com/image.png", "/\n/example.com/image.png", "/\t/example.com/image.png",
  ];
  for (const invalid of invalidPaths) {
    assert.throws(() => renderCatalogSharePage(artifact, invalid, imagePath, "revision"), TypeError, `page: ${JSON.stringify(invalid)}`);
    assert.throws(() => renderCatalogSharePage(artifact, pagePath, invalid, "revision"), TypeError, `image: ${JSON.stringify(invalid)}`);
  }
});

test("share pages only redirect into the canonical Desk application root", () => {
  for (const destination of [
    "https://example.com/?card=equities", "//example.com/?card=equities",
    SITE_ORIGIN.replace("https:", "http:") + "/?card=equities",
    `${SITE_ORIGIN}/cards/equities/`, "javascript:alert(1)", "data:text/html,test",
  ]) {
    assert.throws(() => renderCatalogSharePage({ ...artifact, destination }, pagePath, imagePath, "revision"), TypeError, destination);
  }
});

function metadata(html, name) {
  const tags = html.match(/<meta\b[^>]*>/g) || [];
  const matching = tags.filter(tag => attribute(tag, "property") === name || attribute(tag, "name") === name);
  assert.equal(matching.length, 1, `Exactly one ${name} metadata element is required`);
  return attribute(matching[0], "content");
}

function attribute(tag, name) {
  const match = tag?.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? match[1].replaceAll("&quot;", '"').replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&") : null;
}
