#!/usr/bin/env python3
"""Restore cached OMP references before Herdr reads its session snapshot."""

import fcntl
import json
import os
from pathlib import Path
import shutil
import sys

HERDR_DIR = Path.home() / ".config" / "herdr"
SESSION = Path(os.environ.get("HERDR_SESSION_FILE", HERDR_DIR / "session.json"))
CACHE = Path(
    os.environ.get("HERDR_AGENT_SESSION_CACHE", HERDR_DIR / "agent-sessions.json")
)
LOCK = Path(os.environ.get("HERDR_AGENT_RESTORE_LOCK", HERDR_DIR / ".restore.lock"))


def valid_session(value):
    return (
        isinstance(value, dict)
        and value.get("source") == "herdr:omp"
        and value.get("agent") == "omp"
        and value.get("kind") == "path"
        and Path(value.get("value", "")).is_file()
    )


def find_target(workspace, cached):
    tab_id = cached.get("tab_id", "")
    if ":t" not in tab_id:
        return None
    try:
        public_number = int(tab_id.rsplit(":t", 1)[1], 36)
    except ValueError:
        return None

    numbers = workspace.get("public_tab_numbers", [])
    try:
        tab = workspace["tabs"][numbers.index(public_number)]
    except (KeyError, ValueError, IndexError):
        return None

    panes = list(tab.get("panes", {}).values())
    if len(panes) == 1:
        return panes[0]
    matching = [pane for pane in panes if pane.get("cwd") == cached.get("cwd")]
    return matching[0] if len(matching) == 1 else None


def restore():
    if not SESSION.is_file() or not CACHE.is_file():
        return 0

    snapshot = json.loads(SESSION.read_text())
    cached = json.loads(CACHE.read_text()).get("agents", [])
    workspaces = {
        workspace.get("id"): workspace
        for workspace in snapshot.get("workspaces", [])
    }

    restored = 0
    for agent in cached:
        agent_session = agent.get("agent_session")
        if not valid_session(agent_session):
            continue
        workspace_id = agent.get("pane_id", "").split(":", 1)[0]
        workspace = workspaces.get(workspace_id)
        if not workspace:
            continue
        target = find_target(workspace, agent)
        if target is None or target.get("agent_session"):
            continue
        target["agent_session"] = agent_session
        restored += 1

    if restored:
        backup = SESSION.with_suffix(SESSION.suffix + ".agent-restore.bak")
        shutil.copy2(SESSION, backup)
        temporary = SESSION.with_suffix(SESSION.suffix + ".agent-restore.tmp")
        temporary.write_text(json.dumps(snapshot, separators=(",", ":")) + "\n")
        os.replace(temporary, SESSION)
    return restored


def main():
    LOCK.parent.mkdir(parents=True, exist_ok=True)
    with LOCK.open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        restored = restore()
    print(f"restored={restored}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
