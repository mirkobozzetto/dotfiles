import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme, run } from "herdr";

export default class WorkspaceStatus extends View {
  // Agents by state, each in its color: "3 working · 1 needs you · 2 done".
  // A click on "needs you" goes to the next agent waiting, as ctrl+space enter does.
  counts(t, list) {
    const n = (status) => list.filter(a => a.status === status).length;
    const parts = [["working", n("working"), "working"], ["blocked", n("blocked"), "needs you"], ["done", n("done"), "done"]]
      .filter(([, count]) => count > 0);
    const next = () => {
      const waiting = list.filter(a => a.status === "blocked");
      const at = waiting.findIndex(a => a.focused);
      if (waiting.length) run("agent.focus", { terminal: waiting[(at + 1) % waiting.length].address });
    };
    const row = h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim));
    if (!parts.length) return row.child(`${list.length} agents`);
    return row.children(parts.flatMap(([status, count, words], i) => [
      ...(i ? [div().text_color(t.dim).child("·")] : []),
      div().id(`count-${status}`).text_color(t[status]).when(status === "blocked", el => el.cursor_pointer().on_click(next)).child(`${count} ${words}`),
    ]));
  }

  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const list = agents();
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      // The machine only when it isn't this one: "This computer" took the agents' room.
      .when(Boolean(space?.machine), el => el.child(label("server", space.machine)))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .child(this.counts(t, list))
      // No palette hint: the bar is full, and cmd+/ lists the key.
      .child(div().flex_1());
  }
}
