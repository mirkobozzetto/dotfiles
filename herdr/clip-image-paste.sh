#!/bin/sh
# ponytail: herdr 0.7.x dropped the local clipboard-image bridge (herdr#986).
# Image in the clipboard -> stage a PNG and type its path, which Claude Code
# attaches on its own. Anything else -> plain text paste, so cmd+v stays cmd+v.
set -e
pane="${HERDR_ACTIVE_PANE_ID:-$HERDR_PANE_ID}"
[ -n "$pane" ] || exit 1
f="$(mktemp -d -t herdr-clip)/clip.png"
: > "$f"
osascript >/dev/null 2>&1 <<OSA || true
set fh to open for access POSIX file "$f" with write permission
write (the clipboard as «class PNGf») to fh
close access fh
OSA
if [ -s "$f" ]; then
  herdr pane send-text "$pane" "$f " >/dev/null
else
  herdr pane send-text "$pane" "$(pbpaste)" >/dev/null
fi
