import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createDemoEquitiesSource } from "../src/equities-data.js";

export { createDemoEquitiesSource } from "../src/equities-data.js";

async function main(args) {
  if (args.length > 1 || (args.length && args[0] !== "--check")) {
    throw new Error("Usage: node scripts/generate-equities-demo.mjs [--check]");
  }
  const output = new URL("../data/equities-source.json", import.meta.url);
  const source = createDemoEquitiesSource();
  if (args[0] === "--check") {
    const current = JSON.parse(await readFile(output, "utf8"));
    if (JSON.stringify(current) !== JSON.stringify(source)) throw new Error("The bundled equity demo differs from its deterministic generator.");
    console.log("Validated the bundled nine-stock synthetic demo.");
  } else {
    await writeFile(output, JSON.stringify(source, null, 2) + "\n", "utf8");
    console.log("Generated nine synthetic weekday histories through " + source.sampleWindow.to + ".");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
