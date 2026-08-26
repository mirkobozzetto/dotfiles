# omp

Config for [omp](https://omp.sh), the terminal coding agent. Only hand-picked
files are linked: the agent directory also holds `agent.db` with the OAuth and
API credentials, the model cache, the memories and every session transcript.
None of that belongs in a repository.

## What is linked

| Repo file | Target |
| --- | --- |
| `config.yml` | `~/.omp/agent/config.yml` |
| `mcp.json` | `~/.omp/agent/mcp.json` |
| `extensions/models.ts` | `~/.omp/agent/extensions/models.ts` |
| `extensions/pane-run.ts` | `~/.omp/agent/extensions/pane-run.ts` |

## Install

```sh
./install.sh
```

The script reads `links.conf` and links each entry. A target that already exists
without being a symlink is left alone and reported as `skip`: move it aside
first, then re-run, so adopting a machine's own config is always deliberate.

The same run points `core.hooksPath` at `hooks/`, which enables the pre-commit
secret scanner.

## Secrets

No secret is stored here. `mcp.json` reads its key through a placeholder, which
omp expands at discovery time from the environment:

```json
"url": "https://mcp.exa.ai/mcp?exaApiKey=${EXA_API_KEY}&tools=..."
```

The real value lives in `~/.zshalias`, outside the repo, alongside the other
keys:

```sh
export EXA_API_KEY=...
```

A fresh machine therefore needs that export before the Exa MCP server works.
omp also accepts `${VAR:-default}`, and a `!command` form when a key must be
fetched from a password manager.

`hooks/pre-commit` is the net under this rule. It refuses a commit that stages a
database, a session directory, a private key, or a line shaped like a token,
while ignoring `${VAR}` placeholders. Bypass with `--no-verify` only when you
are certain.

## Extensions

`extensions/models.ts` serves a local page that configures which models `Ctrl+P`
cycles through, the thinking effort of each, and the roles omp drives itself
(`plan`, `commit`, `advisor`, `agents`, `tiny`, `slow`). It opens on its own when
an interactive session starts, and `/models` reopens it.

Edits save as you type: each change rewrites only the `modelRoles` and
`cycleOrder` blocks of `config.yml`, after copying the file once per session to
`config.yml.bak`. Comments and every other setting survive byte for byte.

omp reads its settings once, at startup, and exposes no reload hook, so a change
applies to the next session, not the running one.

`extensions/pane-run.ts` routes the agent's shell commands to a visible pane.

## Notes

- Settings reference: `omp read omp://settings.md`.
- The extension API used by `models.ts`: `omp read omp://extensions.md`.
- Model roles resolve through `modelRoles`; a `@role` alias that has no entry
  there is a silent no-op that falls back to the parent's model.
