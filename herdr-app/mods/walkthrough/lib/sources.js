// What a walkthrough is of, and the git that reads it. Every function takes
// the mod's `exec`, so the same code runs in Herdr and under `node --test`.
//
// A source becomes one or more sections: a patch and the scope its hunk ids
// live in. Staged and unstaged edits of the same lines are different hunks, so
// a step written about the staged version is never quietly matched to an
// unstaged one.

// Reads write nothing under .git: no index refresh, no lock, no fsmonitor.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.quotePath=false", "-c", "diff.autoRefreshIndex=false"];
// The user's diff settings (no prefixes, external tools, color) must not change what is parsed.
const DIFF = ["--no-color", "--no-ext-diff", "--no-textconv", "--src-prefix=a/", "--dst-prefix=b/", "-M"];
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
// Untracked files are read one by one; past these, the rest are listed unread.
const MAX_UNTRACKED = 300;
export const MAX_UNTRACKED_BYTES = 1024 * 1024;

export const SCOPES = [
  { key: "uncommitted", label: "Uncommitted", about: "Everything not committed yet: staged, unstaged and new files" },
  { key: "staged", label: "Staged", about: "What the next commit would hold" },
  { key: "unstaged", label: "Unstaged", about: "The working tree and new files, not staged" },
  { key: "branch", label: "Branch", about: "Everything this branch adds to its base, committed or not" },
  { key: "commit", label: "Commit", about: "One commit, against its first parent" },
];

export async function git(exec, cwd, args) {
  const r = await exec("git", [...READ, ...args], { cwd });
  return { ok: r.code === 0, code: r.code, out: r.stdout ?? "", err: (r.stderr || "").trim() };
}

async function must(exec, cwd, args) {
  const r = await git(exec, cwd, args);
  if (!r.ok) throw new Error(r.err || `git ${args[0]} failed`);
  return r.out;
}

/** The repository a folder is in: { top, name, branch }, or null outside git. */
export async function repoAt(exec, folder) {
  const top = await git(exec, folder, ["rev-parse", "--show-toplevel"]);
  if (!top.ok) return null;
  const root = top.out.trim();
  const head = await git(exec, root, ["rev-parse", "--verify", "-q", "HEAD"]);
  const branch = (await git(exec, root, ["branch", "--show-current"])).out.trim();
  // A linked worktree keeps its index and HEAD outside its folder, under the main repository's .git.
  const gitDir = (await git(exec, root, ["rev-parse", "--absolute-git-dir"])).out.trim();
  return { top: root, name: root.split("/").pop(), branch: branch || null, born: head.ok, gitDir: gitDir || `${root}/.git` };
}

/** What HEAD is now: the branch, or "HEAD@<short hash>" when detached, so each one is a source of its own. */
export async function currentHead(exec, top) {
  const branch = (await git(exec, top, ["branch", "--show-current"])).out.trim();
  if (branch) return branch;
  const short = (await git(exec, top, ["rev-parse", "--short", "HEAD"])).out.trim();
  return short ? `HEAD@${short}` : "HEAD";
}

/** A source's stable name: part of its cache key and the name of its pointer. */
export function sourceKey(source) {
  // The branch being read is part of it: two branches against one base are two walkthroughs.
  if (source.kind === "branch") return `branch:${source.base}...${source.head ?? "HEAD"}`;
  if (source.kind === "commit") return `commit:${source.hash}`;
  return source.kind;
}

/** One line for the model and the header: what is being walked through. */
export function describe(source, repo) {
  switch (source.kind) {
    case "uncommitted": return "Uncommitted local changes, staged and unstaged, with new files.";
    case "staged": return "Staged changes: what the next commit would hold.";
    case "unstaged": return "Unstaged changes in the working tree, with new files.";
    case "branch": return `Everything branch "${source.head ?? repo?.branch ?? "HEAD"}" adds to "${source.base}", committed or not. Work that came in from ${source.base} is left out.`;
    case "commit": return `Commit ${source.hash.slice(0, 12)}${source.subject ? ` ("${source.subject}")` : ""}, against its first parent.`;
    default: return "Local changes.";
  }
}

/**
 * New files git doesn't track yet, as patches. `git diff` never shows them,
 * and a walkthrough of local work without its new files would miss most of it.
 * @returns {Promise<{ patches: string[], unread: { path: string, why: string }[] }>}
 */
// Untracked patches by repository and path, with the size and modification time
// they were read at. A save re-reads the diff, and re-diffing every new file
// each time (up to 300 processes) would keep the CPU busy while an agent edits.
const memo = new Map();
const MEMO_LIMIT = 4000;

export async function untracked(exec, top) {
  const list = await must(exec, top, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const paths = list.split("\0").filter(Boolean);
  const unread = paths.slice(MAX_UNTRACKED).map((path) => ({ path, why: `Not read: more than ${MAX_UNTRACKED} new files.` }));
  const take = paths.slice(0, MAX_UNTRACKED);
  if (!take.length) return { patches: [], unread };

  // One call for every size and time: a stray 40 MB log must not reach the model or overflow exec.
  // Exactly one line per file, in order ("-1" when it can't be read), so no size lands on the wrong path.
  // GNU stat first: BSD's `stat -c` fails, while GNU's `stat -f` would succeed with something else.
  const stats = await exec("sh", ["-c", "for f; do s=$(stat -c '%s %.9Y' \"$f\" 2>/dev/null || stat -f '%z %Fm' \"$f\" 2>/dev/null) || s=-1; echo \"${s:--1}\"; done", "sh", ...take], { cwd: top });
  const lines = (stats.stdout ?? "").split("\n");
  const results = new Array(take.length).fill(null);
  const queue = take.map((path, i) => {
    const stamp = (lines[i] ?? "-1").trim();
    return { path, i, stamp, size: Number(stamp.split(" ")[0]) };
  });
  const problems = new Array(take.length).fill(null);
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      if (!(item.size >= 0)) { problems[item.i] = "Not read: it can't be opened."; continue; }
      if (item.size > MAX_UNTRACKED_BYTES) { problems[item.i] = "Not read: larger than 1 MB."; continue; }
      const key = `${top}\0${item.path}`;
      const known = memo.get(key);
      if (known && known.stamp === item.stamp) { results[item.i] = known.patch; continue; }
      // --no-index exits 1 when the files differ, which is the point.
      const r = await git(exec, top, ["diff", "--no-index", ...DIFF, "--", "/dev/null", item.path]);
      if (r.code <= 1) {
        results[item.i] = r.out;
        if (memo.size >= MEMO_LIMIT) memo.clear();
        memo.set(key, { stamp: item.stamp, patch: r.out });
      } else problems[item.i] = `Not read: ${r.err || "git diff failed"}`;
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker));
  // Kept in the order git listed them, whichever worker finished first: the order is part of the cache key.
  const patches = results.filter((p) => typeof p === "string" && p.trim());
  take.forEach((path, i) => { if (problems[i]) unread.push({ path, why: problems[i] }); });
  return { patches, unread };
}

/**
 * Of the paths a folder watch reported, those that might change a diff,
 * relative to the repository, for `git check-ignore`; `true` when one of git's
 * own files that a diff depends on changed (the index, HEAD, a ref).
 */
export function worthReading(top, paths, gitDir = `${top}/.git`) {
  const out = [];
  for (const path of paths ?? []) {
    // A worktree's own git folder, watched beside it: its index, HEAD and their logs.
    if (gitDir !== `${top}/.git` && path.startsWith(`${gitDir}/`)) {
      if (/^(index|HEAD|logs\/HEAD|refs\/)/.test(path.slice(gitDir.length + 1))) return true;
      continue;
    }
    if (!path.startsWith(`${top}/`)) return true;
    const rel = path.slice(top.length + 1);
    if (rel === ".git" || rel.startsWith(".git/")) {
      if (/^\.git\/(index|HEAD|packed-refs|refs\/)/.test(rel)) return true;
      continue;
    }
    if (/(^|\/)node_modules(\/|$)/.test(rel)) continue;
    out.push(rel);
  }
  return out;
}

/**
 * A source → sections to parse, and files that could not be read.
 * @returns {Promise<{ sections: { scope: string, patch: string }[], unread: { path: string, why: string }[] }>}
 */
export async function loadSections(exec, top, source) {
  const sections = [];
  let unread = [];
  const add = (scope, ...patches) => {
    const patch = patches.filter((p) => p && p.trim()).join("\n");
    if (patch.trim()) sections.push({ scope, patch });
  };
  const withUntracked = async (scope, patch) => {
    const u = await untracked(exec, top);
    unread = u.unread;
    add(scope, patch, ...u.patches);
  };

  switch (source.kind) {
    case "uncommitted":
      add("staged", await must(exec, top, ["diff", "--cached", ...DIFF]));
      await withUntracked("working", await must(exec, top, ["diff", ...DIFF]));
      break;
    case "staged":
      add("staged", await must(exec, top, ["diff", "--cached", ...DIFF]));
      break;
    case "unstaged":
      await withUntracked("working", await must(exec, top, ["diff", ...DIFF]));
      break;
    case "branch": {
      // The merge base, so work that arrived on the base after branching is not counted as this branch's.
      const base = (await must(exec, top, ["merge-base", source.base, "HEAD"])).trim();
      await withUntracked("branch", await must(exec, top, ["diff", ...DIFF, base]));
      break;
    }
    case "commit": {
      const parents = (await must(exec, top, ["rev-list", "--parents", "-n", "1", source.hash])).trim().split(" ");
      add("commit", await must(exec, top, ["diff", ...DIFF, parents[1] ?? EMPTY_TREE, source.hash]));
      break;
    }
    default:
      throw new Error(`Unknown source "${source.kind}"`);
  }
  return { sections, unread };
}

/**
 * Where a branch most likely started from: its upstream remote's default
 * branch, else a local main, master, trunk or develop, never itself.
 */
export async function defaultBase(exec, top, current) {
  const head = await git(exec, top, ["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"]);
  const candidates = [head.ok ? head.out.trim() : "", "origin/main", "origin/master", "main", "master", "trunk", "develop"].filter(Boolean);
  for (const ref of candidates) {
    if (ref === current || ref === `origin/${current}`) continue;
    if ((await git(exec, top, ["rev-parse", "--verify", "-q", `${ref}^{commit}`])).ok) return ref;
  }
  return null;
}

/** Branches to compare against: local ones, then remote ones, most recent first, without the current one. */
export async function baseChoices(exec, top, current) {
  const r = await git(exec, top, ["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/heads", "refs/remotes"]);
  return r.out.split("\n").map((s) => s.trim()).filter((s) => s && s !== current && !s.endsWith("/HEAD") && s !== "origin");
}

/** The latest commits on HEAD: { hash, short, subject, author, when }. */
export async function recentCommits(exec, top, count = 40) {
  const r = await git(exec, top, ["log", `-n${count}`, "--format=%H%x1f%h%x1f%s%x1f%an%x1f%cr"]);
  if (!r.ok) return [];
  return r.out.split("\n").filter(Boolean).map((line) => {
    const [hash, short, subject, author, when] = line.split("\x1f");
    return { hash, short, subject, author, when };
  });
}
