import { View, div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { home, readTextFile, shared, setShared, props, openOverlay, settings, theme } from "herdr";

const KEY = "claude-usage";
const EVERY = 60e3;
// One missed cycle plus slack, so a slow fetch doesn't flash the bar grey.
const STALE = 12 * 60e3;
const SPAN = { session: 5 * 3600e3, weekly_all: 7 * 86400e3, weekly_scoped: 7 * 86400e3 };
const BAR = ["session", "weekly_all"];
const CLAY = { session: "#b98253", weekly_all: "#856144", weekly_scoped: "#856144" };
const AMBER = "#ffb347", RED = "#ff5d6c";
const POPUP_W = 300, GAP = 6;

// Claude Code's status line already writes the plan's limits here on every render
// (vibe-island bridge): no OAuth token to read, no request to api.anthropic.com.
const CACHE = ".vibe-island/cache/rl.json";
const WINDOWS = [["five_hour", "session"], ["seven_day", "weekly_all"]];

function windowsOf(data) {
  return WINDOWS.filter(([k]) => typeof data[k]?.used_percentage === "number")
    .map(([k, kind]) => ({ kind, used: data[k].used_percentage, resets_at: new Date(data[k].resets_at * 1000).toISOString() }));
}

async function refresh() {
  const prev = shared(KEY) ?? {};
  const now = new Date().toISOString();
  try {
    const windows = windowsOf(JSON.parse(await readTextFile(`${home()}/${CACHE}`)));
    if (!windows.length) throw new Error("no limits in the status line cache yet");
    setShared(KEY, { checked: now, fetched: now, error: null, windows });
  } catch (e) {
    setShared(KEY, { ...prev, checked: now, error: String(e?.message ?? e) });
  }
}

const short = w => ({ session: "5h", weekly_all: "7d" })[w.kind] ?? `7d ${w.model ?? ""}`.trim();
const long = w => ({ session: "5-hour limit", weekly_all: "Weekly limit" })[w.kind] ?? `Weekly ${w.model ?? "model"} limit`;

function pace(w) {
  const end = Date.parse(w.resets_at), span = SPAN[w.kind];
  if (!end || !span) return null;
  return Math.min(1, Math.max(0, 1 - (end - Date.now()) / span));
}

function color(w, stale, t) {
  if (stale) return t.dim;
  if (w.used >= 95) return RED;
  if (w.used >= 80) return AMBER;
  return CLAY[w.kind] ?? CLAY.weekly_all;
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
  const left = Math.max(0, end - Date.now());
  if (left < 24 * 3600e3) {
    const h = Math.floor(left / 3600e3), m = Math.round((left % 3600e3) / 60e3);
    return `resets in ${h ? `${h}h ` : ""}${m}m, at ${clock(end)}`;
  }
  return `resets ${DAYS[new Date(end).getDay()]} at ${clock(end)}`;
}

// The elapsed share of the window is drawn as a ghost fill: lit past it means running ahead of pace.
function meter(w, stale, t, height) {
  const used = Math.min(100, Math.max(0, w.used ?? 0));
  const ghost = stale ? null : pace(w);
  return div().relative().w_full().h(height).rounded(height / 2).bg(t.border)
    .when(ghost !== null, el => el.child(div().absolute().left(0).top(0).h_full().w(`${ghost * 100}%`).rounded(height / 2).bg(t.dim).opacity(0.35)))
    .child(div().absolute().left(0).top(0).h_full().w(`${used}%`).rounded(height / 2).bg(color(w, stale, t)));
}

export default class ClaudeUsage extends View {
  init(_props, cx) {
    if (props()?.overlay) return;
    const tick = cx => {
      const last = Date.parse(shared(KEY)?.checked ?? "") || 0;
      if (Date.now() - last >= EVERY) cx.spawn(async () => refresh());
      cx.notify();
    };
    cx.timer.every(60e3, tick);
    tick(cx);
  }

  render() {
    return props()?.overlay ? this.details() : this.bar();
  }

  // At the pointer, a popup on a bottom bar gets pushed back into the window over the bar. Its height
  // can't be measured before it opens, so it is a generous frameless box with the card pinned to its
  // bottom, just above the bar.
  open() {
    const b = this.anchor;
    const z = Number(settings()?.zoom) || 1;
    const rows = Math.max(3, shared(KEY)?.windows?.length ?? 0);
    const height = b ? Math.min(120 + rows * 90, b.y / z - GAP) : 120 + rows * 90;
    const at = b ? { x: Math.max(0, b.x + b.width - (POPUP_W + GAP) * z), y: b.y - (height + GAP) * z } : undefined;
    openOverlay({ mod: "claude-usage", kind: "popup", frame: "none", width: POPUP_W, height, at, props: { details: true, height } });
  }

  bar() {
    const t = theme();
    const u = shared(KEY);
    const stale = !u?.fetched || Boolean(u.error) || Date.now() - Date.parse(u.fetched) > STALE;
    const shown = BAR.map(kind => u?.windows?.find(w => w.kind === kind)).filter(Boolean);
    const edge = props()?.border;
    const tip = shown.length
      ? shown.map(w => `${long(w)}: ${w.used}%, ${resets(w)}`).join("\n") + (u.error ? `\n${u.error}` : "")
      : u?.error ?? "Loading Claude usage";
    return h_flex().id("root").size_full().px(12).gap(12).items_center().bg(t.chrome).text_size(11.8)
      .when(edge === "top", el => el.border_t(1).border_color(t.border))
      .when(edge === "bottom", el => el.border_b(1).border_color(t.border))
      .on_mouse_down("left", (e, cx) => { this.anchor = e.bounds; cx.stop_propagation(); })
      .on_click(() => this.open())
      .tooltip(tip)
      .child(image("icons/claude.svg").size(14).flex_none().opacity(stale ? 0.5 : 1))
      .when(!shown.length, el => el.child(div().text_color(t.dim).child(u?.error ? "no data" : "…")))
      .children(shown.map(w => h_flex().gap(6).items_center().flex_none()
        .child(div().text_color(t.dim).child(short(w)))
        .child(div().w(80).child(meter(w, stale, t, 5)))
        .child(div().w(30).text_color(stale ? t.dim : w.used >= 80 ? color(w, stale, t) : t.muted).child(`${w.used}%`))));
  }

  details() {
    const t = theme();
    const u = shared(KEY);
    const stale = !u?.fetched || Boolean(u.error) || Date.now() - Date.parse(u.fetched) > STALE;
    const footer = !u?.fetched ? (u?.error ?? "not fetched yet")
      : u.error ? `fetch failed: ${u.error} · data from ${clock(Date.parse(u.fetched))}`
      : `updated ${clock(Date.parse(u.fetched))}`;
    return v_flex().w_full().h(props().height ?? 0).justify_end().child(v_flex().w_full().p(14).gap(14).text_size(12).text_color(t.muted)
      .bg(t.popover).border(1).border_color(t.border).rounded(8)
      .child(h_flex().justify_between().items_center()
        .child(h_flex().gap(8).items_center().child(image("icons/claude.svg").size(16))
          .child(div().text_size(13).font_semibold().text_color(t.foreground).child("Claude Usage")))
        .child(div().id("refresh").px(6).py(2).rounded(5).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => cx.spawn(async () => refresh())).child("Refresh")))
      .children((u?.windows ?? []).map(w => v_flex().gap(6)
        .child(h_flex().justify_between().items_end()
          .child(div().text_color(t.foreground).child(long(w)))
          .child(div().text_size(18).font_semibold().text_color(color(w, stale, t)).child(`${w.used}%`)))
        .child(meter(w, stale, t, 6))
        .child(div().text_size(11.5).text_color(t.dim).child(resets(w)))))
      .child(div().text_size(11.5).text_color(u?.error ? t.blocked : t.dim).child(footer)));
  }
}
