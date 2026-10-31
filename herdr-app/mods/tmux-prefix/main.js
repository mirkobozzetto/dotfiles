import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { closeOverlay, focused, hc, nextCommand, props, run, theme } from "herdr";
import { BINDINGS, GROUPS, UNLISTED_NOTE } from "./bindings.js";

// The keys of ~/dotfiles/herdr/config.toml, prefix ctrl+space. Only repeatable
// actions start a timer: the first key after the prefix can take as long as you like.
const REPEAT_MS = 500;
// Three groups per column, all shown at once.
const COLUMNS = [GROUPS.slice(0, 3), GROUPS.slice(3)];

function forwardKey(e, key) {
  if (["enter", "tab", "backspace", "left", "right", "up", "down", "space"].includes(e.key)) return e.key;
  if (key === " ") return "space";
  if (/^[A-Z]$/.test(key)) return `shift+${key.toLowerCase()}`;
  if (key.length === 1 && "abcdefghijklmnopqrstuvwxyz0123456789`\\[],=-.';/".includes(key)) return key === "\\" ? "backslash" : key;
  return null;
}

export default class TmuxPrefix extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.repeat = false;
    this.generation = 0;
    // The mod-specific key binding beats the global opener while we're open.
    cx.spawn(async (cx) => {
      for (;;) {
        await nextCommand();
        this.sendPrefix(cx);
      }
    });
  }

  dismiss() {
    closeOverlay(props().overlay);
  }

  send(key, cx) {
    this.generation++;
    const terminal = focused()?.terminal;
    if (!terminal) return this.dismiss();
    // hc starts its subprocess at the call, before closing cancels this view's tasks.
    const pending = hc(["keys", terminal, key]);
    cx.spawn(async () => {
      const result = await pending;
      if (result.code !== 0) console.log(`tmux-prefix: ${result.stderr}`);
    });
    this.dismiss();
  }

  sendPrefix(cx) {
    this.send("ctrl+space", cx);
  }

  key(e, cx) {
    cx.stop_propagation();
    const m = e.modifiers;
    if (e.key === "escape") return this.dismiss();
    if (m.control && e.key === "space") return this.sendPrefix(cx);
    // A Belgian Mac types | with option+shift+L: Option composing a character still counts as plain.
    const composed = m.alt && e.key_char && e.key_char !== e.key;
    const plain = !m.control && !m.platform && (!m.alt || composed);
    const key = plain ? (e.key_char ?? (m.shift && e.key.length === 1 ? e.key.toUpperCase() : e.key)) : e.key;
    const binding = plain && BINDINGS.find((b) => b[0] === key);
    if (!binding) {
      const forwarded = this.repeat && plain && forwardKey(e, key);
      if (forwarded) return this.send(forwarded, cx);
      return this.dismiss();
    }
    const [, , command, args = {}, repeatable = false] = binding;
    // A local action finishes before the popup closes: closing ends this view's tasks.
    if (typeof command === "function") {
      cx.spawn(async () => {
        await command().catch((e) => console.log(`tmux-prefix: ${e}`));
        this.dismiss();
      });
      return;
    }
    if (!repeatable) this.dismiss();
    run(command, args);
    if (repeatable) {
      this.repeat = true;
      const generation = ++this.generation;
      cx.timer.after(REPEAT_MS, () => {
        if (this.generation === generation) this.dismiss();
      });
      cx.notify();
    }
  }

  render() {
    const t = theme();
    const row = ([key, label, , , repeatable]) =>
      h_flex().h(20).flex_none().items_center().gap(10).child(div().w(28).text_color(t.accent).child(key))
        .child(div().flex_1().child(label)).child(div().text_color(t.dim).child(repeatable ? "repeat" : ""));
    const group = ([name, rows]) =>
      v_flex().gap(2).child(div().h(18).text_size(11).font_medium().text_color(t.dim).child(name)).children(rows.map(row));
    return v_flex().id("tmux-prefix").track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .size_full().p(14).gap(10).bg(t.popover).text_color(t.foreground).text_size(12)
      .child(h_flex().justify_between().child(div().font_semibold().child(this.repeat ? `Repeat · ${REPEAT_MS} ms` : "Ctrl+Space · waiting for a key"))
        .child(div().text_color(t.muted).child("Esc cancel · ^Space send prefix")))
      .child(h_flex().items_start().gap(24).children(COLUMNS.map((groups) => v_flex().flex_1().gap(10).children(groups.map(group)))))
      .child(div().text_color(t.muted).child(UNLISTED_NOTE));
  }
}
