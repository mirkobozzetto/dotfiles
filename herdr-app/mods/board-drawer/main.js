// The agent board as a drawer on a side edge: only the status column peeks
// out; hovering slides out every agent, grouped by state. Floating layouts
// draw one full layout and never change it on hover (AGENTS.md).
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
// No setAgentOrder here: agents-jump owns the order agent.next follows.
import { agents, placement, run, theme } from "herdr";

const STATES = [
  { key: "blocked", label: "Needs you" },
  { key: "working", label: "Working" },
  { key: "done", label: "Done" },
  { key: "idle", label: "Idle" },
];
// Same width as the layout's "peek", so the dots and counts are what peeks.
const PEEK = 52;
const WIDTH = 300;
const MAX_HEIGHT = 560;

const dot = (color, size = 8) => div().size(size).rounded(size).bg(color).flex_none();

export default class BoardDrawer extends View {
  render() {
    const t = theme();
    const list = agents();
    const onRight = placement()?.edge === "right";
    // The edge side holds the part that peeks.
    const row = (text, badge) => h_flex().w_full().items_center()
      .children(onRight ? [text, badge] : [badge, text]);
    const badge = (...kids) => h_flex().w(PEEK).flex_none().justify_center().items_center().gap(5)
      .children(kids);

    const groups = STATES.map(state => ({ ...state, color: t[state.key], cards: list.filter(a => a.status === state.key) }))
      .filter(g => g.cards.length);

    if (!groups.length) return row(
      div().flex_1().px(10).text_size(11).text_color(t.muted).child("No agents"),
      badge(dot(t.idle)));

    return v_flex().id("board-drawer").w(WIDTH).max_h(MAX_HEIGHT).overflow_y_scrollbar().gap(2)
      .children(groups.flatMap(g => [
        row(
          h_flex().flex_1().min_w(0).px(10).h(26).items_center().text_size(11).font_semibold().text_color(t.foreground)
            .child(g.label),
          badge(dot(g.color), div().text_size(11).text_color(g.color).child(String(g.cards.length)))),
        ...g.cards.map(a => row(
          v_flex().flex_1().min_w(0).px(10).py(4)
            .child(div().truncate().text_size(12).text_color(t.foreground).child(a.tab_name))
            .child(div().truncate().text_size(10).text_color(t.muted).child(a.space_name)),
          badge(dot(g.color, 6)))
          .id(`agent-${a.address}`).rounded(6).cursor_pointer()
          .when(a.focused, s => s.bg(t.selected))
          .hover(s => s.bg(t.hover))
          .on_click(() => run("agent.focus", { terminal: a.address }))),
      ]));
  }
}
