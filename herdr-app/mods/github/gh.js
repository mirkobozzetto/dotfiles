// gh as the GitHub account hop picks for the folder, the way hop's shell does:
// the nearest .hop above it, else the active account (~/.gitconfig-active);
// its profile's github.user gives the token. Without it, gh's default login
// reads a private work repo as missing. No hop on the machine: plain gh.
import { exec } from "herdr";

const RUN = `
p=\${HOP_PROFILES:-$HOME/.config/hop} active= a= d=$PWD
if [ -f "$HOME/.gitconfig-active" ]; then
  while IFS= read -r l; do case $l in *path\\ =*) active=\${l##*/} active=\${active%.gitconfig} ;; esac; done < "$HOME/.gitconfig-active"
fi
while :; do
  if [ -f "$d/.hop" ]; then read -r a < "$d/.hop"; break; fi
  [ -n "$d" ] || break
  d=\${d%/*}
done
[ -n "$a" ] && [ -f "$p/$a.gitconfig" ] || a=$active
u=$(git config -f "$p/$a.gitconfig" github.user 2>/dev/null)
[ -n "$u" ] && t=$(gh auth token -u "$u" 2>/dev/null) && export GH_TOKEN="$t"
exec gh "$@"`;

export function gh(args, options) {
  return exec("sh", ["-c", RUN, "sh", ...args], options);
}
