#!/usr/bin/env bash
# fzf picker over sesh, laid out like sessionx: popup, preview on the right,
# sources cycled with Ctrl keys. Bound to Cmd+Alt+P through Ghostty.

set -uo pipefail

ROOTS=(
  "$HOME/code"
  "$HOME/business"
  "$HOME/brain"
  "$HOME/.claude"
  "$HOME/Learn"
  "$HOME/dotfiles"
  "$HOME/glouton"
  "$HOME/stuffs"
)

# sesh only knows zoxide, tmux and sesh.toml. These two sources replace
# sessionx's static custom-paths.
list_projects() {
  {
    printf "%s\n" "${ROOTS[@]}"
    fd --hidden --type d --exact-depth 1 . "${ROOTS[@]}" 2>/dev/null
    fd --hidden --type d --max-depth 4 '^\.git$' "${ROOTS[@]}" \
      --exclude node_modules --exclude vendor --exclude target --exclude plugins 2>/dev/null |
      sed 's|/\.git/*$||'
  } | sed 's|/$||' | sort -u
}

# everything under $HOME. Library and caches are excluded: thousands of entries
# nobody opens a session in, and they drown the real matches.
list_everything() {
  fd --hidden --type d --max-depth 4 . "$HOME" \
    --exclude Library --exclude .Trash --exclude Documents --exclude Desktop --exclude Downloads --exclude node_modules --exclude .git \
    --exclude target --exclude .venv --exclude dist --exclude build \
    --exclude .next --exclude .cache --exclude Pictures --exclude Music \
    --exclude Movies --exclude .cargo --exclude .rustup --exclude .bun \
    --exclude .npm --exclude .nvm 2>/dev/null | sed 's|/$||'
}

# fzf re-invokes this script for the directory sources
case "${1:-}" in
  --projects) list_projects; exit 0 ;;
  --everything) list_everything; exit 0 ;;
esac

choice=$(
  sesh list --icons | fzf-tmux -p 85%,80% \
    --no-sort --ansi \
    --border-label ' sesh ' \
    --prompt '  sesh  ' \
    --pointer '▎' \
    --header '  ^a all      ^t tmux     ^g configs
  ^z zoxide   ^f projects   ^h home
  ^d kill     ? preview     tab / S-tab move' \
    --header-first \
    --color 'bg+:#313244,fg+:#cdd6f4,hl:#f5c2e7,hl+:#f5c2e7,border:#89b4fa,label:#89b4fa,prompt:#a6e3a1,pointer:#f5c2e7,header:#7f849c,info:#7f849c' \
    --bind 'tab:down,btab:up' \
    --bind '?:toggle-preview' \
    --bind 'ctrl-a:change-prompt(  sesh  )+reload(sesh list --icons)' \
    --bind 'ctrl-t:change-prompt(  tmux  )+reload(sesh list -t --icons)' \
    --bind 'ctrl-g:change-prompt(  config  )+reload(sesh list -c --icons)' \
    --bind 'ctrl-z:change-prompt(  zoxide  )+reload(sesh list -z --icons)' \
    --bind "ctrl-f:change-prompt(  project  )+reload($0 --projects)" \
    --bind "ctrl-h:change-prompt(  home  )+reload($0 --everything)" \
    --bind 'ctrl-d:execute-silent(tmux kill-session -t {2..})+change-prompt(  sesh  )+reload(sesh list --icons)' \
    --preview-window 'right:45%' \
    --preview 'sesh preview {} 2>/dev/null || eza -la --icons --group-directories-first {} 2>/dev/null || ls -la {}'
)

[[ -z "$choice" ]] && exit 0
sesh connect "$choice"
