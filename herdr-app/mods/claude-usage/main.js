import { View, div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { home, readTextFile, watchFolder, focused, panes, props, openOverlay, settings, theme } from "herdr";
import * as fs from "fs/promises";

const SPAN = { session: 5 * 3600e3, weekly_all: 7 * 86400e3 };
const BAR = ["session", "weekly_all"];
const CLAY = { session: "#b98253", weekly_all: "#856144" };
const AMBER = "#ffb347", RED = "#ff5d6c";
const POPUP_W = 320, GAP = 6;
const WINDOWS = [["five_hour", "session"], ["seven_day", "weekly_all"]];

// Each Claude's status line writes its account's limits and its own account here
// (~/.claude/scripts/statusline/src/lib/herdr.ts): one file per hop account, one
// per terminal. No OAuth token to read, no request to api.anthropic.com.
const STATUS = () => `${home()}/.local/state/herdr-core/default/claude-status`;
// hop gives each account its own config dir, with its login in .claude.json.
const LOGIN = (account) => `${home()}/.claude-${account}/.claude.json`;
const PERSONAL = "mirko";

async function readJson(path) {
  try { return JSON.parse(await readTextFile(path)); } catch { return null; }
}

async function folder(dir) {
  const out = {};
  for (const f of await fs.readdir(dir).catch(() => [])) {
    if (f.endsWith(".json")) out[f.slice(0, -5)] = await readJson(`${dir}/${f}`);
  }
  return out;
}

function windowsOf(data) {
  return WINDOWS.filter(([k]) => typeof data?.[k]?.used_percentage === "number")
    .map(([k, kind]) => ({ kind, used: data[k].used_percentage, resets_at: new Date(data[k].resets_at * 1000).toISOString() }));
}

// hop's rule: the nearest .hop above the folder names the account, else the personal one.
async function hopAccount(dir) {
  for (let d = dir; d && d !== "/"; d = d.slice(0, d.lastIndexOf("/")) || "/") {
    const pinned = (await readTextFile(`${d}/.hop`).catch(() => null))?.trim();
    if (pinned) return pinned;
  }
  return PERSONAL;
}

const short = w => ({ session: "5h", weekly_all: "7d" })[w.kind];
const long = w => ({ session: "5-hour limit", weekly_all: "Weekly limit" })[w.kind];

function pace(w) {
  const end = Date.parse(w.resets_at), span = SPAN[w.kind];
  if (!end || !span) return null;
  return Math.min(1, Math.max(0, 1 - (end - Date.now()) / span));
}

// Past its reset, a window says nothing about now.
const stale = w => Date.parse(w.resets_at) < Date.now();

function color(w, t) {
  if (stale(w)) return t.dim;
  if (w.used >= 95) return RED;
  if (w.used >= 80) return AMBER;
  return CLAY[w.kind];
}

function clock(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function resets(w) {
  // The API reports resets a fraction of a second before the hour.
  const end = Math.round(Date.parse(w.resets_at) / 60e3) * 60e3;
  if (!end) return "";
  const left = end - Date.now();
  if (left <= 0) return "reset, waiting for this account's next Claude reply";
  if (left < 24 * 3600e3) {
    const h = Math.floor(left / 3600e3), m = Math.round((left % 3600e3) / 60e3);
    return `resets in ${h ? `${h}h ` : ""}${m}m, at ${clock(end)}`;
  }
  return `resets ${DAYS[new Date(end).getDay()]} at ${clock(end)}`;
}

// The elapsed share of the window is drawn as a ghost fill: lit past it means running ahead of pace.
function meter(w, t, height) {
  const used = Math.min(100, Math.max(0, w.used ?? 0));
  const ghost = stale(w) ? null : pace(w);
  return div().relative().w_full().h(height).rounded(height / 2).bg(t.border)
    .when(ghost !== null, el => el.child(div().absolute().left(0).top(0).h_full().w(`${ghost * 100}%`).rounded(height / 2).bg(t.dim).opacity(0.35)))
    .child(div().absolute().left(0).top(0).h_full().w(`${used}%`).rounded(height / 2).bg(color(w, t)));
}

export default class ClaudeUsage extends View {
  init(_props, cx) {
    this.accounts = {};
    this.terminals = {};
    this.emails = {};
    this.hop = new Map();
    const load = async () => {
      this.accounts = await folder(`${STATUS()}/accounts`);
      this.terminals = await folder(`${STATUS()}/terminals`);
      for (const a of new Set([PERSONAL, ...Object.keys(this.accounts)])) {
        this.emails[a] ??= (await readJson(LOGIN(a)))?.oauthAccount?.emailAddress ?? a;
      }
    };
    this.watching = false;
    cx.spawn(async (cx) => {
      for (;;) {
        await load();
        cx.notify();
        try { this.watching = true; await watchFolder(STATUS()); } catch { this.watching = false; return; }
      }
    });
    // Resets pass with time; without a watcher, this also rereads the files.
    cx.timer.every(60e3, (cx) => {
      if (!this.watching) cx.spawn(async (cx) => { await load(); cx.notify(); });
      cx.notify();
    });
  }

  // The account of the Claude in focus: what its status line said, else hop's rule for its folder.
  focusedAccount(cx) {
    const f = focused();
    const said = f?.terminal && this.terminals[f.terminal]?.account;
    if (said) return said;
    const dir = f?.cwd ?? panes().find(p => p.pane === f?.pane)?.cwd;
    if (!dir) return PERSONAL;
    if (!this.hop.has(dir)) {
      this.hop.set(dir, null);
      cx.spawn(async (cx) => { this.hop.set(dir, await hopAccount(dir)); cx.notify(); });
    }
    return this.hop.get(dir) ?? PERSONAL;
  }

  render(cx) {
    return props()?.overlay ? this.details() : this.bar(cx);
  }

  // At the pointer, a popup on a bottom bar gets pushed back into the window over the bar. Its height
  // can't be measured before it opens, so it is a generous frameless box with the card pinned to its
  // bottom, just above the bar.
  open() {
    const b = this.anchor;
    const z = Number(settings()?.zoom) || 1;
    const rows = Math.max(2, Object.keys(this.accounts).length) * 2;
    const height = b ? Math.min(140 + rows * 80, b.y / z - GAP) : 140 + rows * 80;
    const at = b ? { x: Math.max(0, b.x + b.width - (POPUP_W + GAP) * z), y: b.y - (height + GAP) * z } : undefined;
    openOverlay({ mod: "claude-usage", kind: "popup", frame: "none", width: POPUP_W, height, at, props: { details: true, height } });
  }

  bar(cx) {
    const t = theme();
    const account = this.focusedAccount(cx);
    const email = this.emails[account] ?? account;
    const shown = BAR.map(kind => windowsOf(this.accounts[account]).find(w => w.kind === kind)).filter(Boolean);
    const tip = shown.length
      ? `${email}\n` + shown.map(w => `${long(w)}: ${w.used}%, ${resets(w)}`).join("\n")
      : `${email}: no limits yet. They come with this account's next Claude reply.`;
    const edge = props()?.border;
    return h_flex().id("root").size_full().px(12).gap(10).items_center().bg(t.chrome).text_size(11.8)
      .when(edge === "top", el => el.border_t(1).border_color(t.border))
      .when(edge === "bottom", el => el.border_b(1).border_color(t.border))
      .on_mouse_down("left", (e, cx) => { this.anchor = e.bounds; cx.stop_propagation(); })
      .on_click(() => this.open())
      .tooltip(tip)
      .child(image("icons/claude.svg").size(14).flex_none())
      .child(div().flex_none().text_color(account === "gratiago" ? t.accent : t.ansi5).child(email))
      .when(!shown.length, el => el.child(div().text_color(t.dim).child("…")))
      .children(shown.map(w => h_flex().gap(6).items_center().flex_none()
        .child(div().text_color(t.dim).child(short(w)))
        .child(div().w(48).child(meter(w, t, 5)))
        .child(div().w(30).text_color(stale(w) ? t.dim : w.used >= 80 ? color(w, t) : t.muted).child(`${w.used}%`))));
  }

  details() {
    const t = theme();
    const names = Object.keys(this.accounts).sort((a, b) => (a === PERSONAL) - (b === PERSONAL));
    return v_flex().w_full().h(props().height ?? 0).justify_end().child(v_flex().w_full().p(14).gap(14).text_size(12).text_color(t.muted)
      .bg(t.popover).border(1).border_color(t.border).rounded(8)
      .child(h_flex().gap(8).items_center().child(image("icons/claude.svg").size(16))
        .child(div().text_size(13).font_semibold().text_color(t.foreground).child("Claude Usage")))
      .when(!names.length, el => el.child(div().text_color(t.dim).child("No limits yet: they come with the next Claude reply.")))
      .children(names.map(a => v_flex().gap(10)
        .child(div().font_semibold().text_color(a === "gratiago" ? t.accent : t.ansi5).child(this.emails[a] ?? a))
        .children(windowsOf(this.accounts[a]).map(w => v_flex().gap(6)
          .child(h_flex().justify_between().items_end()
            .child(div().text_color(t.foreground).child(long(w)))
            .child(div().text_size(18).font_semibold().text_color(color(w, t)).child(`${w.used}%`)))
          .child(meter(w, t, 6))
          .child(div().text_size(11.5).text_color(t.dim).child(resets(w))))))));
  }
}
