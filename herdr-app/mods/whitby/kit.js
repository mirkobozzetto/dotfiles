// Shared look and data for the Whitby layout's parts.
// Colors and sizes come from Whitby's source (src/ui/primitives.rs, sidebar_view.rs,
// collapsible.rs, terminal_view.rs); herdr theme names carry the shared tokens.

import { svg } from "gpui-kit";
import { theme, settings, panes, terminals, agents, focused, home, keys, exec, window, shared, setShared } from "herdr";

export const ICON = (name) => `mods/whitby/icons/${name}.svg`;

// "#rrggbb" at an opacity, as Whitby's muted-at-N% text and rules.
export function alpha(color, amount) {
  if (!/^#[0-9a-f]{6}$/i.test(color ?? "")) return color;
  return color + Math.round(amount * 255).toString(16).padStart(2, "0");
}

// Theme tokens plus the few Whitby colors herdr has no name for.
export function palette() {
  const t = theme();
  const dark = Boolean(settings()?.dark);
  const tone = (light, night) => (dark ? night : light);
  return {
    ...t,
    dark,
    running: tone("#189a30", "#1c882d"),
    // Status dots: soft enough to sit quietly beside a title.
    dot: {
      working: "#6cbf8a", running: alpha("#6cbf8a", 0.5), done: "#8ab0f7", idle: alpha(t.muted, 0.55),
      stopped: alpha(t.muted, 0.3), blocked: "#e5787a", error: "#e5787a", needs: "#a78bfa",
    },
    // The same states as words, where a label needs one.
    word: { working: tone("#2e9f4b", "#4cc06a"), running: tone("#2e9f4b", "#4cc06a"), blocked: tone("#b54343", "#ff938a"), error: tone("#b54343", "#ff938a"), needs: tone("#7c5cd6", "#b49cfb") },
    live: "#2e9f4b",
    failed: "#b54343",
    warn: tone("#b7791f", "#d49338"),
    blue: "#246cf4",
    front: tone("#ffffff", "#18191b"),
    body: tone("#f9f9fb", "#111113"),
    rowHover: tone("#f9f9fb", "#18191b"),
    field: tone("#f8f8fa", "#19191c"),
    placeholder: tone("#999ba3", "#8d93a0"),
    footer: tone("#f8f8fa", "#202632"),
    footerBorder: tone("#d9d9e0", "#303846"),
    footerMuted: tone("#60646c", "#9aa4b4"),
  };
}

// A Whitby icon; without a color it takes the text color around it (hover included).
export function icon(name, size, color) {
  const el = svg(ICON(name)).size(size).flex_none();
  return color ? el.text_color(color) : el;
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

export function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

// The pane a tab is known by: its agent, else the focused one, else the first.
export function lead(tab, all = panes()) {
  const mine = all.filter((p) => p.tab === tab.id);
  return mine.find((p) => p.program?.agent) ?? mine.find((p) => p.focused) ?? mine[0];
}

const base = (path) => (path ?? "").replace(/\/+$/, "").split("/").pop();
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The last real title each terminal had (see paneTitle).
const named = new Map();

// What a pane calls itself: an agent's own title, else the program. Like Solo's title
// helper, it drops what agents tack on (Grok's " - grok", Codex's " | <folder>") and
// treats a bare folder or program name as no title at all.
export function paneTitle(p) {
  if (!p) return "";
  const prog = p.program?.name;
  const folder = base(p.cwd);
  // "grok-build" titles itself "... - grok": the app's first word counts as its name too.
  const names = [p.program?.key, prog, p.app, p.app?.split("-")[0], p.program?.key?.split("-")[0]];
  const tails = [...names, folder].filter(Boolean).map(escape);
  let live = clean(p.title);
  if (tails.length) live = live.replace(new RegExp(`\\s+[-|·]\\s+(${tails.join("|")})$`, "i"), "").trim();
  const plain = [prog, p.program?.key, p.app, folder, p.terminal].filter(Boolean).map((s) => s.toLowerCase());
  const telling = live && !plain.includes(live.toLowerCase()) && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@");
  // While it works, Grok's title is what it's doing ("Waiting for response..."): keep
  // the name it had before, so the row doesn't change under you.
  const key = p.terminal ?? p.pane;
  if (telling && /(\.\.\.|…)$/.test(live) && named.has(key)) return named.get(key);
  if (telling) named.set(key, live);
  return telling ? live : prog || live || "shell";
}

// A row's name, as Whitby names an agent: a tab someone named, else its pane's title.
export function tabTitle(tab, all = panes()) {
  return tab.named ? tab.name : paneTitle(lead(tab, all));
}

// Agents a terminal started: terminals run from inside it (`hc run`), then the
// helpers its program reports itself (OSC 7501 records, as Claude Code's subagents).
// Each is { key, address?, record?, parent }: a record has no terminal of its own.
export function children(address, all = terminals()) {
  if (!address) return [];
  // A finished one stays, stopped, as Solo keeps a finished child in the tree (when
  // terminals() still lists it; herdr leaves most finished terminals out).
  const runs = all.filter((k) => k.parent === address && (k.state === "live" || k.state === "finished")).map((k) => ({ key: k.address, address: k.address, terminal: k, parent: address }));
  const own = all.find((k) => k.address === address)?.records ?? {};
  const helpers = Object.entries(own).map(([id, record]) => ({ key: `${address}#${id}`, record, parent: address }));
  return [...runs, ...helpers];
}

// Everything under a terminal, at any depth (Whitby's "+N subprocesses").
export function subCount(address, all = terminals()) {
  return children(address, all).reduce((n, c) => n + 1 + (c.address ? subCount(c.address, all) : 0), 0);
}

// What a terminal says about itself (herdr-core's words): its status, which can be
// "error" where herdr's agent lists only say blocked, and what a block waits on
// (permission, question or auth), when the program says.
export function reportOf(address, ts = terminals()) {
  const k = address ? ts.find((x) => x.address === address) : null;
  return { word: k?.status ?? null, kind: k?.report?.kind ?? null };
}

// One word for every status dot: working, running (a live terminal no agent status
// speaks for), done (finished while you were away), idle, error, blocked or needs
// (a block, split by what it waits on), stopped (finished).
export function stateOf(status, live = true, report = null) {
  if (!live) return "stopped";
  if (status === "error" || (status === "blocked" && report?.word === "error")) return "error";
  if (status === "blocked") return blockedState(report?.kind);
  return status ?? "running";
}

// Which blocks show as "Blocked" (pulsing red) and which as "Needs you" (pulsing purple):
// waiting on an approval is blocked; a question, a sign-in or an unexplained block needs you.
export function blockedState(kind) {
  return kind === "permission" ? "blocked" : "needs";
}

// Unread, as Whitby means it: an agent that wants your attention (finished while you
// were away, blocked, needing you, or failed) and that you haven't looked at in that
// state. Looking at it marks it read; a new state makes it unread again. The bell counts
// exactly these, and each gets the unread dot. Shared, so every part agrees.
const ATTENTION = new Set(["done", "blocked", "needs", "error"]);
const READ = "whitby.read";

export function attentionOf(status, address, ts = terminals()) {
  const state = stateOf(status, true, reportOf(address, ts));
  return ATTENTION.has(state) ? state : null;
}

export function isUnread(status, address, ts = terminals()) {
  const state = attentionOf(status, address, ts);
  return Boolean(state) && (shared(READ) ?? {})[address] !== state;
}

// Agents that are unread, most urgent first: errors and blocks, then finished work.
export function unreadAgents(ts = terminals()) {
  const rank = { error: 0, blocked: 1, needs: 2, done: 3 };
  return agents()
    .filter((a) => isUnread(a.status, a.address, ts))
    .sort((x, y) => rank[attentionOf(x.status, x.address, ts)] - rank[attentionOf(y.status, y.address, ts)]);
}

// Marks the agent you're looking at as read in its current state, and forgets what was
// read for agents whose state has moved on. Writes only when something changed.
export function markRead(ts = terminals()) {
  const read = shared(READ) ?? {};
  const next = {};
  for (const a of agents()) {
    const state = attentionOf(a.status, a.address, ts);
    if (state && read[a.address] === state) next[a.address] = state;
  }
  const f = focused();
  if (window()?.active !== false && f?.terminal) {
    const a = agents().find((x) => x.address === f.terminal);
    const state = a && attentionOf(a.status, a.address, ts);
    if (state) next[a.address] = state;
  }
  const same = Object.keys(next).length === Object.keys(read).length && Object.entries(next).every(([k, v]) => read[k] === v);
  if (!same) setShared(READ, next);
}

// A sub-agent's state. It reports to its parent, so its "done" isn't news: a finished
// helper (a record that says done, a terminal that ended) is stopped.
export function subStatus(c) {
  if (c.record) return c.record.state === "done" ? "stopped" : stateOf(c.record.state, true, { word: c.record.state, kind: c.record.kind });
  const k = c.terminal;
  return stateOf(k?.status === "done" ? "idle" : k?.status, k?.state === "live", { word: k?.status, kind: k?.report?.kind });
}

// A sub-agent's name: the one it was given, else its own title, else its program.
export function childTitle(c) {
  if (c.record) return clean(c.record.title) || clean(c.record.msg) || c.record.app || "Subagent";
  const k = c.terminal;
  return k.name || paneTitle({ title: k.title, program: k.program }) || k.template || k.address;
}

export const STATE = { working: "Working", running: "Running", done: "Done", idle: "Idle", blocked: "Blocked", needs: "Needs you", error: "Error", stopped: "Stopped" };

// Whitby's resource figures: CPU and resident memory of each local terminal's process
// tree, sampled every 3s while the window is in front (Solo's refresh), into v.stats.
export function sampleStats(v, cx) {
  v.stats ??= {};
  const sample = (cx) => {
    if (window()?.active === false || v.sampling) return;
    v.sampling = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("ps", ["-axo", "pid=,ppid=,pcpu=,rss="]);
        const kids = new Map(), self = new Map();
        for (const line of r.stdout.split("\n")) {
          const [pid, ppid, cpu, rss] = line.trim().split(/\s+/).map(Number);
          if (!pid) continue;
          self.set(pid, { cpu, mem: rss * 1024 });
          if (!kids.has(ppid)) kids.set(ppid, []);
          kids.get(ppid).push(pid);
        }
        const tree = (pid) => {
          const own = self.get(pid) ?? { cpu: 0, mem: 0 };
          return (kids.get(pid) ?? []).map(tree).reduce((a, b) => ({ cpu: a.cpu + b.cpu, mem: a.mem + b.mem }), { ...own });
        };
        const stats = {};
        for (const k of terminals()) if (k.pid && !k.address.includes("/") && self.has(k.pid)) stats[k.address] = tree(k.pid);
        v.stats = stats;
      } catch {}
      v.sampling = false;
      cx.notify();
    });
  };
  sample(cx);
  cx.timer.every(3000, sample);
}

// Whitby's badge text: "12.3%", "245MB", "1.2GB" (src/sidebar_metrics.rs).
export const cpuText = (cpu) => `${cpu.toFixed(1)}%`;
export function memText(bytes) {
  const mib = 1024 * 1024, gib = 1024 * mib;
  return bytes >= gib ? `${(bytes / gib).toFixed(1)}GB` : `${Math.round(bytes / mib)}MB`;
}

// Whitby's default thresholds for showing a badge (src/sidebar_preferences.rs presets).
export const SHOW = { rowCpu: 30, rowMem: 500 * 1024 * 1024, projectCpu: 25, projectMem: 1024 * 1024 * 1024 };

export function badges(stat, cpuMin, memMin) {
  if (!stat) return [];
  return [stat.cpu >= cpuMin ? cpuText(stat.cpu) : null, stat.mem >= memMin ? memText(stat.mem) : null].filter(Boolean);
}

// The key bound to a command, drawn the macOS way: cmd-] is ⌘].
export function keyFor(command) {
  const bound = (keys() ?? []).find((k) => k.action === command && (k.section === "global" || k.section === "terminal"));
  if (!bound) return null;
  const glyph = { cmd: "⌘", shift: "⇧", alt: "⌥", ctrl: "⌃", up: "↑", down: "↓", left: "←", right: "→" };
  return bound.keys.split("-").map((k) => glyph[k] ?? k.toUpperCase()).join("");
}
