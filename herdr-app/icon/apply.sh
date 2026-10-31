#!/usr/bin/env bash
# Puts herdr-pink.png on /Applications/Herdr.app as a Finder custom icon, the
# same as Get Info > paste. An update of Herdr brings its own icon back: run
# this again after one; a new Herdr terminal does it (~/.zshrc).
set -euo pipefail
readonly ICON="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/herdr-pink.png"
readonly APP="${1:-/Applications/Herdr.app}"
# Already there: nothing to do (runs at every login and every change of the app).
[ -e "$APP/Icon"$'\r' ] && exit 0
[ -d "$APP" ] || exit 0
osascript -l JavaScript - "$ICON" "$APP" <<'JS'
ObjC.import("AppKit");
function run([icon, app]) {
  const image = $.NSImage.alloc.initWithContentsOfFile(icon);
  if (!$.NSWorkspace.sharedWorkspace.setIconForFileOptions(image, app, 0)) throw new Error(`could not set the icon of ${app}`);
  return `icon set on ${app}`;
}
JS
# The Dock keeps its own icon cache, which a Dock restart alone doesn't clear:
# it would go on showing the icon it saw while the update had none.
rm -f "$(getconf DARWIN_USER_CACHE_DIR)com.apple.dock.iconcache"
killall Dock
