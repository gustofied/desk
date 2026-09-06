import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cli = fileURLToPath(new URL("../cli/desk", import.meta.url));
const DAY_MS = 86400000;
const end = Date.parse("2026-09-10T12:00:00Z");
const offsets = [0, 1, 2, 7, 8, 90, 91, 365, 366];
const locations = ["PJM-WEST", "PJM-DOMINION", "ERCOT-NORTH"];
const rows = locations.flatMap(instrument => offsets.map(offset => ({
  instrument,
  observed_at: new Date(end - offset * DAY_MS).toISOString(),
  real_time_price_usd_mwh: 50,
  day_ahead_price_usd_mwh: 45,
  basis_usd_mwh: 5,
})));

function run(args, datasetRows = rows) {
  // Exercise the real executable with a deterministic in-memory fetch response.
  // No server, provider access or filesystem output is needed for --stdout.
  const mock = `globalThis.fetch = async url => {
    if (!String(url).startsWith("https://desk.adamsioud.com/data/v1/")) throw new Error("Unexpected endpoint");
    return Response.json(${JSON.stringify(datasetRows)});
  };`;
  return spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(mock)}`, cli, ...args], {
    encoding: "utf8", timeout: 10000, env: {},
  });
}

test("power CLI accepts all supported locations and filters 1d, 7d, 90d, 1y and all inclusively", () => {
  for (const location of locations) for (const [range, days] of [["1d", 1], ["7d", 7], ["90d", 90], ["1y", 365], ["all", Infinity]]) {
    const result = run(["data", "sync", "power-prices", `--location=${location.toLowerCase()}`, `--range=${range}`, "--stdout"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), rows.filter(row => row.instrument === location && end - Date.parse(row.observed_at) <= days * DAY_MS));
  }
});

test("power CLI uses the selected location's clock and retains legacy West default behavior", () => {
  const newer = { ...rows[0], instrument: "ERCOT-NORTH", observed_at: new Date(end + 40 * DAY_MS).toISOString() };
  const result = run(["data", "sync", "power-prices", "--location=PJM-DOMINION", "--range=7d", "--stdout"], [...rows, newer]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).length, 4);
  const legacy = run(["data", "sync", "power-prices", "--stdout"]);
  assert.equal(legacy.status, 0, legacy.stderr);
  assert.deepEqual(JSON.parse(legacy.stdout), rows.filter(row => row.instrument === "PJM-WEST"));
});

test("new power ranges do not broaden compute CLI range validation or accept invalid power values", () => {
  for (const range of ["90d", "1y"]) {
    const result = run(["data", "sync", "compute-prices", `--range=${range}`, "--stdout"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--range must be 1d, 7d, or all/);
  }
  const invalid = run(["data", "sync", "power-prices", "--range=30d", "--stdout"]);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /1d, 7d, 90d, 1y, or all/);
  const badLocation = run(["data", "sync", "power-prices", "--location=../private", "--stdout"]);
  assert.notEqual(badLocation.status, 0);
  assert.match(badLocation.stderr, /market location id/);
});

test("CLI help documents extended power ranges and both new locations without changing compute help", () => {
  const result = run(["--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /power-prices\s+--location=PJM-DOMINION --range=1d\|7d\|90d\|1y\|all/);
  assert.match(result.stdout, /Locations: PJM-DOMINION, ERCOT-NORTH, PJM-WEST/);
  assert.match(result.stdout, /compute-prices\s+--series=H200,TPI --range=1d\|7d\|all/);
});
