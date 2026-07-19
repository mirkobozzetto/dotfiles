#!/usr/bin/env bash
# Finishes the jump Vibe Island starts but does not complete.
#
# Clicking a session card makes it bring Ghostty forward and stop there: its
# binary carries no switch-client / select-window / select-pane, so with every
# tmux session living inside one Ghostty window you land wherever you already
# were. It does know the target though, and logs it on every click:
#
#   jump-shadow: session=eda9b29c ... tmux=true pane=%5 ...
#
# So we tail that log and perform the switch ourselves. A background process
# owns no tmux client, hence the explicit -c on every client-scoped command.
set -uo pipefail

LOG="$HOME/Library/Logs/VibeIsland/vibe-island.log"
LOCK="/tmp/vibe-island-jump-bridge.pid"
OWN_LOG="/tmp/vibe-island-jump-bridge.log"

log() { printf '%s %s\n' "$(date '+%H:%M:%S')" "$*" >>"$OWN_LOG"; }

if [[ -f "$LOCK" ]] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; then
  exit 0
fi
echo $$ >"$LOCK"
trap 'rm -f "$LOCK"' EXIT

active_client() {
  tmux list-clients -F '#{client_activity}|#{client_name}' 2>/dev/null |
    sort -rn | head -1 | cut -d'|' -f2
}

jump_to_pane() {
  local pane="$1" client sess win
  client="$(active_client)"
  [[ -z "$client" ]] && return

  # a pane id that no longer exists just means a stale card
  sess="$(tmux display-message -p -t "$pane" '#{session_name}' 2>/dev/null)" || return
  [[ -z "$sess" ]] && return
  win="$(tmux display-message -p -t "$pane" '#{window_id}' 2>/dev/null)"

  tmux switch-client -c "$client" -t "$sess" 2>/dev/null
  tmux select-window -t "$win" 2>/dev/null
  tmux select-pane -t "$pane" 2>/dev/null
  log "jumped to $sess ($pane)"
}

# -F survives the log being rotated out from under us
tail -n 0 -F "$LOG" 2>/dev/null | while read -r line; do
  case "$line" in
    *jump-shadow:*tmux=true*pane=%*) ;;
    *) continue ;;
  esac

  pane="${line#*pane=}"
  pane="${pane%% *}"
  [[ "$pane" =~ ^%[0-9]+$ ]] || continue

  jump_to_pane "$pane"
done
