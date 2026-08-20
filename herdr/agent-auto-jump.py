#!/usr/bin/env python3
"""Focus the herdr agent that wants you, once you have stopped typing.

herdr reports agent lifecycle state through its integrations (herdr integration
status). This polls that state and calls `herdr agent focus` on the edge
working -> idle (finished) or -> blocked (needs an answer).

The jump is deferred, never immediate: a request waits DWELL seconds, and only
fires once the focused pane has been quiet for QUIET seconds. Typing keeps it
waiting, so a jump can never land mid-sentence.

Focus is never stolen away from a pane that is itself waiting on you.
"""

import json
import os
import subprocess
import sys
import time

TICK = 1.0
COOLDOWN = 3.0  # seconds after a jump before another one is allowed
DWELL = 3.0  # seconds a request waits before the jump is even considered
QUIET = 2.0  # seconds without a screen change on the focused pane
LOG = os.path.expanduser("~/.config/herdr/agent-auto-jump.log")

# herdr reports "idle" for agents it detects on screen, "done" for a lifecycle
# state pushed by an integration. Both mean the turn is over.
FINISHED = {"idle", "done"}

# Statuses of the pane you are on that forbid stealing your focus.
# "blocked" alone: an agent is asking you something, you are probably answering.
# Add "working" to also stay put whenever the pane you watch is running.
HOLD_WHEN_FOCUSED_IS = {"blocked"}

# A request that has waited this long without ever finding a quiet keyboard is
# dropped: you are clearly deep in something else, and the sidebar already
# carries the state.
EXPIRY = 300.0


def log(msg: str) -> None:
    with open(LOG, "a") as fh:
        fh.write(f"{time.strftime('%H:%M:%S')} {msg}\n")


def herdr(*args: str) -> dict:
    # A dead server answers on stderr with an empty stdout. Raising here keeps
    # the caller from reading that as "no agents", which would wipe the known
    # states and drop a working -> idle edge that spans the outage.
    run = subprocess.run(["herdr", *args], capture_output=True, text=True, timeout=10)
    out = run.stdout.strip()
    if not out.startswith("{"):
        raise RuntimeError(run.stderr.strip()[:120] or f"rc={run.returncode}")
    return json.loads(out)


def agents() -> list:
    return herdr("agent", "list").get("result", {}).get("agents", [])


def focused_pane() -> tuple:
    # `revision` counts screen changes on a pane, so it moves on every keystroke
    # echoed into the focused one and stands still while you read. herdr exposes
    # no last-input timestamp; this is the closest honest signal.
    for pane in herdr("pane", "list").get("result", {}).get("panes", []):
        if pane.get("focused"):
            return pane["pane_id"], pane.get("revision")
    return None, None


def main() -> int:
    prev: dict[str, str] = {}
    handled: set[str] = set()
    pending: dict[str, tuple] = {}  # pane -> (requested_at, reason)
    announced: set[str] = set()
    last_jump = 0.0
    last_seen_rev = (None, None)
    last_screen_change = 0.0

    while True:
        now = time.time()

        try:
            pane_id, revision = focused_pane()
            current = agents()
        except Exception as exc:  # herdr server restarting
            log(f"poll failed: {exc}")
            time.sleep(TICK)
            continue

        if (pane_id, revision) != last_seen_rev:
            last_seen_rev = (pane_id, revision)
            last_screen_change = now

        focused = next((a for a in current if a.get("focused")), None)
        busy_here = bool(focused) and focused["agent_status"] in HOLD_WHEN_FOCUSED_IS

        for a in current:
            pane, state = a["pane_id"], a["agent_status"]
            was = prev.get(pane)

            reason = ""
            if state == "blocked":
                reason = "needs you"
            elif was == "working" and state in FINISHED:
                reason = "finished"

            if not reason:
                prev[pane] = state
                handled.discard(pane)  # episode over, a future jump is allowed
                # back to work before we ever left: the request is void
                pending.pop(pane, None)
                announced.discard(pane)
                continue

            if pane in handled or a.get("focused"):
                prev[pane] = state
                handled.add(pane)
                pending.pop(pane, None)
                continue

            pending.setdefault(pane, (now, reason))
            # deliberately do NOT record the state: working -> idle is a single
            # edge and forgetting it would drop the owed jump.

        alive = {a["pane_id"] for a in current}
        for gone in set(prev) - alive:
            prev.pop(gone, None)
            handled.discard(gone)
        for gone in set(pending) - alive:
            pending.pop(gone, None)
            announced.discard(gone)

        for pane, (asked_at, _) in list(pending.items()):
            if now - asked_at > EXPIRY:
                pending.pop(pane, None)
                announced.discard(pane)
                log(f"dropped {pane}: waited {EXPIRY:.0f}s without a quiet keyboard")

        ready = [p for p, (asked_at, _) in pending.items() if now - asked_at >= DWELL]
        if ready:
            states = {a["pane_id"]: a["agent_status"] for a in current}
            # someone asking a question outranks someone merely finished
            ready.sort(key=lambda p: (states.get(p) != "blocked", pending[p][0]))
            target = ready[0]
            quiet_for = now - last_screen_change

            if busy_here:
                held = "the pane you are on is blocked"
            elif quiet_for < QUIET:
                held = f"typing, quiet for {quiet_for:.1f}s"
            elif now - last_jump < COOLDOWN:
                held = "cooldown"
            else:
                held = ""

            if held:
                if target not in announced:
                    announced.add(target)
                    log(f"holding {target}: {held}")
            else:
                agent = next((a for a in current if a["pane_id"] == target), None)
                reason = pending[target][1]
                herdr("agent", "focus", target)
                waited = now - pending[target][0]
                cwd = agent["cwd"] if agent else "?"
                log(f"JUMPED to {target} ({cwd}) because it {reason}, after {waited:.1f}s")
                prev[target] = states.get(target, prev.get(target, ""))
                handled.add(target)
                pending.pop(target, None)
                announced.discard(target)
                last_jump = now

        time.sleep(TICK)


if __name__ == "__main__":
    sys.exit(main())
