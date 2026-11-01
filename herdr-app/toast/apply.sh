#!/usr/bin/env bash
# Herdr has no setting to turn its toasts off, and puts its own toast mod back
# at every start (the edited one moves to toast-edited). A new Herdr terminal
# puts the silent one back (~/.zshrc). Herdr reloads a saved mod live.
set -euo pipefail
readonly SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/main.js"
readonly MODS="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods"
[ -d "$MODS/toast" ] || exit 0
# Copies Herdr moved aside are ours: drop them, or sync.sh would pull them.
for d in "$MODS"/toast-edited*; do
  [ -f "$d/main.js" ] && cmp -s "$SRC" "$d/main.js" && rm -rf "$d"
done
cmp -s "$SRC" "$MODS/toast/main.js" || cp "$SRC" "$MODS/toast/main.js"
