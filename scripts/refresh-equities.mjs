import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  EQUITIES_TICKERS,
  createEquitiesSource,
  equitiesDateRange,
  validateEquitiesSource,
} from "../src/equities-data.js";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutput = join(projectRoot, ".cache", "equities-source.json");
const maximumResponseBytes = 1024 * 1024;

export async function fetchEquitiesSource({ token, fetchImpl = fetch, now = new Date() } = {}) {
  if (typeof token !== "string" || !token.trim()) {
    throw new Error("EODHD_API_TOKEN is missing. Supply it through the environment, then rerun the refresh. Existing data was preserved.");
  }
  if (token.trim().toLowerCase() === "demo") {
    throw new Error("EODHD's demo token does not cover the nine equities. Supply your own EODHD_API_TOKEN. Existing data was preserved.");
  }
  const range = equitiesDateRange(now);
  const histories = {};
  // One request per symbol, without retries: a full refresh consumes nine calls.
  // Stop immediately on authentication/quota failure instead of spending more.
  for (const ticker of EQUITIES_TICKERS) {
    const url = new URL(`https://eodhd.com/api/eod/${ticker}.US`);
    url.search = new URLSearchParams({
      api_token: token.trim(), fmt: "json", period: "d", order: "a", ...range,
    }).toString();
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      // Fetch errors can contain the URL and API token; do not pass them through.
      throw new Error(`${ticker}: could not reach EODHD. Existing data was preserved.`);
    }
    if (!response.ok) {
      throw new Error(`${ticker}: EODHD returned HTTP ${response.status}. Check account access and daily quota. Existing data was preserved.`);
    }
    try {
      histories[ticker] = JSON.parse(await readLimitedBody(response));
    } catch {
      // Provider error bodies can echo credentials, so only report a fixed message.
      throw new Error(`${ticker}: EODHD returned an unreadable or oversized history. Existing data was preserved.`);
    }
  }
  return createEquitiesSource(histories, { ...range, retrievedAt: now.toISOString() });
}

async function readLimitedBody(response) {
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body || []) {
    length += chunk.byteLength;
    if (length > maximumResponseBytes) throw new Error("Response too large.");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, length).toString("utf8");
}

export async function installEquitiesSource(snapshot, output = defaultOutput) {
  validateEquitiesSource(snapshot);
  const target = resolve(output);
  await mkdir(dirname(target), { recursive: true });
  const staging = await mkdtemp(join(dirname(target), ".equities-refresh-"));
  try {
    const stagedFile = join(staging, "equities-source.json");
    await writeFile(stagedFile, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await rename(stagedFile, target);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function refreshEquitiesSource({
  token, output = defaultOutput, fetchImpl = fetch, now = new Date(),
} = {}) {
  let cached = null;
  try {
    cached = validateEquitiesSource(JSON.parse(await readFile(output, "utf8")));
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error("The equity cache is invalid. Existing data was preserved.");
  }
  if (cached?.source.status === "ready" &&
      new Date(cached.retrievedAt).toISOString().slice(0, 10) === now.toISOString().slice(0, 10)) {
    return { source: cached, refreshed: false };
  }
  const source = await fetchEquitiesSource({ token, fetchImpl, now });
  await installEquitiesSource(source, output);
  return { source, refreshed: true };
}

async function main(args) {
  if (args.includes("--help")) {
    console.log(`Usage: node scripts/refresh-equities.mjs [--check] [--output FILE]

Fetch the past year of daily adjusted closes for nine US-listed equities.
Set EODHD_API_TOKEN in the environment; never pass a token as a command argument.
The documented free account permits one year of history and 20 calls/day;
a refresh uses nine calls. A valid same-UTC-day cache skips the fetch.
API credentials never enter the generated JSON.

--check        Validate the local source, including a truthful unavailable state.
--output FILE  Source snapshot path (default: .cache/equities-source.json).

Price basis: adjusted_close, adjusted for both splits and dividends.
Use provider data only within your license. Public-display rights are not assumed.
Documentation: https://eodhd.com/financial-apis/api-for-historical-data-and-volumes`);
    return;
  }
  let output = defaultOutput;
  let check = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--check") check = true;
    else if (args[index] === "--output" && args[index + 1] && !args[index + 1].startsWith("--")) {
      output = resolve(args[++index]);
    } else {
      throw new Error("Unrecognized option. Use --help. Tokens must be supplied through the environment.");
    }
  }
  if (check) {
    let text;
    try {
      text = await readFile(output, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT" || output !== defaultOutput) throw error;
      text = await readFile(join(projectRoot, "data", "equities-source.json"), "utf8");
    }
    const source = validateEquitiesSource(JSON.parse(text));
    console.log(`Validated nine equities: ${source.source.status}${source.asOf ? ` through ${new Date(source.asOf * 1000).toISOString().slice(0, 10)}` : " (no historical prices configured)"}.`);
    return;
  }
  const { source, refreshed } = await refreshEquitiesSource({ token: process.env.EODHD_API_TOKEN, output });
  console.log(`${refreshed ? "Refreshed" : "Reused today's cache for"} nine equities through ${new Date(source.asOf * 1000).toISOString().slice(0, 10)}.${refreshed ? " Public-display rights remain unconfirmed." : " No API calls used."}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
