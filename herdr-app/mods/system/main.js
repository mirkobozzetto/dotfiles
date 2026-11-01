// CPU, memory and GPU load in the status bar: a small live graph and a percent for each.
// macOS only: reads `iostat`, `vm_stat`, `sysctl` and `ioreg`, none of which need root.
import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, theme, settings } from "herdr";

const EVERY = 3000, HISTORY = 12;
// One shell call per read. `iostat` samples the CPU over 1 s; the first report line is the average since boot.
const SCRIPT = [
  "iostat -n 0 -c 2 -w 1 | tail -1",
  "echo ---", "vm_stat",
  "echo ---", "sysctl -n hw.memsize",
  "echo ---", "ioreg -r -d 1 -c IOAccelerator | grep -o '\"Device Utilization %\"=[0-9]*'",
].join("; ");

// Same scale as the quota bars: green, amber from 60%, orange from 80%, red from 92%.
function level(pct) {
  const dark = settings().dark !== false;
  const scale = dark ? ["#5ed49a", "#f2c14e", "#f59152", "#f2665c"] : ["#1f9d63", "#c98a0b", "#dd6b20", "#d64545"];
  return scale[pct >= 92 ? 3 : pct >= 80 ? 2 : pct >= 60 ? 1 : 0];
}

const gb = bytes => `${(bytes / 2 ** 30).toFixed(1)} GB`;

async function read() {
  const r = await exec("sh", ["-c", SCRIPT]);
  if (r.code !== 0 && !r.stdout) throw new Error((r.stderr || `exit ${r.code}`).trim());
  const [cpuOut, vmOut, memOut, gpuOut] = r.stdout.split("---\n");
  const [user, sys, idle] = cpuOut.trim().split(/\s+/).map(Number);
  // Activity Monitor's "Memory Used": app memory (anonymous minus purgeable) + wired + compressed.
  const page = Number(/page size of (\d+)/.exec(vmOut)?.[1] ?? 16384);
  const pages = name => Number(new RegExp(`${name}:\\s+(\\d+)`).exec(vmOut)?.[1] ?? 0);
  const total = Number(memOut.trim());
  const used = (pages("Anonymous pages") - pages("Pages purgeable") + pages("Pages wired down") + pages("Pages occupied by compressor")) * page;
  // Apple Silicon has one GPU; a Mac with two reports both, so take the busier one.
  const gpus = [...gpuOut.matchAll(/=(\d+)/g)].map(m => Number(m[1]));
  return {
    cpu: { pct: 100 - idle, tip: `CPU ${Math.round(100 - idle)}% · user ${Math.round(user)}%, system ${Math.round(sys)}%` },
    ram: { pct: total ? used / total * 100 : 0, tip: `Memory ${gb(used)} of ${gb(total)} used` },
    gpu: gpus.length ? { pct: Math.max(...gpus), tip: `GPU ${Math.max(...gpus)}% busy` } : null,
  };
}

// The last HISTORY reads as thin columns, newest on the right, tallest at 100%.
function graph(history, t) {
  const cols = Array.from({ length: HISTORY }, (_, i) => history[history.length - HISTORY + i]);
  return h_flex().h(12).gap(1).items_end().flex_none()
    .children(cols.map(pct => div().w(2).rounded(1)
      .h(pct === undefined ? 1 : Math.max(1, Math.round(pct / 100 * 12)))
      .bg(pct === undefined ? t.border : level(pct)).opacity(pct === undefined ? 1 : 0.85)));
}

export default class System extends View {
  init(_props, cx) {
    this.history = { cpu: [], ram: [], gpu: [] };
    this.last = null;
    this.refresh(cx);
    cx.timer.every(EVERY, cx => this.refresh(cx));
  }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async cx => {
      try {
        this.last = await read();
        this.error = null;
        for (const key of ["cpu", "ram", "gpu"]) {
          if (!this.last[key]) continue;
          this.history[key].push(this.last[key].pct);
          if (this.history[key].length > HISTORY) this.history[key].shift();
        }
      } catch (e) { this.error = String(e.message ?? e); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  render(cx) {
    const t = theme(), now = this.last;
    const metric = (key, label) => {
      const m = now?.[key];
      if (now && !m) return null;
      return h_flex().id(`sys-${key}`).gap(5).items_center().flex_none().tooltip(m?.tip ?? label)
        .child(div().text_size(10).text_color(t.dim).child(label))
        .child(graph(this.history[key], t))
        .child(div().min_w(26).text_size(11).text_color(m && m.pct >= 60 ? level(m.pct) : t.muted).child(m ? `${Math.round(m.pct)}%` : "–"));
    };
    return h_flex().id("system").size_full().px(12).gap(12).items_center().justify_end().overflow_hidden()
      .bg(t.chrome).border_t(1).border_color(t.border).text_size(11.5).text_color(t.muted).cursor_pointer()
      .on_click(() => exec("open", ["-a", "Activity Monitor"]).catch(() => {}))
      .when(Boolean(this.error) && !now, el => el.child(div().text_color(t.dim).tooltip(this.error).child("System load unavailable")))
      .when(!this.error || Boolean(now), el => el.children([metric("cpu", "CPU"), metric("ram", "RAM"), metric("gpu", "GPU")].filter(Boolean)))
      .child(div().w(1).h(12).ml(2).flex_none().bg(t.border));
  }
}
