#!/usr/bin/env bash
# Loads the palette matching what the terminal currently reports.
#
# Two things this has to avoid, both of which show up as tmux aborting with
# "too many nested files" and a half-painted status bar:
#
#   - Depth. tmux.conf sourcing a theme file that sources the shared layout is
#     already three levels; run-shell starts a fresh command instead of nesting.
#   - Re-entry. Sourcing a theme file restyles the client, which makes tmux
#     re-evaluate the theme and fire the hook that called us. Applying only on a
#     real change ends that loop on its first turn.
set -uo pipefail

STATE="/tmp/tmux-theme-applied"

theme="$(tmux display-message -p '#{client_theme}' 2>/dev/null)"
[[ "$theme" == "light" ]] || theme="dark"

[[ "$(cat "$STATE" 2>/dev/null)" == "$theme" ]] && exit 0
echo "$theme" >"$STATE"

tmux source-file "$HOME/.config/tmux/theme-${theme}.conf"
