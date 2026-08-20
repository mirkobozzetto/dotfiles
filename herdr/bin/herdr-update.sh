#!/bin/sh
# Upgrade herdr, then warn if a running server is left on the old build.
# A stale server + new client = protocol mismatch that silently breaks
# paste and dictation in every pane (seen with 0.8.0 server / 0.8.2 client).
set -u

BREW=/opt/homebrew/bin/brew

before=$($BREW list --versions herdr 2>/dev/null)
$BREW upgrade herdr
after=$($BREW list --versions herdr 2>/dev/null)

if [ "$before" != "$after" ] && pgrep -f "herdr server" >/dev/null 2>&1; then
  /usr/bin/osascript -e 'display notification \
    "Serveur encore sur l ancienne version : le collage va casser. Tape herdr server stop puis relance herdr." \
    with title "herdr mis à jour"'
  echo "$(date '+%F %T') upgraded ($before -> $after) with a live server: restart required" >&2
fi
