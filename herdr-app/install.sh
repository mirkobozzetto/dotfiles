#!/usr/bin/env bash
#
# Installs this Herdr setup into the Herdr desktop app (~/.config/herdr-app).
# Everything it replaces is copied first to ~/.config/herdr-app/backup-<time>/.
# Run it again after a `git pull` to update.
#
#   ./install.sh

set -euo pipefail

readonly HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly APP="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
readonly BACKUP="$APP/backup-$(date +%Y%m%d-%H%M%S)"

[[ -d "$APP" ]] || { echo "No $APP: open the Herdr app once, then run this again." >&2; exit 1; }

# What this setup brings: the app's files, the layout, themes and mods.
targets=(settings.json keys.json programs.json)
for f in "$HERE"/layouts/*.json "$HERE"/themes/*.json; do targets+=("${f#"$HERE"/}"); done
for d in "$HERE"/mods/*/; do targets+=("mods/$(basename "$d")"); done

backed=0
for t in "${targets[@]}"; do
  [[ -e "$APP/$t" ]] || continue
  mkdir -p "$BACKUP/$(dirname "$t")"
  cp -R "$APP/$t" "$BACKUP/$t"
  backed=$((backed + 1))
done

bash "$HERE/sync.sh" restore >/dev/null

if command -v herdr-app >/dev/null 2>&1; then
  herdr-app do layout.switch '{"name":"mirko"}' >/dev/null 2>&1 || true
fi

echo "Installed into $APP."
((backed > 0)) && echo "Your previous files: $BACKUP"
echo "Ctrl+Space shows every key. Cmd+/ lists all shortcuts."
