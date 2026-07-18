#!/usr/bin/env bash
# Jump to the next agent pane that needs you. "Needs you" = its most recent
# notification is a permission prompt / wait, not a completion. The plugin
# records these as `@pane_os_notify_*` = "<epoch_ms>|<run_id>:<reason>", so we
# compare timestamps: permission/wait newer than the last completion means the
# agent is still blocked on you. Also honors an explicit waiting/blocked status.
set -uo pipefail

# leading epoch from "<ms>|..." (0 if unset)
ts() { local v="$1"; v="${v%%|*}"; [[ "$v" =~ ^[0-9]+$ ]] && echo "$v" || echo 0; }

client="$(tmux list-clients -F '#{client_activity}|#{client_name}' 2>/dev/null | sort -rn | head -1 | cut -d'|' -f2)"
cur="$(tmux display-message -p -t "$client" '#{pane_id}' 2>/dev/null)"

need=()
for p in $(tmux list-panes -a -F '#{pane_id}'); do
  ag="$(tmux show-options -pqv -t "$p" @pane_agent 2>/dev/null)"
  [[ -z "$ag" ]] && continue

  st="$(tmux show-options -pqv -t "$p" @pane_status 2>/dev/null)"
  perm="$(ts "$(tmux show-options -pqv -t "$p" @pane_os_notify_permission_required 2>/dev/null)")"
  done_ts="$(ts "$(tmux show-options -pqv -t "$p" @pane_os_notify_task_completed 2>/dev/null)")"

  # explicit block, or a permission prompt newer than the last completion
  if [[ "$st" == "waiting" || "$st" == "blocked" ]] || ((perm > done_ts)); then
    need+=("$p")
  fi
done

if [[ ${#need[@]} -eq 0 ]]; then
  tmux display-message "No agent needs you right now"
  exit 0
fi

target="${need[0]}"
for i in "${!need[@]}"; do
  if [[ "${need[$i]}" == "$cur" ]]; then
    target="${need[$(((i + 1) % ${#need[@]}))]}"
    break
  fi
done

sess="$(tmux display-message -p -t "$target" '#{session_name}' 2>/dev/null)"
win="$(tmux display-message -p -t "$target" '#{window_id}' 2>/dev/null)"
tmux switch-client -c "$client" -t "$sess" 2>/dev/null
tmux select-window -t "$win" 2>/dev/null
tmux select-pane -t "$target" 2>/dev/null
tmux display-message -c "$client" -- "jumped to $sess (agent needs you)"
