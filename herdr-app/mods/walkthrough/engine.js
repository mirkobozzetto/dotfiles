// Reading the diff, the cache and the background job, against this machine.
//
// ~/.herdr/walkthrough/
//   entries/<key>.json     a finished walkthrough, named by everything that decides it
//   pointers/<place>.json  the one shown last for a repository and source
//   jobs/<place>/          a generation in progress (run.sh, prompt, answer)
//   preferences.md         optional: the reader's own wishes, added to every prompt

import { exec, home, readTextFile, writeTextFile } from "herdr";
import { loadSections, sourceKey, describe, git, worthReading } from "./lib/sources.js";
import { buildDigest } from "./lib/digest.js";
import { buildPrompt } from "./lib/prompt.js";
import { SCHEMA, normalize, VERSION } from "./lib/walkthrough.js";
import { cacheKey, codeKey, placeKey, deadline, MAX_PROMPT_CHARS } from "./lib/cache.js";
import { jobScript, readOutcome, isRunCommand } from "./lib/job.js";

const MAX_ENTRIES = 200;
export const dataDir = () => `${home()}/.herdr/walkthrough`;
const entryPath = (key) => `${dataDir()}/entries/${key}.json`;
const pointerPath = (place) => `${dataDir()}/pointers/${place}.json`;
const jobDir = (place) => `${dataDir()}/jobs/${place}`;

async function readJson(path) {
  try {
    const text = await readTextFile(path);
    return text ? JSON.parse(text) : null;
  } catch { return null; }
}

/** Replaces a file whatever it holds now (writeTextFile wants the old text). */
async function write(path, text) {
  const old = await readTextFile(path).catch(() => null);
  await writeTextFile(path, text, old);
}

export async function ensureDirs() {
  const d = dataDir();
  await exec("mkdir", ["-p", `${d}/entries`, `${d}/pointers`, `${d}/jobs`]);
}

/** Whether Claude Code's `claude` can be started: its version, or null. */
export async function claudeVersion() {
  try {
    const r = await exec("claude", ["--version"]);
    return r.code === 0 ? r.stdout.trim() : null;
  } catch { return null; }
}

/**
 * The diff of a source as it is now, parsed, with what the model would read.
 * @returns {Promise<any>}
 */
export async function readDiff(repo, source) {
  const { sections, unread } = await loadSections(exec, repo.top, source);
  const digest = buildDigest(sections);
  for (const u of unread) digest.files.push({ path: u.path, oldPath: null, status: "added", binary: false, scope: "unread", hunks: [], generated: false, unread: u.why });
  return { ...digest, unread, sk: sourceKey(source), what: describe(source, repo) };
}

/** The key the walkthrough of this diff would have, in this model and language, under these preferences. */
export const keyFor = (repo, diff, model, language, preferences = "") =>
  cacheKey({ top: repo.top, source: diff.sk, model, language, preferences, files: diff.files });

/** The reader's own wishes for every walkthrough, or "". */
export const readPreferences = async () => (await readTextFile(`${dataDir()}/preferences.md`).catch(() => null)) ?? "";

/**
 * Whether paths a folder watch reported can change a diff: anything but
 * node_modules, git's own bookkeeping (its index, HEAD and refs do count) and
 * files git ignores. A build or an install would otherwise re-read the diff
 * every second.
 */
export async function matters(top, paths, gitDir) {
  const candidates = worthReading(top, paths, gitDir);
  if (candidates === true) return true;
  if (!candidates.length) return false;
  const sample = candidates.slice(0, 200);
  const ignored = await git(exec, top, ["check-ignore", "--", ...sample]);
  // 1: none of them is ignored.
  if (ignored.code === 1) return true;
  if (!ignored.ok) return true;
  const out = new Set(ignored.out.split("\n").filter(Boolean));
  return sample.some((p) => !out.has(p)) || candidates.length > sample.length;
}

/**
 * What to show for a diff: the walkthrough written for exactly it, else the
 * last one shown here (older code, or another model or language).
 * @returns {Promise<{ entry: any, exact: boolean } | null>}
 */
export async function findShown(repo, diff, key) {
  const exact = await readJson(entryPath(key));
  const place = placeKey(repo.top, diff.sk);
  if (exact?.version === VERSION) {
    await touch(entryPath(key));
    const pointer = await readJson(pointerPath(place));
    // Showing it makes it the last one shown, so a regeneration builds on what the reader sees.
    if (pointer?.key !== key) await write(pointerPath(place), JSON.stringify({ key, top: repo.top, source: diff.sk })).catch(() => undefined);
    return { entry: exact, exact: true };
  }
  const pointer = await readJson(pointerPath(place));
  const last = pointer?.key ? await readJson(entryPath(pointer.key)) : null;
  if (last?.version !== VERSION) return null;
  await touch(entryPath(pointer.key));
  return { entry: last, exact: false };
}

// Eviction keeps the newest files, so showing an entry marks it new: the one a reader keeps
// coming back to outlives two hundred they looked at once. Once per entry per session is enough.
const touched = new Set();
async function touch(path) {
  if (touched.has(path)) return;
  touched.add(path);
  await exec("touch", [path]).catch(() => undefined);
}

/** The prompt that would be sent, to size it before anything is spent. */
export function preparePrompt(diff, { language, previous, preferences = "" }) {
  return buildPrompt({ digest: diff.text, fileCount: diff.fileCount, hunkCount: diff.hunkCount, what: diff.what, language, previous, preferences });
}

export const promptChars = (p) => p.system.length + p.prompt.length;
export const fits = (p) => promptChars(p) <= MAX_PROMPT_CHARS;

/** The running or finished-but-unread job of a repository and source, or null. */
export async function jobOf(repo, sk) {
  const dir = jobDir(placeKey(repo.top, sk));
  const meta = await readJson(`${dir}/meta.json`);
  if (!meta) return null;
  const code = await readTextFile(`${dir}/code`).catch(() => null);
  return { dir, meta, done: code !== null, code };
}

/** Starts a generation in the background and returns its job. */
export async function startJob(repo, diff, { key, model, language, prompt, source }) {
  await ensureDirs();
  const dir = jobDir(placeKey(repo.top, diff.sk));
  // A run still going there (another window started it) is stopped, not orphaned.
  await stopRun(dir);
  await exec("rm", ["-rf", dir]);
  await exec("mkdir", ["-p", dir]);
  const meta = {
    key, code: codeKey(diff.files), model, language, top: repo.top, source, sk: diff.sk, started: Date.now(), deadline: Date.now() + deadline(diff.hunkCount),
    idByAlias: diff.idByAlias, digestFiles: diff.digestFiles, hunkCount: diff.hunkCount,
  };
  await writeTextFile(`${dir}/system.txt`, prompt.system, null);
  await writeTextFile(`${dir}/prompt.txt`, prompt.prompt, null);
  await writeTextFile(`${dir}/schema.json`, JSON.stringify(SCHEMA), null);
  await writeTextFile(`${dir}/run.sh`, jobScript(), null);
  await writeTextFile(`${dir}/meta.json`, JSON.stringify(meta), null);
  // Detached: exec returns at once, and the run outlives this window.
  // run.sh stops claude itself at the deadline, so a hung run ends even with no window open.
  const seconds = String(Math.ceil((meta.deadline - meta.started) / 1000));
  const launched = await exec("sh", ["-c", "nohup sh \"$0\" \"$1\" \"$2\" >/dev/null 2>&1 &", `${dir}/run.sh`, model, seconds]);
  if (launched.code !== 0) {
    await exec("rm", ["-rf", dir]);
    throw new Error((launched.stderr || launched.stdout || `sh exited with ${launched.code}`).trim());
  }
  return { dir, meta, done: false, code: null };
}

/**
 * The pid a job folder recorded, only while it is still that folder's claude
 * run. After a reboot the number can belong to anything; it is never signalled
 * on the strength of the file alone.
 */
async function runPid(dir, known = null) {
  const pid = known ?? (await readTextFile(`${dir}/pid`).catch(() => null))?.trim();
  if (!pid || !/^\d+$/.test(pid)) return null;
  const r = await exec("ps", ["-o", "command=", "-p", pid]).catch(() => null);
  return r?.code === 0 && isRunCommand(r.stdout) ? pid : null;
}

async function stopRun(dir) {
  const pid = await runPid(dir);
  if (pid) await exec("kill", [pid]).catch(() => undefined);
}

/**
 * Whether a job's claude is still running (a reboot leaves a job with no
 * answer and no process). The pid is read once and kept on the job.
 */
export async function alive(job) {
  job.pid ??= (await readTextFile(`${job.dir}/pid`).catch(() => null))?.trim() || null;
  if (!job.pid) return Date.now() - job.meta.started < 10_000; // not started yet
  return (await runPid(job.dir, job.pid)) !== null;
}

/** The cheap look taken every second: the job, finished, once its code is there; else null. */
export async function finished(job) {
  const code = await readTextFile(`${job.dir}/code`).catch(() => null);
  return code === null ? null : { ...job, done: true, code };
}

export async function cancelJob(job) {
  await stopRun(job.dir);
  await exec("rm", ["-rf", job.dir]);
}

/**
 * A finished job → a stored walkthrough (and the pointer at it). The job's
 * folder goes either way; a failure is thrown with the reason. Two windows on
 * one repository both see the answer arrive: the folder is claimed by renaming
 * it (atomic), and the window that loses gets null and simply reads again.
 */
export async function finishJob(job) {
  const claimed = `${job.dir}.taken-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const moved = await exec("mv", [job.dir, claimed]).catch(() => ({ code: 1 }));
  if (moved.code !== 0) return null;
  const read = (name) => readTextFile(`${claimed}/${name}`).catch(() => null);
  try {
    const { raw, cost } = readOutcome({ out: await read("out.json"), err: await read("err.txt"), code: job.code });
    const walkthrough = normalize(raw, job.meta.idByAlias, job.meta.digestFiles);
    const { key, model, language, top, source, sk } = job.meta;
    const entry = { version: VERSION, key, code: job.meta.code, model, language, top, source, sk, generatedAt: Date.now(), took: Date.now() - job.meta.started, cost, walkthrough };
    await ensureDirs();
    await write(entryPath(key), JSON.stringify(entry));
    await write(pointerPath(placeKey(top, sk)), JSON.stringify({ key, top, source: sk }));
    await evict();
    return entry;
  } finally {
    await exec("rm", ["-rf", claimed]);
  }
}

/** Keeps the newest entries. An entry is a few KB; nothing goes for being merely old. */
async function evict() {
  await exec("sh", ["-c", `cd "$0" && ls -t -- *.json 2>/dev/null | tail -n +${MAX_ENTRIES + 1} | while read -r f; do rm -f -- "$f"; done`, `${dataDir()}/entries`]).catch(() => undefined);
}

/** The system's preferred language (macOS), for the first walkthrough. */
export async function systemLocale() {
  const r = await exec("defaults", ["read", "-g", "AppleLanguages"]).catch(() => null);
  const first = /"?([A-Za-z]{2}[-_A-Za-z]*)"?/.exec(r?.stdout ?? "")?.[1];
  return first ?? (await exec("sh", ["-c", "echo ${LC_ALL:-${LANG:-}}"]).catch(() => null))?.stdout?.trim() ?? "";
}
