#!/usr/bin/env bash
# Pick a file mentioned anywhere in the current pane's history and open it in the
# nvim already running in this tmux session, as a new tab, at its line if the
# path carries one.
#
# This is a thin wrapper over tmux-fzf-open-files-nvim: it reuses that plugin's
# path parser and nvim-targeting, and adds one thing the plugin lacks - it keeps
# only paths that actually exist on disk. The plugin's own regex matches
# anything path-shaped, so its history scan surfaces fragments and stale strings;
# checking existence against the pane's working directory drops those.
#
# Kept separate from the plugin (not an edit to it) so a plugin update cannot
# clobber this, and this cannot break the plugin's own prefix+F/H/G bindings.
set -uo pipefail

PLUGIN="$HOME/.config/tmux/plugins/tmux-fzf-open-files-nvim"
if [[ ! -d "$PLUGIN" ]]; then
  tmux display-message "tmux-fzf-open-files-nvim is not installed"
  exit 0
fi

source "$PLUGIN/scripts/awk_pane_files.sh"
source "$PLUGIN/scripts/sanitize.sh"
source "$PLUGIN/scripts/tmux_find_nvim_target.sh"
source "$PLUGIN/scripts/file_strings_to_nvim.sh"

pane_id="$(tmux display-message -p '#{pane_id}')"
pane_cwd="$(tmux display-message -p '#{pane_current_path}')"

# a path may be absolute, ~-relative, or relative to where the pane sits; the
# trailing :line:col is stripped before the disk check and put back after
exists() {
  local raw="$1" path="${1%%:*}"
  path="${path/#\~/$HOME}"
  [[ "$path" != /* ]] && path="$pane_cwd/$path"
  [[ -f "$path" ]] && printf '%s\n' "$raw"
}

mapfile_compat() {
  # bash 3.2 on macOS has no mapfile
  while IFS= read -r line; do
    [[ -n "$line" ]] && printf '%s\n' "$line"
  done
}

candidates="$(
  tmux capture-pane -t "$pane_id" -J -S - -E - -p |
    parse_files |
    sanitize_pane_output |
    mapfile_compat
)"

real=""
while IFS= read -r c; do
  [[ -z "$c" ]] && continue
  hit="$(exists "$c")" && real+="$hit"$'\n'
done <<<"$candidates"

real="${real%$'\n'}"
if [[ -z "$real" ]]; then
  tmux display-message "No existing file found in this pane"
  exit 0
fi

tmpfile="$(mktemp)"
outfile="$(mktemp)"
trap 'rm -f "$tmpfile" "$outfile"' EXIT
printf '%s\n' "$real" | awk '!seen[$0]++' >"$tmpfile"

tmux display-popup -E "fzf -m --prompt='open in nvim > ' < \"$tmpfile\" > \"$outfile\""
selected="$(cat "$outfile")"
[[ -z "$selected" ]] && exit 0

# A nvim already in the session gets the files as new tabs. When there is none,
# the plugin would split the current pane and race an unstarted nvim with
# send-keys - that is the double-pane mess. Instead, open one clean window with
# the files passed to nvim as arguments, so there is nothing to race.
read -r nvim_window_id nvim_pane_id <<<"$(find_nvim_target)"

if [[ -n "$nvim_pane_id" ]]; then
  nvim_command="$(to_tabedit_strings "$selected")"
  tmux send-keys -t "$nvim_pane_id" Escape ":$nvim_command" Enter
  tmux select-window -t "$nvim_window_id"
  tmux select-pane -t "$nvim_pane_id"
else
  # strip the :line:col suffix for the CLI; the first file's line drives the +cmd
  args=()
  first_line=""
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    local_line="${f#*:}"
    path="${f%%:*}"
    if [[ "$f" == *:* && "$local_line" =~ ^[0-9] ]]; then
      [[ -z "$first_line" ]] && first_line="${local_line%%:*}"
    fi
    args+=("$path")
  done <<<"$selected"

  if [[ -n "$first_line" ]]; then
    tmux new-window -c "$pane_cwd" "nvim +${first_line} -p ${args[*]}"
  else
    tmux new-window -c "$pane_cwd" "nvim -p ${args[*]}"
  fi
fi
