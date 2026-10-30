import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { appHome, home, theme, exec, pickFolder, closeOverlay, props, run, nextCommand } from "herdr";

const STEP = ["Find your work", "Choose workspaces", "Bring them over", "Continue working"];
const basename = path => (path ?? "").replace(/\\/g, "/").split("/").filter(Boolean).pop() || "Home";
const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const shortPath = path => (path ?? "").startsWith(home()) ? `~${path.slice(home().length)}` : path;

export default class HerdrMigration extends View {
  init(_props, cx) {
    this.step = 0;
    this.source = props()?.source ?? `${home()}/.config/herdr/session.json`;
    this.input = InputState.new({ value: this.source, placeholder: "Classic Herdr session.json or its folder" });
    this.input.on("change", (_event, cx) => { this.source = this.input.value(); this.error = ""; cx.notify(); });
    this.input.on("submit", (_event, cx) => this.scan(cx));
    this.plan = null;
    this.job = null;
    this.transfers = [];
    this.selected = new Set();
    this.busy = false;
    this.polling = false;
    this.error = "";
    this.notice = "";
    this.ticks = 0;
    this.python = null;
    this.refresh(cx, true);
    cx.timer.every(1000, cx => {
      this.ticks++;
      const active = this.job && ["queued", "running"].includes(this.job.status);
      if (active || this.ticks % 15 === 0) this.refresh(cx);
    });
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "scan") this.scan(cx);
        else if (command === "import") this.import(cx);
        else if (command === "retry") this.retry(cx);
        else if (command === "refresh") this.refresh(cx, true);
      }
    });
  }

  backend() { return `${appHome()}/mods/herdr-migration/backend.py`; }

  async call(command, args = []) {
    let result;
    const candidates = this.python ? [this.python] : [["python3"], ["python"], ["py", "-3"]];
    for (const candidate of candidates) {
      try {
        result = await exec(candidate[0], [...candidate.slice(1), this.backend(), "--app-home", appHome(), command, ...args]);
        this.python = candidate;
        break;
      } catch (error) { if (this.python) throw error; }
    }
    if (!result) throw new Error("Install Python 3.10 or newer, then reopen this window.");
    let data;
    try { data = JSON.parse(result.stdout); }
    catch { throw new Error(result.stderr || "Python 3.10 or newer is required. Install Python and reopen this window."); }
    if (result.code !== 0 || data.error) throw new Error(data.error || result.stderr || "The operation failed.");
    return data;
  }

  refresh(cx, first = false) {
    if (this.polling) return;
    this.polling = true;
    cx.spawn(async cx => {
      try {
        const result = await this.call("status");
        this.job = result.job;
        this.transfers = result.transfers ?? [];
        if (this.job && first) this.step = this.job.status === "complete" ? 3 : 2;
        if (this.job?.status === "complete" && this.step === 2) this.step = 3;
        if (first && this.job) this.notice = "Your previous migration progress has been restored.";
      } catch (error) { if (first || this.job) this.error = String(error).replace(/^Error: /, ""); }
      this.polling = false;
      cx.notify();
    });
  }

  scan(cx) {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    this.notice = "";
    cx.notify();
    cx.spawn(async cx => {
      try {
        const result = await this.call("scan", ["--source", this.source]);
        this.plan = result.plan;
        this.selected = new Set(this.plan.workspaces.filter(w => !w.imported && !w.missing.length).map(w => w.id));
        this.step = 1;
      } catch (error) { this.error = String(error).replace(/^Error: /, ""); }
      this.busy = false;
      cx.notify();
    });
  }

  chooseFolder(cx) {
    cx.spawn(async cx => {
      const folder = await pickFolder({ prompt: "Choose your classic Herdr configuration folder" });
      if (folder) {
        this.source = `${folder.replace(/[\\/]$/, "")}/session.json`;
        this.input.set_value(this.source);
        this.error = "";
        cx.notify();
      }
    });
  }

  import(cx) {
    if (this.busy || !this.selected.size) return;
    this.operation("start", ["--selected", JSON.stringify([...this.selected])], cx, result => {
      this.job = result.job;
      this.step = 2;
    });
  }

  retry(cx) { this.operation("retry", [], cx, () => { this.step = 2; this.refresh(cx); }); }

  operation(command, args, cx, done) {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    cx.notify();
    cx.spawn(async cx => {
      try {
        const result = await this.call(command, args);
        this.notice = result.message || "";
        if (done) done(result);
        if (command === "resume" && result.terminal) {
          this.busy = false;
          cx.notify();
          if (result.space) run("space.select", { id: result.space });
          if (result.tab) run("tab.select", { id: result.tab });
          run("pane.focus", { terminal: result.terminal });
          if (props()?.overlay) closeOverlay(props().overlay);
          return;
        }
        this.refresh(cx);
      } catch (error) { this.error = String(error).replace(/^Error: /, ""); }
      this.busy = false;
      cx.notify();
    });
  }

  button(id, text, onClick, primary = false, enabled = true) {
    const t = theme();
    return h_flex().id(id).h(34).px(13).gap(7).items_center().justify_center().rounded(8)
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .text_size(12.5).font_medium().opacity(enabled ? 1 : 0.42)
      .when(enabled, el => el.cursor_pointer().hover(s => s.opacity(0.84)).on_click(onClick))
      .child(text);
  }

  badge(text, color) {
    return div().px(7).py(3).rounded(5).bg(`${color}20`).text_size(10.5).font_medium().text_color(color).child(text);
  }

  title(text, detail) {
    const t = theme();
    return v_flex().gap(8).mb(8)
      .child(div().text_size(23).font_semibold().text_color(t.foreground).child(text))
      .child(div().text_size(12.5).text_color(t.muted).child(detail));
  }

  findPage() {
    const t = theme();
    return v_flex().gap(18)
      .child(this.title("Bring your work to Herdr", "Your workspaces, tabs and split terminals, in the new native app."))
      .child(h_flex().gap(10).children([
        ["01", "Preview first", "Choose exactly what comes over."],
        ["02", "Backed up", "Your current setup is saved first."],
        ["03", "Keep working", "Live agents stay in classic Herdr."],
      ].map(([number, label, detail]) => v_flex().flex_1().min_w(0).p(14).gap(7).rounded(10).bg(t.surface).border_1().border_color(t.border)
        .child(div().text_size(11).font_semibold().text_color(t.accent).child(number))
        .child(div().text_size(13).font_semibold().child(label))
        .child(div().text_size(11.5).text_color(t.muted).child(detail)))))
      .child(v_flex().gap(9).mt(8)
        .child(div().text_size(12).font_medium().child("Classic Herdr session"))
        .child(h_flex().gap(9)
          .child(Input.new(this.input).flex_1().h(38).px(11).rounded(8).border_1().border_color(t.input).bg(t.background).text_size(12).text_color(t.foreground))
          .child(this.button("browse-source", "Choose folder", (_e, cx) => this.chooseFolder(cx), false, !this.busy)))
        .child(div().text_size(11).text_color(t.dim).child("Use the default session, a named session's folder, or a saved session.json file.")))
      .child(v_flex().p(14).gap(7).rounded(9).bg(t.surface)
        .child(div().text_size(12).font_medium().child("What comes over"))
        .child(div().text_size(11.5).text_color(t.muted).child("Workspace names, tab names, working folders, split directions and proportions. Conversations get a separate resume step. Classic plugins and theme settings stay as they are.")))
      .child(h_flex().justify_end().child(this.button("scan-source", this.busy ? "Scanning…" : "Find my workspaces →", (_e, cx) => this.scan(cx), true, !this.busy)));
  }

  choosePage() {
    const t = theme();
    const list = this.plan?.workspaces ?? [];
    const chosen = list.filter(w => this.selected.has(w.id));
    const total = chosen.reduce((n, w) => n + w.pane_count, 0);
    return v_flex().gap(12).flex_1().min_h(0)
      .child(this.title("Choose what comes over", `${list.length} workspaces found. Existing work in this app is preserved.`))
      .child(h_flex().items_center().justify_between()
        .child(div().text_size(12).text_color(t.muted).child(`${chosen.length} selected · ${total} terminals`))
        .child(h_flex().gap(7)
          .child(this.button("select-all", "Select available", (_e, cx) => { this.selected = new Set(list.filter(w => !w.imported && !w.missing.length).map(w => w.id)); cx.notify(); }))
          .child(this.button("select-none", "Clear", (_e, cx) => { this.selected.clear(); cx.notify(); }))))
      .child(v_flex().id("workspace-selection").flex_1().min_h(100).overflow_y_scrollbar().gap(8)
        .when(!list.length, el => el.child(div().p(18).text_color(t.muted).child("This session is empty. Choose another session file to continue.")))
        .children(list.map(workspace => {
          const enabled = !workspace.imported && !workspace.missing.length && !this.busy;
          const selected = this.selected.has(workspace.id);
          return h_flex().id(`workspace-${workspace.id}`).p(13).gap(12).items_start().rounded(9).border_1()
            .border_color(selected ? t.accent : t.border).bg(selected ? t.selected : t.surface)
            .when(enabled, el => el.cursor_pointer().hover(s => s.bg(t.hover)).on_click((_e, cx) => {
              if (selected) this.selected.delete(workspace.id); else this.selected.add(workspace.id);
              cx.notify();
            }))
            .child(div().mt(1).size(18).rounded(4).border_1().border_color(selected ? t.accent : t.input)
              .bg(selected ? t.accent : t.background).text_color(t.accent_foreground).text_size(12).flex().items_center().justify_center().child(selected ? "✓" : ""))
            .child(v_flex().flex_1().gap(5)
              .child(h_flex().gap(8).items_center()
                .child(div().text_size(13).font_semibold().child(workspace.name))
                .when(workspace.imported, el => el.child(this.badge("Already imported", t.done)))
                .when(Boolean(workspace.missing.length), el => el.child(this.badge("Folder missing", t.blocked))))
              .child(div().text_size(11).text_color(t.dim).child(shortPath(workspace.folder)))
              .child(div().text_size(11.5).text_color(t.muted).child(`${count(workspace.tabs.length, "tab")} · ${count(workspace.pane_count, "terminal")} · ${count(workspace.agents.length, "saved agent")}`))
              .when(workspace.collision && !workspace.imported, el => el.child(div().text_size(11).text_color(t.muted).child("A space has this name already. It stays untouched; this import gets its own space.")))
              .when(Boolean(workspace.missing.length), el => el.child(div().text_size(11).text_color(t.blocked).child(`Restore this folder, then scan again: ${shortPath(workspace.missing[0])}`))));
        })))
      .child(div().text_size(11).text_color(t.dim).child("A backup is created before the first terminal. Your original agents keep running; the new panes start as shells."))
      .child(h_flex().justify_between().mt(5)
        .child(this.button("back-to-source", "← Change source", (_e, cx) => { this.step = 0; cx.notify(); }))
        .child(this.button("import-selected", `Back up & import ${chosen.length} workspaces`, (_e, cx) => this.import(cx), true, chosen.length > 0 && !this.busy)));
  }

  progressPage() {
    const t = theme();
    const job = this.job ?? {};
    const interrupted = job.status === "interrupted";
    const percent = job.total ? Math.min(100, Math.round(100 * job.done / job.total)) : 0;
    return v_flex().gap(20)
      .child(this.title(interrupted ? "Pick up where you left off" : "Making room for your work", interrupted ? "The import journal and created terminals are preserved." : "You can close this window. Your import continues in the background."))
      .child(v_flex().p(20).gap(16).rounded(11).bg(t.surface)
        .child(h_flex().gap(12).items_center()
          .when(!interrupted, el => el.child(svg("mods/herdr-migration/spinner.svg").size(20).text_color(t.accent).spin(1000)))
          .child(div().text_size(15).font_semibold().child(job.message ?? "Preparing…")))
        .child(h_flex().h(6).rounded(3).bg(t.raised).child(div().w(Math.max(1, percent * 7)).max_w(700).h(6).rounded(3).bg(t.accent)))
        .child(h_flex().justify_between().text_size(12).text_color(t.muted)
          .child(div().child(`${Math.min(job.done ?? 0, job.total ?? 0)} of ${job.total ?? 0} terminals`))
          .child(div().child(`${percent}%`)))
        .child(div().text_size(11.5).text_color(job.backup ? t.done : t.dim).child(job.backup ? "✓ Backup saved" : "Saving your backup before making changes…")))
      .child(div().text_size(12).text_color(t.muted).child("Verification checks every terminal's folder and the complete split tree before marking the import ready."))
      .child(h_flex().justify_end().gap(8)
        .when(interrupted, el => el.child(this.button("retry-import", "Continue import", (_e, cx) => this.retry(cx), true, !this.busy)))
        .when(!interrupted, el => el.child(this.button("pause-import", "Pause import", (_e, cx) => this.operation("pause", [], cx), false, !this.busy))));
  }

  completePage() {
    const t = theme();
    return v_flex().gap(13).flex_1().min_h(0)
      .child(this.title("Your workspaces are ready", "Folders and split layouts are verified. Your existing app spaces are preserved."))
      .child(h_flex().p(13).gap(10).items_center().rounded(9).bg(t.surface)
        .child(this.badge("Verified", t.done))
        .child(div().text_size(12).text_color(t.muted).child(`${this.job?.total ?? 0} terminals imported · backup saved`)))
      .child(div().text_size(13).font_semibold().child("Continue your conversations"))
      .child(div().text_size(11.5).text_color(t.muted).child("When an old agent is ready, exit it in classic Herdr. Then resume its conversation here. This mod never stops an agent or answers an approval for you."))
      .child(v_flex().id("conversation-list").flex_1().min_h(60).overflow_y_scrollbar().gap(8)
        .when(!this.transfers.length, el => el.child(div().p(16).rounded(9).bg(t.surface).text_size(12).text_color(t.muted).child("No saved agents were found in this selection. Your terminal shells are ready to use.")))
        .children(this.transfers.map((agent, i) => {
          const color = agent.status === "working" ? t.working : agent.status === "blocked" ? t.blocked : agent.status === "done" || agent.status === "resumed" ? t.done : t.muted;
          const label = { working: "Working in classic", blocked: "Needs you in classic", done: "Done in classic", idle: "Open in classic", unknown: "Open in classic", ready: "Ready to resume", resumed: "Resumed", unavailable: "Classic status unavailable" }[agent.status] ?? "Open in classic";
          return h_flex().id(`transfer-${i}`).p(12).gap(10).items_center().rounded(9).bg(t.surface)
            .child(v_flex().flex_1().gap(5)
              .child(h_flex().gap(8).items_center().child(div().text_size(12.5).font_semibold().child(agent.workspace)).child(div().text_size(11.5).text_color(t.dim).child(agent.agent)))
              .child(div().text_size(11).text_color(color).child(label))
              .when(!agent.session, el => el.child(div().text_size(10.5).text_color(t.dim).child("Choose the conversation in the agent's resume picker."))))
            .when(agent.ready, el => el.child(this.button(`resume-${i}`, "Resume", (_e, cx) => this.operation("resume", ["--terminal", agent.terminal], cx), true, !this.busy)));
        })))
      .when(Boolean(this.job?.backup), el => el.child(div().text_size(10.5).text_color(t.dim).child(`Backup: ${shortPath(this.job.backup)}`)))
      .child(h_flex().justify_between().gap(8)
        .child(this.button("import-another", "Import another session", (_e, cx) => { this.step = 0; this.plan = null; this.error = ""; cx.notify(); }))
        .child(this.button("finish-migration", "Done", () => { if (props()?.overlay) closeOverlay(props().overlay); }, true)));
  }

  render() {
    const t = theme();
    return v_flex().size_full().min_h(0).bg(t.popover).text_color(t.foreground)
      .child(h_flex().px(24).h(54).gap(10).items_center().border_b(1).border_color(t.border)
        .child(div().size(23).rounded(6).bg(t.accent).text_color(t.accent_foreground).text_size(15).flex().items_center().justify_center().child("↗"))
        .child(div().flex_1().font_semibold().text_size(14).child("Herdr Migration"))
        .when(Boolean(props()?.overlay), el => el.child(this.button("close-migration", "Close", () => closeOverlay(props().overlay)))))
      .child(h_flex().px(24).py(17).gap(18).children(STEP.map((label, i) => h_flex().gap(7).items_center()
        .child(div().size(20).rounded(10).flex().items_center().justify_center().text_size(10.5).font_medium()
          .bg(i === this.step ? t.accent : t.raised).text_color(i === this.step ? t.accent_foreground : t.dim).child(i < this.step ? "✓" : String(i + 1)))
        .child(div().text_size(11.5).text_color(i === this.step ? t.foreground : t.dim).child(label)))))
      .child(v_flex().px(24).pb(22).flex_1().min_h(0).gap(11)
        .when(this.step === 0, el => el.child(this.findPage()))
        .when(this.step === 1, el => el.child(this.choosePage()))
        .when(this.step === 2, el => el.child(this.progressPage()))
        .when(this.step === 3, el => el.child(this.completePage()))
        .when(Boolean(this.error), el => el.child(div().p(11).rounded(8).bg(`${t.blocked}18`).text_size(11.5).text_color(t.blocked).child(this.error))))
      .when(Boolean(this.notice), el => el.child(div().px(24).pb(12).text_size(11).text_color(t.muted).child(this.notice)));
  }
}
