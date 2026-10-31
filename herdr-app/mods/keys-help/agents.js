// The agents' own keys, read from each one's docs or binary on 2026-10-31.
// Option keys reach them through the alt-* lines of keys.json (terminal).
export const AGENT_KEYS = [
  ["Claude Code", [
    ["option+p", "Pick a model"],
    ["option+t", "Thinking on/off"],
    ["shift+up / shift+down", "Raise or lower effort"],
    ["option+o", "Fast mode on/off"],
    ["shift+tab", "Cycle permission mode"],
    ["ctrl+o", "Expand tool output"],
  ]],
  ["pi", [
    ["ctrl+l", "Pick a model"],
    ["ctrl+p / shift+ctrl+p", "Next or previous model"],
    ["shift+tab", "Cycle thinking level"],
    ["ctrl+t", "Collapse or expand thinking"],
    ["ctrl+s", "Save model and thinking level"],
  ]],
  ["omp", [
    ["option+m", "Pick a model"],
    ["ctrl+p / shift+ctrl+p", "Next or previous model"],
    ["shift+tab", "Cycle thinking level"],
  ]],
  ["Prime Agent", [
    ["ctrl+l", "Pick a model (left/right: effort)"],
    ["option+s", "All or scoped models"],
    ["ctrl+o", "Cycle detail level"],
  ]],
];
