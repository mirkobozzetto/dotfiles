// The attention bell (src/ui/notification_attention.rs): Whitby's blue bell and count
// badge, with no frame of its own, 10px from the window's top and 16px from its right, drawn
// by the title bar (it fits in its 30px). It shows only while agents are unread.

import { div } from "gpui-kit";
import { run } from "herdr";
import { palette, icon, alpha, unreadAgents } from "./kit.js";
import { hovered, trackHover, fadeLayer, pressLayer, withTip } from "./rail.js";

const BELL = 18, TOP = 10, RIGHT = 16, PAD = 3;

// The bell's body rests in the light or dark surface color, fills with light blue as the
// pointer comes onto it (and empties as it leaves), and a fill shows over it while
// it's pressed. A click goes to the most urgent unread agent. Positioned in the title
// bar, whose top-right is the window's.
export function bell(v) {
  const t = palette();
  const waiting = unreadAgents();
  if (!waiting.length) return null;
  const tip = `${waiting.length} unread ${waiting.length === 1 ? "agent" : "agents"}`;
  const glyph = (name, color) => div().absolute().top(PAD).left(PAD).size(BELL).child(icon(name, BELL, color));
  // The target stops inside the 30px title bar: a hit area hanging past its edge
  // lets the pointer leave downward without the title bar seeing it go.
  const target = trackHover(div()
    .id("whitby-bell")
    .relative()
    .w(BELL + PAD * 2)
    .h(30 - (TOP - PAD) - 1), v, "bell")
    .child(glyph("attention-bell-fill", t.front))
    .child(fadeLayer("whitby-bell-fill", hovered(v, "bell"), glyph("attention-bell-fill", t.dark ? "#4a6aa8" : "#c6d8fc")))
    .child(glyph("attention-bell", t.blue))
    .child(pressLayer("whitby-bell-press", alpha(t.blue, 0.14), 6, () => run("pane.focus", { pane: waiting[0].pane })))
    .child(div().absolute().top(PAD - 4).left(PAD + BELL - 9).min_w(14).px(3.5).py(1.75).rounded_full().bg(t.blue)
      .text_color("#ffffff").text_size(10.5).line_height("10.5px").font_weight(600).flex().justify_center()
      .child(waiting.length > 9 ? "9+" : String(waiting.length)));
  return div().absolute().top(TOP - PAD).right(RIGHT - PAD).child(withTip("bell", tip, target));
}
