import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CARD_REGISTRY } from "../src/card-registry.js";

export const PUBLISHED_PREVIEW_ARCHIVE_BRANCH = "codex/published-previews";
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publishedRoots = CARD_REGISTRY.flatMap(card => [
  `${card.previewImageDir}/published/`, `${card.previewPageDir}/published/`,
]);

export function isPublishedPreviewPath(file) {
  if (typeof file !== "string" || !file || file.includes("\\")) return false;
  const parts = file.split("/");
  if (parts.some(part => !/^[A-Za-z0-9_%~.-]+$/.test(part) || part === "." || part === "..")) return false;
  // Encoded path separators and dot segments are unsafe in public URLs too.
  try {
    if (parts.some(part => {
      const decoded = decodeURIComponent(part);
      return decoded === "." || decoded === ".." || /[\\/\u0000-\u0020\u007f]/.test(decoded);
    })) return false;
  } catch { return false; }
  return CARD_REGISTRY.some(card =>
    (file.startsWith(`${card.previewImageDir}/published/`) && file.endsWith(".png")) ||
    (file.startsWith(`${card.previewPageDir}/published/`) && file.endsWith("/index.html")));
}

export function immutablePreviewPath(basePath, pngBytes) {
  if (typeof basePath !== "string" || !basePath.startsWith("/") ||
      !isPublishedPreviewPath(basePath.slice(1)) || !basePath.endsWith(".png")) {
    throw new Error("An absolute published PNG path is required");
  }
  const digest = createHash("sha256").update(pngBytes).digest("hex").slice(0, 16);
  return basePath.replace(/\.png$/, `--${digest}.png`);
}

async function statIfPresent(path) {
  try { return await lstat(path); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function checkDirectories(root, relativeDirectory = "") {
  let path = root;
  for (const part of ["", ...relativeDirectory.split("/").filter(Boolean)]) {
    path = join(path, part);
    const info = await statIfPresent(path);
    if (info && (!info.isDirectory() || info.isSymbolicLink())) {
      throw new Error(`Preview directory must not be a symlink or file: ${path}`);
    }
  }
}

async function publishedFiles(root, archive) {
  const files = new Map();
  await checkDirectories(root);
  const walk = async relativePath => {
    const path = join(root, relativePath);
    const info = await statIfPresent(path);
    if (!info) return;
    if (info.isSymbolicLink()) throw new Error(`Refusing preview symlink: ${relativePath}`);
    if (info.isDirectory()) {
      if (archive && relativePath === ".git") return;
      for (const entry of await readdir(path)) await walk(relativePath ? `${relativePath}/${entry}` : entry);
    } else {
      if (!info.isFile() || !isPublishedPreviewPath(relativePath)) {
        throw new Error(`Refusing non-published archive asset: ${relativePath}`);
      }
      files.set(relativePath, path);
    }
  };
  if (archive) await walk("");
  else for (const prefix of publishedRoots) {
    await checkDirectories(root, prefix.slice(0, -1));
    await walk(prefix.slice(0, -1));
  }
  return files;
}

// Both trees are validated before the first copy. Current share pages may change;
// a published PNG pathname is immutable, including across fresh CI checkouts.
export async function mergePublishedPreviews({ siteRoot, archiveRoot }) {
  siteRoot = resolve(siteRoot);
  archiveRoot = resolve(archiveRoot);
  if (siteRoot === archiveRoot || siteRoot.startsWith(`${archiveRoot}/`) || archiveRoot.startsWith(`${siteRoot}/`)) {
    throw new Error("The deployment and preview archive must be separate directories");
  }
  const [site, archive] = await Promise.all([publishedFiles(siteRoot, false), publishedFiles(archiveRoot, true)]);
  for (const [file, archived] of archive) {
    if (!site.has(file) || !file.endsWith(".png")) continue;
    const [oldBytes, newBytes] = await Promise.all([readFile(archived), readFile(site.get(file))]);
    if (!oldBytes.equals(newBytes)) {
      throw new Error(`Published PNG changed at an immutable path: ${file}. Use a new preview version or content hash.`);
    }
  }
  let restored = 0;
  let added = 0;
  let updated = 0;
  const copy = async (source, root, file, exclusive) => {
    await checkDirectories(root, dirname(file));
    await mkdir(dirname(join(root, file)), { recursive: true });
    const existing = await statIfPresent(join(root, file));
    if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error(`Unsafe preview destination: ${file}`);
    await copyFile(source, join(root, file), exclusive ? constants.COPYFILE_EXCL : 0);
  };
  for (const [file, archived] of archive) {
    if (site.has(file)) continue;
    await copy(archived, siteRoot, file, true);
    restored += 1;
  }
  for (const [file, current] of site) {
    if (archive.has(file) && file.endsWith(".png")) continue;
    await copy(current, archiveRoot, file, !archive.has(file));
    if (archive.has(file)) updated += 1;
    else added += 1;
  }
  return { restored, added, updated, files: new Set([...site.keys(), ...archive.keys()]).size };
}

export async function syncPublishedPreviewArchive({
  siteRoot = join(projectRoot, "_site"),
  bootstrap = process.env.DESK_PREVIEW_ARCHIVE_BOOTSTRAP === "true",
} = {}) {
  const repository = process.env.GITHUB_REPOSITORY;
  const server = new URL(process.env.GITHUB_SERVER_URL || "https://github.com");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || "") ||
      server.protocol !== "https:" || server.username || server.password || server.pathname !== "/" || server.search || server.hash) {
    throw new Error("A valid HTTPS GitHub server and GITHUB_REPOSITORY are required");
  }
  if (!process.env.GH_TOKEN) throw new Error("GH_TOKEN is required to persist published previews");
  const remote = `${server.origin}/${repository}.git`;
  const scratch = await mkdtemp(join(tmpdir(), "desk-published-previews-"));
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: `http.${remote}.extraheader`,
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${process.env.GH_TOKEN}`).toString("base64")}`,
    GIT_CONFIG_KEY_1: "core.hooksPath",
    GIT_CONFIG_VALUE_1: "/dev/null",
  };
  const git = args => {
    try { return execFileSync("git", args, { cwd: scratch, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 4 * 1024 * 1024 }); }
    catch { throw new Error(`Preview archive git ${args[0]} failed; no deployment was uploaded.`); }
  };
  try {
    git(["init", "--quiet", `--initial-branch=${PUBLISHED_PREVIEW_ARCHIVE_BRANCH}`]);
    git(["remote", "add", "origin", remote]);
    const ref = `refs/heads/${PUBLISHED_PREVIEW_ARCHIVE_BRANCH}`;
    const exists = git(["ls-remote", "--heads", "origin", ref]).trim();
    if (exists) {
      git(["fetch", "--quiet", "--depth=1", "origin", ref]);
      git(["checkout", "--quiet", "-B", PUBLISHED_PREVIEW_ARCHIVE_BRANCH, "FETCH_HEAD"]);
    } else if (!bootstrap) {
      throw new Error(`Preview archive branch ${PUBLISHED_PREVIEW_ARCHIVE_BRANCH} is missing. Seed it or explicitly bootstrap once before deploying.`);
    }
    const result = await mergePublishedPreviews({ siteRoot, archiveRoot: scratch });
    git(["add", "--all", "--", "."]);
    if (git(["diff", "--cached", "--name-only"]).trim()) {
      git(["-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com", "commit", "--quiet", "-m", "Retain published Desk previews"]);
      // A competing archive update fails this ordinary push; history is never replaced.
      git(["push", "--quiet", "origin", `HEAD:${ref}`]);
    }
    console.log(`Published preview archive: ${result.files} files, ${result.restored} restored, ${result.added} added.`);
    return result;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => arg !== "--bootstrap")) {
    throw new Error("Usage: node scripts/published-preview-archive.mjs [--bootstrap]");
  }
  await syncPublishedPreviewArchive(args.includes("--bootstrap") ? { bootstrap: true } : {});
}
