#!/usr/bin/env bash
#
# Symlinks every app directory declared in links.conf to its expected
# location. Existing content is moved aside, never deleted.

set -euo pipefail

readonly DOTFILES="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly MANIFEST="$DOTFILES/links.conf"
readonly TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

is_already_linked() {
  local target="$1" source="$2"
  [[ -L "$target" && "$(readlink "$target")" == "$source" ]]
}

# A target that exists without being a link is the machine's own config, and it
# may hold things this repo does not carry: tmux plugins, yazi bookmarks,
# ghostty themes. Adopt it deliberately, never behind your back.
skip() {
  echo "skip     $1 exists and is not a link - move it aside to adopt it"
}

link() {
  local source="$1" target="$2"
  mkdir -p "$(dirname "$target")"
  ln -s "$source" "$target"
  echo "link     $target -> $source"
}

install_entry() {
  local source="$DOTFILES/$1" target="$2"

  if is_already_linked "$target" "$source"; then
    echo "ok       $target"
    return
  fi

  if [[ -e "$target" || -L "$target" ]]; then
    skip "$target"
    return
  fi
  link "$source" "$target"
}

# hooks/pre-commit refuses a commit carrying a secret. Git ignores a versioned
# hooks dir until it is pointed at, and the setting is per clone, so every
# machine needs this once.
enable_hooks() {
  local current
  current="$(git -C "$DOTFILES" config core.hooksPath || true)"
  if [[ "$current" == "hooks" ]]; then
    echo "ok       git hooks"
    return
  fi
  git -C "$DOTFILES" config core.hooksPath hooks
  echo "link     git hooks -> $DOTFILES/hooks"
}

main() {
  while read -r name target; do
    [[ -z "$name" || "$name" == \#* ]] && continue
    install_entry "$name" "$(eval echo "$target")"
  done < "$MANIFEST"
  enable_hooks
}

main "$@"
