// Whitby's Projects page (src/ui/projects_home.rs) as herdr's empty window: shown in
// place of the agent pane while there are no spaces. A heading, a card whose
// "Add project" row picks a folder for a new space, Whitby's faint platter under it,
// and a legend of herdr's own shortcuts in Whitby's places.

import { div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, run, pickFolder } from "herdr";
import { palette, alpha, icon, keyFor } from "./kit.js";

// Whitby's legend, with herdr's commands for each idea; only bound keys show.
const HINTS = [
  ["app.palette", "Search"],
  ["mod.open:picker", "Jump"],
  ["space.new", "New project"],
  ["tab.new", "New tab"],
  ["app.settings", "Settings"],
  ["app.help", "Help"],
];

// The artwork's own proportions (assets/splash/whitby-wide-platter.svg).
const PLATTER = 273.89 / 470.0722;

export function initHome(v) {
  v.adding = false;
  v.hoverAdd = false;
  v.column = 406;
}

function addProject(v, cx) {
  if (v.adding) return;
  v.adding = true;
  cx.notify();
  cx.spawn(async (cx) => {
    try {
      const folder = await pickFolder({ prompt: "Add project" });
      if (folder) run("space.new", { folder });
    } finally {
      v.adding = false;
      cx.notify();
    }
  });
}

function legend(t) {
  const hints = HINTS.map(([command, label]) => [label, keyFor(command)]).filter(([, key]) => key);
  return v_flex().mt(10.5).w_full().items_end().gap(1.75).text_size(10.5).text_color(alpha(t.muted, 0.75))
    .children(hints.map(([label, key]) => h_flex().gap(5.25).items_center().line_height("14px")
      .child(div().child(label))
      .child(div().font_family("Menlo").text_color(alpha(t.muted, 0.65)).child(key))));
}

export function home(v) {
  const t = palette();
  const count = spaces().length;
  const border = t.dark ? "#272a2d" : "#e0e1e6";
  const add = h_flex()
    .id("home-add")
    .relative()
    .w_full()
    .py(7)
    .px(10.5)
    .pr(35)
    .gap(10.5)
    .items_center()
    .border_t(1)
    .border_color(alpha(border, 0.5))
    .text_size(12.25)
    .line_height("17.5px")
    .text_color(t.foreground)
    .when(!v.adding, (el) => el.cursor_pointer())
    .on_hover((on, cx) => { v.hoverAdd = on; cx.notify(); })
    .on_click((_e, cx) => addProject(v, cx))
    .child(div().size(14).flex_none().opacity(0.45).child(icon("plus", 14, t.muted)))
    .child(div().flex_1().min_w(0).truncate().child(v.adding ? "Choosing folder..." : "Add project"))
    // Whitby's arrow: muted at half strength, fading in on hover.
    .child(div().id("home-add-arrow").absolute().right(10.5).top(0).bottom(0).w(14).flex().items_center()
      .opacity(v.hoverAdd && !v.adding ? 0.5 : 0).transition("opacity", 150)
      .child(icon("arrow-right", 14, t.muted)));
  const card = v_flex().id("home-card").w_full().min_w(0).rounded(7).border(1).border_color(border)
    .bg(t.dark ? "#18191b" : "#f9f9fb").overflow_hidden().child(add);
  // The platter sits just below the card, 120% of the column wide, at 5%.
  const wide = v.column * 1.2;
  const platter = div().absolute().left(0).top("100%").w_full().flex().justify_center()
    .child(image("mods/whitby/platter.svg").w(wide).h(wide * PLATTER).flex_none().opacity(0.05));
  const column = v_flex()
    .id("home-column")
    .w_full()
    .max_w(406)
    .min_w(0)
    .items_start()
    .on_size_change((size, cx) => { if (size.width !== v.column) { v.column = size.width; cx.notify(); } })
    .child(h_flex().gap(8.75).items_center().text_size(14).line_height("21px").font_weight(600).text_color(t.foreground)
      .child(icon("folder-open", 14, t.muted))
      .child(div().child("Projects")))
    .child(div().mt(3.5).text_size(12.25).line_height("17.5px").text_color(alpha(t.muted, 0.7))
      .child("All the projects loaded in Herdr."))
    .child(div().mt(17.5).text_size(10.5).line_height("14px").text_color(t.muted)
      .child(`${count} ${count === 1 ? "project" : "projects"}`))
    .child(div().relative().mt(7).w_full().child(platter).child(card))
    .child(legend(t));
  return h_flex()
    .id("whitby-home")
    .size_full()
    .overflow_hidden()
    .px(21)
    .items_center()
    .justify_center()
    .bg(t.canvas)
    .child(column);
}
