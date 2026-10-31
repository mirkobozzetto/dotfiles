// Small pieces the walkthrough draws with.

import { div } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, Scrollbar } from "gpui-base";

/** kind: "solid" (the main action), "outline" or "ghost". A disabled button is dim and ignores clicks. */
export function button(t, id, label, onClick, { kind = "outline", disabled = false, small = false, tooltip = null } = {}) {
  const solid = kind === "solid";
  const el = h_flex().id(id).flex_none().h(small ? 24 : 28).px(small ? 8 : 11).gap(6).items_center().justify_center()
    .rounded(small ? 6 : 7).text_size(small ? 11.5 : 12)
    .when(kind === "outline", (e) => e.border_1().border_color(t.border))
    .when(solid && !disabled, (e) => e.bg(t.solid).text_color(t.solid_foreground))
    .when(solid && disabled, (e) => e.bg(t.raised).text_color(t.dim))
    .when(!solid, (e) => e.text_color(disabled ? t.dim : t.foreground))
    .when(!disabled, (e) => e.cursor_pointer().hover((s) => (solid ? s.opacity(0.9) : s.bg(t.hover))))
    .when(disabled, (e) => e.cursor_not_allowed())
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((e, cx) => { if (!disabled) onClick(e, cx); })
    .child(label);
  return tooltip ? el.tooltip(tooltip) : el;
}

/** A small bordered label. */
export const chip = (t, text, color, fill) => div().flex_none().px(6).h(18).flex().items_center().rounded(5).border_1()
  .border_color(color ?? t.border).when(Boolean(fill), (e) => e.bg(fill)).text_size(10.5).font_semibold().text_color(color ?? t.muted).child(text);

const ROW = 30, ROW_WITH_HINT = 44, MENU_MAX = 360;

/**
 * A picker's list: one row per option, the chosen one ticked, the highlighted
 * one (`active`, moved by the keyboard) filled. A virtual list, so the wheel
 * scrolls it and `scroll` (a VirtualListScrollHandle) keeps the highlight in
 * view; its rows take no handlers, so a click comes through `on_item_click`.
 */
export function menu(t, id, items, onPick, { width = 280, active = -1, scroll = null } = {}) {
  const frame = v_flex().id(`${id}-frame`).w(width).p(4).rounded(8).border_1().border_color(t.border).bg(t.popover).shadow_lg()
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    // The list scrolls first; the wheel stops here instead of also scrolling the page under the menu.
    .on_scroll_wheel((_e, cx) => cx.stop_propagation());
  if (!items.length) return frame.child(div().p(8).text_size(12).text_color(t.dim).child("Nothing to pick."));
  const sizes = items.map((item) => (item.hint ? ROW_WITH_HINT : ROW));
  const height = Math.min(MENU_MAX, sizes.reduce((a, b) => a + b, 0));
  const row = (item, i) => v_flex().w_full().h(sizes[i]).px(8).justify_center().rounded(6).cursor_pointer()
    .when(i === active, (e) => e.bg(t.hover))
    .when(item.selected && i !== active, (e) => e.bg(t.selected))
    .child(h_flex().gap(6).items_center()
      .child(div().w(12).flex_none().text_size(11).text_color(t.accent).child(item.selected ? "✓" : ""))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).child(item.label))
      .when(Boolean(item.right), (e) => e.child(div().flex_none().text_size(11).text_color(t.dim).child(item.right))))
    .when(Boolean(item.hint), (e) => e.child(div().pl(18).text_size(11).text_color(t.dim).truncate().child(item.hint)));
  let list = v_virtual_list(id, items.length, sizes, (i) => String(i), (range) => items.slice(range.start, range.end).map((item, k) => row(item, range.start + k)))
    .size_full()
    .on_item_click((key, cx) => { const item = items[Number(key)]; if (item) onPick(item, cx); });
  if (scroll) list = list.track_scroll(scroll);
  return frame.child(div().relative().w_full().h(height).child(list).child(Scrollbar.vertical(id).absolute().inset_0()));
}

/** A dropdown's face: its label and a caret. */
export function picker(t, id, label, onClick, { disabled = false, tooltip = null } = {}) {
  return button(t, id, h_flex().gap(5).items_center().child(div().max_w(220).truncate().child(label)).child(div().text_color(t.dim).text_size(9).child("▼")), onClick, { small: true, disabled, tooltip });
}

export const formatElapsed = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export const formatTokens = (n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
