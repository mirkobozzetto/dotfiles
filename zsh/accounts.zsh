# Accounts follow the folder. The nearest .hop above it names the account
# (~/code/GRATIAGO/.hop says gratiago); elsewhere the active hop account
# applies. On every cd, the Claude login, git, gh and the hop secrets switch.
# An account without a hop profile (a client that only lends Claude) keeps
# the active hop account for GitHub. Sourced after hop.sh.

HOP_PROFILES=${HOP_PROFILES:-$HOME/.config/hop}
# This shell's own include: git reads it, hop switches it, nothing global.
_hop_file=${${TMPDIR:-/tmp}%/}/hop-shell-$$.gitconfig

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

# Points this shell's git, SSH key, gh and secrets at one hop profile.
_hop_github() {
  local profile=$HOP_PROFILES/$1.gitconfig
  git config -f "$_hop_file" include.path "$profile"
  export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=include.path GIT_CONFIG_VALUE_0=$_hop_file
  eval "$(HOP_ACTIVE=$_hop_file command hop env)"
  export HOP_GH_ACCOUNT=$1
  export HOP_GH_USER=$(git config -f "$profile" github.user)
  export GH_TOKEN=$(gh auth token -h github.com -u "$HOP_GH_USER" 2>/dev/null)
}

_hop_follow_dir() {
  # A Claude session keeps the account it was started with, even after a cd.
  [[ -n $CLAUDECODE ]] && return
  local account=$(_hop_account_for "$PWD")
  [[ -z $account || $account == "$HOP_ACCOUNT" ]] && return

  local gh_account=$account
  [[ -f $HOP_PROFILES/$account.gitconfig ]] || gh_account=$(_hop_active)
  _hop_github "$gh_account"

  export HOP_ACCOUNT=$account
  # Every account, mirko included, has its own login: none sits on the shared
  # default one, which any session started outside this shell would use.
  export CLAUDE_CONFIG_DIR=$(_hop_claude_dir "$account")
}

_hop_forget() { rm -f "$_hop_file" }

autoload -Uz add-zsh-hook
add-zsh-hook chpwd _hop_follow_dir
add-zsh-hook zshexit _hop_forget
# hop.sh has just loaded the active account's secrets, whatever was inherited.
[[ -z $CLAUDECODE ]] && HOP_ACCOUNT=
_hop_follow_dir

# hop switches GitHub for this shell only, until a cd into another account's
# folder. hop -g changes the Mac default, as hop always did.
hop() {
  if [[ $1 == -g || $1 == --global ]]; then
    shift
    # The shell's own account must not leak into the global switch.
    env -u GH_TOKEN GIT_CONFIG_COUNT=0 hop "$@" || return
    HOP_ACCOUNT=
    _hop_follow_dir
    return
  fi
  [[ -f $_hop_file ]] || _hop_github "${HOP_GH_ACCOUNT:-$(_hop_active)}"
  HOP_ACTIVE=$_hop_file command hop "$@" || return
  local account=$(basename "$(git config -f "$_hop_file" include.path)" .gitconfig)
  [[ $account == "$HOP_GH_ACCOUNT" ]] || _hop_github "$account"
}

# Git is pinned for the whole session: a Gratiago session that cds into a
# personal repo still commits and pushes as Gratiago.
claude() {
  GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=include.path \
    GIT_CONFIG_VALUE_0=$HOP_PROFILES/$HOP_GH_ACCOUNT.gitconfig command claude "$@"
}
