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

LOG="/tmp/agent-auto-jump.log"
log() { printf '%s %s\n' "$(date '+%H:%M:%S')" "$*" >>"$LOG"; }

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

# Wait, never exit, when no session answers. tmux loads its config - and starts
# this - before tmux-resurrect has restored anything, so a `while has-session`
# loop ends on the very first tick after a reboot and nothing ever restarts it.
while true; do
  if ! tmux has-session 2>/dev/null; then
    sleep "$TICK"
    continue
  fi

  client="$(active_client)"
  [[ -z "$client" ]] && { sleep "$TICK"; continue; }
  cur="$(tmux display-message -p -t "$client" '#{pane_id}' 2>/dev/null)"

  for p in $(tmux list-panes -a -F '#{pane_id}' 2>/dev/null); do
    [[ -z "$(tmux show-options -pqv -t "$p" @pane_agent 2>/dev/null)" ]] && continue

    att="$(tmux show-options -pqv -t "$p" @pane_attention 2>/dev/null)"
    st="$(tmux show-options -pqv -t "$p" @pane_status 2>/dev/null)"
    # @pane_status goes briefly empty between two hook writes. Treat that as "no
    # news" rather than a state: recording it would erase the running side of a
    # running -> idle edge and the finished turn would go unnoticed.
    [[ -z "$st" && -z "$att" ]] && continue

    prev="$(prev_status "$p")"
    [[ "$prev" != "$st" ]] && log "$p: $prev -> $st (attention='$att')"

    # blocked on you, or a turn that just ended (running -> idle)
    wants_you=""
    [[ -n "$att" || "$st" == "waiting" ]] && wants_you="needs you"
    [[ "$prev" == "running" && "$st" == "idle" ]] && wants_you="finished"

    if [[ -z "$wants_you" ]]; then
      save_status "$p" "$st"
      handled="${handled// $p / }"   # episode over: allow a future jump here
      continue
    fi

    # already brought you here, or you are already on it
    if [[ "$handled" == *" $p "* ]]; then
      save_status "$p" "$st"
      continue
    fi
    if [[ "$p" == "$cur" ]]; then
      save_status "$p" "$st"
      handled+="$p "
      continue
    fi

    # don't yank focus mid-sentence. client_activity is the last time YOU sent
    # input; it stays put while a pane streams output, which is what we want -
    # pane_activity would have meant "an agent is printing", and does not even
    # exist in this tmux.
    last="$(tmux display-message -p -t "$client" '#{client_activity}' 2>/dev/null)"
    now="$(date +%s)"
    if [[ "$last" =~ ^[0-9]+$ ]] && ((now - last < IDLE_SECONDS)); then
      # deliberately do NOT save the status here: `running -> idle` is a single
      # edge, and recording it would make the next tick see idle -> idle and
      # forget that a jump is still owed. Leaving prev alone keeps the edge live
      # until you actually go quiet, however long that takes.
      log "hold: typed $((now - last))s ago, $p wants you ($wants_you)"
      continue
    fi

    sess="$(tmux display-message -p -t "$p" '#{session_name}' 2>/dev/null)"
    win="$(tmux display-message -p -t "$p" '#{window_id}' 2>/dev/null)"
    tmux switch-client -c "$client" -t "$sess" 2>/dev/null
    tmux select-window -t "$win" 2>/dev/null
    tmux select-pane -t "$p" 2>/dev/null
    tmux display-message -c "$client" -- "$sess $wants_you"
    log "JUMPED to $sess ($p) because it $wants_you"
    save_status "$p" "$st"
    handled+="$p "
    break
  done

  sleep "$TICK"
done
