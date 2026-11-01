#!/usr/bin/env bash
# Which borrowed mods changed upstream since they were copied here
# (sources.tsv). It only reports: local edits are never overwritten.
# Usage: bash herdr-app/upstream.sh
set -euo pipefail
readonly SOURCES="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/sources.tsv"

while IFS=$'\t' read -r mod repo path sha _license; do
  [[ -z $mod || $mod == \#* ]] && continue
  head=$(gh api "repos/$repo/commits/HEAD" -q .sha 2>/dev/null) || { echo "?  $mod: $repo unreachable"; continue; }
  if [[ $head == "$sha" ]]; then echo "=  $mod"; continue; fi
  changed=$(gh api "repos/$repo/compare/$sha...$head" -q "[.files[].filename | select(startswith(\"$path/\"))] | length" 2>/dev/null || echo "?")
  if [[ $changed == 0 ]]; then
    echo "=  $mod (the repo moved, not this mod)"
  else
    echo "new  $mod: $changed file(s) changed, https://github.com/$repo/compare/${sha:0:7}...${head:0:7}"
  fi
done < "$SOURCES"
