import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "_site");
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
