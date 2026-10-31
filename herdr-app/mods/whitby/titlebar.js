// Whitby's title bar (src/ui/mod.rs titlebar): 30px, two 224px slots around a
// centered "project - agent" caption, dimmed while the window is in the background.
// The attention bell (bell.js) sits near the window's top-right corner.

import { div, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, window } from "herdr";
import { palette, tabTitle } from "./kit.js";
import { bell } from "./bell.js";

// Always "Herdr: Whitby - …": the space and what it shows, else Whitby's Projects page.
export function caption() {
  const space = spaces().find((s) => s.active);
  const tab = space?.tabs.find((t) => t.active);
  const now = !space ? "Projects" : tab ? `${space.name} - ${tabTitle(tab)}` : space.name;
  return `Herdr: Whitby - ${now}`;
}

export function titlebar(v) {
  const t = palette();
  const active = window()?.active !== false;
  const ring = bell(v);
  return h_flex()
    .id("whitby-titlebar")
    .relative()
    .size_full()
    .pl(14)
    .pr(7)
    .items_center()
    .bg(t.canvas)
    .border_b(1)
    .border_color(t.border)
    .opacity(active ? 1 : 0.72)
    .transition("opacity", 120)
    .text_size(12.25)
    .font_weight(500)
    .text_color(t.muted)
    .child(div().w(224).h_full().flex_none())
    .child(h_flex().flex_1().min_w(0).h_full().gap(6).items_center().justify_center().opacity(active ? 1 : 0.82)
      // Whitby's mark (serve.svg) beside the caption, where macOS puts a window's icon.
      .child(image("mods/whitby/whitby.svg").w(19.5).h(14).flex_none())
      .child(div().min_w(0).truncate().child(caption())))
    .child(div().w(224).h_full().flex_none())
    .when(Boolean(ring), (el) => el.child(ring));
}
