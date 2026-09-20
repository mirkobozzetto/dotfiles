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

## pi-background-tasks and the Anthropic subscription

`pi-background-tasks` ships two extensions. `background-tasks.ts` is the
visible one (`bg_run`, `bg_delegate`, fusion). `anthropic-attribution.ts`
is the one to know about: it re-registers the `anthropic` provider and
builds every request to Anthropic itself, disguised as a Claude Code
request (billing system text, `sk-ant-oat` OAuth token, Claude Code
headers) so the subscription pays instead of an API key. From the moment
the package is installed, every turn on an `anthropic/*` model in pi goes
through that file, not through pi's own Anthropic code. `openai-codex/*`
is untouched.

Consequence: any pi release that changes the provider contract breaks
Claude in pi until this package follows. Its `peerDependencies` say which
pi versions it was written for; anything newer is unverified.

Symptoms seen so far, all on Claude models only:

| pi | Symptom | Cause | Fix |
|---|---|---|---|
| 0.85 | session bricked with `Anthropic cache lineage diverged` after reload/resume | lineage guard | [PR #17](https://github.com/ismailsaleekh/pi-background-tasks/pull/17) |
| 0.86 | 100% CPU freeze right after a prompt, then empty answers to every prompt | `TranscriptContext`: prompt and tools moved into `system` messages | [issue #27](https://github.com/ismailsaleekh/pi-background-tasks/issues/27), [PR #28](https://github.com/ismailsaleekh/pi-background-tasks/pull/28) |

If a Claude session in pi freezes or answers nothing while GPT works,
suspect this file first: `kill -USR1 <pid>` and attach the inspector; a
frame in `convertMessages` or `buildAnthropicRequest` confirms it.

### Local patches

Both fixes are applied by hand inside `node_modules`, in this order, on
top of the published 2.5.0 file:

```
~/.pi/agent/npm/node_modules/pi-background-tasks/src/core/anthropic-attribution.ts
```

1. PR #17 (lineage): original saved in
   `~/.pi/agent/backups/pi-background-tasks-2.5.0-lineage/`.
2. PR #28 (pi 0.86): `patches/pi-background-tasks-pr28-pi086-transcript-context.patch`,
   `patch -p1` from the package root. Pre-patch file saved as
   `~/.pi/agent/backups/anthropic-attribution.ts.before-system-role-fix`.

`pi update` or a reinstall of the package overwrites both. Until the PRs
are merged and released, reapply them, then prove the result with
`pi --model anthropic/claude-haiku-4-5 -p "name two tools you have"`:
a working install names tools, a broken one freezes or answers nothing.
Running pi sessions keep the old code in memory: restart them.

The durable exit is to drop `npm:pi-background-tasks` from `packages`
if `bg_run`/`bg_delegate`/fusion are not needed; pi then uses its own
Anthropic transport and nothing here applies.
