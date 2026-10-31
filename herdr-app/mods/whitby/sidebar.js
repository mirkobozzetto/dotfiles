// Whitby's project sidebar (src/ui/sidebar_view.rs, collapsible.rs): a filter row,
// then each space as a project with a folding header and Agents and Terminals
// sections. A row is a tab: agent tabs under Agents, plain shells under Terminals.

import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, terminals, run, openOverlay, window, exec, layout } from "herdr";
import { palette, alpha, icon, lead, tabTitle, subCount, children, subStatus, stateOf, reportOf, isUnread, markRead, childTitle, sampleStats, badges, SHOW } from "./kit.js";

const SECTIONS = [
  { id: "agents", label: "AGENTS", icon: "sparkles", add: "Add agent" },
  { id: "terminals", label: "TERMINALS", icon: "square-terminal", add: "Add terminal" },
];

// Row geometry, for the one selection bar that slides between rows.
const ROW = 28, HEADER = 42, SECTION_GAP = 7, BODY_PAD = 5.25;

export function initSidebar(v, cx) {
  sampleStats(v, cx);
  v.folded = new Set(JSON.parse(localStorage.getItem("folded") ?? "[]"));
  v.filter = "";
  v.hover = null;
  v.hoverRow = null;
  v.hoverProject = null;
  v.input = InputState.new({ placeholder: "Filter Projects" });
  v.input.on("change", (_e, cx) => {
    v.filter = v.input.value().trim().toLowerCase();
    cx.notify();
  });
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// With no spaces, the work area shows Whitby's Projects page (the "home" block)
// instead of herdr's empty pane; the first space brings the agent view back.
function showHome(v, empty) {
  const want = empty ? "home" : "agent";
  const stack = find(layout(), "work");
  if (!stack || stack.active === want) { v.homeAsked = null; return; }
  if (v.homeAsked === want) return;
  v.homeAsked = want;
  run("layout.select", { stack: "work", child: want });
}

function toggle(v, key, cx) {
  v.folded.has(key) ? v.folded.delete(key) : v.folded.add(key);
  localStorage.setItem("folded", JSON.stringify([...v.folded]));
  cx.notify();
}

function select(space, tab) {
  if (!space.active) run("space.select", { id: space.id });
  if (tab) run("tab.select", { id: tab.id });
}

function add(space, section) {
  if (!space.active) run("space.select", { id: space.id });
  if (section.id === "terminals") run("tab.new", { space: space.id });
  else openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 });
}

// Where a space is now: its first terminal's folder, else where it was made.
function place(space, all) {
  const tabs = new Set(space.tabs.map((tab) => tab.id));
  return all.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || space.folder;
}

// Status dots, 7px in soft colors: green while running, blue when done, grey when idle,
// light grey when stopped, solid red on an error; working (green), blocked (red) and
// needs you (purple) pulse, slowly.
const PULSE = new Set(["working", "blocked", "needs"]);
export function statusMark(t, state) {
  // Up a pixel: centered on the row, a dot reads low beside a title's capitals.
  const dot = div().size(7).flex_none().rounded_full().relative().top(-1).bg(t.dot[state] ?? t.dot.stopped);
  return PULSE.has(state) ? dot.loop("opacity", { from: 0.35, to: 1, period: 1600, easing: "ease-in-out" }) : dot;
}

// Each level of sub-agents starts under its parent's title: past the 14px mark and its gap.
const NEST = 14 + 5.25;

// Whitby's resource badges on a row or a project header: 10px, muted.
// A list, so a row with nothing to show gets no element (and no gap) at all.
function stats(t, list) {
  return list.length ? [h_flex().flex_none().gap(4).text_size(10).text_color(t.muted).children(list.map((b) => div().child(b)))] : [];
}

// Every terminal a space runs: its panes' and the sub-agents under them.
function spaceTerminals(space, all, ts) {
  const tabs = new Set(space.tabs.map((tab) => tab.id));
  const under = (address) => children(address, ts).filter((c) => c.address).flatMap((c) => [c.address, ...under(c.address)]);
  return all.filter((p) => tabs.has(p.tab) && p.terminal).flatMap((p) => [p.terminal, ...under(p.terminal)]);
}

// The fold control on a row with sub-agents: shown on hover, and always while folded.
function fold(v, t, key, open, shown) {
  return div()
    .id(`fold-${key}`)
    .w(17.5)
    .h(17.5)
    .flex_none()
    .flex()
    .items_center()
    .justify_center()
    .rounded(3.5)
    .opacity(shown ? 1 : 0)
    .cursor_pointer()
    .hover((s) => s.bg(t.selected))
    // Acts on the press and stops it: inside a clickable row, the row's own click
    // would otherwise take it.
    .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); toggle(v, key, cx); })
    .child(icon(open ? "sidebar-chevron-down" : "sidebar-chevron-right", 10.5, alpha(t.muted, 0.4)));
}

// A row's title, the unread dot while it wants your attention unseen (see isUnread), and
// "(+N subagents)" while its sub-agents are folded away.
function title(t, text, unread, folded, count) {
  return h_flex().flex_1().min_w(0).items_center()
    .child(div().min_w(0).truncate().text_size(12.25).font_weight(600).child(text))
    // Whitby's unread dot, 5px, raised to the top of the title's capitals.
    .when(unread, (el) => el.child(div().ml(3).size(5).flex_none().rounded_full().relative().top(-4).bg(t.blue)))
    .when(folded, (el) => el.child(div().ml(4).flex_none().text_size(12.25).text_color(alpha(t.muted, 0.7)).child(`(+${count} ${count === 1 ? "subagent" : "subagents"})`)));
}

// Sub-agents under a terminal, depth first, each indented one level more; a folded
// parent hides its own. A terminal one peeks, as herdr's agents list does; a helper
// its agent reports (a record) goes to that agent.
function subRows(v, t, address, depth, all, ts, pos) {
  return children(address, ts).flatMap((c) => {
    const key = `kids:${c.key}`;
    const kids = c.address ? subCount(c.address, ts) : 0;
    const open = !v.folded.has(key);
    const owner = all.find((p) => p.terminal === c.parent);
    pos.y += ROW;
    const r = h_flex()
      .id(`sub-${c.key}`)
      .h(ROW)
      .flex_none()
      .pl(31.5 + NEST * depth)
      .pr(10.5)
      .gap(5.25)
      .items_center()
      .cursor_pointer()
      .text_color(t.muted)
      .hover((s) => s.bg(t.rowHover))
      .on_hover((on, cx) => { if (on) v.hoverRow = c.key; else if (v.hoverRow === c.key) v.hoverRow = null; cx.notify(); })
      .on_click(() => c.address ? run("terminal.peek", { terminal: c.address }) : owner ? run("pane.focus", { pane: owner.pane }) : run("terminal.peek", { terminal: c.parent }))
      .child(h_flex().w(14).flex_none().justify_center().items_center().child(statusMark(t, subStatus(c))))
      .child(title(t, childTitle(c), false, kids > 0 && !open, kids))
      .children(stats(t, badges(c.address && v.stats?.[c.address], SHOW.rowCpu, SHOW.rowMem)))
      .when(kids > 0, (el) => el.child(fold(v, t, key, open, v.hoverRow === c.key || !open)));
    return [r, ...(kids > 0 && open ? subRows(v, t, c.address, depth + 1, all, ts, pos) : [])];
  });
}

function row(v, t, space, tab, all, ts, selected, pos) {
  const p = lead(tab, all);
  const key = `kids:${p?.terminal}`;
  const kids = subCount(p?.terminal, ts);
  const open = !v.folded.has(key);
  if (selected) pos.selected = pos.y;
  pos.y += ROW;
  const r = h_flex()
    .id(`row-${tab.id}`)
    .h(ROW)
    .flex_none()
    .pl(31.5)
    .pr(10.5)
    .gap(5.25)
    .items_center()
    .cursor_pointer()
    .text_color(selected ? t.foreground : t.muted)
    .hover((s) => s.bg(t.rowHover))
    .on_hover((on, cx) => { if (on) v.hoverRow = tab.id; else if (v.hoverRow === tab.id) v.hoverRow = null; cx.notify(); })
    .on_click(() => select(space, tab))
    .on_mouse_down("right", () => openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: tab.id, space: space.id } } }))
    .child(h_flex().w(14).flex_none().justify_center().items_center().child(statusMark(t, stateOf(tab.status, true, reportOf(p?.terminal, ts)))))
    .child(title(t, tabTitle(tab, all), Boolean(p?.terminal) && isUnread(tab.status, p.terminal, ts), kids > 0 && !open, kids))
    .children(stats(t, badges(v.stats?.[p?.terminal], SHOW.rowCpu, SHOW.rowMem)))
    .when(kids > 0, (el) => el.child(fold(v, t, key, open, v.hoverRow === tab.id || !open)));
  return [r, ...(kids > 0 && open ? subRows(v, t, p.terminal, 1, all, ts, pos) : [])];
}

function addRow(t, space, section, pos) {
  pos.y += ROW;
  return h_flex()
    .id(`add-${space.id}-${section.id}`)
    .h(ROW)
    .flex_none()
    .pl(31.5)
    .pr(10.5)
    .gap(5.25)
    .items_center()
    .cursor_pointer()
    .text_size(10.5)
    .text_color(alpha(t.muted, 0.5))
    .hover((s) => s.text_color(t.muted))
    .on_click(() => add(space, section))
    .child(h_flex().w(14).flex_none().justify_center().child(icon("sidebar-plus", 10.5)))
    .child(div().child(section.add));
}

function section(v, t, space, sec, tabs, first, all, ts, pos) {
  const key = `${space.id}:${sec.id}`;
  const open = !v.folded.has(key);
  const working = tabs.filter((tab) => tab.status === "working").length;
  const count = sec.id === "agents" ? `${working}/${tabs.length}` : String(tabs.length);
  pos.y += (first ? 0 : SECTION_GAP) + ROW;
  const header = h_flex()
    .id(`sec-${key}`)
    .h(ROW)
    .flex_none()
    .px(10.5)
    .gap(5.25)
    .items_center()
    .when(!first, (el) => el.mt(SECTION_GAP))
    .on_hover((on, cx) => {
      if (on) v.hover = key;
      else if (v.hover === key) v.hover = null;
      cx.notify();
    })
    .child(div().id(`sec-fold-${key}`).ml(-5.25).w(21).h(21).flex_none().flex().items_center().justify_center().rounded(3.5)
      .cursor_pointer().hover((s) => s.bg(t.selected)).on_click((_e, cx) => toggle(v, key, cx))
      .child(icon(open ? "sidebar-chevron-down" : "sidebar-chevron-right", 10.5, alpha(t.muted, 0.4))))
    .child(h_flex().w(14).flex_none().justify_center().child(icon(sec.icon, 10.5, alpha(t.muted, 0.6))))
    .child(div().flex_none().text_size(10).font_weight(600).text_color(alpha(t.muted, 0.6)).child(sec.label))
    .child(div().flex_1().min_w(0).h(1).bg(alpha(t.muted, 0.15)))
    .child(div().id(`sec-add-${key}`).size(17.5).flex_none().flex().items_center().justify_center().rounded(3.5)
      .text_color(t.muted).opacity(v.hover === key ? 1 : 0).cursor_pointer().hover((s) => s.bg(t.hover))
      .tooltip(sec.add).on_click((_e, cx) => { cx.stop_propagation(); add(space, sec); })
      .child(icon("sidebar-plus", 10.5)))
    .child(div().flex_none().text_size(10).text_color(alpha(t.muted, 0.5)).child(count));
  if (!open) return [header];
  const shown = space.tabs.find((tab) => tab.active);
  const rows = tabs.flatMap((tab) => row(v, t, space, tab, all, ts, space.active && tab.id === shown?.id, pos));
  return [header, ...(rows.length ? rows : v.filter ? [] : [addRow(t, space, sec, pos)])];
}

// Whitby's hover action on a project header (Reveal in Finder, on by default).
function reveal(v, t, space, all) {
  const folder = place(space, all);
  return div()
    .id(`proj-reveal-${space.id}`)
    .size(18)
    .flex_none()
    .flex()
    .items_center()
    .justify_center()
    .rounded(3.5)
    .bg(t.selected)
    .text_color(t.muted)
    .opacity(v.hoverProject === space.id ? 1 : 0)
    .cursor_pointer()
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .tooltip("Reveal in Finder")
    .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); exec("open", [folder]); })
    .child(icon("folder", 10.5));
}

function project(v, t, space, all, ts, pos) {
  const open = !v.folded.has(space.id);
  const matches = (tab) => !v.filter || space.name.toLowerCase().includes(v.filter) || tabTitle(tab, all).toLowerCase().includes(v.filter);
  const tabs = space.tabs.filter((tab) => !tab.settled && matches(tab));
  if (v.filter && !tabs.length && !space.name.toLowerCase().includes(v.filter)) return [];
  const working = space.tabs.some((tab) => tab.status === "working");
  pos.y += HEADER;
  const header = h_flex()
    .id(`proj-${space.id}`)
    .h(HEADER)
    .flex_none()
    .px(10.5)
    .gap(5.25)
    .items_center()
    .bg(t.front)
    .border_b(1)
    .border_color(t.border)
    .when(open, (el) => el.shadow_xs())
    .cursor_pointer()
    .on_hover((on, cx) => { if (on) v.hoverProject = space.id; else if (v.hoverProject === space.id) v.hoverProject = null; cx.notify(); })
    .on_click(() => select(space, null))
    .on_mouse_down("right", () => openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: space.id } } }))
    .child(div().id(`proj-fold-${space.id}`).ml(-5.25).w(21).h(21).flex_none().flex().items_center().justify_center().rounded(3.5)
      .hover((s) => s.bg(t.selected))
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); toggle(v, space.id, cx); })
      .child(icon(open ? "sidebar-chevron-down" : "sidebar-chevron-right", 10.5, working ? t.running : alpha(t.muted, 0.4))))
    .child(div().flex_1().min_w(0).truncate().text_size(12.25).font_weight(700).text_color(t.foreground).child(space.name))
    .children(stats(t, badges(spaceTerminals(space, all, ts).reduce((sum, a) => {
      const s = v.stats?.[a];
      return s ? { cpu: sum.cpu + s.cpu, mem: sum.mem + s.mem } : sum;
    }, { cpu: 0, mem: 0 }), SHOW.projectCpu, SHOW.projectMem)))
    .when(!space.machine, (el) => el.child(reveal(v, t, space, all)));
  if (!open) return [header];
  const agents = tabs.filter((tab) => tab.status);
  const shells = tabs.filter((tab) => !tab.status);
  pos.y += BODY_PAD;
  const rows = [
    ...section(v, t, space, SECTIONS[0], agents, true, all, ts, pos),
    ...section(v, t, space, SECTIONS[1], shells, false, all, ts, pos),
  ];
  pos.y += BODY_PAD + 1;
  const body = v_flex()
    .id(`proj-body-${space.id}`)
    .flex_none()
    .py(BODY_PAD)
    .bg(t.body)
    .border_b(1)
    .border_color(t.border)
    .children(rows);
  return [header, body];
}

export function sidebar(v) {
  const t = palette();
  const all = panes();
  const ts = terminals();
  const active = window()?.active !== false;
  const pos = { y: 0, selected: null };
  showHome(v, spaces().length === 0);
  markRead(ts);
  const projects = spaces().flatMap((space) => project(v, t, space, all, ts, pos));
  // Whitby's selection: one blue bar, 85% of the row tall, sliding between rows in 200ms.
  const bar = pos.selected === null ? [] : [div().id("whitby-selection").absolute().left(1.75).top(pos.selected + ROW * 0.075)
    .w(3.5).h(ROW * 0.85).rounded_r(3.5).bg(t.blue).opacity(active ? 1 : 0.4)
    .transition("top", { duration: 200, easing: "ease-in-out" })];
  return v_flex()
    .id("whitby-sidebar")
    .size_full()
    .min_h(0)
    .bg(t.chrome)
    .child(h_flex().id("filter").h(35).flex_none().px(8).gap(4).items_center().border_b(1).border_color(t.border).bg(t.canvas)
      .child(icon("search", 14, t.muted))
      .child(Input.new(v.input).flex_1().min_w(0).py(4).px(4).bg(t.field).text_size(13).text_color(t.foreground)))
    .child(v_flex().id("projects").relative().flex_1().min_h(0).overflow_y_scrollbar()
      .children([...projects, ...bar]));
}
