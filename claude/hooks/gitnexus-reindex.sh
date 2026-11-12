#!/bin/sh
# Stop hook: refresh the GitNexus graph of an ALREADY indexed repo.
# Never indexes a new directory, never rewrites AGENTS.md/CLAUDE.md/skills
# (--index-only). Replaces the old espresso hook that ran `npx gitnexus
# analyze` in any cwd after every turn (pi/OMP/Prime included via bridge).
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -d "$root/.gitnexus" ] || exit 0
command -v gitnexus >/dev/null 2>&1 || exit 0
cd "$root" || exit 0
# Only after a commit: a dirty tree used to rebuild the whole graph after every
# turn, under the MCP servers of every open session, which then crashed.
grep -q "\"lastCommit\": \"$(git rev-parse HEAD)\"" .gitnexus/meta.json 2>/dev/null && exit 0
pgrep -f "gitnexus analyze" >/dev/null 2>&1 && exit 0
# 2 parse workers, lowest priority, no embedding pass: the default (cores-1,
# up to 16) plus --embeddings after every commit froze the Mac on 12/11.
# Without --embeddings, analyze keeps the embeddings already in the index.
nohup nice -n 19 gitnexus analyze --index-only --workers 2 >.gitnexus/reindex.log 2>&1 &
exit 0
