#!/usr/bin/env bash
#
# The Herdr app does not follow symlinks for live reload and rewrites some of
# its files in place, so this folder holds copies, not links.
#   sync.sh          copy the app's personal files here (then commit)
#   sync.sh restore  copy them back into the app on a new machine
# Personal = everything the app did not ship (installed.json lists what it did).
# Mod data (data/), window state and the ntfy topic stay on the machine.

set -euo pipefail

readonly REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly APP="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
readonly FILES=(settings.json keys.json programs.json)
# Theme files the app writes itself; installed.json does not list them.
readonly SHIPPED_THEMES=(atom-one-dark win98)

shipped() {
  python3 -c 'import json, sys; print("\n".join(json.load(open(sys.argv[1]))))' "$APP/installed.json"
}

copy_tree() {
  rsync -a --delete --exclude '*.d.ts' --exclude 'jsconfig.json' --exclude '.*' "$1/" "$2/"
}

pull() {
  local list name file
  list="$(shipped)"
  mkdir -p "$REPO/mods" "$REPO/layouts" "$REPO/themes"
  for file in "${FILES[@]}"; do
    [[ -f "$APP/$file" ]] && cp "$APP/$file" "$REPO/$file"
  done
  for dir in "$APP"/mods/*/; do
    name="$(basename "$dir")"
    grep -qx "$name" <<<"$list" || copy_tree "$dir" "$REPO/mods/$name"
  done
  for file in "$APP"/layouts/*.json; do
    name="$(basename "$file" .json)"
    grep -qx "layout:$name" <<<"$list" || cp "$file" "$REPO/layouts/"
  done
  for file in "$APP"/themes/*.json; do
    name="$(basename "$file" .json)"
    [[ " ${SHIPPED_THEMES[*]} " == *" $name "* ]] || cp "$file" "$REPO/themes/"
  done
  echo "pulled into $REPO"
}

restore() {
  local dir
  mkdir -p "$APP/mods" "$APP/layouts" "$APP/themes"
  for file in "${FILES[@]}"; do
    [[ -f "$REPO/$file" ]] && cp "$REPO/$file" "$APP/$file"
  done
  for dir in "$REPO"/mods/*/; do
    copy_tree "$dir" "$APP/mods/$(basename "$dir")"
  done
  cp "$REPO"/layouts/*.json "$APP/layouts/"
  cp "$REPO"/themes/*.json "$APP/themes/"
  echo "restored into $APP"
}

case "${1:-pull}" in
  pull) pull ;;
  restore) restore ;;
  *) echo "usage: $0 [pull|restore]" >&2; exit 1 ;;
esac
