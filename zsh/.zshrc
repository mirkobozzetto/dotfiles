# Add deno completions to search path
if [[ ":$FPATH:" != *":/Users/mirkobozzetto/.zsh/completions:"* ]]; then export FPATH="/Users/mirkobozzetto/.zsh/completions:$FPATH"; fi
export EDITOR="zed --wait"
export VISUAL="zed --wait"

# If you come from bash you might have to change your $PATH.
 export PATH=$HOME/bin:/usr/local/bin:$PATH
DEFAULT_USER=$USER

# Path to your oh-my-zsh installation.
export ZSH="$HOME/.oh-my-zsh"
 ZSH_THEME="robbyrussell"

plugins+=(git zsh-syntax-highlighting colorize npm k zsh-npm-scripts-autocomplete zsh-better-npm-completion man charm bun)
# nvm  nvmrc automatic config ...  a voir sur github ou autre

source $ZSH/oh-my-zsh.sh

# Set up once, and then reuse. This way it supports user oveagnosteragnosterrrides after the
# plugin is loaded.
typeset -AHg less_termcap

# bold & blinking mode
less_termcap[mb]="${fg_bold[red]}"
less_termcap[md]="${fg_bold[red]}"
less_termcap[me]="${reset_color}"
# standout mode
less_termcap[so]="${fg_bold[yellow]}${bg[blue]}"
less_termcap[se]="${reset_color}"
# underlining
less_termcap[us]="${fg_bold[green]}"
less_termcap[ue]="${reset_color}"

# Handle $0 according to the standard:
# https://zdharma-continuum.github.io/Zsh-100-Commits-Club/Zsh-Plugin-Standard.html
0="${${ZERO:-${0:#$ZSH_ARGZERO}}:-${(%):-%N}}"
0="${${(M)0:#/*}:-$PWD/$0}"

# Absolute path to this file's directory.
typeset -g __colored_man_pages_dir="${0:A:h}"

function colored() {
  local -a environment

  # Convert associative array to plain array of NAME=VALUE items.
  local k v
  for k v in "${(@kv)less_termcap}"; do
    environment+=( "LESS_TERMCAP_${k}=${v}" )
  done

  # Prefer `less` whenever available, since we specifically configured
  # environment for it.
  environment+=( PAGER="${commands[less]:-$PAGER}" )
  environment+=( GROFF_NO_SGR=1 )

  # See ./nroff script.
  if [[ "$OSTYPE" = solaris* ]]; then
    environment+=( PATH="${__colored_man_pages_dir}:$PATH" )
  fi

  command env $environment "$@"
}

autoload -U compinit
compinit
source <(jj util completion zsh)


# zsh_autocompletion
source ~/.zsh/zsh-autosuggestions/zsh-autosuggestions.zsh
export ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE="fg=#808080"



 export MANPATH="/usr/local/man:$MANPATH"

# You may need to manually set your language environment
# export LANG=en_US.UTF-8


export LESS_TERMCAP_mb=$(printf '\e[01;31m') # enter blinking mode – red
export LESS_TERMCAP_se=$(printf '\e[0m') # leave standout mode
export LESS_TERMCAP_so=$(printf '\e[01;33m') # enter standout mode – yellow
export LESS_TERMCAP_ue=$(printf '\e[0m') # leave underline mode
export LESS_TERMCAP_us=$(printf '\e[04;36m') # enter underline mode – cyan

# pnpm
export PNPM_HOME="/Users/mirkobozzetto/Library/pnpm"
case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PNPM_HOME:$PATH" ;;
esac
# pnpm end


# bun completions
#[ -s "/Users/mirkobozzetto/.bun/_bun" ] && source "/Users/mirkobozzetto/.bun/_bun"

# bun
#export BUN_INSTALL="$HOME/.bun"
#export PATH="$BUN_INSTALL/bin:$PATH"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion


[ -f ~/.zshalias ] && source ~/.zshalias

eval "$(starship init zsh)"
. "/Users/mirkobozzetto/.deno/env"

export PATH="/Users/mirkobozzetto/.config/herd-lite/bin:$PATH"
export PHP_INI_SCAN_DIR="/Users/mirkobozzetto/.config/herd-lite/bin:$PHP_INI_SCAN_DIR"

export PATH="$PATH:/Applications/Docker.app/Contents/Resources/bin"
export PATH="$PATH:/Applications/Docker.app/Contents/Resources/cli-plugins"

eval "$(zoxide init zsh)"
# export PATH="/opt/homebrew/opt/mariadb/bin:$PATH"

# . "$HOME/.local/bin/env"  # Commented - file does not exist


# The following lines have been added by Docker Desktop to enable Docker CLI completions.
fpath=(/Users/mirkobozzetto/.docker/completions $fpath)
autoload -Uz compinit
compinit

# End of Docker CLI completions

[[ "$TERM_PROGRAM" == "kiro" ]] && . "$(kiro --locate-shell-integration-path zsh)"

export MB="/Users/mirkobozzetto/Library/CloudStorage/GoogleDrive-mirko@mirko.re/Mon Drive/mirko-brain"
alias mb='cd "$MB"'
# `cc agent` bascule sur le gestionnaire d'agents de fond, qui refuse
# --brief : seul le profil de permissions est repris. Pas de
# --teammate-mode : settings.json impose in-process, jamais tmux (herdr).
unalias cc 2>/dev/null
cc() {
  if [[ $1 == agent || $1 == agents ]]; then
    shift
    claude agents --dangerously-skip-permissions "$@"
    return
  fi
  claude --dangerously-skip-permissions --brief "$@"
}
alias ccw='claude --dangerously-skip-permissions --brief -w'
# ccc/cccw: -c natif reprend la mauvaise session (avant-derniere) sur
# sessions forkees/resume (claude-code #10063, #48270). On resout la vraie
# derniere par timestamp via ~/.claude/bin/claude-last-session.
unalias ccc cccw 2>/dev/null
ccc() {
  local s args
  if [[ $1 == agent || $1 == agents ]]; then
    shift
    claude agents --dangerously-skip-permissions --cwd "$PWD" "$@"
    return
  fi
  s=$("$HOME/.claude/bin/claude-last-session" 2>/dev/null)
  args=(--dangerously-skip-permissions --brief)
  [[ -n $s ]] && args+=(--resume $s)
  claude "${args[@]}" "$@"
}
cccw() {
  local s args
  s=$("$HOME/.claude/bin/claude-last-session" 2>/dev/null)
  args=(--dangerously-skip-permissions --brief -w)
  [[ -n $s ]] && args+=(--resume $s)
  claude "${args[@]}" "$@"
}
alias cca="claude agents"

rnd() {
  if [ -z "$1" ]; then
    echo "Usage: rnd <new_name>"
    return 1
  fi

  local current_dir="$(pwd)"
  local parent_dir="$(dirname "$current_dir")"
  local new_path="$parent_dir/$1"

  mv "$current_dir" "$new_path" && cd "$new_path"
}

# bun
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# Version 1.0.48 avec hooks qui fonctionnent (1.0.98 a un bug)

# Added by Antigravity
export PATH="/Users/mirkobozzetto/.antigravity/antigravity/bin:$PATH"

# Added by Antigravity
export PATH="/Users/mirkobozzetto/.antigravity/antigravity/bin:$PATH"

# Added by Antigravity
export PATH="/Users/mirkobozzetto/.antigravity/antigravity/bin:$PATH"
export GOOGLE_CLOUD_PROJECT="coding-487800"

# opencode
export PATH=/Users/mirkobozzetto/.opencode/bin:$PATH
export PATH="$HOME/.local/bin:$PATH"
export PATH="$PATH:$(python3 -m site --user-base)/bin"
ytt() { python3 -m youtube_transcript_api "$1" --languages fr en es de it pt --format text > "$1.txt" && echo "✅ Saved: $1.txt"; }

# Docker: nettoyage sans risque. Aucun de ces alias ne touche aux volumes,
# donc aucune base de données ne peut disparaître.
alias dstat="docker system df"
alias dps="docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'"

# Le gros du gain, et le plus sûr : le cache de build ne contient que des
# couches intermédiaires reconstructibles.
alias dclean="docker builder prune --force && docker image prune --force && docker container prune --force --filter 'until=168h' && docker system df"

# Version agressive, à lancer en connaissance de cause : supprime en plus tout
# le cache et les images sans conteneur, y compris celles qu'il faudra
# retélécharger. Les conteneurs sont purgés avant les images, sans quoi une
# image référencée par un conteneur arrêté resterait protégée.
alias dclean-hard="docker container prune --force && docker builder prune --all --force && docker image prune --all --force && docker system df"

# Added by Devin
export PATH="/Users/mirkobozzetto/.codeium/windsurf/bin:$PATH"
export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"

# Display an image in the terminal. Ghostty speaks the kitty graphics protocol;
# passthrough=tmux is what gets the pixels past the multiplexer.
img() {
  chafa --passthrough=tmux --format=kitty --size="${COLUMNS:-80}x30" "$@"
}

# yazi: `y` opens the file manager and leaves you in the directory you exited in
# (upstream wrapper). `q` quits and moves, `Q` quits without moving.
y() {
  local tmp cwd
  tmp="$(mktemp -t "yazi-cwd.XXXXXX")"
  yazi "$@" --cwd-file="$tmp"
  if cwd="$(command cat -- "$tmp")" && [ -n "$cwd" ] && [ "$cwd" != "$PWD" ]; then
    builtin cd -- "$cwd"
  fi
  rm -f -- "$tmp"
}

# the .NET SDK installer does not touch PATH; bicep-lsp and dotnet CLI need it
export PATH="/usr/local/share/dotnet:$PATH"

# navi: Ctrl+G pops the interactive cheatsheet, fills placeholders, inserts the command
eval "$(navi widget zsh)"

# herdr-shell-progress: a slow command reports itself to the herdr sidebar with
# a running timer, then leaves its result behind. Globbed because the checkout
# path carries a hash that changes on every reinstall. No-op outside herdr.
for _hsp in "$HOME"/.config/herdr/plugins/github/bayoudhi.shell-progress-*/shell/init.zsh; do
  [ -r "$_hsp" ] && source "$_hsp"
done
unset _hsp

. "$HOME/.atuin/bin/env"

eval "$(atuin init zsh)"

# Apple Music CLI
alias am="zsh $HOME/.local/share/apple-music-cli/src/am.sh"
am-tui() { zsh $HOME/.local/share/apple-music-cli/src/am.sh play -p && zsh $HOME/.local/share/apple-music-cli/src/am.sh np }
alias music-tui="python3 $HOME/.local/share/music_tui/music_tui.py"

# stream une session herdr vers le navigateur (telephone)

remote() {
  local ip=$(ipconfig getifaddr en0 || ipconfig getifaddr en1)
  echo "\n  ->  http://$ip:7681\n"
  env -u HERDR_ENV -u HERDR_TAB_ID -u HERDR_SOCKET_PATH -u HERDR_BIN_PATH \
      -u HERDR_WORKSPACE_ID -u HERDR_PANE_ID \
      ttyd -W -p 7681 herdr session attach default
}

# Insovo production server, key in ~/.ssh/config (Host insovo-vps)
alias insovo-vps="ssh insovo-vps"
export PATH="/opt/homebrew/lib/ruby/gems/4.0.0/bin:$PATH"

# hop account switcher
source /Users/mirkobozzetto/code/hop/shell/hop.sh

# Second Claude login for Gratiago. Not a .hop value: an account without a hop
# profile falls back to the active GitHub account, which may be the personal one.
claude-dev4() {
  [ "${HOP_GH_ACCOUNT:-}" = gratiago ] || { echo "claude-dev4: run it inside ~/code/GRATIAGO" >&2; return 1; }
  ( _hop_claude_dir dev4 && claude "$@" )
}

# Maestro (mobile UI tests). Android Studio's JDK 21: Homebrew's JDK 26 breaks Gradle.
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export PATH="$PATH:$HOME/.maestro/bin"

# Herdr app: a terminal that lost its program (reboot, app quit, core
# restart) comes back as a bare shell. Resume the Claude session it ran,
# recorded by ~/.claude/hooks/hc-claude-session.sh, as if typed here.
if [[ -o interactive && -n $HC_TERMINAL_ID && -n $HC_TERMINAL_SOCKET ]] &&
   [[ $(ps -o comm= -p $PPID) == */herdr-core ]]; then
  _hc_claude_file=${HC_TERMINAL_SOCKET:h}/claude-sessions/$HC_TERMINAL_ID
  [[ -r $_hc_claude_file ]] &&
    { read -r _hc_claude_id; read -r _hc_claude_dir } <$_hc_claude_file
  if [[ -n $_hc_claude_id ]]; then
    [[ -d $_hc_claude_dir ]] && cd -- $_hc_claude_dir
    _hc_claude_resume() {
      add-zle-hook-widget -d line-init _hc_claude_resume
      BUFFER="cc --resume $_hc_claude_id"
      zle accept-line
    }
    autoload -Uz add-zle-hook-widget
    zle -N _hc_claude_resume
    add-zle-hook-widget line-init _hc_claude_resume
  fi
fi

# Herdr app: a send from an agent started by hc arrives wrapped in
# <hc from="…">…</hc>, which zsh can't parse; pane-run's "cmd" shells hung on
# it. Strip the tags before running the line.
if [[ -o interactive && -n $HC_TERMINAL_ID ]]; then
  _hc_unwrap() {
    BUFFER=${BUFFER#\<hc from=*\> }
    BUFFER=${BUFFER%\</hc\>}
    zle .accept-line
  }
  zle -N accept-line _hc_unwrap
fi

# Herdr app: an update brings Herdr's own icon back. A Herdr terminal puts the
# pink ram on again; launchd can't, macOS refuses it the app's bundle.
[[ -n $HC_TERMINAL_ID && -d /Applications/Herdr.app && ! -e /Applications/Herdr.app/Icon$'\r' ]] &&
  ~/dotfiles/herdr-app/icon/apply.sh >/dev/null 2>&1 &!
# Herdr app: every start puts its toast mod back; a Herdr terminal silences it.
[[ -n $HC_TERMINAL_ID ]] && ~/dotfiles/herdr-app/toast/apply.sh >/dev/null 2>&1 &!
