#!/usr/bin/env python3
"""Keep herdr's agent session cache and restore focus after a server restart.

It never moves focus to an agent that finished or needs you: herdr's own toast
says so, and clicking it (or prefix+enter) goes there.

After a server restart it puts focus back on the resumed agent of the active
workspace, since a restart lands on an arbitrary pane.
"""

import json
import os
import subprocess
import sys
import time

TICK = 1.0
RESTORE_FOCUS_WINDOW = 20.0
LOG = os.path.expanduser("~/.config/herdr/agent-auto-jump.log")
CACHE = os.path.expanduser("~/.config/herdr/agent-sessions.json")


def log(msg: str) -> None:
    with open(LOG, "a") as fh:
        fh.write(f"{time.strftime('%H:%M:%S')} {msg}\n")

def cache_agent_sessions(current: list) -> None:
    cached = [
        {
            "pane_id": agent.get("pane_id"),
            "tab_id": agent.get("tab_id"),
            "cwd": agent.get("cwd"),
            "agent_session": agent.get("agent_session"),
        }
        for agent in current
        if agent.get("agent_session")
    ]
    if not cached:
        return
    cached.sort(key=lambda agent: agent.get("pane_id") or "")
    payload = {"version": 1, "agents": cached}
    try:
        with open(CACHE) as fh:
            if json.load(fh) == payload:
                return
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    temporary = f"{CACHE}.tmp"
    with open(temporary, "w") as fh:
        json.dump(payload, fh, separators=(",", ":"))
        fh.write("\n")
    os.replace(temporary, CACHE)


def herdr(*args: str) -> dict:
    # A dead server answers on stderr with an empty stdout. Raising here keeps
    # the caller from reading that as "no agents" and wiping the cache.
    run = subprocess.run(["herdr", *args], capture_output=True, text=True, timeout=10)
    out = run.stdout.strip()
    if not out.startswith("{"):
        raise RuntimeError(run.stderr.strip()[:120] or f"rc={run.returncode}")
    return json.loads(out)


def agents() -> list:
    return herdr("agent", "list").get("result", {}).get("agents", [])


def focused_pane():
    for pane in herdr("pane", "list").get("result", {}).get("panes", []):
        if pane.get("focused"):
            return pane["pane_id"]
    return None


def restored_agent(current: list, focused_pane_id):
    if not focused_pane_id:
        return None

    workspace = focused_pane_id.split(":", 1)[0]
    candidates = [
        agent
        for agent in current
        if agent.get("agent_session")
        and agent.get("pane_id", "").split(":", 1)[0] == workspace
    ]
    if not candidates:
        return None

    priority = {"blocked": 0, "working": 1, "idle": 2, "done": 2}
    return min(
        candidates,
        key=lambda agent: (
            priority.get(agent.get("agent_status"), 3),
            agent.get("pane_id", ""),
        ),
    )


def main() -> int:
    server_unavailable = False
    restore_until = None

    while True:
        now = time.time()

        try:
            pane_id = focused_pane()
            current = agents()
            cache_agent_sessions(current)
        except Exception as exc:  # herdr server restarting
            server_unavailable = True
            log(f"poll failed: {exc}")
            time.sleep(TICK)
            continue

        if server_unavailable:
            restore_until = now + RESTORE_FOCUS_WINDOW
            server_unavailable = False

        if restore_until is not None:
            restored = restored_agent(current, pane_id)
            if restored:
                target = restored["pane_id"]
                if target != pane_id:
                    herdr("agent", "focus", target)
                    log(f"RESTORED focus to {target} in the active workspace")
                restore_until = None
            elif now >= restore_until:
                log("restore focus expired: no resumed agent in workspace")
                restore_until = None

        time.sleep(TICK)


if __name__ == "__main__":
    sys.exit(main())
