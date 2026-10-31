# Herdr app

Config for the Herdr desktop app (0.1.10) and its terminal server, herdr-core
(`hc`). The app reads `~/.config/herdr-app` and does not follow symlinks, so
this folder holds copies.

```sh
bash herdr-app/sync.sh          # copy the app's personal files here, then commit
bash herdr-app/sync.sh restore  # copy them back into the app on a new machine
```

Only what Herdr did not ship is copied: `settings.json`, `keys.json`, the
`mirko` layout, the Catppuccin themes and the mods below.

## Look

- `settings.json`: font, zoom, Catppuccin theme, sound alerts off.
- `layouts/mirko.json`: the only layout kept; pane headers show on hover.
  `ctrl+shift+l` switches back to it.

## Icon

`icon/herdr-pink.png` is Herdr's ram recolored, dark on Catppuccin pink.
`icon/apply.sh` puts it on `/Applications/Herdr.app` as a Finder custom icon,
the same as Get Info > paste, so the app's signed bundle stays untouched.
A Herdr update brings the original icon back; the next Herdr terminal puts the
pink one on again (a line at the end of `zsh/.zshrc`).
It also clears the Dock's own icon cache, which a Dock restart keeps. launchd can't do it:
macOS refuses it the app's bundle.

## Keys

### Ctrl+Space menu (`mods/tmux-prefix`)

Press `ctrl+space`, then one key. Every key shows at once, in two columns.

| Group | Keys |
|---|---|
| Tabs | `c` new, `X` close, `n`/`p` next/previous, `t` rename, `<`/`>` move |
| Panes | `\|` split right, `-` split down, `x` close, `z` zoom |
| Spaces | `)`/`(` and `J`/`K` next/previous, `T` rename |
| Panels | `f` Files, `d` Changes, `G` Graph, `b` GitHub, `e` sidebar |
| Agents | `enter` the next agent that needs you, `g` next agent, `y` its last answer, `r` walk through the diff, `i` Linear issues |
| App | `s`/`w` go to anything, `o` launcher, `:` palette, `?` all shortcuts, `m` sound alerts on/off, `S` settings, `q` minimize |

`0-9` select a tab, `h j k l` or the arrows move between panes. Repeatable keys
stay live for 500 ms. `ctrl+space` twice sends it to the program.

`enter` goes to agents waiting for an answer first, then to finished ones;
pressing it again walks through all of them.

### All shortcuts (`mods/keys-help`)

`cmd+/` (or `ctrl+space ?`) lists every shortcut with a search field:
Herdr's `keys.json`, the Ctrl+Space menu (read from
`mods/tmux-prefix/bindings.js`) and the agents' own keys
(`mods/keys-help/agents.js`).

### Option keys for the agents

On a Belgian layout Herdr keeps Option for typing (`option+p` types `π`), so
`keys.json` sends these chords as Alt instead:

| Keys | Used by |
|---|---|
| `option+p`, `option+t` | Claude Code: pick a model, thinking on/off |
| `option+m` | omp: pick a model |
| `option+shift+p`, `option+1..3` | Prime Agent shortcuts patch |

They no longer type `π`, `†`, `µ` and the characters of `option+1..3`.

### Other global keys

| Keys | Action |
|---|---|
| `cmd+1..9` / `ctrl+1..9` | nth space / nth agent, as listed |
| `cmd+p`, `ctrl+shift+k` | launcher |
| `cmd+o` | space picker |
| `cmd+shift+t` | reopen the last closed tab |
| `cmd+shift+e` / `cmd+shift+c` / `cmd+g` / `cmd+shift+u` | Files / Changes / Graph / GitHub panel |
| `cmd+shift+k` | walkthrough of the diff |
| `cmd+shift+f`, `cmd+alt+f`, `cmd+shift+y` | Fleece: last answer, dock, copy |
| `ctrl+shift+y` | Linear issues |

## Mods

| Mod | What it does |
|---|---|
| `tmux-prefix` | the Ctrl+Space menu |
| `keys-help` | the all-shortcuts window |
| `my-tabs` | tab bar with the panel buttons; names tabs after what runs in them, keeps a name you gave |
| `agents-jump`, `spaces-jump` | Herdr's agents and spaces lists with numbered jumps |
| `claude-usage` | Claude usage gauges per account in the bottom bar |
| `github`, `git-graph` | GitHub and commit graph panels |
| `launcher`, `space-picker`, `path-menu` | open a program, a folder as a space, context menus |
| `reopen-tab` | reopen closed tabs |
| `ntfy` | iPhone ping when an agent needs you |
| `walkthrough` | a diff explained step by step |
| `fleece`, `fleece-dock` | the focused agent's last answer |
| `linear`, `linear-agent`, `issue-agent` | issues, and an agent started on one in a worktree |
| `herdr-migration` | moves tabs over from the terminal herdr |

Linear reads its key from the macOS keychain (`hop:gratiago:LINEAR_API_KEY`).

## Outside this folder

- `~/.claude/bin/herdr-app-tab <label> <cwd> <prompt.md>`: opens a Claude
  session in a background tab. The app's `tab.new` moves the view to the new
  tab; a terminal started by herdr-core with the `herdr.space` and
  `herdr.tab` labels lands without moving it.
- `~/.claude/bin/pane-run`: agent commands run in a "cmd" tab per space, two
  panes at most, started the same quiet way.
- Claude sessions come back after a reboot or an app quit:
  `~/.claude/hooks/hc-claude-session.sh` records the session of each terminal,
  and the end of `zsh/.zshrc` (linked to `~/.zshrc`) resumes it in the shell Herdr gives back. Test:
  `~/.claude/hooks/tests/hc-claude-resume.test.sh`.

## Known limits

- The corner note when an agent finishes can't be turned off: Settings >
  Alerts says it shows either way, and an edit of the shipped `toast` mod is
  restored at the next start.
- The terminals don't draw font ligatures (checked with FiraCode).
- A space can list a tab twice, once unnamed; `my-tabs` keeps the named entry
  so a renamed tab keeps its name.
