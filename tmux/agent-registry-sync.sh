#!/usr/bin/env bash
# Keeps the agent sidebar's pane list in sync with reality: the plugin only
# tags a pane on SessionStart, so sessions started before the hooks — or whose
# tag got cleared mid-run — vanish from the sidebar even while claude runs.
# Every few seconds this tags any pane running claude and untags panes that
# aren't, so the list is always complete. Live state still comes from hooks;
# this only fixes presence. Single instance, guarded by a pidfile.
set -uo pipefail

LOCK="/tmp/agent-registry-sync.pid"
if [[ -f "$LOCK" ]] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; then
  exit 0
fi
echo $$ >"$LOCK"
trap 'rm -f "$LOCK"' EXIT

pane_runs_claude() {
  local pid kids k
  pid="$(tmux display-message -p -t "$1" '#{pane_pid}' 2>/dev/null)"
  [[ -z "$pid" ]] && return 1
  kids="$(pgrep -P "$pid" 2>/dev/null || true)"
  for k in $pid $kids; do
    ps -p "$k" -o comm= 2>/dev/null | grep -qi claude && return 0
  done
  return 1
}

while tmux has-session 2>/dev/null; do
  for p in $(tmux list-panes -a -F '#{pane_id}' 2>/dev/null); do
    tag="$(tmux show-options -pqv -t "$p" @pane_agent 2>/dev/null)"
    if pane_runs_claude "$p"; then
      [[ -z "$tag" ]] && {
        tmux set-option -p -t "$p" @pane_agent "claude" 2>/dev/null
        tmux set-option -p -t "$p" @pane_started_at "$(date +%s)" 2>/dev/null
      }
    else
      # only clear tags we can prove are stale (no claude process behind them)
      [[ -n "$tag" ]] && tmux set-option -pu -t "$p" @pane_agent 2>/dev/null
    fi
  done
  sleep 3
done
