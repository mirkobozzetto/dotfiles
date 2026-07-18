# Terminal setup

Ghostty + tmux + Neovim on macOS, with a sidebar that watches parallel Claude
Code agents and pulls you to whichever one needs you.

Everything here is a copy, not a symlink: the repo is a snapshot. After
changing a config on the machine, copy it back into the repo before
committing (see [Keeping the repo in sync](#keeping-the-repo-in-sync)).

---

## Install on a fresh machine

### 1. Homebrew packages

```sh
brew install --cask ghostty
brew install tmux neovim fzf fd ripgrep zoxide bat delta git-delta \
             lazygit lazydocker yazi chafa sesh starship gitmux eza jq
```

What each one is for:

| Tool | Role |
|---|---|
| ghostty | terminal emulator, GPU-rendered, native macOS |
| tmux | session multiplexer; everything runs inside it |
| neovim | editor (LazyVim distribution) |
| fzf, fd, ripgrep | fuzzy finding, file listing, grep - used by pickers |
| zoxide | frecency-ranked `cd` |
| bat | syntax-highlighted `cat`; also supplies delta's syntax set |
| delta | side-by-side syntax-highlighted git diffs |
| lazygit, lazydocker | terminal UIs for git and Docker |
| yazi | file manager |
| chafa | render images in the terminal |
| sesh | tmux session manager over zoxide |
| starship | shell prompt |
| gitmux | git status segment in the tmux status bar |

### 2. Clone and link

```sh
git clone https://github.com/mirkobozzetto/dotfiles ~/dotfiles
cd ~/dotfiles && ./install.sh
```

`install.sh` reads `links.conf` and creates one symlink per entry. Existing
files are backed up to `~/.dotfiles-backup-<timestamp>` first.

### 3. tmux plugins

```sh
git clone https://github.com/tmux-plugins/tpm ~/.config/tmux/plugins/tpm
tmux new -s main
~/.config/tmux/plugins/tpm/bin/install_plugins
```

### 4. Neovim

Launch `nvim` once and let lazy.nvim install everything, then Mason installs
the language servers. Takes a few minutes on first run.

```sh
nvim --headless "+Lazy! sync" +qa
```

### 5. Bicep syntax for bat and delta

`bat` ships no Bicep grammar and the community Sublime syntax extends
JavaScript, which bat's engine cannot follow. A standalone one lives in this
repo:

```sh
mkdir -p ~/.config/bat/syntaxes
cp ~/dotfiles/bat/syntaxes/Bicep.sublime-syntax ~/.config/bat/syntaxes/
bat cache --build
```

delta reads bat's cache, so this colorizes `.bicep` files in `git diff`,
lazygit, and `bat` alike.

### 6. macOS permissions

Ghostty needs Full Disk Access to avoid a permission prompt every time a
process under it touches Documents, Desktop, or Downloads. This cannot be
granted from a script (System Integrity Protection blocks it):

System Settings, Privacy & Security, Full Disk Access, add Ghostty.
Then `tmux kill-server` and relaunch.

---

## How it fits together

Ghostty launches straight into tmux:

```
command = /bin/zsh -lc "exec /opt/homebrew/bin/tmux new-session -A -s main"
```

The `-lc` matters. Without a login shell, the tmux server inherits macOS's
minimal PATH, `/opt/homebrew/bin` is missing, and every plugin fails with
exit 127.

Every `Cmd` shortcut in Ghostty is defined as raw text that sends the tmux
prefix followed by a key:

```
keybind = cmd+p=text:\x00o
```

`\x00` is the NUL byte, which is what `Ctrl+Space` (the prefix) transmits.
So `Cmd+P` reaches tmux as `prefix o`. The consequence is that you never
type the prefix by hand, and tmux keeps working over SSH where Cmd keys do
not exist.

---

## Daily shortcuts

### Ghostty (Cmd keys)

| Key | Action |
|---|---|
| `Cmd+P` | session picker (sesh + projects + home) |
| `Cmd+Shift+P` | native tmux session tree |
| `Cmd+D` | split pane |
| `Cmd+Shift+B` | toggle the agent sidebar |
| `Cmd+Shift+G` | jump to the next agent waiting on you |
| `Cmd+Shift+,` | reload the Ghostty config |

### tmux (after the prefix, `Ctrl+Space`)

| Key | Action |
|---|---|
| `Space` | searchable list of every binding |
| `o` | sesh picker |
| `s` | session tree |
| `\|` `-` | split right / down |
| `h j k l` | move between panes |
| `x` `X` | kill pane / window |
| `H J K L` | resize (repeatable) |
| `Tab` | extrakto: fuzzy-pick any text on screen |
| `g` | jump to the next agent needing you |
| `r` | reload the config |

`Ctrl+h/j/k/l` without the prefix crosses Neovim splits and tmux panes with
the same keys - the binding checks whether the focused pane runs Neovim and
forwards the key if so.

### Neovim

LazyVim defaults apply; these are the additions.

| Key | Action |
|---|---|
| `<leader>a` | pin the current file to Harpoon |
| `<leader>1`..`4` | jump to Harpoon slot |
| `<leader>H` | Harpoon menu |
| `<leader>uu` | undo tree |
| `Shift+H` / `Shift+L` | previous / next buffer |
| `Ctrl+^` | back to the previously edited file |
| `<leader>d` | debugger (nvim-dap) |
| `<leader>t` | tests (neotest) |
| `<leader>xy` | copy diagnostics to the clipboard |
| `<leader>tt` | toggle a terminal split |

---

## Agent monitoring

Four scripts in `tmux/`, all driven by pane options the sidebar plugin
writes on every Claude Code hook event (`@pane_agent`, `@pane_status`,
`@pane_attention`).

| Script | Job |
|---|---|
| `agent-registry-sync.sh` | tags panes running `claude` every 3s, so sessions never vanish from the sidebar |
| `agent-status-segment.sh` | status-bar counters: red for agents waiting, yellow for agents working |
| `agent-jump-next.sh` | manual jump to the next blocked agent, cycling |
| `agent-auto-jump.sh` | switches you automatically once your own pane goes quiet |

The auto-jump waits `IDLE_SECONDS` (4 by default) of no typing in your
current pane before stealing focus, so it never fires mid-keystroke. A
skipped jump retries on the next tick.

Two tmux facts these scripts depend on, both of which cost a debugging
session to find:

- A background process owns no client, so `switch-client` silently does
  nothing unless you name one with `-c`.
- `select-window` takes a window id (`@3`), not a pane id (`%7`).

The Claude Code hooks are registered in `~/.claude/settings.json` with
absolute paths, not `${CLAUDE_PLUGIN_ROOT}`, which does not resolve when the
plugin is not installed through the marketplace.

---

## Neovim details worth knowing

**34 language servers** via Mason, driven by the LazyVim extras in
`lazyvim.json`. Rust, TypeScript, Python, Go, C, C#, SQL, Terraform, YAML,
Docker, Tailwind, and more.

**Bicep** needed three separate fixes, all in `lua/plugins/bicep.lua`: a
filetype mapping, the lspconfig server entry, and prepending
`/usr/local/share/dotnet` to `PATH` from inside Neovim, because the language
server is a .NET binary that cannot find its own runtime otherwise.

**C#** uses `roslyn.nvim` with omnisharp and the built-in `roslyn_ls`
explicitly disabled, since all three would attach to the same buffer.

**Sessions** restore through `persistence.nvim` on a bare `nvim` or `nvim .`,
and tmux-resurrect restores the panes around them.

**Debugging**: `dap.core` plus the adapters Mason installs per language -
`codelldb` (Rust, C), `netcoredbg` (C#), `delve` (Go), `debugpy` (Python),
`js-debug-adapter` (Node).

---

## Keeping the repo in sync

The repo holds copies, so a config edited on the machine is not in git until
you copy it back:

```sh
cp -R ~/.config/nvim/lua      ~/dotfiles/nvim/
cp    ~/.config/tmux/*.sh     ~/dotfiles/tmux/
cp    ~/.config/tmux/tmux.conf ~/dotfiles/tmux/
cp    ~/.config/ghostty/config ~/dotfiles/ghostty/
```

Before committing, check that no secret slipped in:

```sh
git -C ~/dotfiles diff --cached | grep -iE 'api[_-]?key|token|secret|password|BEGIN .*PRIVATE KEY'
```

`.gitignore` already excludes plugin checkouts, lock files, GitNexus
artifacts, and anything under `.claude/` that holds credentials.

---

## Troubleshooting

**tmux plugins fail with exit 127.** The server has the wrong PATH. Check
`tmux show-environment -g PATH`; it must contain `/opt/homebrew/bin`.
`tmux kill-server` and relaunch from Ghostty, which starts a login shell.

**The status bar renders nothing.** In `tmux.conf` the hidden variables are
shell-style `${VAR}`, not tmux-style `#{VAR}`. And never add `-F` to
`set -g status-*`: it freezes `#I` and `#W` and runs `gitmux` exactly once.

**A `choose-tree -F` format silently produces an empty line.** A comma
inside a `#[...]` block splits the surrounding conditional. Escape it as
`#,`.

**lazygit shows a plain diff with no syntax colors.** lazygit ignores git's
`core.pager`. It needs its own entry in
`~/Library/Application Support/lazygit/config.yml` under `git.pagers`
(a list since 0.61; the old singular `git.paging` was removed).

**A script fails with `mapfile: command not found` or
`declare -A: invalid option`.** macOS ships bash 3.2. No associative
arrays, no `mapfile`. Use a space-delimited string and an append loop.

**Claude Code asks to trust every folder again after an update.** The trust
state is keyed per version. `~/.claude/hooks/trust-all-projects.cjs` flips
every project to trusted; it still has to be registered in
`settings.json` to run automatically.
