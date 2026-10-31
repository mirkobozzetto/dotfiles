// Every shortcut in one list, filterable by typing: Herdr's keys.json (through
// keys()), the ctrl+space menu, and the agents' own keys.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { appHome, keys, props, closeOverlay, readTextFile, theme } from "herdr";
import { AGENT_KEYS } from "./agents.js";

// A mod can't import another mod's files, so the ctrl+space menu is read from
// its source: one `["Group", [` line per group, one `["key", "label", …` per row.
async function prefixGroups() {
  const text = await readTextFile(`${appHome()}/mods/tmux-prefix/bindings.js`);
  const groups = [];
  for (const line of (text ?? "").split("\n")) {
    const group = line.match(/^\s*\["(\w+)", \[$/);
    const row = line.match(/^\s*\["([^"]+)", "([^"]+)"/);
    if (group) groups.push([group[1], []]);
    else if (row && groups.length) groups.at(-1)[1].push([row[1], row[2]]);
  }
  return groups;
}

const HERDR_GROUPS = [
  ["spaces", /^space\./],
  ["tabs", /^tab\./],
  ["panes", /^pane\./],
  ["agents", /^agent\./],
  ["terminal", /^terminal\.|^send:/],
  ["window", /./],
];

function label(action) {
  if (action.startsWith("send:")) return "type " + JSON.stringify(action.slice(5));
  const [name, arg] = action.split(":");
  const words = name.replace(/[._]/g, " ");
  return arg ? `${words} ${arg}` : words;
}

// [title, [[keys, what]]], in the order shown.
function sections(prefix) {
  const herdr = keys().filter((k) => !k.section.startsWith("mod:"));
  const seen = new Set();
  return [
    ...HERDR_GROUPS.map(([name, re]) => [`Herdr · ${name}`, herdr
      .filter((k) => !seen.has(k) && re.test(k.action) && seen.add(k))
      .map((k) => [k.keys + (k.section !== "global" ? `  (${k.section})` : ""), label(k.action)])]),
    ...prefix.map(([name, rows]) => [`Ctrl+Space · ${name}`, rows.map(([key, what]) => [`ctrl+space ${key}`, what])]),
    ...AGENT_KEYS,
  ];
}

export default class KeysHelp extends View {
  init(_props, cx) {
    this.filter = "";
    this.prefix = [];
    cx.spawn(async (cx) => {
      this.prefix = await prefixGroups().catch(() => []);
      cx.notify();
    });
    this.input = InputState.new({ placeholder: "Search a key or an action…" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); cx.notify(); });
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  render() {
    const t = theme();
    const f = this.filter.toLowerCase();
    const shown = sections(this.prefix)
      .map(([title, rows]) => [title, title.toLowerCase().includes(f) ? rows
        : rows.filter(([k, what]) => k.toLowerCase().includes(f) || what.toLowerCase().includes(f))])
      .filter(([, rows]) => rows.length > 0);
    return v_flex()
      .id("keys-help")
      .track_focus(this.handle)
      .on_key_down((e) => {
        if (e.key === "escape") closeOverlay(props().overlay);
      })
      .size_full().min_h(0).p(18).gap(14).bg(t.popover).text_size(12)
      .child(h_flex().h(22).items_center().justify_between()
        .child(div().text_size(15).font_semibold().text_color(t.foreground).child("All shortcuts"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(Input.new(this.input).h(36).flex_none().px(10).rounded(9).border_1().border_color(t.accent).bg(t.background).text_size(12.8).text_color(t.foreground))
      // A popup takes its content's height: a flex list would shrink to nothing.
      .child(v_flex().h(500).flex_none().overflow_y_scrollbar().py(2).gap(10).children(shown.map(([title, rows]) =>
        v_flex().gap(2)
          .child(div().text_size(11.5).font_medium().text_color(t.dim).child(title))
          .children(rows.map(([k, what]) => h_flex().h(28).px(8).rounded(7).items_center()
            .child(div().w(220).text_color(t.accent).child(k))
            .child(div().text_color(t.foreground).child(what)))))));
  }
}
