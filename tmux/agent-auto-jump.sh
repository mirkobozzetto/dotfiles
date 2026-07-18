#!/usr/bin/env bash
# Brings you to an agent the moment it wants you: a permission prompt, a
# question, a form — or a turn that just finished. Never mid-keystroke: it waits
# for your current pane to go quiet first, then switches. Skipped jumps retry on
# the next tick, so you land there as soon as you pause.
#
# A background process owns no client, so every client-scoped tmux command has
# to name one explicitly or it silently does nothing.
set -uo pipefail

IDLE_SECONDS=4   # how long the focused pane must be quiet before we steal focus
TICK=2
STATE_DIR="/tmp/agent-auto-jump-state"
mkdir -p "$STATE_DIR"

LOCK="/tmp/agent-auto-jump.pid"
if [[ -f "$LOCK" ]] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; then
  exit 0
fi
echo $$ >"$LOCK"
trap 'rm -f "$LOCK"' EXIT

# panes we already jumped to for this episode, so we don't ping-pong.
# bash 3.2 on macOS has no associative arrays: a space-delimited string does.
handled=" "

active_client() {
  tmux list-clients -F '#{client_activity}|#{client_name}' 2>/dev/null |
    sort -rn | head -1 | cut -d'|' -f2
}

prev_status() { cat "$STATE_DIR/${1//\%/}" 2>/dev/null || echo ""; }
save_status() { echo "$2" >"$STATE_DIR/${1//\%/}"; }

while tmux has-session 2>/dev/null; do
  client="$(active_client)"
  [[ -z "$client" ]] && { sleep "$TICK"; continue; }
  cur="$(tmux display-message -p -t "$client" '#{pane_id}' 2>/dev/null)"

  for p in $(tmux list-panes -a -F '#{pane_id}' 2>/dev/null); do
    [[ -z "$(tmux show-options -pqv -t "$p" @pane_agent 2>/dev/null)" ]] && continue

    att="$(tmux show-options -pqv -t "$p" @pane_attention 2>/dev/null)"
    st="$(tmux show-options -pqv -t "$p" @pane_status 2>/dev/null)"
    prev="$(prev_status "$p")"
    save_status "$p" "$st"

    # blocked on you, or a turn that just ended (running -> idle)
    wants_you=""
    [[ -n "$att" || "$st" == "waiting" ]] && wants_you="needs you"
    [[ "$prev" == "running" && "$st" == "idle" ]] && wants_you="finished"

    if [[ -z "$wants_you" ]]; then
      handled="${handled// $p / }"   # episode over: allow a future jump here
      continue
    fi

    [[ "$handled" == *" $p "* ]] && continue               # already brought you here
    [[ "$p" == "$cur" ]] && { handled+="$p "; continue; }  # you're already on it

    # don't yank focus while the current pane is still producing output
    last="$(tmux display-message -p -t "$cur" '#{pane_activity}' 2>/dev/null)"
    now="$(date +%s)"
    if [[ "$last" =~ ^[0-9]+$ ]] && ((now - last < IDLE_SECONDS)); then
      continue   # busy: retry next tick
    fi

    sess="$(tmux display-message -p -t "$p" '#{session_name}' 2>/dev/null)"
    win="$(tmux display-message -p -t "$p" '#{window_id}' 2>/dev/null)"
    tmux switch-client -c "$client" -t "$sess" 2>/dev/null
    tmux select-window -t "$win" 2>/dev/null
    tmux select-pane -t "$p" 2>/dev/null
    tmux display-message -c "$client" -- "$sess $wants_you"
    handled+="$p "
    break
  done

  sleep "$TICK"
done
