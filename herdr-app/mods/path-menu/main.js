// Context menus (Herdr's items). Opened as a popup with
// props { tab: "pane" | "tab" | "space" | "global", target }.
// path-menu: a terminal right-click also lists the files and folders on screen, to open
// them or show them in the file manager. Based on Herdr's shipped `menu` mod (Apache-2.0).
// ↑/↓ move, Enter runs, Esc closes. An item is [label, command, args];
// a command "worktree" opens the worktree dialog instead.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, keys, terminals, spaces, panes, exec, window } from "herdr";
import { pathsOnScreen } from "./paths.js";

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

// A space's checkout: "main" (a repo's own), "linked" (a worktree), or null.
async function checkout(folder, on) {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on });
  const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on });
  if (top.code !== 0 || common.code !== 0) return null;
  return common.stdout.trim() === `${top.stdout.trim()}/.git` ? "main" : "linked";
}

function items(p, git) {
  p = p ?? {};
  const tg = p.target ?? {};
  switch (p.tab) {
    case "pane": {
      // A kept sub-agent can go back under its parent, still running.
      const all = terminals();
      const term = all.find((t) => t.address === tg.terminal);
      const parent = term?.parent && all.find((t) => t.address === term.parent);
      // Once they go to the program, Shift+right-click still opens this menu.
      const toProgram = term?.labels?.["herdr.right-click"] === "program";
      const found = (p.paths ?? []).map((f) => [f.path.split("/").pop() + (f.dir ? "/" : ""), "open", f]);
      return [
        ...found,
        ["Split right", "pane.split", { direction: "right", pane: tg.pane }],
        ["Split down", "pane.split", { direction: "down", pane: tg.pane }],
        ["Zoom", "pane.zoom", { pane: tg.pane }],
        ...(term
          ? [
              toProgram
                ? ["Use Herdr right-click menu", "terminal.right_click", { terminal: term.address, to: "menu" }]
                : ["Send right-clicks to pane", "terminal.right_click", { terminal: term.address, to: "program" }],
            ]
          : []),
        ...(parent ? [[`Send back to ${parent.name || parent.address}`, "terminal.park", { terminal: term.address }]] : []),
        ["Close pane", "pane.close", { pane: tg.pane }],
      ];
    }
    case "tab":
      return [
        ["Rename", "tab.rename", { id: tg.id }],
        ["New tab", "tab.new", { space: tg.space }],
        ["Close", "tab.close", { id: tg.id }],
      ];
    case "space":
      return [
        ["Rename", "space.rename", { id: tg.id }],
        ...(git ? [["New worktree", "worktree", { space: tg.id, action: "new" }], ["Open worktree", "worktree", { space: tg.id, action: "open" }]] : []),
        ...(git === "linked" ? [["Remove worktree", "worktree", { space: tg.id, action: "remove" }]] : []),
        ["Close", "space.close", { id: tg.id }],
      ];
    default:
      return [
        ["New space", "space.new", {}],
        ["Keybinds", "app.help", {}],
        ["Theme: graphite", "app.theme", { name: "graphite" }],
        ["Theme: ink", "app.theme", { name: "ink" }],
        ["Theme: moss", "app.theme", { name: "moss" }],
        ["Theme: atom one dark", "app.theme", { name: "atom-one-dark" }],
      ];
  }
}

function menuIcon(command, args) {
  if (command === "open") return `mods/files/${args.dir ? "folder" : "file"}.svg`;
  const name = command.endsWith(".close") ? "x" : command.endsWith(".rename") ? "square-pen" : command.endsWith(".new") ? "plus" : command === "worktree" ? "git-branch" : command === "app.help" ? "terminal" : command === "app.theme" ? "settings" : command === "pane.split" ? "panel-right" : command === "pane.zoom" ? "square" : "terminal";
  return `mods/workspace-chrome/${name}.svg`;
}

// The key bound to a command, for the hint on the right.
function shortcut(name, args) {
  // `pane.split:right` binds pane.split with { direction: "right" }.
  const value = args && Object.values(args)[0];
  const k = keys().find((b) => b.section === "global" && (b.action === name || b.action === `${name}:${value}`));
  return k ? k.keys : "";
}

// Opens a file with its app, a folder in the file manager; reveal shows the item in its folder.
function openPath(f, reveal) {
  const platform = window()?.platform;
  const [cmd, args] = platform === "windows" ? ["explorer", reveal ? [`/select,${f.path}`] : [f.path]]
    : platform === "linux" ? ["xdg-open", [reveal ? f.path.replace(/\/[^/]*$/, "") || "/" : f.path]]
    : ["open", reveal ? ["-R", f.path] : [f.path]];
  exec(cmd, args).catch(() => null);
}

// Pixel height of the menu for its items: rows, dividers and padding.
function height(list) {
  const rows = list.length * 31, dividers = list.filter((it, i) => i > 0 && (it[1].endsWith(".close") || it[1] === "pane.split" && list[i - 1][1] === "open")).length * 9;
  return rows + dividers + (list.some((it) => it[1] === "open") ? 24 : 0) + 12;
}

export default class Menu extends View {
  init(_props, cx) {
    this.at = 0;
    this.git = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    const p = props();
    // First open: look for paths on screen, then reopen in place, sized for them.
    const term = p?.tab === "pane" && !p.paths && p.target?.terminal;
    const local = term && !String(term).includes("/");
    if (local)
      cx.spawn(async () => {
        const cwd = panes().find((x) => x.pane === p.target.pane)?.cwd;
        const paths = await pathsOnScreen(term, cwd).catch(() => []);
        if (!paths.length) return;
        const next = { ...p, paths };
        delete next.overlay;
        closeOverlay(p.overlay);
        openOverlay({ mod: "path-menu", kind: "popup", width: 320, height: height(items(next, null)), props: next });
      });
    const space = p?.tab === "space" && spaces().find((s) => s.id === p.target?.id);
    const folder = space && place(space);
    if (folder)
      cx.spawn(async (cx) => {
        this.git = await checkout(folder, space.machine).catch(() => null);
        cx.notify();
      });
  }

  choose(i, cx) {
    const it = items(props(), this.git)[i];
    if (!it) return;
    closeOverlay(props()?.overlay);
    if (it[1] === "open") openPath(it[2], false);
    else if (it[1] === "worktree") openOverlay({ mod: "worktree", kind: "dialog", ...(it[2].action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 }), props: it[2] });
    else run(it[1], it[2]);
  }

  render(cx) {
    const t = theme();
    const list = items(props(), this.git);
    return v_flex()
      .id("menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(this.at, cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .when(list[0]?.[1] === "open", (el) => el.child(div().px(8).pt(4).pb(5).text_size(11).text_color(t.dim).child("On screen")))
      .children(
        list.map((it, i) =>
          v_flex()
            .when(i > 0 && (it[1] === "pane.split" && list[i - 1][1] === "open" || it[1].endsWith(".close") || it[1] === "app.help" || (it[1] === "app.theme" && list[i - 1][1] !== "app.theme")), el => el.child(div().mx(7).my(4).h(1).bg(t.border)))
            .child(h_flex()
            .id(`mi-${i}`)
            .h(31)
            .px(8)
            .gap(9)
            .rounded(7)
            .items_center()
            .justify_between()
            .text_color(t.foreground)
            .when(i === this.at, (el) => el.bg(t.selected))
            .hover((s) => s.bg(t.hover))
            .when(it[1] !== "open", (el) => el
              .on_click((_e, cx) => this.choose(i, cx))
              .child(svg(menuIcon(it[1], it[2])).size(14).flex_none().text_color(t.muted))
              .child(div().flex_1().child(it[0]))
              .child(div().text_size(11).text_color(t.dim).child(shortcut(it[1], it[2]))))
            // A path row: the name opens it, the button beside it shows it in its folder.
            .when(it[1] === "open", (el) => el
              .child(h_flex().id(`open-${i}`).flex_1().min_w(0).h_full().gap(9).items_center().tooltip(it[2].path)
                .on_click((_e, cx) => this.choose(i, cx))
                .child(svg(menuIcon(it[1], it[2])).size(14).flex_none().text_color(t.muted))
                .child(div().flex_1().min_w(0).truncate().child(it[0])))
              .child(div().id(`reveal-${i}`).flex_none().px(6).py(2).rounded(5).text_size(11).text_color(t.dim).hover((s) => s.bg(t.raised).text_color(t.foreground))
                .on_click(() => { closeOverlay(props()?.overlay); openPath(it[2], true); })
                .child(window()?.platform === "macos" ? "Finder" : "Folder")))),
        ),
      );
  }
}
