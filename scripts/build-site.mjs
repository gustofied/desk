import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CARD_REGISTRY } from "../src/card-registry.js";
import { assertEquitiesPublicDisplay } from "./equities-runtime.mjs";

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const siteEntries = [
  ".nojekyll",
  "CNAME",
  "index.html",
  "desk.js",
  "robots.txt",
  "sitemap.xml",
  "styles",
  "assets",
  "cards",
  "cli",
];

// Publish the registered runtime and Desk API catalog, not arbitrary files left
// under data/. Raw inputs and retired provider exports are never site assets.
const dataEntries = [...new Set([
  "data/manifest.json",
  ...CARD_REGISTRY.flatMap(card => [card.dataFile, card.dataTable?.file]).filter(Boolean),
])].filter(file => file !== "data/v1/equity-prices.json" && !file.endsWith("-source.json"));

export async function buildSite({ projectRoot = defaultRoot } = {}) {
  const output = join(projectRoot, "_site");
  // Validate before replacing an existing deployment. Only explicit demo equity
  // history is publishable; a stale local provider runtime must fail closed.
  const equities = JSON.parse(await readFile(join(projectRoot, "data/equities.json"), "utf8"));
  assertEquitiesPublicDisplay(equities);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await Promise.all([...siteEntries, ...dataEntries].map(async entry => {
    const destination = join(output, entry);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(projectRoot, entry), destination, { recursive: true, dereference: true });
  }));
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(`Built ${await buildSite()}`);
}
