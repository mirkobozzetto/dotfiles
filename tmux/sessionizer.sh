#!/usr/bin/env bash
# Opens (or joins) a tmux session dedicated to the chosen repo.
# One session per project, named after the folder.

set -euo pipefail

RACINES=(
  "$HOME/code"
  "$HOME/glouton"
  "$HOME/stuffs"
  "$HOME/business"
  "$HOME/Learn"
  "$HOME/Downloads"
  "$HOME/dotfiles"
  "$HOME/brain"
  "$HOME/Obsidian"
  "$HOME/.claude"
)
PROFONDEUR=4

# --no-ignore would descend into node_modules and vendor: stray .git dirs live there
lister_projets() {
  fd --hidden --type d --max-depth "$PROFONDEUR" '^\.git$' "${RACINES[@]}" \
    --exclude node_modules --exclude vendor --exclude target \
    --exclude plugins 2>/dev/null |
    sed 's|/\.git/*$||' |
    sort -u
}

if [[ $# -eq 1 ]]; then
  choix="$1"
else
  choix=$(lister_projets | fzf --reverse --border --prompt='projet > ' --height=100%) || exit 0
fi

[[ -z "$choix" ]] && exit 0

# tmux rejects dots in a session name
nom=$(basename "$choix" | tr '.' '_')

# two homonymous repos live under different roots (maestro.go,
# mirkobozzetto): without this we'd silently join the wrong project
if tmux has-session -t="$nom" 2>/dev/null; then
  actuel=$(tmux display-message -p -t "$nom" '#{session_path}' 2>/dev/null || true)
  if [[ "$actuel" != "$choix" ]]; then
    nom=$(basename "$(dirname "$choix")")_$nom
    nom=${nom//./_}
  fi
fi

if ! tmux has-session -t="$nom" 2>/dev/null; then
  tmux new-session -ds "$nom" -c "$choix"
fi

if [[ -z "${TMUX:-}" ]]; then
  tmux attach -t "$nom"
else
  tmux switch-client -t "$nom"
fi
