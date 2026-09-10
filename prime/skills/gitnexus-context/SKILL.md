---
name: gitnexus-context
description: "Use GitNexus for codebase exploration, debugging, call-flow tracing, and change-impact analysis when the current repository has an existing index. Skip it for small tasks where direct source reads are enough."
---

# GitNexus context for Prime Agent

Use GitNexus by default for substantive code work, without waiting for the user
to mention it. Retrieve relevant graph context before reasoning about affected
code. It supplements current source and tests; it does not guarantee quality.
This is agent-driven, on-demand operation, not a watcher or recurring service.

## Default workflow

1. Identify the current Git repository and match its canonical path against
   `list_repos`. Do not guess from a duplicate repository name.
2. Check freshness before relying on graph results: indexed commit, branch,
   relevant working-tree changes, and incomplete/partial warnings. For a stale
   existing index, run `gitnexus analyze --index-only` from the confirmed root,
   preserving any existing explicit indexing options. Wait for completion and
   inspect logs, then query the graph to verify usable context. Do not enable
   watch mode, regenerate instructions, or ask for routine refresh approval.
   Report only material failures; fall back to source if results remain partial.
   Respect Plan's no-write boundary and report any refresh deferred by it.
3. For architecture, debugging, execution-flow, or impact questions, use the
   smallest useful read-only tool: `query`, `context`, `impact`,
   `detect_changes`, or `cypher`. Read the schema before custom Cypher.
4. Corroborate important graph results against the current source and git diff.
5. Skip GitNexus for small, bounded work where direct file search is clearer.

## Prime native MCP

The generic `mcp` module is pre-imported. Discover schemas before calls:

```python
tools = await mcp.list_tools("gitnexus")
repos = await mcp.call_tool("gitnexus", "list_repos", {})
result = await mcp.call_tool("gitnexus", "query", {
    "repo": "exact-repository-name",
    "search_query": "concept or flow",
})
```

Only claim native MCP access after one of these calls succeeds in the current
Prime kernel. A new or changed server configuration can require `await
mcp.reload()` or a new Prime session.

## CLI fallback

If native MCP is unavailable, use the installed executable directly and label
this as CLI fallback:

```bash
gitnexus list
gitnexus status
gitnexus query --repo exact-repository-name "concept or flow"
gitnexus context --repo exact-repository-name SymbolName
gitnexus impact --repo exact-repository-name SymbolName
```

Do not use `npx` when the installed `gitnexus` executable is available.

## Safety

- Keep Plan mode read-only. Do not modify source through GitNexus.
- Do not call `rename`, `clean`, `remove`, `wiki`, or `publish` unless the user
  explicitly requests that operation. Refreshing an existing relevant index is
  allowed automatically after confirming its canonical repository path.
- Never index the home directory, `.config`, or an unrelated repository.
- Refresh stale indexes of already indexed, task-relevant repositories without
  asking. Preserve existing indexing options; avoid unnecessary refreshes on
  trivial tasks. Ask before first-time indexing of a new repository.
- If refresh fails or search reports partial results, state the limitation and
  use current source as fallback. Do not repeatedly retry the same failure.
- Do not enable wiki generation, external LLM calls, uploads, or publishing.
