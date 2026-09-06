import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertEquitiesPublicDisplay } from "./equities-runtime.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "_site");
// Local API access does not grant permission to redistribute historical data.
// Stop before copying private provider data into a public deployment artifact.
const equities = JSON.parse(await readFile(join(root, "data/equities.json"), "utf8"));
assertEquitiesPublicDisplay(equities);
const entries = [
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
  "data",
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

await Promise.all(
  entries.map((entry) =>
    cp(join(root, entry), join(output, entry), {
      recursive: true,
      dereference: true,
    }),
  ),
);

console.log(`Built ${output}`);
