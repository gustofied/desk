import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1];
assert(head, "The homepage must have a static document head");
const meta = [...head.matchAll(/<meta\b[^>]*>/gi)].map(([tag]) => attributes(tag));
const links = [...head.matchAll(/<link\b[^>]*>/gi)].map(([tag]) => attributes(tag));

test("the homepage shares a text summary without a default social image", () => {
  const imageTags = meta.filter(tag => [tag.name, tag.property].some(value =>
    /^(?:og:image|twitter:image)(?::|$)/i.test(value || "")));
  assert.deepEqual(imageTags, [], "No image URLs or image-specific social metadata belong on the homepage");
  assert.equal(links.some(link => (link.rel || "").toLowerCase().split(/\s+/).includes("image_src")), false,
    "Legacy image_src links must not restore a default preview image");
  assert.equal(metadata("twitter:card"), "summary");
});

test("the homepage retains its title, descriptions, canonical identity and favicon", () => {
  assert.match(head, /<title>Desk<\/title>/);
  const description = "Explore, compose, monitor, and share compute market views.";
  for (const name of ["og:title", "og:site_name", "twitter:title"]) {
    assert.equal(metadata(name), "Desk", name);
  }
  for (const name of ["og:description", "twitter:description"]) {
    assert.equal(metadata(name), description, name);
  }
  assert.equal(metadata("description"), `The workspace for compute desks. ${description}`);
  assert.equal(metadata("og:type"), "website");
  assert.equal(metadata("og:url"), "https://desk.adamsioud.com/");
  assert.equal(links.find(link => link.rel === "canonical")?.href, "https://desk.adamsioud.com/");
  assert.equal(links.find(link => link.rel === "icon")?.href, "./assets/favicon.svg");
});

function metadata(name) {
  const matches = meta.filter(tag => tag.name === name || tag.property === name);
  assert.equal(matches.length, 1, `Exactly one ${name} tag is required`);
  return matches[0].content;
}

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([^\s=<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)]
    .map(([, name, doubleQuoted, singleQuoted, unquoted]) =>
      [name.toLowerCase(), doubleQuoted ?? singleQuoted ?? unquoted]));
}
