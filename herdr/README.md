# herdr

20 plugins, the keys they answer to, and the two files that reproduce the whole
set on another machine. Prefix is `ctrl+space`.

Plugins are not stored here. `plugins-config/herdr-lazy/plugins.list` declares
which ones belong to this setup and `plugins.lock` pins the commit each one was
installed at; `herdr-lazy sync` makes a machine match them. Everything else in
this directory is config and small scripts, linked file by file from
`links.conf` because the live `~/.config/herdr` also holds sockets and session
state.

## Moving around

| | | |
|---|---|---|
| `herdr-navigator` | one fuzzy list over workspaces, agents, projects, directories and remotes | `prefix+o` · `ctrl+o` · `u` |
| `willfish.herdr-navigator` | crosses herdr panes and Neovim splits on the same key | `alt+h j k l` |
| `herdr-floax` | a floating shell that keeps its contents, one per workspace | `prefix+shift+a` |
| `termscope` | open a file or link already printed on screen | `prefix+ctrl+f` |

`prefix+a` opens a plain popup shell, fresh every time; floax is the one that
remembers.

## Looking at files

| | | |
|---|---|---|
| `herdr-file-viewer` | read-only and git-aware: diff when the file changed, rendered markdown otherwise. `e` hands the file to `$EDITOR` | `prefix+f` · `shift+f` |
| `ray.file-explorer` | yazi in a pane, the only one of the three that moves and renames | `prefix+b` |
| `rmarganti.herdr-pluck` | keyboard hints to copy a visible token or open a URL | `prefix+shift+c` |

## Git and review

| | | |
|---|---|---|
| `gh-pr` | puts the branch's PR status on the agent's sidebar row | `prefix+shift+u` |
| `herdr-lazygit` | lazygit in a pane, with generated commit messages | `prefix+shift+v` |
| `persiyanov.reviewr` | an agent's diff beside its chat; line comments go back into its prompt | `prefix+ctrl+r` |
| `tdi.worktree-setup` | replays setup steps in a fresh worktree | needs a per-project `config.toml` |

## Watching agents

| | | |
|---|---|---|
| `herdr-insight` | seven days of agent state: who worked, when, how long blocked | `prefix+shift+i` |
| `usagebar` | context meters and provider rate-limit windows in the sidebar | on event |
| `bayoudhi.shell-progress` | the sidebar also tracks slow shell commands, not just agents | zsh hook |
| `cobanov.herdr-ntfysh` | ntfy push when an agent finishes or blocks | needs a topic |

## Naming tabs

| | | |
|---|---|---|
| `mirko.tab-autoname` | names a tab after its branch in a worktree, after its directory otherwise | `prefix+y` |
| `tab-smart-rename` | names it after the task instead; without an API key it falls back to fixed labels | `prefix+t` · `alt+t` · `shift+y` |

Both claim the same tab. Smart Rename yields to a manual name until
`prefix+shift+y` resets it.

## Standing up workspaces

| | | |
|---|---|---|
| `cloudmanic.herdr-plus` | one TOML file brings up a whole workspace, tabs and startup commands included | `prefix+m` · `shift+m` |
| `herdr-lazy` | the declared plugin list, and the lockfile that reproduces it | `prefix+shift+p` |
| `artisann.zed-herdr` | keeps the herdr workspace in step with the open Zed session | on event |

## Picking a key

herdr keeps its own defaults for anything `config.toml` does not redefine, so a
free-looking key is not always free. `prefix+shift+r` is `reload_config`,
`prefix+shift+t` is `rename_tab`, `prefix+shift+n` / `shift+w` / `shift+d` are
the workspace verbs, and `prefix+tab` cycles panes. `prefix+b` is only free here
because `toggle_sidebar` moved to `prefix+e`.

```sh
strings $(which herdr) | grep -B40 'toggle_sidebar = '   # the default table
```

## Reproducing this elsewhere

```sh
herdr plugin install natori-hrj/herdr-lazy
herdr-lazy sync            # installs everything the list names, at the locked commits
herdr-lazy doctor          # every entry still resolves?
```

There is no `plugin update` in herdr: refreshing a plugin means reinstalling it.
`bin/herdr-update.sh` only upgrades the binary through brew.

## The rest of this directory

| | |
|---|---|
| `config.toml` | keymap, theme, sidebar rows, and every plugin binding above |
| `agent-auto-jump.py` | LaunchAgent daemon that focuses an agent when it finishes or blocks |
| `plugins-local/tab-autoname/` | the local plugin, source included |
| `bin/break-pane.sh` | moves the focused pane into a tab of its own, herdr has no keybind for it |
| `bin/herdr-update.sh` | `brew upgrade herdr` on a schedule, with a notice if a server lags behind |
| `clip-image-paste.sh` | stages a clipboard screenshot for the agent, gone from herdr since 0.7.x |
