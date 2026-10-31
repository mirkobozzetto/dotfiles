// Your open Linear issues, with an `Agent` button that starts an agent on one in a new worktree.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, focused, exec, theme, home, appHome, readTextFile, nextCommand, openOverlay } from "herdr";
import { API_URL, ISSUES_QUERY, STATUSES, parseConfig, parseIssues, linearError, filterIssues, ago } from "./linear.js";
import { openUrl } from "./open.js";

const REFRESH_MS = 60000;
const NO_KEY = "No Linear API key. In a terminal: hop secret set LINEAR_API_KEY gratiago";
// Where `hop secret set` keeps it: the key never sits in a plain file.
const KEYCHAIN_SERVICE = "hop:gratiago:LINEAR_API_KEY";

// LINEAR_API_KEY from the environment, else from the macOS keychain.
async function envKey() {
  const script = 'printf %s "${LINEAR_API_KEY:-$(security find-generic-password -a "$USER" -s "$1" -w 2>/dev/null)}"';
  const r = await exec("sh", ["-c", script, "sh", KEYCHAIN_SERVICE]).catch(() => null);
  return r?.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

async function loadConfig() {
  const text = await readTextFile(`${appHome()}/linear.json`).catch(() => null);
  const config = parseConfig(text, home());
  if (!config.apiKey && !config.error) config.apiKey = await envKey();
  return config;
}

async function fetchIssues(apiKey) {
  const r = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: apiKey },
    body: JSON.stringify({ query: ISSUES_QUERY }),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(linearError(r.status, body));
  return parseIssues(JSON.parse(body));
}

// The focused pane's folder (else the focused terminal's, else the shown space's) and its machine.
function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}

const PRIORITY_COLORS = { 1: "ansi1", 2: "working" };

export default class Linear extends View {
  init(_props, cx) {
    this.issues = []; this.status = "all"; this.text = ""; this.generation = 0; this.loading = false;
    this.search = InputState.new({ placeholder: "Filter by id or title" });
    this.search.on("change", (_e, cx) => { this.text = this.search.value(); cx.notify(); });
    this.refresh(cx);
    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "refresh") this.refresh(cx);
        cx.notify();
      }
    });
  }

  refresh(cx) {
    const generation = ++this.generation;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const config = await loadConfig();
        this.config = config;
        if (config.error) throw new Error(config.error);
        if (!config.apiKey) throw new Error(NO_KEY);
        const issues = await fetchIssues(config.apiKey);
        if (generation === this.generation) { this.issues = issues; this.error = null; }
      } catch (e) { if (generation === this.generation) this.error = String(e.message ?? e); }
      finally { if (generation === this.generation) this.loading = false; cx.notify(); }
    });
    cx.notify();
  }

  // A team mapped in linear.json works on that folder here; otherwise the space you're in.
  startAgent(issue) {
    const { cwd, on } = location(), mapped = this.config?.repos?.[issue.team];
    openOverlay({ mod: "linear-agent", kind: "dialog", width: 480, height: 660,
      props: { issue, cwd: mapped ?? cwd, on: mapped ? null : on } });
  }

  chip(status, t) {
    const active = this.status === status.id;
    return h_flex().id(`status-${status.id}`).h(24).px(8).flex_none().items_center().rounded(6).cursor_pointer().text_size(11)
      .bg(active ? t.selected : t.raised).text_color(active ? t.foreground : t.muted)
      .hover((s) => s.bg(t.hover)).on_click((_e, cx) => { this.status = status.id; cx.notify(); }).child(status.label);
  }

  agentButton(issue, t) {
    return div().id(`agent-${issue.id}`).flex_none().px(7).h(20).flex().items_center().rounded(6)
      .text_size(11).text_color(t.muted).border_1().border_color(t.border).hover((s) => s.bg(t.raised).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); this.startAgent(issue); }).child("Agent");
  }

  meta(issue, t) {
    const priority = issue.priority > 0 ? issue.priorityLabel : null;
    return h_flex().flex_1().min_w(0).gap(8).items_center().overflow_hidden()
      .child(h_flex().flex_none().gap(5).items_center()
        .child(div().size(7).rounded_full().bg(issue.stateColor ?? t.dim))
        .child(div().text_color(t.muted).child(issue.state)))
      .when(Boolean(priority), (e) => e.child(div().flex_none().text_color(t[PRIORITY_COLORS[issue.priority]] ?? t.dim).child(priority)))
      .children(issue.labels.slice(0, 2).map((l) => div().flex_none().px(5).rounded(4).border_1()
        .border_color(`${l.color}88`).text_color(t.muted).child(l.name)));
  }

  row(issue, t) {
    return v_flex().id(`issue-${issue.id}`).flex_none().px(10).py(7).gap(3).rounded(7).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click(() => openUrl(issue.url))
      .child(h_flex().gap(8).items_center()
        .child(div().flex_none().text_size(11).text_color(t.accent).child(issue.identifier))
        .child(div().flex_1().min_w(0).truncate().child(issue.title))
        .child(this.agentButton(issue, t)))
      .child(h_flex().gap(8).items_center().text_size(11).text_color(t.dim)
        .child(this.meta(issue, t))
        .child(div().flex_none().child(`${issue.team} · ${ago(issue.updatedAt)}`)));
  }

  emptyText() {
    if (this.error) return this.error;
    if (this.loading) return "Loading…";
    return this.issues.length ? "No issues match these filters" : "No open issues assigned to you";
  }

  render() {
    const t = theme(), list = filterIssues(this.issues, { status: this.status, text: this.text });
    return v_flex().id("linear").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Linear"))
        .child(div().text_size(11).text_color(t.dim).child(`${this.issues.length} open`))
        .child(div().flex_1())
        .child(div().id("refresh").px(8).h(26).flex().items_center().rounded(7).cursor_pointer().text_size(11).text_color(t.muted)
          .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.refresh(cx)).child(this.loading ? "…" : "Refresh")))
      .child(h_flex().h(38).flex_none().px(8).gap(6).items_center().border_b(1).border_color(t.border)
        .children(STATUSES.map((s) => this.chip(s, t)))
        .child(div().flex_1().min_w(0).h(24).px(8).flex().items_center().rounded(6).border_1()
          .border_color(this.text.trim() ? t.accent : t.border).bg(t.background)
          .child(Input.new(this.search).h_full().text_size(11).text_color(t.foreground))))
      .child(v_flex().id("linear-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(2)
        .children(list.map((issue) => this.row(issue, t)))
        .when(!list.length, (e) => e.child(div().p(8).text_color(this.error ? t.ansi1 : t.dim).child(this.emptyText()))));
  }
}
