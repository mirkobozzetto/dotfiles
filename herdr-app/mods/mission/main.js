import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, spaces, terminals, panes, props, run, setAgentOrder } from "herdr";

const C = { bg: "#030906", panel: "#07150e", line: "#234b32", green: "#99ffa9", muted: "#5d9270", amber: "#ffd16a", red: "#ff6554" };
const color = a => a.status === "blocked" ? C.red : a.status === "done" ? C.amber : a.status === "idle" ? C.muted : C.green;
const word = a => ({ working: "ACTIVE", blocked: "ATTENTION", done: "COMPLETE", idle: "STANDBY" })[a.status] ?? "STANDBY";
const label = (s, size = 11, c = C.muted) => div().flex_none().text_size(size).text_color(c).child(s);
const icon = a => !a.program.icon ? div().w(18) : (a.program.tint ? svg(a.program.icon).text_color(color(a)) : image(a.program.icon)).size(18);
const base = () => v_flex().size_full().font_family("JetBrains Mono").bg(C.bg).text_color(C.green).overflow_hidden();
function bar(a) {
  return h_flex().h(3).w_full().bg(C.line).child(div().h_full().bg(color(a)).w(a.status === "done" ? "100%" : a.status === "blocked" ? "100%" : a.status === "working" ? "45%" : "12%")
    .when(a.status === "working", e => e.loop("opacity", {from: 0.35, to: 1, period: 1800})));
}
function tile(a, index) {
  const alert = a.status === "blocked";
  return v_flex().id(`mission-${a.address}`).relative().flex_1().min_w(0).h_full().p(10).gap(3)
    .bg(alert ? "#2a100d" : C.panel).border(1).border_color(alert ? C.red : C.line)
    .on_click(() => run("agent.focus", {terminal: a.address}))
    .child(h_flex().items_center().gap(8).child(icon(a)).child(label(a.program.name.toUpperCase(), 12, color(a))).child(div().flex_1()).child(label(String(index + 3).padStart(2, "0"))))
    .child(label(`${a.space_name} / ${a.tab_name}`, 12, "#b4c8b8").truncate())
    .child(div().flex_1().min_h(0))
    .child(label(word(a), 26, color(a)))
    .child(bar(a).flex_none())
    .children([22, 46, 70, 94].map(y => div().absolute().left(0).right(0).top(y).h(1).bg("#99ffa908")))
    .when(alert, e => e.child(div().absolute().inset(0).border(2).border_color(C.red).loop("opacity", {from: 0.2, to: 1, period: 900})));
}

export default class Mission extends View {
  init(_p, cx) {
    this.started = Date.now();
    if (props()?.role === "top") cx.timer.every(1000, cx => cx.notify());
  }
  render() {
    const list = agents();
    const role = props()?.role;
    if (role === "top") {
      const known = terminals().filter(t => list.some(a => a.address === t.address)).map(t => t.created_ms).filter(n => Number.isFinite(n) && n > 0);
      if (known.length) this.started = Math.min(...known);
      const seconds = Math.max(0, Math.floor((Date.now() - this.started) / 1000));
      const clock = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, "0")).join(":");
      return h_flex().size_full().font_family("JetBrains Mono").bg(C.bg).px(24).items_center().gap(28).border_b(1).border_color(C.line)
        .child(v_flex().gap(1).child(label("MISSION ELAPSED", 10)).child(label(`T+ ${clock}`, 42, C.green)))
        .child(div().w(1).h(60).bg(C.line))
        .child(v_flex().gap(6).child(label("HERDR MISSION CONTROL", 26, "#d9ffe0")).child(label("AUTONOMOUS OPERATIONS / LIVE TELEMETRY", 11)))
        .child(div().flex_1())
        .child(v_flex().gap(12).children([ ["working", "ACTIVE", C.green], ["blocked", "NEEDS YOU", C.red], ["done", "COMPLETE", C.amber] ].map(([s,n,c]) => h_flex().gap(8).items_center().child(div().size(7).bg(c).rounded(4)).child(label(`${list.filter(a => a.status === s).length} ${n}`, 11, c)))));
    }
    if (role === "feeds") return h_flex().size_full().font_family("JetBrains Mono").items_center().justify_between().px(2)
      .child(label("01 / LIVE COMMAND FEEDS", 12, C.green))
      .child(label(`${spaces().find(s => s.active)?.name ?? ""} / ${spaces().find(s => s.active)?.tabs.find(t => t.active)?.name ?? ""}`, 12));
    if (role === "pane") {
      const pane = panes().find(p => p.pane === props().pane);
      const a = list.find(a => a.address === pane?.terminal);
      const peers = panes().filter(p => p.tab === pane?.tab && p.terminal);
      const primary = peers[0]?.pane === pane?.pane;
      return h_flex().size_full().font_family("JetBrains Mono").bg("#102719").px(14).items_center().gap(10)
        .child(label(primary ? "PRIMARY" : "SECONDARY", 14, C.green))
        .when(Boolean(a), e => e.child(icon(a)).child(label(a.program.name.toUpperCase(), 12, "#d9ffe0")))
        .child(div().flex_1()).child(label(a ? word(a) : "CONNECTED", 11, a ? color(a) : C.muted));
    }
    if (role === "grid") {
      const active = spaces().find(s => s.active)?.tabs.find(t => t.active)?.id;
      const rest = list.filter(a => a.tab !== active);
      setAgentOrder(list.map(a => a.address));
      const count = Math.max(1, Math.ceil(rest.length / 2));
      return base().gap(9)
        .child(h_flex().h(20).flex_none().justify_between().child(label("02 / DISTRIBUTED AGENT ARRAY", 12, C.green)).child(label(`${list.length} AGENTS / ${spaces().length} WORKSPACES`, 11)))
        .children([rest.slice(0,count),rest.slice(count)].filter(r=>r.length).map((row,i) => h_flex().flex_1().min_h(0).gap(10).children(row.map((a,j)=>tile(a,i*count+j)))));
    }
    return h_flex().size_full().font_family("JetBrains Mono").bg(C.bg).items_center().justify_between().border_t(1).border_color(C.line).px(24)
      .child(label("HERDR / FLIGHT OPERATIONS", 10)).child(label(`${list.filter(a=>a.status==="blocked").length} AWAITING OPERATOR  //  ALL FEEDS LIVE`, 10, C.amber)).child(label("MISSION CONTROL / LOCAL", 10));
  }
}
