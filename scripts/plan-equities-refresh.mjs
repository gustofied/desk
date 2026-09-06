import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateEquitiesSource } from "../src/equities-data.js";

// Pushes, manual deployments and reruns can reuse observations but never spend
// provider quota. Only the first attempt of the daily scheduled run may fetch.
export function planEquitiesRefresh({
  publicDisplayRights, eventName, runAttempt, cachedSource = null, now = new Date(),
}) {
  const day = now.toISOString().slice(0, 10);
  if (publicDisplayRights !== "confirmed") {
    return { refresh: false, message: "Equities public display is disabled; deploy the unavailable placeholder." };
  }
  if (cachedSource !== null) {
    validateEquitiesSource(cachedSource);
    if (cachedSource.source.status !== "ready") {
      throw new Error("The Actions equity cache must contain a complete observed snapshot.");
    }
    const retrievedDay = new Date(cachedSource.retrievedAt).toISOString().slice(0, 10);
    if (retrievedDay > day) throw new Error("The Actions equity cache has a future retrieval date.");
    if (retrievedDay === day) {
      return { refresh: false, message: `Reusing the ${day} equity cache; no API calls.` };
    }
  }
  if (eventName === "schedule" && String(runAttempt) === "1") {
    return { refresh: true, message: "Daily equity refresh: at most nine requests, without retries." };
  }
  if (!cachedSource) {
    throw new Error("No equity cache is available. Wait for the next daily scheduled refresh; this deployment will not fetch or replace the existing site.");
  }
  const retrievedDay = new Date(cachedSource.retrievedAt).toISOString().slice(0, 10);
  const asOfDay = new Date(cachedSource.asOf * 1000).toISOString().slice(0, 10);
  return {
    refresh: false,
    warning: true,
    message: `Reusing equities retrieved ${retrievedDay}, with closes through ${asOfDay}; no API calls or freshness claim.`,
  };
}

export function assertEquitiesCacheDay(source, day) {
  validateEquitiesSource(source);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || source.source.status !== "ready" ||
      new Date(source.retrievedAt).toISOString().slice(0, 10) !== day) {
    throw new Error("Only an observed snapshot retrieved on the cache key's UTC date may be saved.");
  }
}

async function main(args) {
  if (args.length) {
    if (args.length !== 2 || args[0] !== "--verify-cache-day") throw new Error("Invalid arguments.");
    const source = JSON.parse(await readFile(".cache/equities-source.json", "utf8"));
    assertEquitiesCacheDay(source, args[1]);
    console.log(`Validated equity cache identity for ${args[1]}.`);
    return;
  }
  let cachedSource = null;
  if (process.env.EQUITIES_PUBLIC_DISPLAY_RIGHTS === "confirmed") {
    let text;
    try {
      text = await readFile(".cache/equities-source.json", "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (text !== undefined) cachedSource = JSON.parse(text);
  }
  const plan = planEquitiesRefresh({
    publicDisplayRights: process.env.EQUITIES_PUBLIC_DISPLAY_RIGHTS,
    eventName: process.env.GITHUB_EVENT_NAME,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    cachedSource,
  });
  console.log(`${plan.warning ? "::warning::" : ""}${plan.message}`);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `refresh=${plan.refresh}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(() => {
    // Do not print raw file contents or parser exceptions from a damaged cache.
    console.error("Equity refresh planning failed: a valid observed cache is required for non-scheduled deployments. Check cache validity or wait for the next daily schedule. The existing site was not replaced.");
    process.exitCode = 1;
  });
}
