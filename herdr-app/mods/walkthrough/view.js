// The walkthrough: a change read in the order it makes sense, one step at a
// time, with the code each step talks about under it.

import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, VirtualListScrollHandle } from "gpui-base";
import { spaces, panes, focused, agents, theme, props, closeOverlay, hc, exec, nextCommand, settings, shared, setShared, watchFolder } from "herdr";
import { SCOPES, repoAt, currentHead, defaultBase, baseChoices, recentCommits } from "./lib/sources.js";
import { overlay, fileTotals } from "./lib/walkthrough.js";
import { numberLines } from "./lib/hunks.js";
import { LANGUAGES, languageOf, fromLocale } from "./lib/languages.js";
import { MODELS, DEFAULT_MODEL, modelOf } from "./lib/job.js";
import { estimateTokens, codeKey, MAX_PROMPT_CHARS } from "./lib/cache.js";
import { formatComments, addComment, sameSpot } from "./lib/comments.js";
import { readDiff, readPreferences, matters, keyFor, findShown, preparePrompt, fits, promptChars, jobOf, startJob, alive, finished, cancelJob, finishJob, claudeVersion, systemLocale, ensureDirs } from "./engine.js";
import { button, chip, menu, picker, formatElapsed, formatTokens } from "./ui.js";

const PREFS = "walkthrough.prefs";
// Lines drawn on one page; a step past this says how many it leaves out.
const MAX_PAGE_LINES = 2500;
const NOTE_LABEL = { choice: "Decision", upkeep: "Upkeep", gap: "Limitation", divergence: "Divergence", untested: "Untested" };
const NOTE_ABOUT = {
  choice: "A product or design call made here that could have gone another way",
  upkeep: "Something the project maintains from now on",
  gap: "Something users still can't do, or will see fail",
  divergence: "Two paths of the same thing that behave differently",
  untested: "The change's main promise has no test",
};

/** Where the shown space is now: its focused pane's folder, else where it was made. */
function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  return { space, folder: pane?.cwd || f?.cwd || space?.folder || null, terminal: f?.terminal ?? null };
}

const scopeName = (scope) => (scope === "staged" ? "staged" : scope === "working" ? "unstaged" : scope);

const prefs = () => /** @type {any} */ (shared(PREFS)) ?? {};
const savePrefs = (change) => setShared(PREFS, { ...prefs(), ...change });

export class Walkthrough {
  init(cx) {
    const p = props() ?? {};
    const here = location();
    this.folder = p.folder ?? here.folder;
    this.space = here.space;
    this.remote = Boolean(here.space?.machine);
    this.from = here.terminal; // the terminal it was opened over: comments go to its agent first
    const saved = prefs();
    this.scope = SCOPES.some((s) => s.key === p.scope) ? p.scope : SCOPES.some((s) => s.key === saved.scope) ? saved.scope : "uncommitted";
    this.model = MODELS.some((m) => m.key === saved.model) ? saved.model : DEFAULT_MODEL;
    this.language = saved.language ?? null; // null until the system's is read
    this.repo = undefined; // undefined: looking, null: not in git
    this.base = null;
    this.bases = [];
    this.commit = null;
    this.commits = [];
    this.claude = undefined;
    this.diff = null;
    this.cacheKey = null;
    this.shown = null; // { entry, exact }
    this.view = null;
    this.job = null;
    this.jobSeq = 0; // bumped whenever this view starts, ends or drops a job
    this.starting = false;
    this.polls = 0;
    this.deadSince = null;
    this.loading = false;
    this.error = null;
    this.genError = null;
    this.step = 0; // index into view.steps; steps.length is the "Not covered" page
    this.visited = new Set();
    this.openFiles = new Set();
    this.comments = [];
    this.target = null; // { sk, scope, path, line, kind, code }: the line a comment is being written on
    this.agentTo = null;
    this.picking = null; // "base" | "commit" | "model" | "language" | "agent"
    this.menuIndex = 0; // the highlighted row of the open picker, moved by ↑ ↓ and chosen by Enter
    this.menuScroll = VirtualListScrollHandle.new();
    this.sent = null;
    this.seq = 0;
    this.dirty = false;
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.input = InputState.new({ placeholder: "Comment on this line, then Enter" });
    this.typing = false;
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.input.on("submit", (_e, cx) => { this.saveComment(); cx.notify(); });

    cx.spawn(async (cx) => {
      if (!this.folder || this.remote) { this.repo = null; cx.notify(); return; }
      const [repo, claude, locale] = await Promise.all([repoAt(exec, this.folder).catch(() => null), claudeVersion(), this.language ? null : systemLocale()]);
      this.repo = repo;
      this.claude = claude;
      if (!this.language) this.language = fromLocale(locale);
      if (!repo) { cx.notify(); return; }
      await ensureDirs();
      const [base, bases, commits] = await Promise.all([
        defaultBase(exec, repo.top, repo.branch), baseChoices(exec, repo.top, repo.branch), recentCommits(exec, repo.top)]);
      const remembered = prefs().bases?.[repo.top];
      this.base = remembered && bases.includes(remembered) ? remembered : base;
      this.bases = bases;
      this.commits = commits;
      this.commit = commits[0] ?? null;
      await this.reload(cx);
      this.watch(cx);
    });
    cx.timer.every(1000, (cx) => this.tick(cx));
    // Commands for keys.json: walkthrough.generate, .cancel, .next, .prev.
    cx.spawn(async (cx) => {
      for (;;) {
        const name = String(await nextCommand()).replace(/^walkthrough\./, "").split(":")[0];
        if (name === "generate") await this.generate(cx);
        else if (name === "cancel") await this.cancel(cx);
        else if (name === "next") this.go(this.step + 1);
        else if (name === "prev") this.go(this.step - 1);
        cx.notify();
      }
    });
  }

  /** The source the toolbar describes, or null while one still has to be picked. */
  source() {
    if (this.scope === "branch") return this.base ? { kind: "branch", base: this.base, head: this.head ?? this.repo?.branch ?? "HEAD" } : null;
    if (this.scope === "commit") return this.commit ? { kind: "commit", hash: this.commit.hash, subject: this.commit.subject } : null;
    return { kind: this.scope };
  }

  /** Re-reads the diff and what to show for it. A newer reload wins over an older one still running. */
  async reload(cx) {
    const repo = this.repo;
    if (!repo) return;
    const seq = ++this.seq, jobSeq = this.jobSeq;
    this.loading = true;
    this.dirty = false;
    cx.notify();
    try {
      // The terminal may have checked out another branch since the last read.
      const head = await currentHead(exec, repo.top);
      const detached = head === "HEAD" || head.startsWith("HEAD@");
      if (this.head !== undefined && head !== this.head) await this.rebase(repo, detached ? null : head);
      this.head = head;
      repo.branch = detached ? null : head;
      const source = this.source();
      if (!source) {
        this.diff = null; this.shown = null; this.view = null;
        if (jobSeq === this.jobSeq) this.job = null;
      } else {
        const diff = await readDiff(repo, source);
        const preferences = await readPreferences();
        const key = keyFor(repo, diff, this.model, this.language, preferences);
        const [shown, job] = await Promise.all([findShown(repo, diff, key), jobOf(repo, diff.sk)]);
        if (seq !== this.seq) return;
        // The size of exactly the prompt Generate would send, so the intro and the check agree.
        this.promptSize = promptChars(preparePrompt(diff, { language: this.language, previous: this.previousFor(shown), preferences }));
        const before = this.shown?.entry?.key + String(this.shown?.entry?.generatedAt);
        // A comment box belongs to a line of the diff it was opened on.
        if (this.diff?.sk !== diff.sk) this.target = null;
        this.diff = diff;
        this.cacheKey = key;
        this.shown = shown;
        // A job this view started or ended while reading is newer than what the read found.
        if (jobSeq === this.jobSeq && !this.starting) this.job = job;
        this.view = shown ? overlay(shown.entry.walkthrough, diff.files) : null;
        // Another walkthrough is another reading path: what was visited in the old one means nothing here.
        if (before !== shown?.entry?.key + String(shown?.entry?.generatedAt)) {
          this.step = 0;
          this.visited = new Set(this.view?.steps.length ? [this.view.steps[0].id] : []);
          this.openFiles = new Set();
        }
        if (this.view) this.step = Math.min(this.step, this.view.steps.length);
      }
      this.error = null;
    } catch (e) {
      if (seq === this.seq) this.error = String(e?.message ?? e);
    }
    if (seq === this.seq) this.loading = false;
    cx.notify();
  }

  /**
   * After a checkout, the bases on offer are those of the new branch: never the
   * branch itself, and the remembered or detected one when it still fits.
   */
  async rebase(repo, branch) {
    const [base, bases] = await Promise.all([defaultBase(exec, repo.top, branch), baseChoices(exec, repo.top, branch)]);
    const remembered = prefs().bases?.[repo.top];
    this.bases = bases;
    if (!this.base || !bases.includes(this.base)) this.base = remembered && bases.includes(remembered) ? remembered : base;
  }

  /** Edits in the repository mark the diff dirty; the next tick re-reads it. */
  watch(cx) {
    const { top, gitDir } = this.repo ?? {};
    if (!top) return;
    const loop = (folder) => cx.spawn(async (cx) => {
      for (;;) {
        const changed = await watchFolder(folder);
        if (this.scope !== "commit" && !this.dirty && await matters(top, changed, gitDir)) this.dirty = true;
      }
    });
    loop(top);
    // A linked worktree's index and HEAD live outside it.
    if (gitDir && !gitDir.startsWith(`${top}/`)) loop(gitDir);
  }

  async tick(cx) {
    if (this.ticking || !this.repo) return;
    this.ticking = true;
    try {
      // Every second only the answer is looked for; whether the run is alive, every fifth.
      const check = this.job && !this.job.done && (++this.polls % 5 === 0 || this.deadSince);
      const done = this.job && !this.job.done ? await finished(this.job) : null;
      if (done) this.job = done;
      else if (check) {
        const job = await jobOf(this.repo, this.job.meta.sk);
        if (job) job.pid = this.job.pid;
        if (!job) this.setJob(null);
        else if (job.done) this.job = job;
        else if (Date.now() > job.meta.deadline + 10_000) { // run.sh stops it at the deadline; this is for a run.sh that died
          this.setJob(null);
          await cancelJob(job);
          this.genError = "The model took too long and was stopped. Try a narrower scope, or another model.";
          await this.reload(cx);
        } else if (await alive(job)) {
          this.job.pid = job.pid;
          this.deadSince = null;
        } else if (!this.deadSince) {
          // claude has just exited and run.sh is about to write its code: give it a moment.
          this.deadSince = Date.now();
        } else if (Date.now() - this.deadSince > 3000) {
          this.deadSince = null;
          const again = await jobOf(this.repo, job.meta.sk);
          if (again?.done) this.job = again;
          else {
            this.setJob(null);
            if (again) await cancelJob(again);
            this.genError = "The generation stopped without an answer (the computer may have slept or restarted). Try again.";
            await this.reload(cx);
          }
        }
      }
      if (this.job && !this.job.done) cx.notify(); // the elapsed time
      if (this.job?.done) {
        const job = this.job;
        this.setJob(null);
        let lost = false;
        try {
          // null: another window took the answer; it is stored in a moment, and a later read finds it.
          lost = (await finishJob(job)) === null;
          this.genError = null;
        } catch (e) { this.genError = String(e?.message ?? e); }
        await this.reload(cx);
        if (lost) this.dirty = true;
      } else if (this.dirty && !this.loading) {
        await this.reload(cx);
      }
    } finally {
      this.ticking = false;
    }
  }

  setJob(job) {
    this.job = job;
    this.jobSeq++;
  }

  async generate(cx) {
    const repo = this.repo, diff = this.diff, source = this.source();
    // Keys and buttons alike: never on a diff still being read, with nothing to read, or twice.
    if (!this.canGenerate() || this.starting || !source) return;
    this.starting = true;
    try { await this.start(cx, repo, diff, source); } finally { this.starting = false; }
    cx.notify();
  }

  /**
   * The walkthrough handed on for revision: only one of older code, by the same
   * model in the same language. Another model or language writes its own reading.
   */
  previousFor(shown) {
    const e = shown?.entry;
    return shown && !shown.exact && e.model === this.model && e.language === this.language ? e.walkthrough : null;
  }

  async start(cx, repo, diff, source) {
    this.genError = null;
    const previous = this.previousFor(this.shown);
    const model = this.model, language = this.language;
    const preferences = await readPreferences();
    const prompt = preparePrompt(diff, { language, previous, preferences });
    if (!fits(prompt)) {
      this.genError = `This diff is too large to send whole (≈ ${formatTokens(estimateTokens(promptChars(prompt)))} tokens; the limit is ≈ ${formatTokens(estimateTokens(MAX_PROMPT_CHARS))}). Pick a narrower scope.`;
      return;
    }
    try {
      // The key of exactly what is sent, not of whatever the last read saw.
      const key = keyFor(repo, diff, model, language, preferences);
      this.setJob(await startJob(repo, diff, { key, model, language, prompt, source }));
    } catch (err) {
      this.genError = `Couldn't start claude: ${String(err?.message ?? err)}`;
    }
  }

  async cancel(cx) {
    if (!this.job) return;
    const job = this.job;
    this.setJob(null);
    await cancelJob(job);
    cx.notify();
  }

  go(index) {
    const steps = this.view?.steps ?? [];
    this.step = Math.max(0, Math.min(steps.length, index));
    if (steps[this.step]) this.visited.add(steps[this.step].id);
    this.target = null;
  }

  pickScope(key, cx) {
    if (this.scope === key) return;
    this.scope = key;
    this.picking = null;
    this.genError = null;
    this.loading = true; // until the read the change starts has finished
    savePrefs({ scope: key });
    cx.spawn(async (cx) => this.reload(cx));
  }

  choose(kind, value, cx) {
    this.picking = null;
    if (kind !== "agent") { this.genError = null; this.loading = true; }
    if (kind === "model") { this.model = value; savePrefs({ model: value }); }
    if (kind === "language") { this.language = value; savePrefs({ language: value }); }
    if (kind === "base") { this.base = value; savePrefs({ bases: { ...(prefs().bases ?? {}), [this.repo.top]: value } }); }
    if (kind === "commit") this.commit = value;
    if (kind === "agent") { this.agentTo = value; cx.notify(); return; }
    cx.spawn(async (cx) => this.reload(cx));
  }

  /** The agents a comment can go to: the one it was opened over first, then this space's, most recent first. */
  agentChoices() {
    const all = agents().filter((a) => !this.space || a.space === this.space.id).sort((a, b) => b.seq - a.seq);
    const from = all.find((a) => a.address === this.from);
    return from ? [from, ...all.filter((a) => a !== from)] : all;
  }

  /** Comments belong to the source they were made on; another scope or commit keeps its own. */
  ownComments() {
    return this.comments.filter((c) => c.sk === this.diff?.sk);
  }

  /** The spot a diff line is: comments and the comment box are matched to it. */
  spot(file, number, side) {
    return { sk: this.diff?.sk, scope: file.scope, path: file.path, line: number, kind: side };
  }

  agent() {
    const list = this.agentChoices();
    return list.find((a) => a.address === this.agentTo) ?? list[0] ?? null;
  }

  saveComment() {
    const text = this.input.value().trim();
    if (!this.target || !text) return;
    this.comments = addComment(this.comments, { ...this.target, text });
    this.input.set_value("");
    this.target = null;
    this.handle.focus();
  }

  async send(cx) {
    const agent = this.agent();
    const mine = this.ownComments();
    if (!agent || !mine.length) return;
    const mixed = new Set(this.diff?.files.map((f) => f.scope)).size > 1;
    const r = await hc(["send", agent.address, formatComments(mine, this.diff?.what ?? "a change", { mixed })]).catch((e) => ({ code: 1, stderr: String(e?.message ?? e) }));
    if (r.code === 0) {
      this.sent = `Sent ${mine.length} comment${mine.length === 1 ? "" : "s"} to ${agent.program?.name ?? agent.address}.`;
      this.comments = this.comments.filter((c) => !mine.includes(c));
    } else {
      this.sent = `Couldn't send: ${(r.stderr || r.stdout || "hc send failed").trim()}`;
    }
    cx.notify();
  }

  onKey(e, cx) {
    if (this.typing) return;
    const k = e.key;
    if (this.picking && this.menuKey(k, cx)) { cx.notify(); return; }
    if (k === "escape") {
      if (this.picking) this.picking = null;
      else if (this.target) this.target = null;
      else if (props()?.overlay) closeOverlay(props().overlay);
    } else if (this.view && (k === "right" || k === "j" || k === "n")) this.go(this.step + 1);
    else if (this.view && (k === "left" || k === "k" || k === "p")) this.go(this.step - 1);
    else return;
    cx.notify();
  }

  // ——— drawing ———

  render() {
    const t = theme();
    const inDialog = Boolean(props()?.overlay);
    return v_flex().id("walkthrough").track_focus(this.handle).on_key_down((e, cx) => this.onKey(e, cx))
      .on_size_change((size, cx) => { if (Math.abs((this.width ?? 0) - size.width) > 1) { this.width = size.width; cx.notify(); } })
      .size_full().bg(inDialog ? t.popover : t.background).text_color(t.foreground).text_size(13)
      .child(this.header(t, inDialog))
      .child(this.toolbar(t))
      .child(div().flex_1().min_h(0).relative()
        .child(this.body(t))
        .when(Boolean(this.picking), (el) => el
          // While a picker is open the page under it holds still: a click beside it closes it, the wheel does nothing.
          .child(div().id("backdrop").absolute().inset_0().on_click((_e, cx) => { this.picking = null; cx.notify(); })
            .on_scroll_wheel((_e, cx) => cx.stop_propagation()))
          .child(this.popup(t))))
      .when(Boolean(this.view), (el) => el.child(this.footer(t)));
  }

  header(t, inDialog) {
    const r = this.repo;
    return h_flex().h(44).flex_none().px(14).gap(10).items_center().border_b(1).border_color(t.border)
      .child(div().text_size(14).text_color(t.accent).child("◆"))
      .child(div().font_semibold().text_size(14).child("Walkthrough"))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim)
        .child(r ? `${r.name}${r.branch ? `  ⎇ ${r.branch}` : "  (detached)"}` : this.folder ?? ""))
      .when(Boolean(this.claude), (el) => el.child(div().text_size(11).text_color(t.dim).child(`claude ${String(this.claude).split(" ")[0]}`)))
      .when(inDialog, (el) => el.child(button(t, "close", "Esc", () => closeOverlay(props().overlay), { kind: "ghost", small: true })));
  }

  toolbar(t) {
    const busy = Boolean(this.job);
    const tabs = h_flex().flex_none().p(2).gap(2).rounded(7).bg(t.raised).children(SCOPES.map((s) =>
      div().id(`scope-${s.key}`).px(9).h(22).flex().items_center().rounded(5).text_size(12).cursor_pointer()
        .when(this.scope === s.key, (e) => e.bg(t.popover).text_color(t.foreground).font_semibold())
        .when(this.scope !== s.key, (e) => e.text_color(t.muted).hover((st) => st.text_color(t.foreground)))
        .tooltip(s.about)
        .on_click((_e, cx) => this.pickScope(s.key, cx))
        .child(s.label)));
    const open = (what) => (_e, cx) => { this.togglePicker(what); cx.notify(); };
    const action = busy
      ? button(t, "cancel", "Cancel", (_e, cx) => cx.spawn(async (cx) => this.cancel(cx)), { small: true })
      : button(t, "generate", this.shown?.exact ? "Regenerate" : "Generate", (_e, cx) => cx.spawn(async (cx) => this.generate(cx)),
        { kind: this.shown?.exact ? "outline" : "solid", small: true, disabled: !this.canGenerate(), tooltip: this.claude === null ? "claude isn't installed" : null });
    return h_flex().min_h(42).flex_none().px(14).py(7).gap(8).items_center().flex_wrap().border_b(1).border_color(t.border)
      .child(tabs)
      .when(this.scope === "branch", (el) => el.child(div().text_size(11.5).text_color(t.dim).child("vs"))
        .child(picker(t, "pick-base", this.base ?? "Pick a base", open("base"))))
      .when(this.scope === "commit", (el) => el.child(picker(t, "pick-commit", this.commit ? `${this.commit.short} ${this.commit.subject}` : "Pick a commit", open("commit"))))
      .child(div().flex_1())
      .when(this.loading, (el) => el.child(div().text_size(11).text_color(t.dim).frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90)))
      .child(picker(t, "pick-model", modelOf(this.model).name, open("model"), { tooltip: "Model" }))
      .child(picker(t, "pick-language", languageOf(this.language).name, open("language"), { tooltip: "Language of the explanations" }))
      .child(action);
  }

  canGenerate() {
    return Boolean(this.claude && this.repo && this.diff && this.diff.hunkCount > 0 && !this.job && !this.loading);
  }

  /** The open picker's rows and where it sits: { items, width, side }. */
  menuOf(kind) {
    switch (kind) {
      case "base": return { side: "left", width: 280, items: this.bases.map((b) => ({ label: b, value: b, selected: b === this.base })) };
      case "commit": return { side: "left", width: 460, items: this.commits.map((c) => ({ label: `${c.short}  ${c.subject}`, hint: `${c.author} · ${c.when}`, value: c, selected: c.hash === this.commit?.hash })) };
      case "model": return { side: "right", width: 280, items: MODELS.map((m) => ({ label: m.name, hint: m.about, value: m.key, selected: m.key === this.model })) };
      case "language": return { side: "right", width: 220, items: LANGUAGES.map((l) => ({ label: l.name, right: l.english === l.name ? "" : l.english, value: l.tag, selected: l.tag === this.language })) };
      case "agent": {
        const current = this.agent();
        return { side: "footer", width: 320, items: this.agentChoices().map((a) => ({
          label: `${a.program?.name ?? "Agent"} · ${a.tab_name || `tab ${a.tab_index + 1}`}`, right: a.address, value: a.address, selected: a === current,
        })) };
      }
      default: return { side: "left", width: 280, items: [] };
    }
  }

  /** Opens a picker (or closes it, when it is the open one) with its chosen row highlighted and in view. */
  togglePicker(kind) {
    if (this.picking === kind) { this.picking = null; return; }
    this.picking = kind;
    this.menuIndex = Math.max(0, this.menuOf(kind).items.findIndex((i) => i.selected));
    this.menuScroll.scroll_to_item(this.menuIndex, "center");
    this.handle.focus();
  }

  /** ↑ ↓ move the highlight, Enter chooses it. Returns false for keys a picker doesn't use. */
  menuKey(key, cx) {
    const { items } = this.menuOf(this.picking);
    if (key === "down" || key === "up") {
      if (!items.length) return true;
      this.menuIndex = (this.menuIndex + (key === "down" ? 1 : -1) + items.length) % items.length;
      this.menuScroll.scroll_to_item(this.menuIndex);
      return true;
    }
    if (key === "enter") {
      const item = items[this.menuIndex];
      if (item) this.choose(this.picking, item.value, cx);
      return true;
    }
    return false;
  }

  popup(t) {
    const kind = this.picking;
    const { items, width, side } = this.menuOf(kind);
    const el = menu(t, `menu-${kind}`, items, (item, cx) => this.choose(kind, item.value, cx), { width, active: this.menuIndex, scroll: this.menuScroll });
    if (side === "footer") return div().absolute().bottom(4).right(14).child(el);
    return div().absolute().top(4).when(side === "left", (e) => e.left(14)).when(side === "right", (e) => e.right(14)).child(el);
  }

  body(t) {
    const center = (...lines) => v_flex().size_full().items_center().justify_center().gap(8).p(24)
      .children(lines.map((l, i) => (typeof l === "string" ? div().max_w(560).text_center().text_size(i === 0 ? 14 : 12.5).text_color(i === 0 ? t.foreground : t.dim).child(l) : l)));
    if (this.remote) return center("This space is on another machine.", "Walkthroughs read git and run claude on this computer only.");
    if (this.repo === undefined) return center("Reading…");
    if (this.repo === null) return center("Not a git repository.", this.folder ? `Nothing to walk through in ${this.folder}.` : "Focus a terminal in a repository, then open the walkthrough again.");
    if (this.error) return center("Couldn't read the diff.", this.error);
    if (!this.source()) return center(this.scope === "branch" ? "Pick the branch to compare with." : "Pick a commit.", "Nothing is read or generated until you do.");
    if (!this.diff) return center("Reading the diff…");
    if (!this.diff.files.length) return center("Nothing to walk through.", `No ${SCOPES.find((s) => s.key === this.scope)?.label.toLowerCase()} changes${this.scope === "branch" ? ` against ${this.base}` : ""}.`);
    if (!this.view) return this.job ? this.progress(t) : this.intro(t);
    // A narrow pane gives the page the room; the footer still moves between steps.
    return h_flex().size_full().items_start()
      .when((this.width ?? 1000) >= 720, (e) => e.child(this.contents(t)))
      .child(v_flex().flex_1().min_w(0).h_full()
        .children(this.banners(t))
        .child(this.step < this.view.steps.length ? this.page(t, this.view.steps[this.step]) : this.tail(t)));
  }

  /** Before the first walkthrough: what would be read, and what it would cost. */
  intro(t) {
    const d = this.diff;
    const size = this.promptSize ?? d.text.length;
    const tokens = estimateTokens(size);
    const tooBig = size > MAX_PROMPT_CHARS;
    const totals = d.files.map((f) => ({ f, added: f.hunks.reduce((n, h) => n + h.added, 0), deleted: f.hunks.reduce((n, h) => n + h.deleted, 0) }));
    return v_flex().id("intro").size_full().overflow_y_scrollbar().items_center().p(28).gap(14)
      .child(v_flex().w_full().max_w(620).gap(14)
        .child(div().text_size(18).font_semibold().child("Read this change in the order it makes sense"))
        .child(div().text_size(13).text_color(t.muted).child("Claude groups related edits into steps, orders them so each builds on the last, and explains what each one changes. It explains; it doesn't judge the code. Every edit it leaves out is still listed at the end."))
        .child(h_flex().gap(8).items_center().flex_wrap()
          .child(chip(t, `${d.fileCount} file${d.fileCount === 1 ? "" : "s"}`))
          .child(chip(t, `${d.hunkCount} hunk${d.hunkCount === 1 ? "" : "s"}`))
          .child(chip(t, `≈ ${formatTokens(tokens)} tokens`, tooBig ? t.ansi1 : undefined))
          .when(d.generatedPaths.length > 0, (e) => e.child(chip(t, `${d.generatedPaths.length} generated, not sent`)))
          .when(d.unread.length > 0, (e) => e.child(chip(t, `${d.unread.length} not read`))))
        .when(this.claude === null, (e) => e.child(this.notice(t, t.ansi1, "Claude Code's `claude` isn't installed, or isn't on the PATH Herdr starts programs with. Walkthroughs are written by `claude -p`.")))
        .when(tooBig, (e) => e.child(this.notice(t, t.ansi1, "This diff is too large to send whole, and a walkthrough of part of it would read as complete. Pick a narrower scope.")))
        .when(d.hunkCount === 0 && d.files.length > 0, (e) => e.child(this.notice(t, t.muted, d.generatedPaths.length ? "Only generated files changed; they aren't sent to the model." : "No changed lines to read: binary files, renames or mode changes only.")))
        .when(Boolean(this.genError), (e) => e.child(this.notice(t, t.ansi1, this.genError)))
        .child(h_flex().gap(10).items_center()
          .child(button(t, "start", `Generate walkthrough with ${modelOf(this.model).name}`, (_e, cx) => cx.spawn(async (cx) => this.generate(cx)), { kind: "solid", disabled: !this.canGenerate() || tooBig }))
          .child(div().text_size(11.5).text_color(t.dim).child(`in ${languageOf(this.language).name}`)))
        .child(v_flex().mt(6).rounded(8).border_1().border_color(t.border).children(totals.map(({ f, added, deleted }, i) =>
          h_flex().h(26).px(10).gap(8).items_center().when(i > 0, (e) => e.border_t(1).border_color(t.border)).text_size(12)
            .child(div().flex_1().min_w(0).truncate().text_color(f.generated || f.unread ? t.dim : t.foreground).child(f.path))
            .when(f.generated, (e) => e.child(chip(t, "generated")))
            .when(Boolean(f.unread), (e) => e.child(div().text_size(11).text_color(t.dim).child(f.unread)))
            .when(f.status !== "modified" && !f.unread, (e) => e.child(div().text_size(11).text_color(t.dim).child(f.status)))
            .child(div().text_size(11.5).text_color(t.ansi2).child(added ? `+${added}` : ""))
            .child(div().text_size(11.5).text_color(t.ansi1).child(deleted ? `−${deleted}` : ""))))));
  }

  notice(t, color, text) {
    return div().w_full().px(10).py(7).rounded(7).border_1().border_color(color).text_size(12).text_color(color === t.muted ? t.muted : t.foreground).child(text);
  }

  /** A generation running with nothing to show yet. */
  progress(t) {
    const j = this.job.meta;
    const row = (state, label, extra = "") => h_flex().gap(10).items_center()
      .child(state === "run" ? div().w(14).text_color(t.accent).frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90) : div().w(14).text_color(state === "done" ? t.ansi2 : t.dim).child(state === "done" ? "✓" : "○"))
      .child(div().text_size(13).text_color(state === "wait" ? t.dim : t.foreground).child(label))
      .child(div().text_size(12).text_color(t.dim).child(extra));
    return v_flex().size_full().items_center().justify_center().gap(12)
      .child(v_flex().gap(10)
        .child(row("done", "Read the diff", `${j.hunkCount} hunk${j.hunkCount === 1 ? "" : "s"}`))
        .child(row(this.job.done ? "done" : "run", `Asking Claude ${modelOf(j.model).name}`, formatElapsed(Date.now() - j.started)))
        .child(row(this.job.done ? "run" : "wait", "Putting the steps together")))
      .child(div().mt(8).max_w(480).text_center().text_size(11.5).text_color(t.dim).child("It runs in the background: close this and come back, the walkthrough will be waiting."))
      .child(button(t, "cancel-run", "Cancel", (_e, cx) => cx.spawn(async (cx) => this.cancel(cx)), { small: true }));
  }

  banners(t) {
    const out = [];
    const bar = (id, color, text, action) => h_flex().id(id).flex_none().mx(16).mt(10).px(10).py(6).gap(10).items_center().rounded(7).border_1().border_color(color)
      .child(div().flex_1().min_w(0).text_size(12).child(text)).when(Boolean(action), (e) => e.child(action));
    const regen = (label) => button(t, `banner-${label}`, label, (_e, cx) => cx.spawn(async (cx) => this.generate(cx)), { small: true, disabled: !this.canGenerate() });
    if (this.job) {
      out.push(bar("b-job", t.accent, `Writing a new walkthrough with ${modelOf(this.job.meta.model).name}… ${formatElapsed(Date.now() - this.job.meta.started)}`,
        button(t, "b-cancel", "Cancel", (_e, cx) => cx.spawn(async (cx) => this.cancel(cx)), { small: true })));
    }
    if (this.genError) out.push(bar("b-error", t.ansi1, this.genError, null));
    const e = this.shown?.entry;
    if (e && !this.shown.exact && !this.job) {
      const otherModel = e.model !== this.model, otherLanguage = e.language !== this.language;
      if (otherModel || otherLanguage) {
        out.push(bar("b-other", t.border, `Showing the ${languageOf(e.language).name} walkthrough by ${modelOf(e.model).name}. There's none in ${languageOf(this.language).name} by ${modelOf(this.model).name} for this code yet.`, regen("Generate")));
      } else {
        const n = this.view.outdated, fresh = this.view.uncovered.reduce((s, u) => s + u.hunks.length, 0);
        // Same code, other key: it was written under other preferences, or by an older version of this mod.
        if (e.code && e.code === codeKey(this.diff.files)) out.push(bar("b-prefs", t.border, "This code hasn't changed, but your preferences or this mod's prompt have since this walkthrough was written.", regen("Regenerate")));
        else out.push(bar("b-stale", t.blocked, n
          ? `Written for an earlier state of this code: ${n === 1 ? "1 step describes" : `${n} steps describe`} code that has changed or is gone.`
          : `The code changed after this walkthrough was written. ${fresh} hunk${fresh === 1 ? " is" : "s are"} listed under Not covered.`, regen("Regenerate")));
      }
    }
    return out;
  }

  /** The table of contents: every step by part, visited ones ticked, outdated ones flagged. */
  contents(t) {
    const v = this.view, w = this.shown.entry.walkthrough;
    const uncovered = v.uncovered.length;
    const stepRow = (s, i) => h_flex().id(`toc-${s.id}`).w_full().px(8).py(5).gap(8).items_center().rounded(6).cursor_pointer()
      .when(i === this.step, (e) => e.bg(t.selected))
      .when(i !== this.step, (e) => e.hover((st) => st.bg(t.hover)))
      .on_click((_e, cx) => { this.go(i); cx.notify(); })
      .child(div().flex_none().min_w(18).h(16).px(4).rounded(8).flex().items_center().justify_center().text_size(10).font_semibold()
        .when(s.outdated, (e) => e.bg(t.blocked).text_color(t.background).child("!"))
        .when(!s.outdated && this.visited.has(s.id) && i !== this.step, (e) => e.text_color(t.ansi2).child("✓"))
        .when(!s.outdated && (!this.visited.has(s.id) || i === this.step), (e) => e.bg(t.raised).text_color(t.muted).child(String(s.position))))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).when(s.weight === "skim", (e) => e.text_color(t.muted)).child(s.title))
      .when(s.weight === "key", (e) => e.child(div().flex_none().size(6).rounded(3).bg(t.accent).tooltip("Key change")));
    return v_flex().id("contents").w(280).flex_none().h_full().overflow_y_scrollbar().border_r(1).border_color(t.border).p(10).gap(2)
      .child(div().px(8).text_size(13.5).font_semibold().child(w.title))
      .when(Boolean(w.summary), (e) => e.child(div().px(8).pt(2).pb(6).text_size(12).text_color(t.muted).child(w.summary)))
      .children(v.parts.flatMap((part) => [
        div().px(8).pt(10).pb(2).text_size(10.5).font_semibold().text_color(t.dim).child(part.title.toUpperCase()),
        ...part.steps.map((s) => stepRow(s, s.position - 1)),
      ]))
      .child(div().mt(8).mx(8).h(1).bg(t.border))
      .child(h_flex().id("toc-tail").mt(6).w_full().px(8).py(5).gap(8).items_center().rounded(6).cursor_pointer()
        .when(this.step === v.steps.length, (e) => e.bg(t.selected))
        .hover((st) => st.bg(t.hover))
        .on_click((_e, cx) => { this.go(v.steps.length); cx.notify(); })
        .child(div().flex_none().min_w(18).text_center().text_size(11).text_color(t.dim).child("…"))
        .child(div().flex_1().text_size(12.5).text_color(t.muted).child("Not covered"))
        .child(div().text_size(11).text_color(t.dim).child(String(uncovered))))
      .child(div().px(8).pt(12).text_size(10.5).text_color(t.dim).child(this.meta()));
  }

  meta() {
    const e = this.shown.entry;
    const when = new Date(e.generatedAt);
    const parts = [`${modelOf(e.model).name} · ${languageOf(e.language).name}`, `${when.toLocaleDateString()} ${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`];
    if (typeof e.cost === "number") parts.push(`$${e.cost.toFixed(e.cost < 0.1 ? 3 : 2)}`);
    return parts.join(" · ");
  }

  page(t, s) {
    const part = this.view.parts[s.part];
    const total = this.view.steps.length;
    return v_flex().id(`page-${s.id}-${this.shown.entry.generatedAt}`).flex_1().min_h(0).overflow_y_scrollbar().px(22).py(16).gap(12)
      .child(div().text_size(11).text_color(t.dim).child(`${part.title.toUpperCase()}  ·  STEP ${s.position} OF ${total}`))
      .child(h_flex().gap(8).items_center().flex_wrap()
        .child(div().text_size(18).font_semibold().child(s.title))
        .when(s.weight === "key", (e) => e.child(chip(t, "Key change", t.accent).tooltip("The rest of the change depends on this, or its main behavior lives here. Read it closely.")))
        .when(s.weight === "skim", (e) => e.child(chip(t, "Context").tooltip("A supporting change, here so the rest makes sense. Safe to skim.")))
        .when(s.outdated, (e) => e.child(chip(t, "Outdated", t.blocked).tooltip("Code this step described has changed or is gone."))))
      .child(div().max_w(820).text_size(13.5).line_height(1.55).child(s.text))
      .when(s.notes.length > 0, (e) => e.child(v_flex().max_w(820).gap(6).children(s.notes.map((n) =>
        h_flex().gap(8).items_start().child(chip(t, NOTE_LABEL[n.kind], t.blocked).tooltip(NOTE_ABOUT[n.kind])).child(div().flex_1().text_size(12.5).text_color(t.muted).child(n.text))))))
      .when(s.outdated, (e) => e.child(this.notice(t, t.blocked, s.found.length
        ? `${s.missing} of the ${s.missing + s.found.length} hunks this step described changed or are gone; what's left is below.`
        : "Every hunk this step described has changed or is gone. Regenerate to read the code as it is now.")))
      .when(s.found.length > 0, (e) => e.child(h_flex().gap(10).flex_wrap().text_size(11.5).text_color(t.dim).children(fileTotals(s.found).map((f) =>
        h_flex().gap(4).child(div().child(f.path)).child(div().text_color(t.ansi2).child(f.added ? `+${f.added}` : "")).child(div().text_color(t.ansi1).child(f.deleted ? `−${f.deleted}` : ""))))))
      .child(this.code(t, s.found));
  }

  /** Everything no step covers, file by file, each with the model's one-line note. */
  tail(t) {
    const v = this.view;
    return v_flex().id(`tail-${this.shown.entry.generatedAt}`).flex_1().min_h(0).overflow_y_scrollbar().px(22).py(16).gap(10)
      .child(div().text_size(18).font_semibold().child("Not covered"))
      .child(div().max_w(820).text_size(12.5).text_color(t.muted).child(v.uncovered.length
        ? "Changes no step describes: edits made after the walkthrough was written, ones the model judged routine, generated and binary files, and files too large to read. Open a file to see its hunks."
        : "Every change is covered by a step."))
      .children(v.uncovered.map(({ file, hunks, note }) => {
        const id = `${file.scope}:${file.path}`;
        const open = this.openFiles.has(id);
        const twice = v.uncovered.filter((u) => u.file.path === file.path).length > 1;
        const added = hunks.reduce((n, h) => n + h.added, 0), deleted = hunks.reduce((n, h) => n + h.deleted, 0);
        return v_flex().rounded(8).border_1().border_color(t.border)
          .child(h_flex().id(`tail-${id}`).px(10).py(6).gap(8).items_center().when(hunks.length > 0, (e) => e.cursor_pointer().hover((st) => st.bg(t.hover)))
            .on_click((_e, cx) => { if (!hunks.length) return; open ? this.openFiles.delete(id) : this.openFiles.add(id); cx.notify(); })
            .child(div().w(10).text_size(9).text_color(t.dim).child(hunks.length ? (open ? "▼" : "▶") : ""))
            .child(v_flex().flex_1().min_w(0)
              .child(div().truncate().text_size(12.5).child(twice ? `${file.path}  (${scopeName(file.scope)})` : file.path))
              .when(Boolean(note || file.unread), (e) => e.child(div().text_size(11.5).text_color(t.dim).child(file.unread ?? note))))
            .when(file.status !== "modified", (e) => e.child(div().text_size(11).text_color(t.dim).child(file.status)))
            .child(div().text_size(11.5).text_color(t.ansi2).child(added ? `+${added}` : ""))
            .child(div().text_size(11.5).text_color(t.ansi1).child(deleted ? `−${deleted}` : "")))
          .when(open, (e) => e.child(div().border_t(1).border_color(t.border).child(this.code(t, hunks.map((hunk) => ({ hunk, file })), false))));
      }));
  }

  /** Hunks as code, consecutive ones of a file under one header. Click a line to comment on it. */
  code(t, found, headers = true) {
    const font = settings().font_family ?? "JetBrains Mono";
    const rows = [];
    let lines = 0, last = null, cut = 0;
    const twice = new Set();
    const scopes = new Map();
    for (const { file } of found) {
      if (scopes.has(file.path) && scopes.get(file.path) !== file.scope) twice.add(file.path);
      scopes.set(file.path, file.scope);
    }
    for (const { hunk, file } of found) {
      // Past the cap nothing more is drawn, headers included; the lines left are counted.
      if (lines >= MAX_PAGE_LINES) { cut += hunk.lines.length; continue; }
      const name = `${file.scope}:${file.path}`;
      if (headers && name !== last) {
        rows.push(h_flex().mt(rows.length ? 10 : 0).h(26).px(10).gap(8).items_center().rounded_t(7).bg(t.raised).border_1().border_color(t.border)
          .child(div().flex_1().min_w(0).truncate().text_size(12).font_semibold().child(file.path))
          .when(twice.has(file.path) || (file.scope === "staged" && this.scope === "uncommitted"), (e) => e.child(chip(t, scopeName(file.scope))))
          .when(file.status !== "modified", (e) => e.child(div().text_size(11).text_color(t.dim).child(file.oldPath ? `${file.status} from ${file.oldPath}` : file.status))));
      }
      last = name;
      rows.push(div().h(20).px(10).flex().items_center().bg(t.hover).text_color(t.dim).text_size(11).font_family(font).truncate().child(hunk.header));
      for (const line of numberLines(hunk)) {
        if (lines >= MAX_PAGE_LINES) { cut++; continue; }
        lines++;
        rows.push(this.line(t, file, line, font));
        if (line.kind === "meta") continue;
        const spot = this.spot(file, line.number, line.kind === "-" ? "-" : "+");
        const c = this.comments.find((x) => sameSpot(x, spot));
        if (c) rows.push(this.commentRow(t, c));
        if (this.target && sameSpot(this.target, spot)) rows.push(this.commentBox(t));
      }
    }
    if (cut) rows.push(div().px(10).py(6).text_size(11.5).text_color(t.dim).child(`${cut} more line${cut === 1 ? "" : "s"} not drawn here.`));
    return v_flex().w_full().flex_none().rounded(7).border_1().border_color(t.border).overflow_hidden().children(rows);
  }

  line(t, file, { kind, number, text }, font) {
    if (kind === "meta") return div().h(20).px(10).flex().items_center().text_size(11).text_color(t.dim).font_family(font).child(text);
    const side = kind === "-" ? "-" : "+";
    const spot = this.spot(file, number, side);
    const selected = this.target && sameSpot(this.target, spot);
    return h_flex().id(`l-${file.scope}:${file.path}-${side}${number}`).h(20).w_full().gap(8).font_family(font).text_size(11.5).cursor_pointer()
      .when(kind === "+", (e) => e.bg(t.ansi2 + "1c")).when(kind === "-", (e) => e.bg(t.ansi1 + "1c"))
      .when(Boolean(selected), (e) => e.bg(t.selection))
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        this.target = { ...spot, code: text };
        const existing = this.comments.find((c) => sameSpot(c, spot));
        this.input.set_value(existing?.text ?? "");
        this.input.focus();
        cx.notify();
      })
      .child(div().w(44).flex_none().text_right().text_color(t.dim).child(String(number)))
      .child(div().w(10).flex_none().text_color(kind === "+" ? t.ansi2 : kind === "-" ? t.ansi1 : t.dim).child(kind === " " ? "" : kind))
      .child(div().flex_1().min_w(0).whitespace_nowrap().overflow_hidden().child(text || " "));
  }

  commentRow(t, c) {
    return h_flex().px(10).py(5).gap(8).items_start().bg(t.popover).border_y(1).border_color(t.border)
      .child(div().w(62).flex_none().text_right().text_size(11).text_color(t.accent).child("comment"))
      .child(div().flex_1().text_size(12).child(c.text))
      .child(button(t, `rm-${c.scope}:${c.path}-${c.kind}${c.line}`, "✕", (_e, cx) => { this.comments = this.comments.filter((x) => x !== c); cx.notify(); }, { kind: "ghost", small: true }));
  }

  commentBox(t) {
    return h_flex().px(10).py(6).gap(8).items_center().bg(t.popover).border_y(1).border_color(t.accent)
      .child(div().flex_1().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input).w_full()))
      .child(button(t, "comment-save", "Add", (_e, cx) => { this.saveComment(); cx.notify(); }, { kind: "solid", small: true }))
      .child(button(t, "comment-cancel", "Cancel", (_e, cx) => { this.target = null; this.handle.focus(); cx.notify(); }, { kind: "ghost", small: true }));
  }

  footer(t) {
    const steps = this.view.steps.length;
    const agent = this.agent();
    const n = this.ownComments().length;
    return h_flex().h(44).flex_none().px(14).gap(8).items_center().border_t(1).border_color(t.border)
      .child(button(t, "prev", "← Previous", (_e, cx) => { this.go(this.step - 1); cx.notify(); }, { small: true, disabled: this.step === 0 }))
      .child(button(t, "next", this.step === steps - 1 ? "Not covered →" : "Next →", (_e, cx) => { this.go(this.step + 1); cx.notify(); }, { small: true, disabled: this.step >= steps }))
      .child(div().text_size(11.5).text_color(t.dim).child(this.step < steps ? `${this.visited.size} of ${steps} read · ← → to move` : "End of the walkthrough"))
      .child(div().flex_1())
      .when(Boolean(this.sent), (e) => e.child(div().text_size(11.5).text_color(t.dim).truncate().child(this.sent)))
      .child(div().text_size(11.5).text_color(n ? t.foreground : t.dim).child(n ? `${n} comment${n === 1 ? "" : "s"}` : "Click a line to comment"))
      .when(n > 0, (e) => e
        .child(picker(t, "pick-agent", agent ? `${agent.program?.name ?? "Agent"} · ${agent.address}` : "No agent here", (_e, cx) => { this.togglePicker("agent"); cx.notify(); }, { disabled: !agent }))
        .child(button(t, "send", "Send", (_e, cx) => cx.spawn(async (cx) => this.send(cx)), { kind: "solid", small: true, disabled: !agent, tooltip: "Pastes the comments into the agent and presses Enter" })));
  }
}
