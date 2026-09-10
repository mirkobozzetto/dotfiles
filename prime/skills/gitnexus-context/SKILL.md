---
name: gitnexus-context
description: "Use GitNexus for codebase exploration, debugging, call-flow tracing, and change-impact analysis when the current repository has an existing index. Skip it for small tasks where direct source reads are enough."
---

# GitNexus context for Prime Agent

Use GitNexus as optional read-only code intelligence. It supplements source
inspection; it does not replace it.

## Default workflow

1. Identify the current Git repository and match its canonical path against
   `list_repos`. Do not guess from a duplicate repository name.
2. Check index freshness before relying on graph results. Compare the indexed
   commit and branch with the current repository. Report stale or missing data.
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
    "query": "concept or flow",
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
- Do not call `rename`, `clean`, `remove`, `analyze`, `index`, `wiki`, or
  `publish` unless the user explicitly requests that operation.
- Never index the home directory, `.config`, or an unrelated repository.
- Ask before indexing or refreshing an existing project.
- Do not enable wiki generation, external LLM calls, uploads, or publishing.
