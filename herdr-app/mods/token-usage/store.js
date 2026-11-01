// The token-usage mod's plain logic: one session file's lines become per-day,
// per-model buckets; a range folds those buckets into totals; the panel's
// compact formats. No gpui or herdr imports here, so a plain JS runtime can
// run the very same parsing against the store for cross-checking.

export const RANGES = [
  ["today", "Today"],
  ["7d", "7 days"],
  ["30d", "30 days"],
  ["all", "All"],
];

const DAY = 86400000;
const pad = (n) => (n < 10 ? "0" + n : "" + n);

/** The local calendar day of a millisecond timestamp, as "YYYY-MM-DD". */
export function dayKey(ms) {
  const d = new Date(ms);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

/** The earliest day a range keeps, as "YYYY-MM-DD", or null for everything.
 * Bucket keys start with that day, so a string compare filters a range. */
export function rangeFloor(range, nowMs) {
  if (range === "7d") return dayKey(nowMs - 6 * DAY);
  if (range === "30d") return dayKey(nowMs - 29 * DAY);
  if (range === "all") return null;
  return dayKey(nowMs);
}

const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);

function costOf(cost) {
  if (!cost || typeof cost !== "object") return 0;
  const total = cost.total;
  if (typeof total === "number" && isFinite(total)) return total;
  return num(cost.input) + num(cost.output) + num(cost.cacheRead) + num(cost.cacheWrite);
}

/**
 * Folds one session file's text into `buckets`, keyed
 * "<YYYY-MM-DD>|<model>|<provider>" with [requests, input, output, cacheRead,
 * cacheWrite, cost]. Lines without `"usage"` are skipped before parsing; only
 * `type: "message"` lines with a usage and a numeric timestamp are counted.
 *
 * Lines are cut out of the text one at a time as the scan walks it, never
 * split into an array of every line: a 50 MB session becomes ~5,500 substrings
 * that way, and the mod runtime stalls under that (here it returns in under a
 * second, as does the same walk over a 10 MB slice of it).
 *
 * Returns the session's cwd, read from the `type: "session"` line near the top.
 * `budget.until` (ms since the epoch) stops the walk early when the clock
 * passes it; `budget.partial` then says so, and the caller counts the file as
 * only partly indexed instead of letting one file hold the panel's cadence.
 */
export function scan(text, buckets, budget) {
  let cwd = null;
  const head = text.slice(0, 65536);
  const cwdAt = head.indexOf('"cwd"');
  if (cwdAt >= 0) {
    const start = head.lastIndexOf("\n", cwdAt) + 1;
    const stop = head.indexOf("\n", cwdAt);
    try {
      const d = JSON.parse(head.slice(start, stop < 0 ? head.length : stop));
      if (d && d.type === "session" && typeof d.cwd === "string" && d.cwd) cwd = d.cwd;
    } catch {
      // A malformed header line is skipped, like every other line here.
    }
  }
  let from = 0;
  let seen = 0;
  for (;;) {
    if (budget && budget.until && (seen++ & 255) === 0 && Date.now() > budget.until) {
      budget.partial = true;
      break;
    }
    const hit = text.indexOf('"usage"', from);
    if (hit < 0) break;
    const start = text.lastIndexOf("\n", hit) + 1;
    const stop = text.indexOf("\n", hit);
    const end = stop < 0 ? text.length : stop;
    from = end + 1;
    let d;
    try {
      d = JSON.parse(text.slice(start, end));
    } catch {
      continue;
    }
    const m = d && d.type === "message" ? d.message : null;
    if (!m || !m.usage) continue;
    const ts = m.timestamp;
    if (typeof ts !== "number" || !isFinite(ts)) continue;
    const u = m.usage;
    const key = dayKey(ts) + "|" + (typeof m.model === "string" ? m.model : "unknown") + "|" + (typeof m.provider === "string" ? m.provider : "");
    let b = buckets[key];
    if (!b) b = buckets[key] = [0, 0, 0, 0, 0, 0];
    b[0] += 1;
    b[1] += num(u.input);
    b[2] += num(u.output);
    b[3] += num(u.cacheRead);
    b[4] += num(u.cacheWrite);
    b[5] += costOf(u.cost);
  }
  return cwd;
}

/** The store's project folder a session path lives in (its first segment). */
export function projectOf(path, root) {
  const rel = root && path.indexOf(root + "/") === 0 ? path.slice(root.length + 1) : path;
  const cut = rel.indexOf("/");
  return cut < 0 ? rel : rel.slice(0, cut);
}

/** Sums every bucket of every cached file that `range` keeps. */
export function aggregate(files, range, nowMs, root) {
  const floor = rangeFloor(range, nowMs);
  const out = { req: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, total: 0 };
  const models = new Map();
  const projects = new Map();
  for (const [path, f] of files) {
    const project = projectOf(path, root);
    for (const key in f.b) {
      if (floor !== null && key < floor) continue;
      const b = f.b[key];
      if (!b) continue;
      const total = b[1] + b[2] + b[3] + b[4];
      out.req += b[0];
      out.input += b[1];
      out.output += b[2];
      out.cacheRead += b[3];
      out.cacheWrite += b[4];
      out.cost += b[5];
      out.total += total;
      const cut = key.indexOf("|");
      const rest = key.slice(cut + 1);
      const end = rest.indexOf("|");
      const model = end < 0 ? rest : rest.slice(0, end);
      let m = models.get(model);
      if (!m) models.set(model, (m = [0, 0, 0]));
      m[0] += b[0];
      m[1] += total;
      m[2] += b[5];
      let p = projects.get(project);
      if (!p) projects.set(project, (p = [0, 0]));
      p[0] += total;
      p[1] += b[0];
    }
  }
  return { req: out.req, input: out.input, output: out.output, cacheRead: out.cacheRead, cacheWrite: out.cacheWrite, cost: out.cost, total: out.total, models, projects };
}

/** The range's models, heaviest first. */
export function topModels(models, limit) {
  const list = [];
  for (const [name, v] of models) list.push({ name, req: v[0], tokens: v[1], cost: v[2] });
  list.sort((a, b) => b.tokens - a.tokens || b.req - a.req || (a.name < b.name ? -1 : 1));
  return list.slice(0, limit);
}

/** The range's projects, heaviest first, named by their decoded folder. */
export function topProjects(projects, limit, names) {
  const list = [];
  for (const [dir, v] of projects) list.push({ dir, label: (names && names[dir]) || dir, tokens: v[0], req: v[1] });
  list.sort((a, b) => b.tokens - a.tokens || (a.label < b.label ? -1 : 1));
  return list.slice(0, limit);
}

/** 1.24M, 128k, 812. */
export function fmtTokens(n) {
  if (!n) return "0";
  if (n < 1000) return String(Math.round(n));
  if (n < 1e6) {
    const k = n / 1000;
    return (k < 10 ? k.toFixed(1) : String(Math.round(k))) + "k";
  }
  return (n / 1e6).toFixed(2) + "M";
}

/** 1.8 GB, 640 MB, 12 KB. */
export function fmtBytes(n) {
  if (!n) return "0 B";
  if (n < 1e3) return n + " B";
  if (n < 1e6) return Math.round(n / 1e3) + " KB";
  if (n < 1e9) return Math.round(n / 1e6) + " MB";
  return (n / 1e9).toFixed(1) + " GB";
}

/** $12.34, <$0.01, $0. */
export function fmtCost(n) {
  if (!n) return "$0";
  if (n < 0.01) return "<$0.01";
  if (n < 1000) return "$" + n.toFixed(2);
  return "$" + Math.round(n);
}

/** just now, 12s ago, 3m ago, 2h ago, 4d ago. */
export function fmtAgo(ms) {
  if (ms < 15000) return "just now";
  if (ms < 60000) return Math.round(ms / 1000) + "s ago";
  if (ms < 3600000) return Math.round(ms / 60000) + "m ago";
  if (ms < 86400000) return Math.round(ms / 3600000) + "h ago";
  return Math.round(ms / 86400000) + "d ago";
}
