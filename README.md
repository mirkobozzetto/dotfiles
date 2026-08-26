```
      _       _    __ _ _
   __| | ___ | |_ / _(_) | ___  ___
  / _` |/ _ \| __| |_| | |/ _ \/ __|
 | (_| | (_) | |_|  _| | |  __/\__ \
  \__,_|\___/ \__|_| |_|_|\___||___/
```

**A terminal that comes to you.**

Ghostty on top of two multiplexers you can swap with one hotkey, a Neovim you
can live in, and an agent layer that watches every coding agent running on the
machine: the moment one finishes its turn or stops to ask you something, you
are already in front of it.

Everything here is a symlink from this repo. No framework, no bootstrap magic,
one manifest that says what goes where. Every trap that cost an evening is
written down at the bottom.

![shell](https://img.shields.io/badge/shell-zsh-89b4fa)
![editor](https://img.shields.io/badge/editor-LazyVim-a6e3a1)
![theme](https://img.shields.io/badge/theme-Catppuccin%20Mocha-f5c2e7)

## What's in here

| | |
|---|---|
| **Ghostty** | launches straight into a multiplexer; every `Cmd` shortcut is forwarded as a tmux prefix sequence, so the same keys work over SSH |
| **tmux** | session persistence across reboots, sesh picker, extrakto, hand-written Catppuccin status bar |
| **herdr** | the other multiplexer: workspaces, an agent sidebar, and a socket API to drive panes from a script |
| **mux** | one switch between the two, from Ghostty or from Raycast, in the window you are already in |
| **Neovim** | LazyVim, 34 language servers, debugger, tests, harpoon, format on save |
| **Agent redirection** | live state of every coding agent, and automatic focus when one finishes or needs you - on both multiplexers |
| **pane-run** | agent commands run in a pane you can see, not in the agent's hidden shell |
| **omp** | [omp](https://omp.sh), the harness I am on right now: its config lives here, plus a local page that configures the `Ctrl+P` model cycle - see [omp/README.md](omp/README.md) |
| | plus yazi, lazygit + delta, gitmux, starship, zed |

## Install

```sh
git clone https://github.com/mirkobozzetto/dotfiles ~/dotfiles
~/dotfiles/install.sh
```

`install.sh` reads `links.conf` and symlinks each config into place. A target
that already exists without being a link is left alone and reported as
`skip`: your machine's own config may hold things this repo does not carry,
such as tmux plugins, yazi bookmarks or ghostty themes. Move it aside
yourself to adopt it.

Dependencies, shortcuts and troubleshooting: **[SETUP.md](SETUP.md)**.

## Two multiplexers, one switch

Ghostty runs `~/.config/mux`, which starts tmux or herdr depending on
`~/.config/mux.state`. `mux switch` flips the choice and ends the running
client; the loop inside `mux` then starts the other one in the same window.
Neither server is stopped, so tmux keeps its sessions and herdr keeps its
workspaces.

`mux/switch-mux.sh` is the Raycast Script Command for it. Add `~/dotfiles/mux`
in Raycast under Settings > Extensions > Script Commands > Add Directory, then
give the command a hotkey. Called with no argument, `mux` starts a
multiplexer; any other word only reports the current one.

The switch is global: the hotkey fires from outside any terminal, so there is
no focused window to single out and every window flips at once.

## Agent redirection

Both multiplexers watch your coding agents and bring you to the one that wants
you: a turn that just ended, or a prompt waiting for an answer.

On tmux, `tmux/agent-auto-jump.sh` reads pane options written by the agents'
hooks. On herdr, `herdr/agent-auto-jump.py` polls `herdr agent list` and calls
`herdr agent focus`. herdr already knows each agent's state through its own
integrations, so nothing else has to be instrumented:

```sh
herdr integration status          # pi, omp, claude, codex, opencode, hermes...
herdr integration install claude
```

The herdr daemon runs from a LaunchAgent, so it comes back after a reboot and
after a crash:

```sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.herdr.agent-auto-jump.plist
tail -f ~/.config/herdr/agent-auto-jump.log
```

Three details decide whether this is pleasant or infuriating:

**`working -> idle` is an edge, not a state.** When a jump is held back, the
new status must not be recorded, or the next tick compares idle to idle and
forgets that a redirection was owed.

**herdr reports both `idle` and `done` for a finished turn** - `idle` when it
detects it on screen, `done` when an integration pushes it. Matching only one
misses half the cases.

**herdr exposes no "last time you typed" signal**, unlike tmux's
`client_activity`. The only guard is the status of the pane you are on:
`HOLD_WHEN_FOCUSED_IS` at the top of the script, `{"blocked"}` by default.
Add `"working"` to never be pulled away from a running agent.

## Commands in a visible pane

Coding agents run their shell commands out of sight. `claude/bin/pane-run`
sends them to a real pane instead, waits for the exit code, and relays the
output back. It handles tmux and herdr, and says so when it falls back to
local execution.

It is wired from `claude/hooks/pane-route.cjs` for Claude Code and from
`omp/extensions/pane-run.ts` for OMP. Known limit, shared by both
multiplexers: a command that calls `exit` itself kills the piped subshell
before the return code is written, so the wait is capped and falls back.

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

## Vibe Island

[Vibe Island](https://vibeisland.app) puts every AI coding session in the
macOS notch: live status, questions, and one-click jump to the session.
Optional here, but `tmux/vibe-island-jump-bridge.sh` exists for it.

Clicking a card is supposed to land you on the right tmux pane. In 1.0.42 it
brings the terminal forward and stops there - the binary contains `list-panes`
but no `switch-client`, `select-window` or `select-pane`, so it can find the
pane and not reach it. With every session inside one window, you land wherever
you already were.

It does log the pane it meant to reach on each click, so the bridge tails that
log and runs the three missing commands. Clicking works as advertised.

This reads another app's log format, so treat it as a splint, not a fix: if
they change the format, jumps quietly stop and you are back to today's
behaviour. `/tmp/vibe-island-jump-bridge.log` shows whether it still fires.
Delete the script and its two lines in `tmux.conf` to remove it.

## Layout

```
ghostty/  tmux/  herdr/  mux/  nvim/  yazi/  lazygit/  bat/  starship/  gitmux/
zed/  warp/  claude/  omp/
links.conf     install.sh     SETUP.md
```

`links.conf` is the single source of truth for what gets symlinked where.
To add an app: move its config here, add a line, run `./install.sh`.

`herdr/` is linked file by file, never as a directory: the real one also holds
sockets, logs and live session state. `omp/` follows the same rule for the same
reason - its agent directory holds `agent.db` with the credentials, the model
cache and every transcript - so only `config.yml`, `mcp.json` and two extensions
are linked. `claude/` carries the pane-run wiring; the herdr agent-state hooks in
those directories belong to `herdr integration install` and are left to it.

No secret is committed: config files reference their keys as `${VAR}`, the values
stay in `~/.zshalias`, and `hooks/pre-commit` refuses a commit that stages a
database, a session directory, a private key or a token-shaped line.

## License

MIT. Take what you like.
