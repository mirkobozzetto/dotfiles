#!/usr/bin/env python3
"""Classic Herdr -> Herdr desktop. Python 3.10+, standard library only.

No credentials, scrollback, telemetry, network requests, or agent termination.
Only local core/app APIs and explicitly selected session files are used.
"""
import argparse
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import queue
import shutil
import subprocess
import sys
import threading
import time
import uuid

VERSION = "1.0.0"
MAX_BYTES = 16 * 1024 * 1024
SHELLS = {"zsh", "bash", "fish", "sh", "dash", "nu", "pwsh", "powershell", "cmd", "xonsh"}


class MigrationError(Exception):
    pass


def read_json(path, default=None):
    path = Path(path)
    if not path.exists():
        return copy.deepcopy(default)
    if path.stat().st_size > MAX_BYTES:
        raise MigrationError("This session file is too large (limit: 16 MiB).")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError) as error:
        raise MigrationError(f"Cannot read {path.name}: {error}") from error


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        with temporary.open("x", encoding="utf-8") as stream:
            try:
                os.chmod(temporary, 0o600)
            except OSError:
                pass
            json.dump(value, stream, indent=2, ensure_ascii=False)
            stream.write("\n")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def identifier(prefix):
    return prefix + uuid.uuid4().hex


def process_alive(pid):
    if not isinstance(pid, int) or pid <= 0:
        return False
    if os.name == "nt":
        # os.kill(pid, 0) can terminate a process on Windows.
        import ctypes
        kernel = ctypes.windll.kernel32
        kernel.OpenProcess.restype = ctypes.c_void_p
        handle = kernel.OpenProcess(0x1000, False, pid)
        if not handle:
            return False
        code = ctypes.c_ulong()
        try:
            return bool(kernel.GetExitCodeProcess(ctypes.c_void_p(handle), ctypes.byref(code))) and code.value == 259
        finally:
            kernel.CloseHandle(ctypes.c_void_p(handle))
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


class Core:
    """Line-delimited JSON-RPC; closing this connection never stops the core."""
    def __init__(self, env):
        try:
            self.process = subprocess.Popen(["hc", "connect"], env=env, stdin=subprocess.PIPE,
                                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                            text=True, encoding="utf-8", bufsize=1)
        except OSError as error:
            raise MigrationError("Install herdr-core (hc), then reopen Herdr.") from error
        self.messages = queue.Queue()
        self.sequence = 0

        def receive():
            try:
                for line in self.process.stdout:
                    self.messages.put(json.loads(line))
            except (ValueError, OSError):
                pass
            self.messages.put(None)
        threading.Thread(target=receive, daemon=True).start()

    def call(self, method, params):
        self.sequence += 1
        request = {"jsonrpc": "2.0", "id": self.sequence, "method": method, "params": params}
        try:
            self.process.stdin.write(json.dumps(request) + "\n")
            self.process.stdin.flush()
            answer = self.messages.get(timeout=15)
        except (OSError, queue.Empty) as error:
            raise MigrationError("The core stopped responding. Reopen this mod and choose Retry.") from error
        if answer is None:
            raise MigrationError("Cannot reach herdr-core. Open Herdr and try again.")
        if "error" in answer:
            detail = answer["error"]
            kind = detail.get("data", {}).get("kind", "error")
            raise MigrationError(f"Core {kind}: {detail.get('message', 'request failed')}")
        return answer["result"]

    def close(self):
        try:
            self.process.stdin.close()
            self.process.wait(timeout=1)
        except (OSError, subprocess.TimeoutExpired):
            # Only our disposable transport process; never the user's server.
            self.process.terminate()
            self.process.wait(timeout=3)


class Runtime:
    def __init__(self, app_home):
        self.env = dict(os.environ, HERDR_APP_HOME=str(app_home))
        self.connection = None

    def cli(self, args, timeout=12):
        try:
            result = subprocess.run(args, env=self.env, capture_output=True, text=True,
                                    encoding="utf-8", timeout=timeout)
        except FileNotFoundError as error:
            raise MigrationError(f"{args[0]} is not installed or is missing from PATH.") from error
        except subprocess.TimeoutExpired as error:
            raise MigrationError(f"{args[0]} did not respond. Check that it is running, then retry.") from error
        if result.returncode:
            raise MigrationError((result.stderr or result.stdout or "Command failed.").strip()[:600])
        try:
            answer = json.loads(result.stdout)
        except ValueError as error:
            raise MigrationError(f"Unexpected response from {args[0]}. Check its installed version.") from error
        if isinstance(answer, dict) and "error" in answer:
            raise MigrationError(str(answer["error"]))
        return answer

    def rpc(self, method, params):
        if self.connection is None:
            self.connection = Core(self.env)
        return self.connection.call(method, params)

    def app(self, name, args):
        return self.cli(["herdr-app", "do", name, json.dumps(args)])

    def close(self):
        if self.connection:
            self.connection.close()


def normalize_session(raw):
    if not isinstance(raw, dict) or not isinstance(raw.get("workspaces"), list):
        raise MigrationError("Choose a classic Herdr session.json file. This file has no workspaces list.")
    if len(raw["workspaces"]) > 200:
        raise MigrationError("This version supports up to 200 workspaces per session.")
    workspaces = []
    seen = set()
    total = 0
    for index, workspace in enumerate(raw["workspaces"]):
        wid = str(workspace.get("id", index))
        if wid in seen:
            raise MigrationError("The session contains duplicate workspace IDs.")
        seen.add(wid)
        tabs = []
        public = workspace.get("public_pane_numbers", {})
        for tab_index, tab in enumerate(workspace.get("tabs", [])):
            panes = tab.get("panes", {})
            if not isinstance(panes, dict) or not panes:
                raise MigrationError(f"Workspace {index + 1} contains an empty or unsupported tab.")
            normalized = {}
            for key, pane in panes.items():
                cwd = pane.get("cwd")
                if not isinstance(cwd, str) or not cwd or not Path(cwd).expanduser().is_absolute():
                    raise MigrationError("Every pane must have an absolute working folder.")
                normalized[str(key)] = {"folder": str(Path(cwd).expanduser()),
                                        "classic_pane": f"{wid}:p{public.get(str(key), key)}",
                                        "session": pane.get("agent_session")}
            leaf_ids = []

            def validate(node, depth=0):
                if depth > 48 or not isinstance(node, dict):
                    raise MigrationError("The session has an invalid or excessively deep split tree.")
                if "Pane" in node:
                    key = str(node["Pane"])
                    if key not in normalized:
                        raise MigrationError("A split references a pane that is missing from the session.")
                    leaf_ids.append(key)
                    return {"Pane": key}
                split = node.get("Split", {})
                ratio = split.get("ratio")
                if split.get("direction") not in ["Horizontal", "Vertical"] or isinstance(ratio, bool) or not isinstance(ratio, (int, float)) or not math.isfinite(ratio) or not 0 < ratio < 1:
                    raise MigrationError("The session contains an unsupported split direction or proportion.")
                return {"Split": {"direction": split["direction"], "ratio": ratio,
                                  "first": validate(split.get("first"), depth + 1),
                                  "second": validate(split.get("second"), depth + 1)}}
            tree = validate(tab.get("layout"))
            if len(set(leaf_ids)) != len(leaf_ids) or set(leaf_ids) != set(normalized):
                raise MigrationError("Every terminal must appear exactly once in its tab's split tree.")
            total += len(normalized)
            tabs.append({"name": tab.get("custom_name") or "", "panes": normalized, "tree": tree})
        if not tabs:
            raise MigrationError("The session contains a workspace with no tabs.")
        first_folder = next(iter(tabs[0]["panes"].values()))["folder"]
        workspaces.append({"id": wid, "name": workspace.get("custom_name") or Path(first_folder).name or "Home",
                           "folder": workspace.get("identity_cwd") or first_folder, "tabs": tabs})
    if total > 1000:
        raise MigrationError("This version supports up to 1,000 panes per session.")
    return workspaces


def build_tree(tree, mapping, root_id=None):
    if "Pane" in tree:
        pane = mapping[str(tree["Pane"])]
        return {"id": pane["pane"], "type": "block", "content": {"terminal": pane["terminal"]}}
    split = tree["Split"]
    a, b = build_tree(split["first"], mapping), build_tree(split["second"], mapping)
    a["size"], b["size"] = {"weight": split["ratio"]}, {"weight": 1 - split["ratio"]}
    return {"id": root_id or identifier("s"), "type": "row" if split["direction"] == "Horizontal" else "column", "children": [a, b]}


class Store:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.state_file = self.root / "state.json"

    def read(self):
        state = read_json(self.state_file, {"version": 1, "sources": {}, "job": None})
        if state.get("version") != 1 or not isinstance(state.get("sources"), dict):
            raise MigrationError("Migration history is unreadable. Keep it and its backups; do not import again until it is repaired.")
        return state

    def write(self, state):
        write_json(self.state_file, state)

    def acquire(self):
        lock = self.root / "operation.lock"
        try:
            lock.mkdir(mode=0o700)
        except FileExistsError:
            owner = read_json(lock / "owner.json", {})
            pid = owner.get("pid")
            alive = process_alive(pid) if isinstance(pid, int) else time.time() - lock.stat().st_mtime <= 10
            if alive:
                raise MigrationError("Another migration operation is running. Its progress appears here automatically.")
            # An abandoned lock contains only our owner record; never remove a run.
            (lock / "owner.json").unlink(missing_ok=True)
            try:
                lock.rmdir()
                lock.mkdir(mode=0o700)
            except OSError as error:
                raise MigrationError("Another migration started while recovering the interrupted operation. Retry.") from error
        write_json(lock / "owner.json", {"pid": os.getpid()})
        return lock

    @staticmethod
    def release(lock):
        (lock / "owner.json").unlink(missing_ok=True)
        lock.rmdir()


class Engine:
    def __init__(self, app_home, data_dir=None, runtime=None):
        self.home = Path(app_home)
        self.store = Store(data_dir or self.home / "data/herdr-migration")
        self.runtime = runtime or Runtime(self.home)

    def scan(self, source):
        path = Path(source).expanduser()
        if path.is_dir():
            path = path / "session.json"
        path = path.resolve()
        if not path.is_file():
            raise MigrationError("No session.json found. Choose your classic Herdr configuration folder or a saved session file.")
        raw = read_json(path)
        workspaces = normalize_session(raw)
        source_structure = digest(workspaces)
        document = self.runtime.rpc("doc.get", {"name": "herdr-app"})
        live_doc = document.get("value") or {"spaces": []}
        spaces = live_doc.get("spaces", [])
        source_key = digest(str(path))[:24]
        state = self.store.read()
        history = state["sources"].get(source_key, {}).get("workspaces", {})
        legacy = None
        session_prefix = None
        try:
            sessions = self.runtime.cli(["herdr", "session", "list", "--json"])["sessions"]
            match = next((s for s in sessions if Path(s["session_dir"]).resolve() == path.parent), None)
            if match and match.get("running"):
                session_prefix = ["herdr"] if match.get("default") else ["herdr", "--session", match["name"]]
                legacy = self.runtime.cli(session_prefix + ["api", "snapshot"])["result"]["snapshot"]
        except (MigrationError, KeyError, StopIteration):
            pass
        live_panes = {p["pane_id"]: p for p in (legacy or {}).get("panes", [])}
        names = {w["workspace_id"]: w["label"] for w in (legacy or {}).get("workspaces", [])}
        for workspace in workspaces:
            workspace["name"] = names.get(workspace["id"], workspace["name"])
            workspace["missing"] = []
            workspace["agents"] = []
            for tab in workspace["tabs"]:
                for pane in tab["panes"].values():
                    live = live_panes.get(pane["classic_pane"], {})
                    pane["folder"] = live.get("foreground_cwd") or live.get("cwd") or pane["folder"]
                    if not Path(pane["folder"]).is_dir():
                        workspace["missing"].append(pane["folder"])
                    session = live.get("agent_session") or pane.get("session") or {}
                    if live.get("agent") or session.get("agent"):
                        agent = {"classic_pane": pane["classic_pane"], "agent": live.get("agent") or session.get("agent"),
                                 "session": session.get("value") if session.get("kind") == "id" else None,
                                 "status": live.get("agent_status", "unknown")}
                        pane["agent"] = agent
                        workspace["agents"].append(agent)
            completed = history.get(workspace["id"], {})
            target = next((s for s in spaces if s["id"] == completed.get("space")), None)
            workspace["imported"] = completed.get("verified", False) and target is not None
            workspace["collision"] = any(s.get("name") == workspace["name"] and s.get("id") != completed.get("space") for s in spaces)
            workspace["pane_count"] = sum(len(t["panes"]) for t in workspace["tabs"])
        plan = {"source": str(path), "source_key": source_key, "fingerprint": digest(raw),
                "source_structure": source_structure,
                "workspaces": workspaces, "legacy_prefix": session_prefix,
                "legacy_available": legacy is not None, "created": time.time()}
        write_json(self.store.root / "plan.json", plan)
        return {"plan": plan, "job": state.get("job"), "history": history}

    def start(self, selected):
        lock = self.store.acquire()
        try:
            plan = read_json(self.store.root / "plan.json")
            if not plan:
                raise MigrationError("Scan your classic session first.")
            state = self.store.read()
            running = state.get("job") or {}
            if running.get("status") in ["queued", "running"]:
                raise MigrationError("A migration is already running. Wait for it to finish or recover its interrupted run.")
            if running.get("status") == "interrupted":
                raise MigrationError("Continue the interrupted import first. It already has a backup and a recovery journal.")
            live_doc = self.runtime.rpc("doc.get", {"name": "herdr-app"}).get("value") or {"spaces": []}
            live_ids = {s["id"] for s in live_doc.get("spaces", [])}
            history = state["sources"].get(plan["source_key"], {}).get("workspaces", {})
            already = {key for key, value in history.items() if value.get("verified") and value.get("space") in live_ids}
            chosen = [w for w in plan["workspaces"] if w["id"] in selected and w["id"] not in already]
            if not chosen:
                raise MigrationError("Select at least one workspace that has not already been imported.")
            if any(w["missing"] for w in chosen):
                raise MigrationError("Some selected folders no longer exist. Deselect those workspaces or restore their folders, then scan again.")
            if digest(read_json(plan["source"])) != plan["fingerprint"]:
                # Classic rewrites the file while running; compare actual structure,
                # not focus, sidebar width or attention bookkeeping.
                if digest(normalize_session(read_json(plan["source"]))) != plan["source_structure"]:
                    raise MigrationError("The classic workspace changed since the preview. Scan again before importing it.")
            job = {"id": identifier("run-"), "source_key": plan["source_key"], "status": "queued", "stage": "backup",
                   "selected": [w["id"] for w in chosen], "done": 0, "total": sum(w["pane_count"] for w in chosen),
                   "message": "Preparing your backup…", "started": time.time(), "heartbeat": time.time(), "pid": None}
            state["job"] = job
            self.store.write(state)
            write_json(self.store.root / "runs" / job["id"] / "plan.json", plan)
            args = [sys.executable, str(Path(__file__).resolve()), "--app-home", str(self.home), "--data-dir", str(self.store.root), "worker", "--job", job["id"]]
            log = self.store.root / "runs" / job["id"] / "worker.log"
            with log.open("a", encoding="utf-8") as output:
                options = {"start_new_session": True} if os.name != "nt" else {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS}
                worker = subprocess.Popen(args, env=self.runtime.env, stdin=subprocess.DEVNULL, stdout=output, stderr=output, **options)
            state["job"]["pid"] = worker.pid
            self.store.write(state)
            return {"job": state["job"]}
        finally:
            self.store.release(lock)

    def worker(self, job_id):
        # The launching process holds the lock until the job's PID is recorded.
        deadline = time.monotonic() + 8
        while True:
            try:
                lock = self.store.acquire()
                break
            except MigrationError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(0.1)
        state = self.store.read()
        try:
            if not state.get("job") or state["job"]["id"] != job_id:
                raise MigrationError("This migration was superseded by another run.")
            job = state["job"]
            plan = read_json(self.store.root / "runs" / job_id / "plan.json")
            job.update(status="running", pid=os.getpid())
            self.store.write(state)
            self.perform(state, plan)
        except Exception as error:
            if state.get("job") and state["job"]["id"] == job_id:
                state["job"].update(status="interrupted", message=str(error), heartbeat=time.time())
                self.store.write(state)
            raise
        finally:
            self.store.release(lock)

    def perform(self, state, plan):
        job = state["job"]
        run_dir = self.store.root / "runs" / job["id"]
        backup = run_dir / "backup"
        chosen = [w for w in plan["workspaces"] if w["id"] in job["selected"]]
        if any(not Path(p["folder"]).is_dir() for w in chosen for t in w["tabs"] for p in t["panes"].values()):
            raise MigrationError("A selected folder is missing. Restore it before continuing this import.")
        document = self.runtime.rpc("doc.get", {"name": "herdr-app"})
        if not (backup / "complete.json").exists():
            write_json(backup / "app-document.json", document)
            write_json(backup / "classic-session.json", read_json(plan["source"]))
            for name in ["settings.json", "keys.json", "view.json"]:
                if (self.home / name).exists():
                    write_json(backup / name, read_json(self.home / name))
            write_json(backup / "complete.json", {"version": VERSION, "created": time.time()})
        job["backup"] = str(backup)
        source = state["sources"].setdefault(plan["source_key"], {"path": plan["source"], "workspaces": {}})
        self.store.write(state)
        terminals = self.runtime.rpc("terminal.list", {"all": True})["terminals"]
        terminal_by_id = {t["address"]: t for t in terminals}
        existing_spaces = {s["id"] for s in (document.get("value") or {}).get("spaces", [])}
        job["done"] = 0
        by_marker = {t.get("labels", {}).get("herdr-migration.pane"): t for t in terminals if t.get("labels", {}).get("herdr-migration.source") == plan["source_key"]}
        new_spaces = []
        for workspace in chosen:
            previous = source["workspaces"].get(workspace["id"], {})
            if previous.get("verified") and previous["space"] not in existing_spaces:
                if any(terminal_by_id.get(p["terminal"], {}).get("state") == "live" for t in previous["tabs"] for p in t["panes"].values()):
                    raise MigrationError("Previously imported terminals are still running elsewhere. Keep using those terminals instead of importing duplicates.")
                source.setdefault("previous_imports", []).append(source["workspaces"].pop(workspace["id"]))
            record = source["workspaces"].setdefault(workspace["id"], {"space": identifier("sp"), "tabs": [], "verified": False, "instance": identifier("import-")})
            if not record["tabs"]:
                for tab in workspace["tabs"]:
                    record["tabs"].append({"id": identifier("tb"), "panes": {key: {"pane": identifier("p"), "terminal": None} for key in tab["panes"]}})
                self.store.write(state)
            target_space = {"id": record["space"], "name": workspace["name"], "folder": workspace["folder"], "tabs": []}
            for tab, target_tab in zip(workspace["tabs"], record["tabs"]):
                for key, pane in tab["panes"].items():
                    marker = record["instance"] + "/" + pane["classic_pane"]
                    saved = target_tab["panes"][key]
                    found = by_marker.get(marker)
                    if found:
                        if found["state"] != "live":
                            raise MigrationError("An imported terminal exited. Its record is preserved; open a shell there before retrying.")
                        saved["terminal"] = found["address"]
                    elif saved["terminal"]:
                        raise MigrationError("An imported terminal disappeared. Review the interrupted run before continuing.")
                    else:
                        job.update(stage="import", message="Creating " + workspace["name"], heartbeat=time.time())
                        self.store.write(state)
                        result = self.runtime.rpc("terminal.run", {"cwd": pane["folder"], "keep": True, "no_parent": True, "no_notify": True,
                            "labels": {"herdr.space": record["space"], "herdr.tab": target_tab["id"],
                                       "herdr-migration.source": plan["source_key"], "herdr-migration.pane": marker}})
                        saved["terminal"] = result["address"]
                        by_marker[marker] = result
                    saved.update(folder=pane["folder"], classic_pane=pane["classic_pane"], agent=pane.get("agent"))
                    if (run_dir / "pause.request").exists():
                        raise MigrationError("Import paused. Your created shells are preserved. Continue when you are ready.")
                    job.update(done=min(job["total"], job.get("done", 0) + 1), heartbeat=time.time())
                    self.store.write(state)
                root = build_tree(tab["tree"], target_tab["panes"], target_tab["id"])
                if root["type"] == "block":
                    root = {"id": target_tab["id"], "type": "row", "children": [root]}
                target_space["tabs"].append({"id": target_tab["id"], "name": tab["name"], "root": root})
            new_spaces.append(target_space)
        job.update(stage="verify", message="Restoring split proportions and verifying every folder…", heartbeat=time.time())
        self.store.write(state)
        # Merge with the newest accepted document. Never overwrite unrelated spaces.
        for attempt in range(12):
            latest = self.runtime.rpc("doc.get", {"name": "herdr-app"})
            merged = copy.deepcopy(latest.get("value") or {"spaces": []})
            current = merged.setdefault("spaces", [])
            positions = {s["id"]: index for index, s in enumerate(current)}
            for space in new_spaces:
                if space["id"] in positions:
                    current[positions[space["id"]]] = space
                else:
                    current.append(space)
            try:
                self.runtime.rpc("doc.set", {"name": "herdr-app", "value": merged, "version": latest["version"]})
                break
            except MigrationError as error:
                if "conflict" not in str(error).lower() or attempt == 11:
                    raise
                time.sleep(0.1)
        after = self.runtime.rpc("doc.get", {"name": "herdr-app"})
        actual_spaces = {s["id"]: s for s in (after.get("value") or {}).get("spaces", [])}
        for expected in new_spaces:
            if actual_spaces.get(expected["id"]) != expected:
                raise MigrationError("The imported layout changed before verification. Review it, then retry.")
        live = {t["address"]: t for t in self.runtime.rpc("terminal.list", {"all": True})["terminals"]}
        for workspace in chosen:
            record = source["workspaces"][workspace["id"]]
            for tab in record["tabs"]:
                for pane in tab["panes"].values():
                    terminal = live.get(pane["terminal"], {})
                    folder = (terminal.get("foreground") or {}).get("cwd") or terminal.get("cwd")
                    if terminal.get("state") != "live" or folder != pane["folder"] or not terminal.get("keep"):
                        raise MigrationError("A shell did not start in its expected folder. Restore that folder and choose Retry.")
            record["verified"] = True
        job.update(status="complete", stage="complete", done=job["total"], message="Your workspaces are ready.", heartbeat=time.time())
        self.store.write(state)
        write_json(run_dir / "receipt.json", {"workspaces": len(chosen), "tabs": sum(len(w["tabs"]) for w in chosen),
                                              "panes": job["total"], "verified": True, "backup": str(backup), "created": time.time()})

    def status(self):
        state = self.store.read()
        job = state.get("job")
        if job and job["status"] in ["queued", "running"] and time.time() - job.get("heartbeat", 0) > 45:
            if not process_alive(job.get("pid")):
                job = dict(job, status="interrupted", message="The import was interrupted. Retry continues from its saved progress.")
        transfers = []
        plan = read_json(self.store.root / "plan.json", {})
        history = state["sources"].get(plan.get("source_key"), {}).get("workspaces", {})
        live_agents, available = [], False
        if plan.get("legacy_prefix") and (not job or job["status"] not in ["queued", "running"]):
            try:
                live_agents = self.runtime.cli(plan["legacy_prefix"] + ["agent", "list"])["result"]["agents"]
                available = True
            except (MigrationError, KeyError):
                pass
        for workspace in plan.get("workspaces", []):
            target = history.get(workspace["id"], {})
            for tab in target.get("tabs", []):
                for pane in tab["panes"].values():
                    agent = pane.get("agent")
                    if not agent:
                        continue
                    active = next((a for a in live_agents if a["pane_id"] == agent["classic_pane"] or
                                   (agent.get("session") and a.get("agent_session", {}).get("value") == agent["session"])), None)
                    transfers.append({**agent, "workspace": workspace["name"], "terminal": pane["terminal"],
                                      "space": target["space"], "tab": tab["id"],
                                      "status": "resumed" if pane.get("resumed") else active.get("agent_status", "unknown") if active else "ready" if available else "unavailable",
                                      "ready": available and active is None and not pane.get("resumed")})
        return {"job": job, "transfers": transfers, "legacy_available": available}

    def retry(self):
        lock = self.store.acquire()
        try:
            state = self.store.read()
            job = state.get("job")
            if not job or job["status"] == "complete":
                raise MigrationError("There is no interrupted import to continue.")
            if process_alive(job.get("pid")):
                raise MigrationError("The import is still running. Wait for its next progress update.")
            job.update(status="interrupted", pid=None)
            (self.store.root / "runs" / job["id"] / "pause.request").unlink(missing_ok=True)
            self.store.write(state)
        finally:
            self.store.release(lock)
        # Run the existing journal; do not create another migration or backup.
        args = [sys.executable, str(Path(__file__).resolve()), "--app-home", str(self.home), "--data-dir", str(self.store.root), "worker", "--job", job["id"]]
        with (self.store.root / "runs" / job["id"] / "worker.log").open("a") as output:
            options = {"start_new_session": True} if os.name != "nt" else {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS}
            process = subprocess.Popen(args, env=self.runtime.env, stdin=subprocess.DEVNULL, stdout=output, stderr=output, **options)
        return {"message": "Continuing your saved import.", "pid": process.pid}

    def resume(self, terminal_id):
        lock = self.store.acquire()
        try:
            state = self.store.read()
            plan = read_json(self.store.root / "plan.json", {})
            if not plan.get("legacy_prefix"):
                raise MigrationError("The matching classic Herdr server must be running so we can check for an open copy of this conversation.")
            panes = [p for w in state["sources"].get(plan.get("source_key"), {}).get("workspaces", {}).values() for t in w["tabs"] for p in t["panes"].values()]
            pane = next((p for p in panes if p["terminal"] == terminal_id), None)
            if not pane or not pane.get("agent"):
                raise MigrationError("This terminal has no saved conversation to resume.")
            if pane.get("resumed"):
                raise MigrationError("This conversation has already been resumed here.")
            agent = pane["agent"]
            live = self.runtime.cli(plan["legacy_prefix"] + ["agent", "list"])["result"]["agents"]
            if any(a["pane_id"] == agent["classic_pane"] or (agent.get("session") and a.get("agent_session", {}).get("value") == agent["session"]) for a in live):
                raise MigrationError("This conversation is still open in classic Herdr. Exit that agent first; your conversation stays saved.")
            actual = self.runtime.rpc("terminal.get", {"terminal": terminal_id})
            name = Path((actual.get("foreground") or {}).get("name", "")).stem.lstrip("-")
            if actual.get("state") != "live" or actual.get("status") or name not in SHELLS:
                raise MigrationError("The destination terminal is busy. Return it to an empty shell before resuming.")
            sid, kind = agent.get("session"), agent["agent"]
            if sid and kind in ["claude", "codex", "grok"]:
                argv = ["codex", "--no-daemon", "resume", sid] if kind == "codex" else [kind, "--resume", sid]
            elif kind in ["claude", "codex", "grok"]:
                argv = ["codex", "--no-daemon", "resume"] if kind == "codex" else [kind, "--resume"]
            else:
                raise MigrationError("This agent has no supported resume command. Start it manually in its migrated pane.")
            if not shutil.which(argv[0]):
                raise MigrationError(f"Install {argv[0]} before resuming this conversation.")
            # Start the native agent in its own new tab, with argv instead of shell
            # text. No command is injected into a potentially edited shell prompt.
            location = next((w for w in state["sources"][plan["source_key"]]["workspaces"].values() if any(p is pane for t in w["tabs"] for p in t["panes"].values())), None)
            result = self.runtime.app("tab.new", {"space": location["space"], "folder": pane["folder"], "name": "Resume " + kind, "argv": argv})
            pane["resumed"] = {"terminal": result["terminal"], "tab": result["tab"], "at": time.time()}
            self.store.write(state)
            return {"message": "Complete any sign-in or trust prompt in the agent's tab." if sid else "Choose your conversation in the agent's resume picker.", "space": location["space"], **result}
        finally:
            self.store.release(lock)

    def pause(self):
        job = self.store.read().get("job")
        if not job or job["status"] not in ["queued", "running"]:
            raise MigrationError("No import is running.")
        write_json(self.store.root / "runs" / job["id"] / "pause.request", {"at": time.time()})
        return {"message": "Pausing after the current terminal is created…"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-home", default=os.environ.get("HERDR_APP_HOME", str(Path.home() / ".config/herdr-app")))
    parser.add_argument("--data-dir")
    sub = parser.add_subparsers(dest="command", required=True)
    scan = sub.add_parser("scan")
    scan.add_argument("--source", required=True)
    start = sub.add_parser("start")
    start.add_argument("--selected", required=True, help="JSON array of classic workspace IDs")
    sub.add_parser("status")
    sub.add_parser("retry")
    sub.add_parser("pause")
    worker = sub.add_parser("worker")
    worker.add_argument("--job", required=True)
    resume = sub.add_parser("resume")
    resume.add_argument("--terminal", required=True)
    args = parser.parse_args()
    engine = Engine(args.app_home, args.data_dir)
    try:
        if args.command == "scan":
            result = engine.scan(args.source)
        elif args.command == "start":
            selected = json.loads(args.selected)
            if not isinstance(selected, list) or not all(isinstance(i, str) for i in selected):
                raise MigrationError("Select workspaces using the preview.")
            result = engine.start(selected)
        elif args.command == "worker":
            engine.worker(args.job)
            result = engine.status()
        elif args.command == "retry":
            result = engine.retry()
        elif args.command == "resume":
            result = engine.resume(args.terminal)
        elif args.command == "pause":
            result = engine.pause()
        else:
            result = engine.status()
        print(json.dumps(result, ensure_ascii=False))
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False))
        return 1
    finally:
        engine.runtime.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
