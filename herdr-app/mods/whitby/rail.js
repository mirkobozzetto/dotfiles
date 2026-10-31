// Whitby's app rail (src/ui/app_rail.rs): 48px, its buttons at the bottom.
// Add opens a new space (Whitby: add a project); Settings opens herdr's settings.

import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { run } from "herdr";
import { palette, icon, alpha } from "./kit.js";

const FADE = { duration: 150, easing: "ease-out" };

// Hover state, which drives the fades. It comes from on_hover on a control's outer
// element, which doesn't take the press: on the element that does, a press dragged off
// and released elsewhere never reports the pointer leaving, and the hover sticks.
export function hovered(v, id) {
  return Boolean(v.hovered?.has(id));
}

export function trackHover(el, v, id) {
  return el.on_hover((on, cx) => {
    v.hovered ??= new Set();
    on ? v.hovered.add(id) : v.hovered.delete(id);
    cx.notify();
  });
}

// A layer that fades in over 150ms while the control is hovered, and out after.
export const fadeLayer = (id, on, child) =>
  div().id(id).absolute().inset(0).opacity(on ? 1 : 0).transition("opacity", FADE).child(child);

// The top layer takes the press. Its fill is GPUI's active style: it shows at once and
// ends when the button is released, wherever that is. Translucent, over the glyph.
export const pressLayer = (id, color, radius, action) =>
  div().id(id).absolute().inset(0).rounded(radius).cursor_pointer().active((s) => s.bg(color))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click(action);

// A tooltip takes the pointer from whatever element it's on, so it goes on a wrapper.
export const withTip = (id, tip, el) => div().id(`${id}-tip`).flex_none().tooltip(tip).child(el);

const centered = (child) => div().size_full().flex().items_center().justify_center().child(child);

// A rail button: 28px, rounded 7, a 1px line, resting on the light or dark surface.
// On hover its fill and its glyph (muted to full) fade in and out over 150ms; while
// it's pressed a fill shows over it at once.
function railButton(v, t, id, glyph, tip, action) {
  const on = hovered(v, id);
  return withTip(id, tip, trackHover(div()
    .id(id)
    .relative()
    .size(28)
    .flex_none()
    .rounded(7)
    .border(1)
    .border_color(t.border)
    .bg(t.canvas), v, id)
    .child(fadeLayer(`${id}-fill`, on, div().size_full().rounded(6).bg(t.hover)))
    .child(div().absolute().inset(0).child(centered(icon(glyph, 18, t.muted))))
    .child(fadeLayer(`${id}-ink`, on, centered(icon(glyph, 18, t.foreground))))
    .child(pressLayer(`${id}-press`, alpha(t.foreground, 0.08), 6, action)));
}

export function rail(v) {
  const t = palette();
  return v_flex()
    .id("whitby-rail")
    .size_full()
    .py(7)
    .gap(3.5)
    .items_center()
    .bg(t.canvas)
    .child(div().flex_1())
    .child(div().my(5.25).child(railButton(v, t, "rail-add", "plus", "New space", () => run("space.new"))))
    .child(div().my(5.25).child(railButton(v, t, "rail-settings", "settings", "Settings", () => run("app.settings"))));
}
