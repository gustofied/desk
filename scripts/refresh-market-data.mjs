import { isDeepStrictEqual } from "node:util";
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  fileURLToPath,
  pathToFileURL,
} from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotRoot = join(
  root,
  "api",
  "dashboard-snapshots",
  "gpu-benchmark",
);
const defaultSourceBase =
  "https://www.adamsioud.com/api/dashboard-snapshots";
const maximumSnapshotBytes = 8 * 1024 * 1024;
const expectedSnapshots = [
  { family: "H100", file: "h100.json" },
  { family: "H200", file: "h200.json" },
  { family: "B200", file: "b200.json" },
  { family: "B300", file: "b300.json" },
];

const options = parseOptions(process.argv.slice(2));
const localSnapshots = await readLocalSnapshots();
const localSet = validateSnapshotSet(localSnapshots, "local snapshots", {
  maxAgeHours: null,
});

if (options.check) {
  console.log(
    `Validated ${localSnapshots.length} local GPU snapshots from ${localSet.runId}.`,
  );
  process.exit(0);
}

const sourceBase = normalizeSourceBase(options.source);
const incomingSnapshots = await Promise.all(
  expectedSnapshots.map((expected) => readIncomingSnapshot(sourceBase, expected)),
);
const incomingSet = validateSnapshotSet(
  incomingSnapshots,
  "incoming snapshots",
  options,
);
rejectRegression(localSnapshots, localSet, incomingSnapshots, incomingSet);

const changed = incomingSnapshots.filter((incoming, index) =>
  !isDeepStrictEqual(incoming.payload, localSnapshots[index].payload),
);

if (!changed.length) {
  console.log(
    `GPU snapshots are already current at ${incomingSet.runId} ` +
      `(${incomingSet.observedAt}).`,
  );
  process.exit(0);
}

if (incomingSet.runId === localSet.runId) {
  throw new Error(
    `Refusing to rewrite source run ${incomingSet.runId}; ` +
      "publish a new upstream run instead.",
  );
}

await installSnapshotSet(incomingSnapshots, localSnapshots);
console.log(
  `Installed ${incomingSnapshots.length} GPU snapshots from ${incomingSet.runId} ` +
    `(${incomingSet.observedAt}).`,
);

async function readLocalSnapshots() {
  return Promise.all(
    expectedSnapshots.map(async (expected) => {
      const target = join(snapshotRoot, expected.file);
      const text = await readFile(target, "utf8");
      return {
        expected,
        payload: parsePayload(text, target),
        target,
        text,
      };
    }),
  );
}

async function readIncomingSnapshot(sourceBase, expected) {
  const source = new URL(`gpu-benchmark/${expected.file}`, sourceBase);
  let text;

  if (source.protocol === "file:") {
    text = await readFile(fileURLToPath(source), "utf8");
  } else {
    text = await fetchText(source);
  }

  if (Buffer.byteLength(text, "utf8") > maximumSnapshotBytes) {
    throw new Error(
      `${safeSourceLabel(source)} exceeds the ${maximumSnapshotBytes}-byte limit`,
    );
  }

  return {
    expected,
    payload: parsePayload(text, safeSourceLabel(source)),
    source,
    text: text.endsWith("\n") ? text : `${text}\n`,
  };
}

async function fetchText(source) {
  const attempts = options.attempts;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const headers = {
        Accept: "application/json",
        "Cache-Control": "no-cache",
        "User-Agent": "desk-market-refresh/1",
      };
      if (options.token) headers.Authorization = `Bearer ${options.token}`;

      const response = await fetch(source, {
        cache: "no-store",
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      const finalUrl = new URL(response.url);
      assertSafeRemote(finalUrl);

      if (!response.ok) {
        const error = new Error(
          `${safeSourceLabel(source)} returned HTTP ${response.status}`,
        );
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }

      const contentLength = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(contentLength) &&
        contentLength > maximumSnapshotBytes
      ) {
        const error = new Error(
          `${safeSourceLabel(source)} advertises ${contentLength} bytes; ` +
            `limit is ${maximumSnapshotBytes}`,
        );
        error.retryable = false;
        throw error;
      }
      return await readLimitedBody(response, source);
    } catch (error) {
      const shouldRetry =
        attempt < attempts &&
        error?.retryable !== false &&
        error?.name !== "SyntaxError";
      if (!shouldRetry) {
        throw new Error(
          `Could not read ${safeSourceLabel(source)} after ${attempt} attempt(s): ` +
            `${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
      await delay(250 * 2 ** (attempt - 1));
    }
  }
  throw new Error(`Could not read ${safeSourceLabel(source)}`);
}

async function readLimitedBody(response, source) {
  const chunks = [];
  let byteLength = 0;
  for await (const chunk of response.body || []) {
    byteLength += chunk.byteLength;
    if (byteLength > maximumSnapshotBytes) {
      const error = new Error(
        `${safeSourceLabel(source)} exceeds the ${maximumSnapshotBytes}-byte limit`,
      );
      error.retryable = false;
      throw error;
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, byteLength).toString("utf8");
}

function validateSnapshotSet(snapshots, label, { maxAgeHours }) {
  const metadata = snapshots.map((snapshot) =>
    validateSnapshot(snapshot.payload, snapshot.expected, label),
  );
  const runIds = new Set(metadata.map((item) => item.runId));
  const manifestTimes = new Set(metadata.map((item) => item.manifestObservedAt));
  if (runIds.size !== 1) {
    throw new Error(`${label} mix multiple source runs: ${[...runIds].join(", ")}`);
  }
  if (manifestTimes.size !== 1) {
    throw new Error(`${label} do not share one observation time`);
  }

  const observedMs = metadata[0].manifestObservedMs;
  const futureSkewMs = observedMs - Date.now();
  if (futureSkewMs > 10 * 60 * 1000) {
    throw new Error(`${label} are dated more than 10 minutes in the future`);
  }
  if (maxAgeHours !== null) {
    const ageHours = (Date.now() - observedMs) / (60 * 60 * 1000);
    if (ageHours > maxAgeHours) {
      throw new Error(
        `${label} are ${ageHours.toFixed(2)} hours old; ` +
          `limit is ${maxAgeHours} hours`,
      );
    }
  }

  return {
    observedAt: metadata[0].manifestObservedAt,
    observedMs,
    runId: metadata[0].runId,
  };
}

function validateSnapshot(payload, expected, label) {
  const context = `${label}/${expected.file}`;
  requireObject(payload, context);
  requireEqual(payload.contract, "compute_bazaar_card", `${context}.contract`);
  requireEqual(payload.card_type, "gpu_benchmark", `${context}.card_type`);
  requireEqual(
    payload.card_id,
    `gpu-benchmark:${expected.family.toLowerCase()}`,
    `${context}.card_id`,
  );
  requireEqual(payload.unit, "USD per GPU-hour", `${context}.unit`);
  requireEqual(payload.data?.family_id, expected.family, `${context}.data.family_id`);
  if (!new Set(["live", "observed", "success"]).has(payload.status)) {
    throw new Error(`${context}.status is not publishable`);
  }

  const manifest = requireObject(payload.manifest, `${context}.manifest`);
  requireEqual(
    manifest.contract,
    "compute_bazaar_gold_market",
    `${context}.manifest.contract`,
  );
  const runId = requireString(manifest.run_id, `${context}.manifest.run_id`);
  if (!/^gold-market-\d{8}T\d{6}-[0-9a-f]{8}$/.test(runId)) {
    throw new Error(`${context}.manifest.run_id is malformed`);
  }
  const manifestObservedAt = requireString(
    manifest.observed_at,
    `${context}.manifest.observed_at`,
  );
  const manifestObservedMs = parseTimestamp(
    manifestObservedAt,
    `${context}.manifest.observed_at`,
  );
  parseTimestamp(payload.as_of, `${context}.as_of`);

  const current = requireObject(payload.data?.current, `${context}.data.current`);
  requireEqual(
    current.benchmark_family_id,
    expected.family,
    `${context}.data.current.benchmark_family_id`,
  );
  requireFiniteNumber(
    current.benchmark_usd_gpu_hr,
    `${context}.data.current.benchmark_usd_gpu_hr`,
  );

  if (!Array.isArray(payload.series) || !payload.series.length) {
    throw new Error(`${context}.series must contain observations`);
  }
  let previousTimestamp = -Infinity;
  let firstTimestamp = NaN;
  for (const [index, row] of payload.series.entries()) {
    requireObject(row, `${context}.series[${index}]`);
    const observedAt = parseTimestamp(
      row.observed_at,
      `${context}.series[${index}].observed_at`,
    );
    if (observedAt <= previousTimestamp) {
      throw new Error(`${context}.series timestamps must be strictly increasing`);
    }
    if (index === 0) firstTimestamp = observedAt;
    previousTimestamp = observedAt;

    const value = requireFiniteNumber(row.value, `${context}.series[${index}].value`);
    const lower = requireFiniteNumber(row.lower, `${context}.series[${index}].lower`);
    const upper = requireFiniteNumber(row.upper, `${context}.series[${index}].upper`);
    if (lower < 0 || value < 0 || upper < 0 || lower > value || value > upper) {
      throw new Error(`${context}.series[${index}] has an invalid price band`);
    }
    for (const field of ["offer_count", "provider_count"]) {
      if (
        row[field] !== null &&
        row[field] !== undefined &&
        (!Number.isInteger(row[field]) || row[field] < 0)
      ) {
        throw new Error(`${context}.series[${index}].${field} is invalid`);
      }
    }
  }

  const coverage = requireObject(payload.coverage, `${context}.coverage`);
  if (coverage.observation_count !== payload.series.length) {
    throw new Error(`${context}.coverage.observation_count does not match series`);
  }
  const window = requireObject(
    payload.observation_window,
    `${context}.observation_window`,
  );
  const windowStart = parseTimestamp(
    window.started_at,
    `${context}.observation_window.started_at`,
  );
  const windowEnd = parseTimestamp(
    window.ended_at,
    `${context}.observation_window.ended_at`,
  );
  if (
    Math.abs(windowStart - firstTimestamp) > 1000 ||
    Math.abs(windowEnd - previousTimestamp) > 1000
  ) {
    throw new Error(`${context}.observation_window does not match series bounds`);
  }
  if (Math.abs(manifestObservedMs - previousTimestamp) > 10 * 60 * 1000) {
    throw new Error(`${context}.series does not match its manifest time`);
  }

  return {
    latestObservationMs: previousTimestamp,
    manifestObservedAt,
    manifestObservedMs,
    runId,
  };
}

function rejectRegression(current, currentSet, incoming, incomingSet) {
  if (incomingSet.observedMs < currentSet.observedMs) {
    throw new Error(
      `Incoming run ${incomingSet.runId} predates local run ${currentSet.runId}`,
    );
  }
  for (let index = 0; index < incoming.length; index += 1) {
    const family = incoming[index].expected.family;
    const currentLatest = parseTimestamp(
      current[index].payload.series.at(-1)?.observed_at,
      `local ${family} latest observation`,
    );
    const incomingLatest = parseTimestamp(
      incoming[index].payload.series.at(-1)?.observed_at,
      `incoming ${family} latest observation`,
    );
    if (incomingLatest < currentLatest) {
      throw new Error(`Incoming ${family} history is older than the local snapshot`);
    }
  }
}

async function installSnapshotSet(incoming, current) {
  const stagingRoot = join(
    root,
    ".cache",
    "market-refresh",
    `${process.pid}-${Date.now()}`,
  );
  await mkdir(stagingRoot, { recursive: true });

  try {
    await Promise.all(
      incoming.map((snapshot) =>
        writeFile(join(stagingRoot, snapshot.expected.file), snapshot.text, "utf8"),
      ),
    );
    await Promise.all(
      incoming.map((snapshot) =>
        readFile(join(stagingRoot, snapshot.expected.file), "utf8").then((text) => {
          const payload = parsePayload(text, `staged ${snapshot.expected.file}`);
          validateSnapshot(payload, snapshot.expected, "staged snapshots");
        }),
      ),
    );

    try {
      for (const snapshot of incoming) {
        const target = join(snapshotRoot, snapshot.expected.file);
        await rename(join(stagingRoot, snapshot.expected.file), target);
      }
    } catch (error) {
      await Promise.all(
        current.map((snapshot) => writeFile(snapshot.target, snapshot.text, "utf8")),
      );
      throw new Error("Snapshot installation failed; restored the previous set", {
        cause: error,
      });
    }
  } finally {
    await rm(stagingRoot, { force: true, recursive: true });
  }
}

function normalizeSourceBase(value) {
  const source = value || defaultSourceBase;
  let base;
  try {
    base = new URL(source);
  } catch {
    const localPath = resolve(root, source);
    base = pathToFileURL(`${localPath}/`);
  }
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  if (base.username || base.password) {
    throw new Error("Snapshot source URLs must not contain credentials");
  }
  if (base.protocol !== "file:") assertSafeRemote(base);
  return base;
}

function assertSafeRemote(url) {
  if (url.protocol === "https:") return;
  const loopback = new Set(["127.0.0.1", "::1", "localhost"]);
  if (url.protocol === "http:" && loopback.has(url.hostname)) return;
  throw new Error("Remote snapshot sources must use HTTPS");
}

function safeSourceLabel(url) {
  return `${url.origin}${url.pathname}`;
}

function parsePayload(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requireEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} must be ${JSON.stringify(expected)}`);
  }
}

function requireFiniteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function parseTimestamp(value, label) {
  const timestamp = requireString(value, label);
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(timestamp)) {
    throw new Error(`${label} must include a timezone`);
  }
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} is invalid`);
  return milliseconds;
}

function parseOptions(args) {
  const parsed = {
    attempts: numberOption(process.env.DESK_SNAPSHOT_FETCH_ATTEMPTS, 3, {
      integer: true,
      label: "DESK_SNAPSHOT_FETCH_ATTEMPTS",
      maximum: 5,
      minimum: 1,
    }),
    check: false,
    maxAgeHours: optionalNumber(process.env.DESK_MAX_SNAPSHOT_AGE_HOURS, {
      label: "DESK_MAX_SNAPSHOT_AGE_HOURS",
      minimum: 0,
    }),
    source: process.env.DESK_SNAPSHOT_BASE_URL || defaultSourceBase,
    sourceExplicit: Boolean(process.env.DESK_SNAPSHOT_BASE_URL),
    timeoutMs: numberOption(process.env.DESK_SNAPSHOT_TIMEOUT_MS, 20_000, {
      integer: true,
      label: "DESK_SNAPSHOT_TIMEOUT_MS",
      maximum: 120_000,
      minimum: 1000,
    }),
    token: process.env.DESK_SNAPSHOT_TOKEN || "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--check") {
      parsed.check = true;
    } else if (argument === "--help") {
      printHelp();
      process.exit(0);
    } else if (argument === "--source") {
      parsed.source = requireArgument(args[++index], "--source");
      parsed.sourceExplicit = true;
    } else if (argument.startsWith("--source=")) {
      parsed.source = requireArgument(
        argument.slice("--source=".length),
        "--source",
      );
      parsed.sourceExplicit = true;
    } else if (argument === "--max-age-hours") {
      parsed.maxAgeHours = numberOption(
        requireArgument(args[++index], "--max-age-hours"),
        null,
        { label: "--max-age-hours", minimum: 0 },
      );
    } else if (argument.startsWith("--max-age-hours=")) {
      parsed.maxAgeHours = numberOption(
        argument.slice("--max-age-hours=".length),
        null,
        { label: "--max-age-hours", minimum: 0 },
      );
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  if (parsed.token && !parsed.sourceExplicit) {
    throw new Error(
      "DESK_SNAPSHOT_TOKEN requires an explicit DESK_SNAPSHOT_BASE_URL or --source",
    );
  }
  return parsed;
}

function optionalNumber(value, settings) {
  if (value === undefined || value === null || value === "") return null;
  return numberOption(value, null, settings);
}

function numberOption(value, fallback, settings) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (
    !Number.isFinite(number) ||
    (settings.integer && !Number.isInteger(number)) ||
    number < settings.minimum ||
    (settings.maximum !== undefined && number > settings.maximum)
  ) {
    throw new Error(`${settings.label} has an invalid value`);
  }
  return number;
}

function requireArgument(value, option) {
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function printHelp() {
  console.log(`Usage: node scripts/refresh-market-data.mjs [options]

Options:
  --check                 Validate the checked-in snapshots without fetching
  --source URL_OR_PATH    Override the snapshot base URL or local fixture path
  --max-age-hours HOURS   Reject an upstream run older than this limit
  --help                  Show this help

Environment:
  DESK_SNAPSHOT_BASE_URL
  DESK_SNAPSHOT_TOKEN
  DESK_MAX_SNAPSHOT_AGE_HOURS
  DESK_SNAPSHOT_TIMEOUT_MS
  DESK_SNAPSHOT_FETCH_ATTEMPTS`);
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
