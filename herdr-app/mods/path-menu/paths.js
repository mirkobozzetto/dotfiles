// Finds file and folder paths in a terminal's visible text that exist on this computer.
// The menu cannot see the clicked word, so it offers the paths on screen, newest (lowest) first.
import { exec, hc } from "herdr";

const START = /^(~\/|\.{1,2}\/|\/[\w.~-]|[\w.-]+\/|[\w-][\w.-]*\.[A-Za-z0-9]{1,8}$)/;
const MAX_WORDS = 6, MAX_CANDIDATES = 400;

// Trailing punctuation from prose, and editor suffixes like file.ts:12:3 or file.md#L4.
const TAIL = /[`'")\]>,;!?.:]+$/;
const clean = s => s.replace(TAIL, "").replace(/(:\d+){1,2}$|#L\d+(-L?\d+)?$/, "").replace(TAIL, "");

function candidates(text) {
  const lines = text.split("\n"), out = [];
  for (let row = lines.length - 1; row >= 0 && out.length < MAX_CANDIDATES; row--) {
    const line = lines[row], words = [...line.matchAll(/\S+/g)];
    // A long path can wrap onto the next row; its first word may finish it.
    const wrap = (lines[row + 1] ?? "").trimStart().split(/\s/)[0] ?? "";
    for (let i = words.length - 1; i >= 0; i--) {
      const word = words[i][0].replace(/^[`'"(\[<]+/, "");
      if (!START.test(clean(word)) && !START.test(word)) continue;
      const begin = words[i].index + words[i][0].length - word.length, group = [];
      for (let j = i; j < Math.min(words.length, i + MAX_WORDS); j++) {
        const raw = line.slice(begin, words[j].index + words[j][0].length);
        group.push(clean(raw));
        if (j === words.length - 1 && wrap) group.push(clean(raw + wrap));
      }
      out.push([...new Set(group.filter(c => c.length > 1))]);
    }
  }
  return out;
}

// Which candidates exist: "kind\0candidate\0absolute\0" for each, relative ones against cwd.
const CHECK = 'for p in "$@"; do case "$p" in "~/"*) a="$HOME/${p#"~/"}";; /*) a="$p";; *) a="$PWD/$p";; esac; ' +
  'if [ -d "$a" ]; then printf "d\\0%s\\0%s\\0" "$p" "$a"; elif [ -f "$a" ]; then printf "f\\0%s\\0%s\\0" "$p" "$a"; fi; done';

// Where bare file names live below cwd: the repo's files (tracked and untracked, not ignored),
// else a bounded find. Prints "relative/path" per line; awk keeps those whose last part is a name.
const LOOKUP = 'pick() { awk -F/ \'BEGIN { for (i = 1; i < ARGC; i++) want[ARGV[i]] = 1; ARGC = 1 } want[$NF] && n[$NF]++ < 2\' "$@"; }; ' +
  'if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then git ls-files --cached --others --exclude-standard | pick "$@"; ' +
  'else find . -maxdepth 6 -type f -not -path "*/.git/*" -not -path "*/node_modules/*" 2>/dev/null | head -100000 | sed "s#^\\./##" | pick "$@"; fi';
const MAX_NAMES = 12, PER_NAME = 2;

async function findByName(names, cwd) {
  if (!names.length || !cwd) return new Map();
  const r = await exec("sh", ["-c", LOOKUP, "lookup", ...names], { cwd }).catch(() => null);
  const byName = new Map();
  for (const rel of (r?.stdout ?? "").split("\n").filter(Boolean)) {
    const name = rel.split("/").pop(), list = byName.get(name) ?? [];
    if (list.length < PER_NAME) byName.set(name, [...list, { dir: false, path: `${cwd}/${rel}` }]);
  }
  return byName;
}

export async function pathsOnScreen(terminal, cwd, limit = 6) {
  const read = await hc(["read", terminal]);
  if (read.code !== 0) return [];
  const groups = candidates(read.stdout);
  const all = [...new Set(groups.flat())].slice(0, MAX_CANDIDATES);
  if (!all.length) return [];
  const r = await exec("sh", ["-c", CHECK, "paths", ...all], { cwd: cwd || undefined });
  if (r.code !== 0) return [];
  const found = new Map(), f = r.stdout.split("\0");
  for (let i = 0; i + 2 < f.length; i += 3) found.set(f[i + 1], { dir: f[i] === "d", path: f[i + 2].replace(/\/\.\/|\/+$/g, m => (m === "/./" ? "/" : "")) });
  // A bare "name.ext" that is not in cwd is looked up in the project below it.
  const bare = group => !group.some(c => found.has(c)) && /^[\w-][\w.-]*\.[A-Za-z0-9]{1,8}$/.test(group[0]) ? group[0] : null;
  const names = [...new Set(groups.map(bare).filter(Boolean))].slice(0, MAX_NAMES);
  const byName = await findByName(names, cwd);
  const out = [], seen = new Set();
  for (const group of groups) {
    // The longest candidate that exists: "Screenshot at 16.36.png" over "Screenshot".
    const hit = group.filter(c => found.has(c)).sort((a, b) => b.length - a.length)[0];
    const items = hit ? [found.get(hit)] : byName.get(bare(group)) ?? [];
    for (const item of items) {
      if (item.path === "/" || item.path === cwd || seen.has(item.path)) continue;
      seen.add(item.path);
      out.push(item);
      if (out.length >= limit) return out;
    }
  }
  return out;
}
