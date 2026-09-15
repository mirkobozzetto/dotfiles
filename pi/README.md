# pi

Config for the [pi coding agent](https://pi.dev), linked from this repo the
same way `omp/` is. Only hand-picked files live here — `~/.pi/agent` also
holds `auth.json` with the OAuth tokens, the model catalog cache and every
session transcript, none of which belong in git.

| File | Linked to | What it carries |
|---|---|---|
| `settings.json` | `~/.pi/agent/settings.json` | default model, thinking level, enabled models, packages |
| `AGENTS.md` | `~/.pi/agent/AGENTS.md` | global rules loaded into every pi session |
| `mcp.json` | `~/.pi/agent/mcp.json` | MCP servers |
| `extensions/pane-run.ts` | `~/.pi/agent/extensions/pane-run.ts` | routes the bash tool to a visible terminal pane |

`install.sh` recreates these links from `links.conf` on a new machine.

## Visible commands

`extensions/pane-run.ts` intercepts the `bash` tool and rewrites the command to
run through `claude/bin/pane-run`, the same runner Claude Code and omp use. A
command therefore lands in a visible Herdr tab instead of the agent's hidden
shell, and stays in the terminal history.

The runner handles both multiplexers — Herdr when `HERDR_ENV=1`, tmux when
`TMUX` is set — and falls back to local execution with a printed notice when
neither is live. It reuses a free command tab in the same workspace, creates a
new one without stealing focus when they are all busy, and never splits a pane.

`AGENTS.md` states the matching rule so the agent does not route around it with
a background job.

## Models

`enabledModels` is the Ctrl+P cycle list. Anthropic entries are pinned to
current models only, so legacy ones stay out of the picker:

```
openai-codex/*
anthropic/claude-haiku-4-5
anthropic/claude-sonnet-5
anthropic/claude-opus-5
anthropic/claude-fable-5-1
```

## Secrets

`mcp.json` is safe to track: the Exa key is read from the macOS Keychain at
request time via `!security find-generic-password`, never stored in the file.
`hooks/pre-commit` is the net under that rule.

## Packages

Installed with `pi install`; the list lives in `settings.json` under
`packages`. Two are local checkouts rather than npm:

- `../../code/skills/arsenal` — workflow router
- `../../stuffs/espresso` — concise policy, Ponytail, model ladder

Both are shared with omp, which loads the same checkouts through its own
adapter. Editing either repo changes both harnesses at once.

## Known local patch

`pi-background-tasks` 2.5.0 hard-fails an Anthropic session after a reload or
resume with `Anthropic cache lineage diverged before transport`. The upstream
fix ([PR #17](https://github.com/ismailsaleekh/pi-background-tasks/pull/17))
is applied by hand inside `node_modules`, with the original saved next to it:

```
~/.pi/agent/npm/node_modules/pi-background-tasks/src/core/anthropic-attribution.ts
~/.pi/agent/backups/pi-background-tasks-2.5.0-lineage/
```

`pi update --extensions` overwrites it. Reapply from the PR until it is merged.
