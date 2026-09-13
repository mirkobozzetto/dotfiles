# Prime Agent configuration

Portable snapshot of my Prime Agent setup, tested with Prime Agent 0.9.4
and GitNexus 1.6.11 on macOS. This is configuration, not a fork of Prime.

## Included

- Six Astra/Sol model + effort profiles through `openai-codex`.
- Normal/Plan modes independent of model, effort, and available tools.
- Arsenal routing and Espresso concise-policy overlays, enabled by default.
- Native GitNexus stdio MCP integration with a restricted tool list.
- Shared operating instructions, interactive questionnaires, and a one-tier-down delegation policy.
- Prime-specific Arsenal skills and resources, plus GitNexus context guidance.
- An optional, version-specific daemon keyboard workaround.

No credentials, conversations, session state, memories, caches, local indexes,
Python environments, or backup files are included. This is a reviewed snapshot:
changes made by Prime to your local settings do not automatically sync here.

## Install safely

Install Prime Agent using its official instructions and authenticate locally.
Install GitNexus separately if you want code-graph integration. Both
`prime-agent` and `gitnexus` must be on the PATH inherited by Prime's service.
The model identifiers are specific to my account/catalog: adjust them in
`settings.json` and `extensions/model-presets.ts` if unavailable to you.

From this repository root, copy only missing files:

```sh
mkdir -p ~/.prime/agent/extensions ~/.prime/agent/skills
cp -n prime/settings.json ~/.prime/agent/settings.json
cp -n prime/AGENTS.md ~/.prime/agent/AGENTS.md
cp -Rn prime/extensions/. ~/.prime/agent/extensions/
cp -Rn prime/skills/. ~/.prime/agent/skills/
```

On macOS, `-n` leaves existing files untouched. These commands do not merge or
update an existing installation. Back up and manually merge your settings and
instructions if they already exist; preserve your providers, MCP connections,
extensions, and private data. Do not symlink or copy the whole `~/.prime/agent`
directory. The root dotfiles installer deliberately does not install this
snapshot or overwrite your running Prime configuration.

Authenticate with Prime locally; never put tokens in this repository. The public
GitNexus command is `gitnexus`, not a machine-specific absolute path. Disable or
remove its MCP entry if you do not install it.

### Optional personal skills

Prime also discovers `~/.agents/skills`. Those personal skills are not bundled
here. This snapshot disables the bundled `websearch` and `skill-creator` to
avoid collisions with my personal versions. Without those versions, remove
`bundledSkills.websearch: false` and the `-skill-creator/SKILL.md` exclusion to
restore Prime's bundled skills (and configure any required authentication).
Arsenal reports missing capabilities rather than silently installing them.

Run `/reload` for extension/skill changes. Newly configured MCP servers were
verified in a fresh Prime session; a running kernel may retain its old settings
snapshot, and `mcp.reload()` alone may not discover a newly added server.

## Profiles and shortcuts

| Command | Model | Effort |
| --- | --- | --- |
| `/astra-low` | `gpt-6-astra` | low |
| `/astra-med` | `gpt-6-astra` | medium |
| `/astra-high` | `gpt-6-astra` | high |
| `/sol-low` | `gpt-5.6-sol` | low |
| `/sol-med` | `gpt-5.6-sol` | medium |
| `/sol-high` | `gpt-5.6-sol` | high |

`/profile-next` and `/profile-previous` cycle in table order.
The settings snapshot starts at Sol High. Selecting a profile changes model and
effort; changing work mode never does.

| macOS key | Action |
| --- | --- |
| Option-P | Next profile |
| Option-Shift-P | Previous profile |
| Option-1 / Option-2 / Option-3 | Low / Medium / High on the current model |
| Control-Option-P | Toggle Normal / Plan |

`Alt` in extension code means Option on macOS. Ghostty users can set
`macos-option-as-alt = left`; right Option then remains available for composing
characters. Other terminals and keyboard layouts may encode keys differently.
No terminal configuration is changed by this snapshot.

### Daemon shortcut limitation

Prime 0.9.4 registers extension shortcuts in local sessions but does not forward
those registrations to its daemon-attached interface. Slash commands work
without the workaround. `patches/prime-0.9.4-daemon-shortcuts.patch` preserves the
small local fix used here, including authoritative model/effort UI refresh.
It touches both the source-style output and the actual bundled CLI artifact.

`patches/prime-0.9.4-edit-diffs-expanded.patch` makes edit diffs expanded by
default while keeping `Ctrl+J` available to collapse them. It is also
version-specific and touches the source-style output plus the bundled CLI
artifact.

This is **not a general installer or an upstream fix**. The bundle filename is
version-specific. Inspect the patch, verify your version, and back up the two
files named in it before applying anything. From the installed Prime package
root, check applicability first:

```sh
git apply --check /path/to/dotfiles/prime/patches/prime-0.9.4-daemon-shortcuts.patch
# Only if the check succeeds and backups exist:
git apply /path/to/dotfiles/prime/patches/prime-0.9.4-daemon-shortcuts.patch
```

Do not force a failed patch onto another release. An update/reinstall can
replace the patched files. Roll back by restoring your backups. `/reload`
does not reload JavaScript already loaded by the terminal interface: detach
and reattach with `prime-agent attach <session-id>` after patching. Do not stop
the daemon or delete a session. Without the patch, use the slash commands.

## History position indicator

Optional `patches/prime-0.9.4-history-indicator.patch` adds a circular position
icon and percentage to the fullscreen transcript follow hint. It updates on
scroll, shrinks on narrow terminals, and disappears when following live output.
The percentage measures rendered scroll distance, not messages or token usage.

Back up the two target files, then apply from the Prime Agent 0.9.4 package root
with `patch -p1 < /path/to/prime-0.9.4-history-indicator.patch`. Detach and reattach
the terminal interface; `/reload` does not reload this JavaScript. Updates can
overwrite the patch. Restore the backed-up files to roll back.

Verification: the installed fullscreen renderer passed top/middle/follow and
narrow-width checks; the CLI bundle passed syntax checking. Visual confirmation
in a reattached terminal remains a separate manual check.

## Visible Herdr commands

Inside Herdr, Prime's routing instructions send ordinary shell commands through
`bin/herdr-run` using native nonblocking `bash()` handles. The helper reuses a
reserved idle `Prime commands` tab or creates one without changing focus. It
preserves the requested cwd and returns combined output plus the real exit code.
Outside Herdr, commands run locally. OMP and Claude helpers are unchanged.

Private command scripts, output, exit codes and pane IDs remain under
`~/.prime/agent/commands/`; the tab also keeps its visible transcript. No automatic
history deletion is configured. Do not publish these logs: command output may
contain sensitive data. The destination pane supplies the environment; REPL-only
environment overrides do not propagate automatically.

This is instruction-based routing, not a native interception hook. Herdr
control diagnostics may use direct shell calls; Python reads and edits remain
in Prime's transcript. Stopping the relay does not prove the pane command has
stopped: inspect the reported pane before retrying or interrupting owned work.

## Project skill precedence

Optional `patches/prime-0.9.4-skill-shadowing.patch` treats an automatically
loaded project skill overriding an automatically loaded user skill as normal
precedence, not a conflict warning. Selection order is unchanged. Same-scope
collisions, explicitly configured collisions, and validation errors still show.
No project or shared skill is deleted. This applies globally, not just FlowFlow.

Back up the target files and apply from the installed Prime 0.9.4 package root
with `patch -p1 < /path/to/prime-0.9.4-skill-shadowing.patch`. Package updates
can overwrite it. A fresh Prime worker loads the patched loader; `/reload`
alone cannot replace already imported JavaScript in an existing worker.

Prime uses its three mode/profile extensions and the visible-command routing
skill. It does not import OMP or Claude hook configurations automatically.
Herdr shell routing remains instruction-driven, not native bash interception.

## Work modes

- `/plan`: analyze, read, research, and propose without modifying user files
  or external systems.
- `/normal`: remove the additional planning instruction.
- `/mode`: show state; `/mode toggle`: toggle it.

State persists per session. Plan is a **behavioral instruction, not a sandbox**:
all tools remain available, and compliance still depends on the model.

## Arsenal and Espresso

```text
/arsenal-mode on|off|status
/espresso on|off|status
```

Both default to ON when no saved session preference exists. Explicit OFF
persists for that session. Arsenal selects the shortest relevant installed
workflow; Espresso encourages clear, concise, efficient work. Neither changes
models, effort, or tools. Normal/Plan and permission boundaries take precedence.

Arsenal stays solo by default. Approved delegation uses the native RLM adapter
and the product-scout, harness-analyst, adversarial-reviewer contracts. Espresso
may propose up to two independent research workers, but ON never grants consent.
No external workers, RTK, Ponytail, automatic reviewers or nested delegation.
Higher-priority solo instructions still forbid spawning.

Included routes: `arsenal`, `brief`, `propose`, `issue`, `next`, `trace`, `ship`,
and `espresso`. The personal `websearch` is reused when present. Ship handles
implementation, bounded verification, resume and explicitly requested commits.
No OMP controller or persistent OMP agent definitions are installed.

`skills/arsenal/scripts/delegation.py` validates model selection, request fields,
and role JSON shapes. It does not spawn: use native `rlm(...)` directly. Consent
and concurrency are caller inputs, not runtime enforcement. Read-only contracts
are not tool isolation. Follow `skills/arsenal/references/adapters/delegation.md`.

Verification: local checks exercised the four model mappings and JSON contracts;
native Prime loaded the skills and extensions without diagnostics. Five bounded
read-only live tests then exercised the three Arsenal roles and two Espresso
researchers. Child session records confirmed openai-codex Sol Low from an Astra
Low parent, with no explicit thinking override. All five JSON responses passed
the installed validator. Observed tool calls were limited to reads and parent
messages; the parent stayed Astra Low and OMP was not accessed. This proves
these scenarios, not every model/effort pair or hard permission enforcement.
New sessions load the installed instructions; resumed sessions can retain older
context and may need a reload before using updated behavior.

The skills are adapted from my Arsenal plugin sources (`plugins/arsenal`, `brief`, `propose`,
`issue`, `next`, and `trace`).
Vendored renderer license notices remain in `skills/arsenal/assets/vendor/`.

## Delegation policy

Where the active workflow permits delegation, the instructions prefer:

```text
Astra -> Sol -> Terra -> Luna -> Luna
```

Resolve an exact `openai-codex` model with `rlm.find_models`, then pass it to
`rlm(...)` without `thinking` to inherit the parent's current effort. Prime
clamps unsupported efforts. This is an instruction, not a hard routing lock.
No silent provider substitution; difficult tasks can justify an explained
exception. Simple work stays on the parent. Astra Low -> Sol Low was verified
against actual session records; this is not a claim that every combination
has been live-tested.

## GitNexus

Prime uses GitNexus proactively for substantive code exploration, debugging,
call-flow and impact analysis. No user reminder is needed. Existing relevant
indexes are refreshed on demand with `gitnexus analyze --index-only`, without
routine approval or generated instruction changes. There is no watcher,
recurring service, automatic wiki generation, or upload. First-time indexing
still needs approval; Plan remains read-only.

The agent verifies freshness, checks refresh results, retrieves graph context,
and corroborates it against current source and tests. Partial results are
reported, not treated as proof of safety. This is an instruction-driven workflow,
not an enforced tool hook or a guarantee that every task invokes GitNexus.

Verification: `dotfiles` was rebuilt in index-only mode. Native MCP search
returned the Prime delegation symbols and context resolved `select_model` at
the correct source location. The previous partial FTS error disappeared. The
analyzer still reports unsupported cross-language field links; source checks
remain necessary for those cases.

## Exa

The native HTTP MCP connection references `EXA_API_KEY`; no secret is included.
Export that variable before starting Prime. Six tools are exposed: web search,
advanced search, page fetching, legacy crawling, code context, and deep search.
Search and page fetching were verified through Prime's native MCP connection;
advanced search, crawling, and code context passed SDK MCP calls. Deep search
was discovered but not executed. Reload Prime after adding the connection.

The shared personal websearch skill discovers tools and prefers `web_fetch_exa`,
with `crawling_exa` as a compatibility fallback. That personal skill is not
vendored in this snapshot.

## Layout

```text
prime/
  settings.json
  AGENTS.md
  extensions/          # profiles, work modes, orchestration toggles
  skills/              # Prime-only portable resources
  patches/             # optional 0.9.4 daemon shortcut fix
```
