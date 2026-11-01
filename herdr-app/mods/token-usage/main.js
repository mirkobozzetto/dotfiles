// Token usage: a live panel over the omp session store (~\.omp\agent\sessions).
// One cache under ~/.config/herdr-app/data/token-usage holds, per session file,
// its size, mtime and per-day per-model usage buckets; the panel sums the range
// you pick out of it. Indexing reads one file at a time, a few files between two
// redraws, so the panel stays responsive while it catches up.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, shared, setShared, home, appHome, exec, window } from "herdr";
import * as fs from "fs/promises";
import { RANGES, aggregate, dayKey, fmtAgo, fmtBytes, fmtCost, fmtTokens, projectOf, scan, topModels, topProjects } from "./store.js";

const STORE = "/.omp/agent/sessions";
const TOKEN_USAGE = "token-usage";
const SCOPE = "token-usage.range";
const CONCURRENT = 3; // files read at once: a hung read costs one slot, not the panel
const TASK_MS = 90000; // a read older than this is given up on at the next tick
const STAT_MS = 30000; // how often the store is looked at for changes
const WRITE_MS = 15000; // how often the cache may reach the disk
const READ_MS = 20000; // a single file's read may take this long, then it is abandoned
const LIST_MS = 25000; // a store listing may take this long before it is given up on
const LIST_EVERY = 30000; // how often a fresh listing is asked for (in the background)
const IO_MS = 25000; // mkdir, exists, cache reads and writes
const PASS_BYTES = 6 * 1024 * 1024; // re-reading per pass is bounded to this many bytes
const BIG_BYTES = 8 * 1024 * 1024; // a file this big is read once it has settled...
const STABLE_MS = 60000; // ...for this long without being written to
const TOO_SLOW = Symbol("too slow");
const TOP_MODELS = 8;
const TOP_PROJECTS = 6;

/** The range every copy of this mod agrees on. */
function chosen() {
  const v = shared(SCOPE);
  return typeof v === "string" && RANGES.some(([key]) => key === v) ? v : "today";
}

/** A path with the home folder written as ~. */
function short(path) {
  const p = String(path).replace(/\\/g, "/");
  const h = (home() || "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (h && p.toLowerCase().indexOf(h.toLowerCase()) === 0) return "~" + path.slice(h.length);
  return path;
}

export default class TokenUsage extends View {
  init(_props, cx) {
    this.root = (home() || "").replace(/\\/g, "/").replace(/\/+$/, "") + STORE;
    const app = appHome() || "";
    const sep = app.indexOf("\\") >= 0 ? "\\" : "/";
    this.dir = app.replace(/[\\/]+$/, "") + sep + "data" + sep + TOKEN_USAGE;
    this.files = new Map(); // path -> { s, m, b }
    this.cwds = {}; // project folder -> the cwd its sessions ran in
    this.stats = null; // the last listing that arrived
    this.statsAt = 0; // when it arrived
    this.listing = false; // one listing in flight at a time
    this.listingSince = 0;
    this.queued = []; // files waiting to be read
    this.reading = new Map(); // path -> { at, s }: reads in flight
    this.fresh = new Set(); // never indexed before: not budget-limited
    this.pass = 0; // files the last refill set out to index
    this.windowBytes = 0; // re-read bytes started in this 30 s window
    this.dirty = false;
    this.missing = false;
    this.bytes = 0;
    this.skipped = new Set();
    this.partial = new Set();
    this.big = new Set(); // active sessions too big to read while they grow
    this.indexedAt = Date.now();
    this.wroteAt = 0;
    this.version = 0;
    this.cached = null;
    this.cachedKey = "";
    cx.spawn(async (cx) => {
      await this.begin(cx);
    });
    cx.timer.every(STAT_MS, (cx) => this.tick(cx));
  }

  /** Refresh: give up on everything in flight (each recorded and counted), drop
   * the queue, and schedule a fresh round now instead of waiting for a tick. */
  async refresh(cx) {
    for (const path of [...this.reading.keys()]) this.abandon(path, "refresh");
    this.reading.clear();
    this.queued = [];
    this.windowBytes = 0;
    this.wroteAt = 0; // the fresh round writes the cache whatever it finds
    this.tick(cx);
  }

  async begin(cx) {
    await this.limited(fs.mkdir(this.dir, { recursive: true }), IO_MS, cx).catch(() => null);
    await this.loadCache(cx);
    this.indexedAt = Date.now();
    cx.notify();
    if (!(await this.present(cx))) {
      this.missing = true;
      cx.notify();
      return;
    }
    // Only the first round waits for a listing: after that every round works
    // from the last listing that arrived, so a slow process cannot hold it.
    this.startListing();
    if (this.listingTask) await this.limited(this.listingTask, LIST_MS, cx).catch(() => null);
    this.tick(cx);
  }

  /** Gives up on one file: it keeps the size and mtime the listing reported, so
   * it stops counting as pending, and keeps the buckets already known. The
   * footer names how many. Used for a read that outlived its bound, and for a
   * pass that outlived every bound — then the file it was on is the one to
   * blame, which is how the cadence recovers without depending on a timer. */
  abandon(path, why) {
    if (!path) return;
    const st = this.stats ? this.stats.get(path) : null;
    const prev = this.files.get(path);
    this.skipped.add(path);
    this.files.set(path, { s: st ? st.s : prev ? prev.s : 0, m: st ? st.m : prev ? prev.m : 0, b: prev ? prev.b : {} });
    this.version++;
  }

  /** Bounded await: `work` or TOO_SLOW after `ms`. A hung read, listing or
   * write therefore abandons its pass instead of wedging the 30 s cadence for
   * ever — the failure one file can cause, and the reason a pass must never be
   * able to die silently. */
  limited(work, ms, cx) {
    const running = Promise.resolve(work);
    running.catch(() => null); // the abandoned promise must not reject later
    if (!cx) return running; // a background listing: nothing is waiting on it
    let task = null;
    const late = new Promise((done) => {
      task = cx.timer.after(ms, () => done(TOO_SLOW));
    });
    return Promise.race([running, late]).finally(() => {
      if (task) task.cancel();
    });
  }

  async present(cx) {
    try {
      return (await this.limited(fs.exists(this.root), IO_MS, cx)) === true;
    } catch {
      return false;
    }
  }

  // Files ------------------------------------------------------------------

  async loadCache(cx) {
    try {
      const data = JSON.parse(await this.limited(fs.readFile(this.dir + "/cache.json", "utf8"), IO_MS, cx));
      if (data && data.v === 1 && data.files && typeof data.files === "object") {
        for (const path in data.files) {
          const f = data.files[path];
          if (f && typeof f.s === "number" && f.b && typeof f.b === "object") this.files.set(path, { s: f.s, m: f.m || 0, b: f.b });
        }
      }
    } catch {
      // No cache yet, or one that was cut short by a crash: start empty.
    }
    try {
      const data = JSON.parse(await this.limited(fs.readFile(this.dir + "/projects.json", "utf8"), IO_MS, cx));
      if (data && data.dirs && typeof data.dirs === "object") this.cwds = data.dirs;
    } catch {
      this.cwds = this.cwds || {};
    }
    this.bytes = this.size();
    this.version++;
  }

  size() {
    let n = 0;
    for (const f of this.files.values()) n += f.s || 0;
    return n;
  }

  /** Size and mtime of every session file, in one listing.
   * The runtime's fs has no stat, and reading 1.8 GB to notice a change is no
   * answer: a directory listing is the cheap pass it needs to be. */
  async listFiles() {
    if ((window()?.platform ?? "windows") === "windows") {
      const script =
        "$ErrorActionPreference='SilentlyContinue';Get-ChildItem -LiteralPath '" +
        this.root.replace(/'/g, "''") +
        "' -Recurse -File -Filter *.jsonl | ForEach-Object { $_.FullName + [char]9 + $_.Length + [char]9 + [long](($_.LastWriteTimeUtc - [datetime]'1970-01-01T00:00:00Z').TotalMilliseconds) }";
      const r = await this.limited(exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]), LIST_MS, null);
      if (r === TOO_SLOW) throw new Error("the store listing took longer than " + LIST_MS + "ms");
      if (r.code !== 0) throw new Error(r.stderr || "powershell could not list the store");
      return this.listed(r.stdout, false);
    }
    const r = await this.limited(exec("sh", ["-c", 'find "$1" -type f -name "*.jsonl" -exec stat -f "%N%t%z%t%m" {} +', "sh", this.root]), LIST_MS, null);
    if (r === TOO_SLOW) throw new Error("the store listing took longer than " + LIST_MS + "ms");
    if (r.code !== 0) throw new Error(r.stderr || "find could not list the store");
    return this.listed(r.stdout, true);
  }

  listed(out, seconds) {
    const map = new Map();
    for (const line of out.split("\n")) {
      const a = line.indexOf("\t");
      if (a < 0) continue;
      const b = line.indexOf("\t", a + 1);
      if (b < 0) continue;
      const s = Number(line.slice(a + 1, b));
      const raw = Number(line.slice(b + 1).replace(/\r$/, ""));
      if (!isFinite(s) || !isFinite(raw)) continue;
      map.set(line.slice(0, a).replace(/\\/g, "/"), { s, m: Math.round(seconds ? raw * 1000 : raw) });
    }
    return map;
  }

  /** Starts one file's read as an independent task. The tick never waits for
   * it: a read that never returns leaks one slot, which the next tick gives up
   * on, instead of holding the panel. */
  read(path, st, cx) {
    this.limited(fs.readFile(path, "utf8"), READ_MS, cx)
      .then((text) => this.got(path, st, typeof text === "string" ? text : null))
      .catch(() => this.got(path, st, null));
  }

  got(path, st, text) {
    if (!this.reading.has(path)) return; // given up on while it ran
    this.reading.delete(path);
    const buckets = {};
    if (text === null) {
      // Unreadable or too slow: counted, recorded with the listing's size and
      // mtime so it stops counting as pending, keeping the buckets we knew.
      this.skipped.add(path);
    } else {
      const budget = { until: Date.now() + READ_MS };
      let cwd = null;
      try {
        cwd = scan(text, buckets, budget);
      } catch {
        // A file that is not what it claims: keep whatever was readable.
      }
      if (budget.partial) this.partial.add(path);
      else this.partial.delete(path);
      this.skipped.delete(path);
      if (cwd) this.cwds[projectOf(path, this.root)] = cwd;
    }
    const prev = this.files.get(path);
    this.files.set(path, { s: st ? st.s : prev ? prev.s : 0, m: st ? st.m : prev ? prev.m : 0, b: text === null && prev ? prev.b : buckets });
    this.version++;
    this.bytes = this.size();
    this.indexedAt = Date.now();
    this.dirty = true;
    this.pump(); // the slot is free: start the next file (unbounded: TASK_MS covers it)
  }

  /** Starts the cache write and returns at once. A write that never returns
   * (this runtime's fs can do that) must not stop the 30 s cadence: one write
   * is allowed in flight, and after IO_MS*2 the next pass may try again. */
  save(force) {
    const now = Date.now();
    if (this.saving && this.savingSince && now - this.savingSince < IO_MS * 2) return false;
    if (!force && now - this.wroteAt < WRITE_MS) return false;
    this.wroteAt = now;
    this.saving = true;
    this.savingSince = now;
    const files = {};
    for (const [path, f] of this.files) files[path] = f;
    const cache = JSON.stringify({ v: 1, files });
    const dirs = JSON.stringify({ v: 1, dirs: this.cwds });
    fs.writeFile(this.dir + "/cache.json", cache)
      .then(() => fs.writeFile(this.dir + "/projects.json", dirs))
      .catch(() => null)
      .finally(() => {
        this.saving = false;
      });
    return true;
  }

  /** Asks for a fresh listing without any pass ever waiting on it: a listing
   * process can take tens of seconds under load, and no single operation may
   * hold the cadence. The pass that follows uses whatever listing arrived
   * last; the footer says when that listing has gone stale. */
  startListing() {
    if (this.listing && this.listingSince && Date.now() - this.listingSince < LIST_MS * 2) return;
    this.listing = true;
    this.listingSince = Date.now();
    this.listingTask = this.listFiles()
      .then((map) => {
        this.stats = map;
        this.statsAt = Date.now();
        this.statError = null;
      })
      .catch((e) => {
        this.statError = String((e && e.message) || e);
      })
      .finally(() => {
        this.listing = false;
      });
  }

  /** A tick schedules work and never awaits it. Reads run as their own tasks
   * (bounded, and given up on if they outlive every bound), so no single slow
   * operation can hold the cadence, and a quiet tick still marks the time. */
  tick(cx) {
    this.startListing();
    const stats = this.stats;
    if (stats) {
      const now = Date.now();
      for (const [path, job] of [...this.reading]) {
        if (now - job.at > TASK_MS) {
          this.reading.delete(path);
          this.abandon(path, "read timed out after " + Math.round((now - job.at) / 1000) + "s");
        }
      }
      if (!this.queued.length) this.refill(stats);
      this.windowBytes = 0; // a fresh byte budget for the next 30 s of re-reads
      this.pump(cx);
    }
    if (this.dirty && this.save(false)) this.dirty = false;
    // A tick that found nothing to do still marks the time: that is how the
    // header shows the 30 s re-check is alive.
    if (stats) this.indexedAt = Date.now();
    cx.notify();
  }

  /** Picks what to read: everything new or changed, minus active sessions too
   * big to re-read while they grow. Newest first, so live sessions lead. */
  refill(stats) {
    const list = [];
    const big = new Set();
    const fresh = new Set();
    const now = Date.now();
    for (const [path, st] of stats) {
      const c = this.files.get(path);
      if (c && c.s === st.s && c.m === st.m) continue;
      if (!c) fresh.add(path);
      if (st.s > BIG_BYTES && now - st.m < STABLE_MS) {
        big.add(path);
        continue;
      }
      list.push(path);
    }
    list.sort((a, b) => stats.get(b).m - stats.get(a).m);
    this.queued = list;
    this.fresh = fresh;
    this.big = big;
    this.pass = list.length;
  }

  /** Starts reads while there is room. The window budget bounds re-reading the
   * store; a file never indexed before is not budget-limited, or a first index
   * of 1.8 GB could never finish. */
  pump(cx) {
    while (this.queued.length && this.reading.size < CONCURRENT) {
      const path = this.queued[0];
      const st = this.stats ? this.stats.get(path) : null;
      const size = st ? st.s : 0;
      const again = !this.fresh.has(path);
      if (again && this.windowBytes > 0 && this.windowBytes + size > PASS_BYTES) break;
      this.queued.shift();
      if (again) this.windowBytes += size;
      this.reading.set(path, { at: Date.now(), s: size });
      this.read(path, st, cx);
    }
  }

  /** The range's totals, kept until the data, the range or the day moves. */
  forRange(range) {
    const now = Date.now();
    const key = range + "|" + dayKey(now) + "|" + this.version;
    if (this.cachedKey !== key || !this.cached) {
      this.cached = aggregate(this.files, range, now, this.root);
      this.cachedKey = key;
    }
    return this.cached;
  }

  // UI ---------------------------------------------------------------------

  bar(t, fraction, color) {
    const share = isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
    return div().h(3).w_full().rounded(2).bg(t.raised).overflow_hidden().child(div().h(3).rounded(2).bg(color).w(safeShare(share)));
  }

  header(t) {
    const refresh = div()
      .id("tu-refresh")
      .h(20)
      .px(8)
      .rounded(6)
      .flex()
      .items_center()
      .text_size(11.5)
      .bg(t.raised)
      .text_color(t.muted)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.spawn(async (cx) => {
          await this.refresh(cx);
        });
      })
      .child("Refresh");
    return h_flex()
      .flex_none()
      .h(38)
      .px(12)
      .gap(8)
      .items_center()
      .border_b(1)
      .border_color(t.border)
      .child(div().text_size(12.5).font_semibold().child("Token usage"))
      .child(div().flex_1().min_w(0).truncate().text_right().text_size(11.5).text_color(t.dim).child(this.stampText()))
      .child(refresh);
  }

  chips(t, range) {
    return h_flex()
      .flex_none()
      .px(12)
      .py(6)
      .gap(6)
      .children(
        RANGES.map(([key, label]) => {
          const on = key === range;
          return div()
            .id("tu-range-" + key)
            .h(20)
            .px(9)
            .rounded(10)
            .flex()
            .items_center()
            .text_size(11.5)
            .cursor_pointer()
            .bg(on ? t.selected : t.raised)
            .text_color(on ? t.foreground : t.muted)
            .hover((s) => s.bg(on ? t.selected : t.hover))
            .on_click(() => setShared(SCOPE, key))
            .child(label);
        }),
      );
  }

  cell(t, label, value, color) {
    return v_flex().flex_1().min_w(0).gap(1)
      .child(div().text_size(11.5).text_color(t.dim).child(label))
      .child(div().text_size(13).text_color(color ?? t.foreground).truncate().child(value));
  }

  grid(t, a) {
    return v_flex().gap(8).children([
      h_flex().gap(10).children([this.cell(t, "Total tokens", fmtTokens(a.total)), this.cell(t, "Input", fmtTokens(a.input))]),
      h_flex().gap(10).children([this.cell(t, "Output", fmtTokens(a.output)), this.cell(t, "Cache read", fmtTokens(a.cacheRead))]),
      h_flex().gap(10).children([this.cell(t, "Requests", String(a.req)), this.cell(t, "Cost", fmtCost(a.cost), a.cost > 0 ? t.done : t.dim)]),
      // An active session is read only once it settles, so these numbers trail
      // it by up to a minute. Said here, where the numbers are, not hidden.
    ]).when(this.big.size > 0, (el) => el.child(div().text_size(11.5).text_color(t.dim).child("Active session numbers lag up to 1 minute")));
  }

  hit(t, a) {
    const hit = a.input + a.cacheRead > 0 ? a.cacheRead / (a.input + a.cacheRead) : 0;
    return h_flex().gap(8).items_center()
      .child(div().text_size(11.5).text_color(t.dim).child("Cache hit rate"))
      .child(div().flex_1().min_w(0).child(this.bar(t, hit, t.accent)))
      .child(div().w(42).text_right().text_size(11.5).text_color(t.muted).child((hit * 100).toFixed(1) + "%"));
  }

  title(t, label) {
    return div().text_size(11.5).text_color(t.muted).font_semibold().child(label);
  }

  columns(t, labels) {
    return h_flex().gap(6).items_center()
      .child(div().flex_1().text_size(11.5).text_color(t.dim).child(labels[0]))
      .child(div().w(44).text_right().whitespace_nowrap().text_size(11.5).text_color(t.dim).child(labels[1]))
      .child(div().w(76).text_right().whitespace_nowrap().text_size(11.5).text_color(t.dim).child(labels[2]))
      .child(div().w(64).text_right().whitespace_nowrap().text_size(11.5).text_color(t.dim).child(labels[3]));
  }

  models(t, a, list) {
    if (!list.length) return v_flex().gap(4).child(this.title(t, "Models")).child(div().text_size(11.5).text_color(t.dim).child("No model data in this range"));
    const total = a.total || 1;
    const rows = list.map((m) =>
      v_flex()
        .gap(1)
        .child(
          h_flex()
            .gap(6)
            .items_center()
            .child(div().flex_1().min_w(0).truncate().text_size(11.5).child(m.name))
            .child(div().w(44).text_right().whitespace_nowrap().text_size(11.5).text_color(t.dim).child(String(m.req)))
            .child(div().w(76).text_right().whitespace_nowrap().text_size(11.5).text_color(t.muted).child(fmtTokens(m.tokens)))
            .child(div().w(64).text_right().whitespace_nowrap().text_size(11.5).text_color(m.cost > 0 ? t.done : t.dim).child(fmtCost(m.cost))),
        )
        .child(this.bar(t, m.tokens / total, t.accent)),
    );
    return v_flex().gap(6).child(this.title(t, "Models")).child(this.columns(t, ["Model", "Req", "Tokens", "Cost"])).children(rows);
  }

  projects(t, list) {
    if (!list.length) return v_flex().gap(4).child(this.title(t, "Projects")).child(div().text_size(11.5).text_color(t.dim).child("No project data in this range"));
    const rows = list.map((p) =>
      h_flex()
        .h(18)
        .gap(6)
        .items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).child(short(p.label)))
        .child(div().w(78).text_right().whitespace_nowrap().text_size(11.5).text_color(t.muted).child(fmtTokens(p.tokens)))
        .child(div().w(76).text_right().whitespace_nowrap().text_size(11.5).text_color(t.dim).child(p.req + " req")),
    );
    return v_flex().gap(4).child(this.title(t, "Projects")).children(rows);
  }

  /** While a pass has files pending it counts them; otherwise it reports the
   * index as it stands. The denominator is this pass's own work, never a count
   * of what the store is hoped to hold. */
  /** The panel's own footer sentence. */
  footerText() {
    const now = Date.now();
    const pending = this.queued.length + this.reading.size;
    const parts = [];
    if (pending) parts.push("Indexing " + Math.max(0, this.pass - pending) + "/" + this.pass + " files");
    else parts.push("Indexed " + this.files.size + " files · " + fmtBytes(this.bytes));
    if (this.big.size) parts.push(this.big.size + " large file(s) waiting to settle (active sessions)");
    if (this.skipped.size) parts.push(this.skipped.size + " file(s) failed to read");
    if (this.partial.size) parts.push(this.partial.size + " file(s) only partly indexed");
    let oldest = 0;
    for (const job of this.reading.values()) if (!oldest || job.at < oldest) oldest = job.at;
    if (oldest && now - oldest > 45000) parts.push("a read has been running " + Math.round((now - oldest) / 1000) + "s");
    if (this.statsAt && now - this.statsAt > 120000) parts.push("listing " + Math.round((now - this.statsAt) / 1000) + "s stale");
    if (this.statError) parts.push("session store listing failed");
    return parts.join(" · ");
  }

  /** The panel's own header stamp. */
  stampText() {
    return this.indexedAt ? fmtAgo(Date.now() - this.indexedAt) : "waiting to index";
  }

  footer(t) {
    return h_flex().flex_none().h(26).px(12).gap(6).items_center().border_t(1).border_color(t.border).text_size(11.5).text_color(t.dim)
      .child(div().flex_1().min_w(0).truncate().child(this.footerText()));
  }

  render() {
    const t = theme();
    if (this.missing) {
      return v_flex().id("token-usage").size_full().bg(t.surface).p(12).gap(6).text_size(12).text_color(t.foreground)
        .child(div().text_size(12.5).font_semibold().child("Token usage"))
        .child(div().text_color(t.muted).child("No omp session data found (~\\.omp\\agent\\sessions)"));
    }
    const range = chosen();
    const a = this.forRange(range);
    return v_flex().id("token-usage").size_full().bg(t.surface).text_size(12).text_color(t.foreground)
      .child(this.header(t))
      .child(this.chips(t, range))
      .child(
        v_flex().flex_1().min_h(0).overflow_y_scrollbar().px(12).py(8).gap(12).children([
          this.grid(t, a),
          this.hit(t, a),
          this.models(t, a, topModels(a.models, TOP_MODELS)),
          this.projects(t, topProjects(a.projects, TOP_PROJECTS, this.cwds)),
        ]),
      )
      .child(this.footer(t));
  }
}

/** A percent width whose fraction is already clamped: "0.0%" .. "100.0%". */
function safeShare(share) {
  return (share * 100).toFixed(1) + "%";
}
