import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, TextareaState, Textarea, SliderState, Slider, SliderTrack, SliderIndicator, SliderThumb } from "gpui-base";
import { appHome, home, hc, focused, panes, terminals, shared, setShared, settings, props, theme, run, openOverlay, closeOverlay, notify } from "herdr";
import { STATE_KEY, DEFAULT_SIZE, PRESETS, readState, ownedTerminals, tabName, pressedInWindow } from "./model.js";
import { FloatController } from "./controller.js";

const WINDOW = "__herdr_float_space_window_v1";
const SIZE_POPUP = "__herdr_float_space_size_v1";

function resultJSON(result, operation) {
  if (result.code !== 0) throw new Error(`${operation}: ${result.stderr.trim() || `exit ${result.code}`}`);
  try { return JSON.parse(result.stdout); }
  catch { throw new Error(`${operation}: invalid response from herdr-core`); }
}

function host() {
  const labels = ["--label", "herdr.mod=float-space", "--label", `herdr.float-space=${appHome()}`];
  return {
    getState: () => shared(STATE_KEY),
    setState: state => setShared(STATE_KEY, state),
    focused, panes, terminals,
    liveOwned: () => ownedTerminals(terminals(), appHome()),
    listOwned: async () => {
      const data = resultJSON(await hc(["ls", "--json", ...labels]), "List Float Space terminals");
      if (!Array.isArray(data.terminals)) throw new Error("List Float Space terminals: missing terminal list");
      return data.terminals;
    },
    spawnOwned: async () => resultJSON(await hc(["run", "--bg", "--keep", "--no-parent", "--cwd", home(), "--json", ...labels]), "Start terminal"),
    killOwned: async address => {
      const result = await hc(["kill", address]);
      if (result.code !== 0) throw new Error(result.stderr.trim() || "Could not end terminal");
    },
    open: spec => openOverlay(spec),
    close: id => closeOverlay(id),
    focusPane: pane => run("pane.focus", { pane }),
  };
}

// No copy lives as long as the window, so every copy shares this controller.
// Its fields outlive copies and reloads; its methods are this build's.
function windowShared() {
  const memory = globalThis[WINDOW] ??= { controller: new FloatController(), lease: null };
  Object.setPrototypeOf(memory.controller, FloatController.prototype);
  return memory;
}

// Each command runs in its own invisible copy, which closes itself when done.
// Herdr stops a copy's tasks when that copy closes or reloads, and a remount
// closes the header, so neither the header nor a popup may run one. The
// shortcut's `mod.open` starts the same copy without a command: a toggle.
function act(command) {
  openOverlay({ mod: "float-space", kind: "window", frame: "none", width: 1, height: 1, props: { role: "run", command } });
}

// One command at a time. A claim, not a shared promise chain: a chain through
// a copy Herdr stopped never settles, while a stopped copy's claim expires.
async function claim(cx, owner) {
  const memory = windowShared();
  while (memory.lease && memory.lease.owner !== owner && Date.now() - memory.lease.at < 15000) await cx.sleep(15);
  memory.lease = { owner, at: Date.now() };
}

function release(owner) {
  const memory = windowShared();
  if (memory.lease?.owner === owner) memory.lease = null;
}

function stop(_event, cx) { cx.stop_propagation(); }

// The header and the edge blocks draw one border. Each waits on the same
// change in a task of its own (a task's `cx.notify()` redraws its view even
// when another view woke it), so all four redraw together.
function showFocus(keyboard) {
  const memory = windowShared();
  if (memory.keyboard === keyboard) return;
  memory.keyboard = keyboard;
  memory.focusChanged?.resolve();
  memory.focusChanged = null;
}

function drawsBorder(cx) {
  cx.spawn(async cx => {
    for (;;) {
      const memory = windowShared();
      if (!memory.focusChanged) {
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        memory.focusChanged = { promise, resolve };
      }
      await memory.focusChanged.promise;
      cx.notify();
    }
  });
}

// A press on the header's own controls puts the keyboard in the window too.
function grab(view) {
  return (_event, cx) => { cx.stop_propagation(); view.handle?.focus(); showFocus(true); };
}
function focusKey() {
  const now = focused();
  return `${now?.pane}|${now?.terminal}`;
}
// The icon from the app's program table: a one-color glyph or a picture.
function programIcon(program, color) {
  if (!program?.icon) return null;
  return program.tint ? svg(program.icon).size(14).flex_none().text_color(color) : image(program.icon).size(14).flex_none();
}

export default class FloatSpace extends View {
  init(_props, cx) {
    this.copyProps = props() ?? {};
    // `mod.open` (the shortcut) opens a copy with only an overlay id. A layout
    // block without a role is an optional button.
    const role = this.copyProps.role;
    this.role = role ?? (this.copyProps.overlay ? "run" : "launcher");
    if (this.role === "run") {
      const owner = this.copyProps.overlay;
      cx.spawn(async cx => {
        try {
          await claim(cx, owner);
          await windowShared().controller.handle(this.copyProps.command ?? "toggle", host());
        } catch (error) {
          notify({ title: "Float Space", body: String(error?.message ?? error), level: "error" });
        } finally {
          release(owner);
          closeOverlay(owner);
        }
      });
    } else if (this.role === "size") {
      // Lets the size button close this popup instead of opening another.
      globalThis[SIZE_POPUP] = { overlay: this.copyProps.overlay };
      const size = readState(shared(STATE_KEY)).size;
      this.sliders = {};
      for (const [key, min, max] of [["width", 20, 95], ["height", 30, 95]]) {
        const slider = SliderState.new({ min, max, step: 1, value: Math.round(size[key] * 100) });
        slider.on("change", (_value, cx) => cx.notify());
        this.sliders[key] = slider;
      }
    } else if (this.role === "notes") {
      this.notes = TextareaState.new({ value: readState(shared(STATE_KEY)).notes, placeholder: "Notes shared across your spaces…", rows: 10 });
      // Shared state re-renders every mod in the app: save once typing pauses,
      // and on close (switching tabs, hiding, reloading).
      this.notes.on("change", (_e, cx) => {
        this.pendingSave?.cancel();
        this.pendingSave = cx.timer.after(400, () => this.saveNotes());
      });
      this.notes.on("focus", () => { windowShared().notesFocused = true; });
      this.notes.on("blur", () => { windowShared().notesFocused = false; });
    } else if (this.role === "bar") {
      this.handle = cx.focus_handle();
      // Herdr 0.1.10's pane.focus only addresses main-layout terminals.
      // Focus our chrome instead of leaving typing in the agent underneath.
      cx.timer.after(0, () => { this.handle.focus(); showFocus(true); });
      drawsBorder(cx);
      // Core state is live: reconcile only when the snapshot disagrees with the
      // tabs, once per snapshot, while the window is open.
      cx.timer.every(3000, () => {
        const memory = windowShared();
        const live = ownedTerminals(terminals(), appHome());
        const tabs = readState(shared(STATE_KEY)).tabs;
        const seen = live.map(terminal => terminal.address).sort().join(" ");
        if (memory.lease || seen === memory.reconciled) return;
        if (live.length === tabs.length && tabs.every(tab => live.some(terminal => terminal.address === tab.address))) return;
        memory.reconciled = seen;
        act("reconcile");
      });
      // Presses update the border at once; this catches the rest, such as
      // Herdr focusing another pane from the keyboard.
      cx.timer.every(150, () => showFocus(this.keyboard()));
    } else if (this.role === "edge") {
      drawsBorder(cx);
    }
  }

  // Whether typing goes into this window: its header, Notes or its terminal.
  // Herdr keeps the pane underneath marked focused in all three cases, and
  // `focused()` doesn't report a terminal in an overlay, so a press inside the
  // window counts until a press elsewhere or Herdr focusing another pane.
  keyboard() {
    if (this.handle?.is_focused() || windowShared().notesFocused) return true;
    if (this.pressedIn && this.pressedIn === focusKey()) return true;
    const now = focused();
    return !now?.pane && readState(shared(STATE_KEY)).tabs.some(tab => tab.address === now?.terminal);
  }

  // Any press outside the header: in the window's body, or anywhere else.
  notePress(event) {
    if (!event.bounds) return;
    const height = readState(shared(STATE_KEY)).size.height * window.viewport_size().height;
    const inside = pressedInWindow(event.position, event.bounds, height);
    this.pressedIn = inside ? focusKey() : null;
    showFocus(inside);
  }

  saveNotes() {
    this.pendingSave = null;
    const state = readState(shared(STATE_KEY));
    const notes = this.notes.value();
    if (state.notes !== notes) setShared(STATE_KEY, { ...state, notes });
  }

  async close() {
    if (this.role === "notes") windowShared().notesFocused = false;
    if (this.role === "size" && globalThis[SIZE_POPUP]?.overlay === this.copyProps.overlay) globalThis[SIZE_POPUP] = { closedAt: Date.now() };
    if (this.pendingSave) {
      this.pendingSave.cancel();
      this.saveNotes();
    }
    this.notes?.release();
    for (const slider of Object.values(this.sliders ?? {})) slider.release();
    // Last: it may wait for core. Work started from here is cancelled with
    // this copy, so it must not hand over to another copy.
    if (this.role === "bar") {
      if (this.copyProps.generation === windowShared().controller.generation) windowShared().keyboard = false;
      try { await windowShared().controller.windowClosed(host(), this.copyProps.generation); }
      catch (error) { notify({ title: "Float Space", body: String(error?.message ?? error), level: "error" }); }
    }
  }

  // The confirm dialog's buttons, at popup size: a solid primary, a raised secondary.
  button(id, label, action, primary = false) {
    const t = theme();
    return h_flex().id(id).h(26).px(12).items_center().justify_center().flex_none().rounded(6).border_1()
      .border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).cursor_pointer().hover(s => s.opacity(0.88))
      .on_mouse_down("left", stop).on_click(action).child(label);
  }

  iconButton(id, icon, label, action, press) {
    const t = theme();
    return h_flex().id(id).size(22).items_center().justify_center().flex_none().rounded(6).text_color(t.dim)
      .cursor_pointer().hover(s => s.bg(t.hover).text_color(t.foreground))
      .tooltip(label).accessibility_label(label)
      .on_mouse_down("left", (event, cx) => { cx.stop_propagation(); this.handle?.focus(); showFocus(true); this.pointer = event.position; press?.(); }).on_click(action)
      .child(svg(`mods/float-space/${icon}.svg`).size(14));
  }

  // A tab as Herdr's tab bar draws one, sized for a 30px header.
  tab(id, icon, label, active, action, extra = []) {
    const t = theme();
    return h_flex().id(id).h(22).px(8).gap(6).flex_none().items_center().rounded(6)
      .border_1().border_color(active ? t.border : t.background).bg(active ? t.raised : t.background)
      .text_color(active ? t.foreground : t.muted).cursor_pointer().hover(s => s.bg(t.hover))
      .on_mouse_down("left", grab(this)).on_click(action)
      .when(Boolean(icon), el => el.child(icon))
      .child(div().max_w(135).truncate().child(label))
      .children(extra);
  }

  // A press outside a popup closes it before the click arrives, so remember
  // whether this press found it open; the click then only closes it.
  pressSize() {
    const popup = globalThis[SIZE_POPUP];
    this.sizeWasOpen = Boolean(popup?.overlay) || Date.now() - (popup?.closedAt ?? 0) < 250;
  }

  toggleSize() {
    const popup = globalThis[SIZE_POPUP];
    if (this.sizeWasOpen) {
      if (popup?.overlay) closeOverlay(popup.overlay);
      return;
    }
    const at = this.pointer ? { x: Math.max(0, this.pointer.x - 260), y: this.pointer.y + 16 } : "pointer";
    openOverlay({ mod: "float-space", props: { role: "size" }, kind: "popup", width: 280, at });
  }

  applySize(width, height) {
    act(`resize-${width}-${height}`);
    closeOverlay(this.copyProps.overlay);
  }

  renderLauncher() {
    const t = theme();
    // Continues the status bar beside it: chrome, its top border, a rounded button.
    return h_flex().size_full().items_center().justify_center().bg(t.chrome).border_t(1).border_color(t.border)
      .child(h_flex().id("float-space-launcher").size(22).items_center().justify_center().rounded(6).text_color(t.muted)
        .cursor_pointer().hover(s => s.bg(t.hover).text_color(t.foreground))
        .tooltip("Float Space · Ctrl+Shift+Space")
        .accessibility_label("Toggle Float Space (Ctrl+Shift+Space)")
        .on_mouse_down("left", stop).on_click(() => act("toggle"))
        .child(svg("mods/float-space/float.svg").size(14)));
  }

  renderBar() {
    const t = theme();
    const state = readState(shared(STATE_KEY));
    const live = terminals();
    const notes = state.page === "notes";
    const ring = windowShared().keyboard ? t.accent : t.input;
    const tabs = state.tabs.map(tab => {
      const terminal = live.find(item => item.address === tab.address);
      const name = tabName(tab, terminal);
      const status = terminal?.status;
      const active = state.page === "terminal" && state.active === tab.address;
      return this.tab(`float-tab-${tab.address}`, programIcon(terminal?.program, t.muted), name, active,
        () => act(`select-${tab.address}`), [
          status === "working" ? svg("mods/float-space/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)
            : status === "blocked" || status === "done" ? div().size(6).flex_none().rounded(3).bg(t[status]) : null,
          active ? div().id(`float-end-${tab.address}`).flex_none().text_color(t.dim).hover(s => s.text_color(t.foreground))
            .tooltip(`Close ${name}`).accessibility_label(`Close ${name}`)
            .on_mouse_down("left", grab(this)).on_click((_e, cx) => { cx.stop_propagation(); act(`end-${tab.address}`); })
            .child(svg("mods/float-space/close.svg").size(12)) : null,
        ].filter(Boolean));
    });
    // Notes can't be closed, so it leads the header where a title would be; the
    // terminal tabs follow. Free strip space drags the window. The outer edge is
    // the top of the window's border; the line under the tabs stays neutral.
    return v_flex().id("float-space-bar").track_focus(this.handle).on_mouse_down_out(event => this.notePress(event))
      .on_mouse_down("left", () => { this.handle.focus(); showFocus(true); })
      .size_full().bg(t.background).border_t(1).border_l(1).border_r(1).rounded_t(10).border_color(ring)
      .child(h_flex().flex_1().min_h(0).px(6).gap(6).items_center().border_b(1).border_color(t.border)
      .text_color(t.foreground).text_size(12)
      .child(this.tab("float-notes-tab", svg("mods/float-space/notes.svg").size(14).flex_none().text_color(notes ? t.foreground : t.muted), "Notes",
        notes, () => act("notes")).tooltip("Notes shared across your spaces"))
      .when(tabs.length > 0, el => el.child(div().w(1).h(14).flex_none().bg(t.border)))
      .child(h_flex().id("float-terminal-tabs").flex_1().h_full().min_w(0).items_center().gap(2).overflow_x_scrollbar().children(tabs))
      .child(this.iconButton("float-new-terminal", "plus", "New terminal", () => act("new")))
      .child(this.iconButton("float-size", "size", "Window size", () => this.toggleSize(), () => this.pressSize()))
      .child(this.iconButton("float-hide", "hide", "Hide · Ctrl+Shift+Space", () => act("hide"))));
  }

  // The window's sides and bottom, in the header's border color.
  renderEdge() {
    const t = theme();
    const ring = windowShared().keyboard ? t.accent : t.input;
    if (this.copyProps.side === "bottom") {
      return div().size_full().bg(t.background).border_b(1).border_l(1).border_r(1).rounded_b(10).border_color(ring);
    }
    return div().size_full().bg(ring);
  }

  // The terminals' font and size from Herdr's settings, so Notes reads like the
  // terminal tabs beside it.
  renderNotes() {
    const t = theme();
    const look = settings();
    return v_flex().id("float-notes").size_full().min_h(0).bg(t.background).text_color(t.foreground)
      .on_mouse_down("left", stop)
      .child(Textarea.new(this.notes).flex_1().min_h(0).w_full().px(16).py(14).bg(t.background).text_color(t.foreground)
        .font_family(look.font_family ?? "JetBrains Mono").text_size(look.font_size ?? 14));
  }

  renderSize() {
    const t = theme();
    const current = readState(shared(STATE_KEY)).size;
    return v_flex().w_full().p(14).gap(10).bg(t.popover).text_color(t.foreground).text_size(12)
      .child(div().font_medium().child("Window size"))
      .child(h_flex().gap(6).children(PRESETS.map(preset => {
        const on = current.width === preset.width && current.height === preset.height;
        return v_flex().id(`float-preset-${preset.id}`).flex_1().py(6).items_center().rounded(6).border_1()
          .border_color(on ? t.accent : t.input).bg(on ? t.selected : t.raised).cursor_pointer().hover(s => s.bg(t.hover))
          .on_mouse_down("left", stop).on_click(() => this.applySize(Math.round(preset.width * 100), Math.round(preset.height * 100)))
          .child(div().child(preset.label))
          .child(div().text_size(11).text_color(t.dim).child(`${Math.round(preset.width * 100)} × ${Math.round(preset.height * 100)}`));
      })))
      .children([["width", "Width"], ["height", "Height"]].map(([key, label]) => {
        const slider = this.sliders[key];
        return v_flex().gap(3)
          .child(h_flex().justify_between().child(label)
            .child(div().text_color(t.muted).child(`${Math.round(slider.value())}%`)))
          .child(Slider.new(slider).accessibility_label(label).w_full().child(
            SliderTrack.new(slider).flex().items_center().h(24).w_full().child(
              // The shell places the thumb's left edge only; center it on the groove.
              SliderIndicator.new(slider).relative().w_full().h(4).rounded(2).bg(t.border)
                .range_style(fill => fill.rounded(2).bg(t.accent))
                .child(SliderThumb.new(slider).size(12).rounded(6).bg(t.foreground).ml(-6).mt(-4)))));
      }))
      .child(h_flex().gap(8).justify_between()
        .child(this.button("float-reset-size", "Reset", (_e, cx) => {
          for (const [key, slider] of Object.entries(this.sliders)) slider.set_value(Math.round(DEFAULT_SIZE[key] * 100));
          cx.notify();
        }))
        .child(this.button("float-apply-size", "Apply", () =>
          this.applySize(...["width", "height"].map(key => Math.round(this.sliders[key].value()))), true)));
  }

  render() {
    if (this.role === "bar") return this.renderBar();
    if (this.role === "notes") return this.renderNotes();
    if (this.role === "size") return this.renderSize();
    if (this.role === "edge") return this.renderEdge();
    if (this.role === "run") return div();
    return this.renderLauncher();
  }
}
