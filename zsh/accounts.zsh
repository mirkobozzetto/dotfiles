# Accounts follow the folder. The nearest .hop above it names the account
# (~/code/GRATIAGO/.hop says gratiago); elsewhere the active hop account
# applies. On every cd, the Claude login, gh and the hop secrets switch.
# An account without a hop profile (a client that only lends Claude) keeps
# the active hop account for GitHub. Sourced after hop.sh.

HOP_PROFILES=${HOP_PROFILES:-$HOME/.config/hop}
# This account keeps the plain ~/.claude login; every other one gets its own.
HOP_CLAUDE_DEFAULT=mirko

_hop_active() {
  basename "$(git config -f "$HOME/.gitconfig-active" include.path)" .gitconfig
}

_hop_account_for() {
  local d=$1
  while [[ $d != / ]]; do
    if [[ -f $d/.hop ]]; then
      tr -d '[:space:]' < "$d/.hop"
      return
    fi
    d=${d:h}
  done
  _hop_active
}

# ~/.claude-<account> holds links to everything in ~/.claude (settings, rules,
# skills, history) plus its own account file, so its login stays separate.
# ponytail: a file Claude rewrites in place there (settings.json via /config)
# stops being a link and diverges; delete it and cd again to relink.
_hop_claude_dir() {
  local dir=$HOME/.claude-$1 f
  if [[ ! -d $dir ]]; then
    mkdir -p "$dir"
    jq 'del(.oauthAccount)' "$HOME/.claude.json" > "$dir/.claude.json"
    chmod 600 "$dir/.claude.json"
  fi
  for f in "$HOME"/.claude/{*,.[!.]*}(N); do
    case ${f:t} in .claude.json | .credentials.json | .git) continue ;; esac
    [[ -e $dir/${f:t} || -L $dir/${f:t} ]] || ln -s "$f" "$dir/${f:t}"
  done
  print -r -- "$dir"
}

_hop_follow_dir() {
  # A Claude session keeps the account it was started with, even after a cd.
  [[ -n $CLAUDECODE ]] && return
  local account=$(_hop_account_for "$PWD")
  [[ -z $account || $account == "$HOP_ACCOUNT" ]] && return

  local gh_account=$account
  [[ -f $HOP_PROFILES/$account.gitconfig ]] || gh_account=$(_hop_active)
  local profile=$HOP_PROFILES/$gh_account.gitconfig

  # hop env only prints the active account: point it at this one instead.
  local include=$(mktemp)
  git config -f "$include" include.path "$profile"
  eval "$(HOP_ACTIVE=$include command hop env)"
  rm -f "$include"

  export HOP_ACCOUNT=$account HOP_GH_ACCOUNT=$gh_account
  export HOP_GH_USER=$(git config -f "$profile" github.user)
  export GH_TOKEN=$(gh auth token -h github.com -u "$HOP_GH_USER" 2>/dev/null)
  if [[ $account == "$HOP_CLAUDE_DEFAULT" ]]; then
    unset CLAUDE_CONFIG_DIR
  else
    export CLAUDE_CONFIG_DIR=$(_hop_claude_dir "$account")
  fi
}

autoload -Uz add-zsh-hook
add-zsh-hook chpwd _hop_follow_dir
# hop.sh has just loaded the active account's secrets, whatever was inherited.
[[ -z $CLAUDECODE ]] && HOP_ACCOUNT=
_hop_follow_dir

hop() {
  command hop "$@" || return
  HOP_ACCOUNT=
  _hop_follow_dir
}

# Git is pinned for the whole session: a Gratiago session that cds into a
# personal repo still commits and pushes as Gratiago.
claude() {
  GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=include.path \
    GIT_CONFIG_VALUE_0=$HOP_PROFILES/$HOP_GH_ACCOUNT.gitconfig command claude "$@"
}
