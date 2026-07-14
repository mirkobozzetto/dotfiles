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

back_up() {
  local target="$1"
  mv "$target" "$target.backup-$TIMESTAMP"
  echo "backup   $target.backup-$TIMESTAMP"
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

  [[ -e "$target" || -L "$target" ]] && back_up "$target"
  link "$source" "$target"
}

main() {
  while read -r name target; do
    [[ -z "$name" || "$name" == \#* ]] && continue
    install_entry "$name" "$(eval echo "$target")"
  done < "$MANIFEST"
}

main "$@"
