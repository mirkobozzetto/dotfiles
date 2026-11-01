// omp's cost since midnight, in the bottom bar; a click opens the omp usage panel.
// Reads only the session files omp wrote today, every few minutes: the full
// history stays with the token-usage panel.
import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, home, run, theme } from "herdr";

const EVERY = 5 * 60e3;
const SESSIONS = () => `${home()}/.omp/agent/sessions`;
// Same rule as token-usage's store.js: message lines with usage, cost.total or its parts.
const SCRIPT = `d=$(date +%Y-%m-%d); s=$(date -j -f "%Y-%m-%d %H:%M:%S" "$d 00:00:00" +%s)000
find "$1" -type f -name '*.jsonl' -newermt "$d" -exec grep -h '"usage"' {} + 2>/dev/null |
jq -R -n --argjson s "$s" '[inputs | (try fromjson catch null)
  | select(.type? == "message" and .message.usage and ((.message.timestamp | type) == "number") and .message.timestamp >= $s)
  | .message.usage.cost | if type == "object" then (.total // ((.input // 0) + (.output // 0) + (.cacheRead // 0) + (.cacheWrite // 0))) else 0 end]
  | add // 0'`;

export default class OmpCost extends View {
  init(_props, cx) {
    this.cost = null;
    const read = () => cx.spawn(async (cx) => {
      const r = await exec("sh", ["-c", SCRIPT, "sh", SESSIONS()]).catch(() => null);
      const n = Number(r?.stdout?.trim());
      this.cost = r?.code === 0 && Number.isFinite(n) ? n : null;
      cx.notify();
    });
    read();
    cx.timer.every(EVERY, () => read());
  }

  render() {
    const t = theme();
    const text = this.cost === null ? "omp …" : `omp $${this.cost.toFixed(2)}`;
    return h_flex().id("omp-cost").size_full().px(10).items_center().justify_center().bg(t.chrome).border_t(1).border_color(t.border)
      .text_size(11.8).text_color(this.cost ? t.muted : t.dim).cursor_pointer()
      .tooltip("omp cost since midnight · click for the usage panel")
      .on_click(() => { run("layout.select", { stack: "panel-body", child: "usage-omp" }); run("layout.show", { id: "panel" }); })
      .child(text);
  }
}
