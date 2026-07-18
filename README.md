# dotfiles

macOS terminal setup: Ghostty, tmux, Neovim, and a sidebar that watches
parallel Claude Code agents and pulls you to whichever one needs you.

![shell](https://img.shields.io/badge/shell-zsh-89b4fa)
![editor](https://img.shields.io/badge/editor-LazyVim-a6e3a1)
![theme](https://img.shields.io/badge/theme-Catppuccin%20Mocha-f5c2e7)

## What's in here

| | |
|---|---|
| **Ghostty** | launches straight into tmux; every `Cmd` shortcut is forwarded as a tmux prefix sequence, so the same keys work over SSH |
| **tmux** | session persistence across reboots, sesh picker, extrakto, hand-written Catppuccin status bar |
| **Neovim** | LazyVim, 34 language servers, debugger, tests, harpoon, format on save |
| **Agent sidebar** | live state of every Claude Code session, with automatic redirection when one finishes or needs you |
| | plus yazi, lazygit + delta, gitmux, starship, zed |

## Install

```sh
git clone https://github.com/mirkobozzetto/dotfiles ~/dotfiles
~/dotfiles/install.sh
```

`install.sh` reads `links.conf` and symlinks each config into place. Existing
files are backed up first, never deleted.

Dependencies, shortcuts and troubleshooting: **[SETUP.md](SETUP.md)**.

## A few things that took a while to get right

**Ghostty must start a login shell.** Otherwise the tmux server inherits
macOS's minimal PATH, `/opt/homebrew/bin` is missing, and every plugin dies
with exit 127.

**`Cmd` keys are sent as text, not bound to actions:**

```
keybind = cmd+p=text:\x00o
```

`\x00` is what `Ctrl+Space` transmits, so `Cmd+P` reaches tmux as `prefix o`.
You never type the prefix, and nothing breaks over SSH.

**A background process owns no tmux client**, so `switch-client` silently
does nothing unless you name one with `-c`.

**`running -> idle` is an edge, not a state.** The auto-jump waits until you
stop typing, so it must not record the new status before the jump actually
happens - otherwise the next tick compares idle to idle and forgets a
redirection was owed.

## Layout

```
ghostty/  tmux/  nvim/  yazi/  lazygit/  bat/  starship/  gitmux/  zed/  warp/
links.conf     install.sh     SETUP.md
```

`links.conf` is the single source of truth for what gets symlinked where.
To add an app: move its config here, add a line, run `./install.sh`.

## License

MIT. Take what you like.
