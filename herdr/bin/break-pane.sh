#!/bin/sh
# Pull the focused pane out into a tab of its own, the tmux break-pane move.
#
# herdr has had `pane move --new-tab` since the CLI landed, but no keybinding
# for it (discussion #1674), and the move needs an explicit pane id. A binding
# is not run from inside a pane, so HERDR_PANE_ID is absent; herdr sets
# HERDR_ACTIVE_PANE_ID for that case, and `pane list` is the fallback when even
# that is missing.

set -eu

HERDR="${HERDR_BIN_PATH:-herdr}"

pane="${HERDR_ACTIVE_PANE_ID:-}"

if [ -z "$pane" ]; then
  pane="$("$HERDR" pane list 2>/dev/null | python3 -c '
import json, sys
panes = json.load(sys.stdin)["result"]["panes"]
focused = [p for p in panes if p.get("focused")]
print(focused[0]["pane_id"] if focused else "")
')"
fi

[ -n "$pane" ] || { echo "no focused pane to move" >&2; exit 1; }

exec "$HERDR" pane move "$pane" --new-tab --focus
