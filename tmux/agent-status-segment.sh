#!/usr/bin/env bash
# Compact agent summary for the tmux status bar: shows counts only for states
# that matter, so the bar stays quiet when nothing needs you. Reads the pane
# options the sidebar writes on every hook event.
set -uo pipefail

waiting=0
running=0

for p in $(tmux list-panes -a -F '#{pane_id}' 2>/dev/null); do
  [[ -z "$(tmux show-options -pqv -t "$p" @pane_agent 2>/dev/null)" ]] && continue
  att="$(tmux show-options -pqv -t "$p" @pane_attention 2>/dev/null)"
  st="$(tmux show-options -pqv -t "$p" @pane_status 2>/dev/null)"
  if [[ -n "$att" || "$st" == "waiting" ]]; then
    ((waiting++))
  elif [[ "$st" == "running" ]]; then
    ((running++))
  fi
done

out=""
((waiting > 0)) && out+="#[fg=#f38ba8,bold]▲ ${waiting}#[default]"
((running > 0)) && out+="${out:+  }#[fg=#f9e2af]▶ ${running}#[default]"
printf '%s' "$out"
