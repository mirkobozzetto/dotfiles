import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { appHome, closeOverlay, focused, hc, layout, nextCommand, notify, props, readTextFile, run, spaces, theme, writeTextFile } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Same as the panel buttons of my-tabs: close the panel when it's the one shown, else show it.
async function togglePanel(id) {
  const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
  if (panel && !panel.hidden && body?.active === id) run("layout.hide", { id: "panel" });
  else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
}

// One step left or right in its space, stopping at the ends.
async function moveTab(step) {
  const tabs = spaces().find((s) => s.active)?.tabs ?? [];
  const tab = tabs.find((t) => t.active);
  if (!tab) return;
  const index = Math.min(tabs.length, Math.max(1, tab.index + step));
  if (index !== tab.index) run("tab.move", { id: tab.id, index });
}

// Sound alerts on/off: settings.json `sounds.enabled`, which Herdr applies live.
async function toggleSound() {
  const path = `${appHome()}/settings.json`;
  const text = await readTextFile(path);
  const settings = JSON.parse(text ?? "{}");
  const enabled = settings.sounds?.enabled === false;
  settings.sounds = { ...settings.sounds, enabled };
  await writeTextFile(path, `${JSON.stringify(settings, null, 2)}\n`, text);
  notify({ title: enabled ? "Sound alerts on" : "Sound alerts off", level: "info", timeout: 2000 });
}

// The keys of ~/dotfiles/herdr/config.toml, prefix ctrl+space. Only repeatable
// actions start a timer: the first key after the prefix can take as long as you like.
const REPEAT_MS = 500;
const BINDINGS = [
  ["c", "New tab", "tab.new"],
  ["|", "Split right", "pane.split", { direction: "right" }],
  ["-", "Split down", "pane.split", { direction: "down" }],
  ["x", "Close pane", "pane.close"],
  ["X", "Close tab", "tab.close"],
  ["n", "Next tab", "tab.next", {}, true],
  ["p", "Previous tab", "tab.prev", {}, true],
  [")", "Next space", "space.next", {}, true],
  ["(", "Previous space", "space.prev", {}, true],
  ["g", "Next agent", "agent.next", {}, true],
  ["s", "Go to anything", "mod.open", { name: "picker" }],
  ["o", "Launcher", "mod.open", { name: "launcher" }],
  ["w", "Go to anything", "mod.open", { name: "picker" }],
  ["e", "Toggle sidebar", "layout.toggle", { id: "sidebar" }],
  ["t", "Rename tab", "tab.rename"],
  ["S", "Settings", "app.settings"],
  ["q", "Minimize window", "window.minimize"],
  ["h", "Focus left", "pane.go", { direction: "left" }, true],
  ["j", "Focus down", "pane.go", { direction: "down" }, true],
  ["k", "Focus up", "pane.go", { direction: "up" }, true],
  ["l", "Focus right", "pane.go", { direction: "right" }, true],
  ["left", "Focus left", "pane.go", { direction: "left" }, true],
  ["down", "Focus down", "pane.go", { direction: "down" }, true],
  ["up", "Focus up", "pane.go", { direction: "up" }, true],
  ["right", "Focus right", "pane.go", { direction: "right" }, true],
  ["J", "Next space", "space.next", {}, true],
  ["K", "Previous space", "space.prev", {}, true],
  ["z", "Zoom pane", "pane.zoom"],
  ["m", "Sound alerts on/off", toggleSound],
  ["<", "Move tab left", () => moveTab(-1)],
  [">", "Move tab right", () => moveTab(1)],
  ["f", "Files panel", () => togglePanel("files")],
  ["d", "Changes panel", () => togglePanel("changes")],
  ["G", "Graph panel", () => togglePanel("graph")],
  ["b", "GitHub panel", () => togglePanel("github")],
  ["T", "Rename space", "space.rename"],
  [":", "Command palette", "app.palette"],
  ["i", "Linear issues", "mod.open", { name: "linear" }],
  ["r", "Walk through the diff", "mod.open", { name: "walkthrough" }],
  ["y", "Agent's last answer", "mod.open", { name: "fleece" }],
  ...Array.from({ length: 10 }, (_, i) => [String(i), `Tab ${i === 0 ? 10 : i}`, "tab.select", { index: i === 0 ? 10 : i }]),
];

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
    this.all = false;
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
    if (plain && key === "?") {
      this.all = !this.all;
      this.repeat = false;
      this.generation++;
      cx.notify();
      return;
    }
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
    const rows = this.all ? BINDINGS : BINDINGS.filter(([key]) => !["left", "right", "up", "down"].includes(key) && !/^\d$/.test(key));
    return v_flex().id("tmux-prefix").track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .p(14).gap(8).bg(t.popover).text_color(t.foreground).text_size(12)
      .child(h_flex().justify_between().child(div().font_semibold().child(this.repeat ? `Repeat · ${REPEAT_MS} ms` : "Ctrl+Space · waiting for a key"))
        .child(div().text_color(t.muted).child("Esc cancel · ^Space send prefix")))
      .child(v_flex().h(280).min_h(0).overflow_y_scrollbar().children(rows.map(([key, label, , , repeatable]) =>
        h_flex().h(20).flex_none().items_center().gap(12).child(div().w(40).text_color(t.accent).child(key))
          .child(div().flex_1().child(label)).child(div().text_color(t.dim).child(repeatable ? "repeat" : "")))))
      .child(div().text_color(t.muted).child("0–9 tabs (0 = 10) · arrows focus · ? all bindings"));
  }
}
