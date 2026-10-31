// Shepherd: every terminal of every space in one list, a summary on top and a
// command line at the bottom. ↑/↓ or a click selects a row, a double click or
// Enter on an empty line peeks at it. Text goes to the selected terminal; on a
// space header, or with /new, it starts a new agent with /who /where /model /effort.
// Right click or /star stars a row (starred rows lead their space).
// /space <folder> [name] makes a space running the /who agent and sets it as /where;
// /space gh:owner/repo [name] clones the GitHub repo into ~/dev first (or reuses its clone).
// /close (or ⌘⌫ on an empty line) closes the selected agent, /close done every finished
// one, /close shells every shell, /close space [name] a whole space (the selected
// row's unless named); each asks first, Enter says yes, Esc no.
// /machine picks the computer /space works on (folders, clones and the space itself).

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { appHome, spaces, machines, panes, agents, terminals, run, hc, exec, readTextFile, writeTextFile, home, knownAgents, props, openOverlay, closeOverlay, window, shared, setShared, nextCommand } from "herdr";

// The picture's own colors, not the theme's: this layout is one fixed look.
const C = {
  bg: "#0c0f1e", sel: "#1b2140", line: "#232842",
  text: "#ececf0", idle: "#b4b4bc", num: "#a3a3ad", dim: "#6f7388", title: "#b9b9c2",
  // Status colors: the same as the counts on top.
  star: "#f4e97a", done: "#19d27c", working: "#f3ef8e", blocked: "#f0315c", shell: "#ff4d6d",
  terminal: "#2ecc8f", plus: "#a6e3b8", age: "#e0e0e6",
  box: { agents: "#f4f4f4", working: "#f3ef8e", paused: "#f0315c", done: "#19d27c", cost: "#c4b5fd" },
  mark: "#ff5c8a",
};
const SPACE_COLORS = ["#ff5c8a", "#c4b5fd", "#cfc8ff", "#f0f0f4", "#34d399", "#7dd3fc", "#fbbf24", "#f9a8d4"];
const PROGRAM_COLORS = { claude: "#ff9f43", codex: "#7dd3fc", gemini: "#8ab4f8", opencode: "#c4b5fd", pi: "#f9a8d4", grok: "#e5e7eb" };
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const COMMANDS = ["who", "where", "model", "effort", "new", "space", "close", "machine", "language", "star",
  "yes", "no", "answer", "rename", "find", "preview"];
// /find words that pick rows by kind or status instead of by text.
const PREVIEW_LINES = 8;
// Model names and ids as they may go into a start command: no leading "-", no quotes.
const SAFE_VALUE = /^[A-Za-z0-9][\w.:\/\[\]@+ -]{0,80}$/;
const FIND_WORDS = ["working", "blocked", "done", "idle", "agents", "shells"];
// Every UI text in English and German; /language picks one (English by default).
const TEXT = {
  en: {
    cmd: {
      who: "coding agent for new agents", where: "space for new agents", model: "model for new agents",
      effort: "effort for new agents", new: "start a new agent with a task",
      space: "new space: <folder> | gh:<repo> [name]", close: "close: selected | done | shells | space",
      machine: "computer for new spaces", language: "language: en | de", star: "star the selected row",
      yes: "approve what a blocked agent asks", no: "decline what a blocked agent asks",
      answer: "type an answer to a blocked agent", rename: "own name for the row (empty: automatic)",
      find: "show only matching rows (empty: all)", preview: "live preview below the list: on | off",
    },
    days: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    local: "local", selected: "selected", current: "current", selectedSpace: "selected space",
    newAgent: (who, sp) => `New ${who} in ${sp}`,
    spaceUsage: "/space <folder> | gh:<repo> [name]",
    badRepo: (r) => `Not a valid repo “${r}” (owner/repo)`,
    newSpace: (n, who, on) => `New space ${n} with ${who}${on ? ` on ${on}` : ""}`,
    newSpaceWhere: (n) => `New space ${n} · where → ${n}`,
    cloning: (r, on) => `Cloning ${r}${on ? ` on ${on}` : ""} …`,
    cloneFailed: (e) => `Clone failed: ${e}`,
    typingFor: (n) => `Typing for ${n}`,
    pickAgent: "Select an agent row first",
    pickAgentOrNew: "Select an agent row first (or /new <task>)",
    pickRow: "Select a row first",
    noneDone: "No finished agents", noShells: "No shells",
    nDone: (n) => `${n} finished agents`, nShells: (n) => `${n} shells`, nMarked: (n) => `${n} marked rows`,
    askClose: (what) => `Close ${what}?`,
    busyOne: "Still working!", busyN: (n) => `${n} still working!`,
    alsoSpace: (names) => `Also closes space ${names}.`,
    yesNo: "Enter = yes · Esc = no",
    askCloseSpace: (n, a, sh) => `Close space ${n} (${a} agents, ${sh} shells)?`,
    spaceClosed: (n) => `Space ${n} closed`,
    closed: (x) => `Closed: ${x}`,
    noSpace: (n) => `No space “${n}”`,
    noComputer: (a) => `No computer “${a}” (hc machine add …)`,
    unknown: (c, list) => `Unknown: /${c}  (${list})`,
    enterName: (c) => `/${c}: enter a name`,
    askShell: (n, t) => `Shell ${n} runs this as a command: “${t}” – send?`,
    sendFailed: "Sending failed",
    pickFolder: "pick a folder",
    already: (p) => `already here: ${p}`,
    willClone: (d) => `will be cloned to ~/${d}`,
    taskFor: (n) => `Task for ${n} …`,
    newIn: (who, w) => `New ${who} in ${w} …`,
    sugHint: (final) => `↑↓ select · Tab fill in · Enter ${final ? "set" : "fill in"}`,
    clickToType: "Click to type",
    cacheLeft: (m) => `${m}m left`, cacheLt1: "<1m left", expired: "expired",
    noQuota: (w) => `no data for ${w}`,
    notBlocked: (n) => `${n} isn't waiting for an answer`,
    answered: (n, a) => `→ ${n}: ${a}`,
    askAnswer: (a, qs) => `${a} for ${qs.length} agents: ${qs.join(" · ")} – go?`,
    gaveNone: "None of them is waiting any more – nothing sent",
    badValue: (v) => `Not allowed: ${v}`,
    renamed: (n) => `Renamed to ${n}`, autoName: "Automatic name again",
    filter: (f, n) => `filter “${f}” · ${n} shown · /find or Esc clears`,
    marked: (n) => `${n} marked`, taskForMarked: (n) => `Task for ${n} marked rows …`,
    previewOn: "Preview on", previewOff: "Preview off",
    cost: "cost",
  },
  de: {
    cmd: {
      who: "Coding-Agent für neue Agents", where: "Space für neue Agents", model: "Model für neue Agents",
      effort: "Aufwand für neue Agents", new: "neuen Agent mit Auftrag starten",
      space: "neuen Space anlegen: <Ordner> | gh:<Repo> [Name]", close: "schließen: selected | done | shells | space",
      machine: "Computer für neue Spaces", language: "Sprache: en | de", star: "gewählte Zeile markieren",
      yes: "Frage eines blockierten Agents bestätigen", no: "Frage eines blockierten Agents ablehnen",
      answer: "Antwort an einen blockierten Agent tippen", rename: "eigener Name für die Zeile (leer: automatisch)",
      find: "nur passende Zeilen zeigen (leer: alle)", preview: "Live-Vorschau unter der Liste: on | off",
    },
    days: ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"],
    local: "lokal", selected: "gewählt", current: "aktuell", selectedSpace: "gewählter Space",
    newAgent: (who, sp) => `Neuer ${who} in ${sp}`,
    spaceUsage: "/space <Ordner> | gh:<Repo> [Name]",
    badRepo: (r) => `Kein gültiges Repo „${r}“ (owner/repo)`,
    newSpace: (n, who, on) => `Neuer Space ${n} mit ${who}${on ? ` auf ${on}` : ""}`,
    newSpaceWhere: (n) => `Neuer Space ${n} · where → ${n}`,
    cloning: (r, on) => `Klone ${r}${on ? ` auf ${on}` : ""} …`,
    cloneFailed: (e) => `Klonen fehlgeschlagen: ${e}`,
    typingFor: (n) => `Tippen für ${n}`,
    pickAgent: "Erst eine Agent-Zeile wählen",
    pickAgentOrNew: "Erst eine Agent-Zeile wählen (oder /new <Auftrag>)",
    pickRow: "Erst eine Zeile wählen",
    noneDone: "Keine fertigen Agents", noShells: "Keine Shells",
    nDone: (n) => `${n} fertige Agents`, nShells: (n) => `${n} Shells`, nMarked: (n) => `${n} markierte Zeilen`,
    askClose: (what) => `${what} schließen?`,
    busyOne: "Arbeitet noch!", busyN: (n) => `${n} arbeiten noch!`,
    alsoSpace: (names) => `Schließt auch Space ${names}.`,
    yesNo: "Enter = ja · Esc = nein",
    askCloseSpace: (n, a, sh) => `Space ${n} schließen (${a} Agents, ${sh} Shells)?`,
    spaceClosed: (n) => `Space ${n} geschlossen`,
    closed: (x) => `Geschlossen: ${x}`,
    noSpace: (n) => `Kein Space „${n}“`,
    noComputer: (a) => `Kein Computer „${a}“ (hc machine add …)`,
    unknown: (c, list) => `Unbekannt: /${c}  (${list})`,
    enterName: (c) => `/${c}: Name eingeben`,
    askShell: (n, t) => `Shell ${n} führt das als Befehl aus: „${t}“ – senden?`,
    sendFailed: "Senden fehlgeschlagen",
    pickFolder: "Ordner wählen",
    already: (p) => `schon da: ${p}`,
    willClone: (d) => `wird nach ~/${d} geklont`,
    taskFor: (n) => `Auftrag an ${n} …`,
    newIn: (who, w) => `Neuer ${who} in ${w} …`,
    sugHint: (final) => `↑↓ wählen · Tab übernehmen · Enter ${final ? "setzen" : "übernehmen"}`,
    clickToType: "Klicken zum Tippen",
    cacheLeft: (m) => `noch ${m}m`, cacheLt1: "noch <1m", expired: "abgelaufen",
    noQuota: (w) => `keine Daten für ${w}`,
    notBlocked: (n) => `${n} wartet auf keine Antwort`,
    answered: (n, a) => `→ ${n}: ${a}`,
    askAnswer: (a, qs) => `${a} für ${qs.length} Agents: ${qs.join(" · ")} – los?`,
    gaveNone: "Keiner wartet mehr – nichts gesendet",
    badValue: (v) => `Nicht erlaubt: ${v}`,
    renamed: (n) => `Umbenannt in ${n}`, autoName: "Wieder automatischer Name",
    filter: (f, n) => `Filter „${f}“ · ${n} sichtbar · /find oder Esc hebt auf`,
    marked: (n) => `${n} markiert`, taskForMarked: (n) => `Auftrag an ${n} markierte Zeilen …`,
    previewOn: "Vorschau an", previewOff: "Vorschau aus",
    cost: "Kosten",
  },
};
let LANG = "en";
const T = () => TEXT[LANG] ?? TEXT.en;
// Asked of a small model once per Claude session: a 1–3 word name for its first request.
// The name keeps the request's own language.
const NAMER = "You name tasks. The text on stdin is a request to a coding agent; do not carry it out or answer it. Reply only with a short name for the task in the request's language: 1 to 3 words, lower case, joined with -, only a-z, 0-9 and umlauts.";
// Prints a session's first real request (see the script).
const FIRST_ASK = `
import json, os, sys
# A session's first real request: a user message of four words or more, not a command,
# tool result or reminder. Claude Code, Codex, pi and grok (a session folder) alike.
path = sys.argv[1]
if os.path.isdir(path): path = os.path.join(path, "chat_history.jsonl")
def text(c):
    return c if isinstance(c, str) else " ".join(x.get("text", "") for x in (c or []) if isinstance(x, dict) and x.get("type") in ("text", "input_text"))
for line in open(path, encoding="utf-8", errors="replace"):
    try: d = json.loads(line)
    except Exception: continue
    p = d.get("payload") or {}
    m = d.get("message") or {}
    if d.get("type") == "event_msg" and p.get("type") == "user_message": t = p.get("message") or ""
    elif d.get("type") == "response_item" and p.get("type") == "message" and p.get("role") == "user": t = text(p.get("content"))
    elif d.get("type") == "user" and "message" in d and not d.get("isMeta"): t = text(m.get("content"))
    elif d.get("type") == "user" and "content" in d and not d.get("synthetic_reason"): t = text(d.get("content"))
    elif d.get("type") == "message" and m.get("role") == "user": t = text(m.get("content"))
    else: continue
    t = t.strip()
    if t and not t.startswith(("<", "Caveat:")) and len(t.split()) >= 4: print(t[:3000]); break
`;
// Prints {path, id, cwd} of the session a codex, pi or grok process (kind, pid, cwd) writes.
const AGENT_FIND = `
import json, os, subprocess, sys, time
# Which session a coding agent process (kind, pid, cwd) writes: the file it or a child holds
# open, else the one for the same folder that started closest to the process.
kind, pid, cwd = sys.argv[1], sys.argv[2], sys.argv[3]
env = lambda k, d: os.environ.get(k) or os.path.expanduser(d)
root = {"codex": env("CODEX_HOME", "~/.codex") + "/sessions",
        "pi": env("PI_CODING_AGENT_DIR", "~/.pi/agent") + "/sessions",
        "grok": env("GROK_HOME", "~/.grok") + "/sessions"}[kind]
def run(*a):
    try: return subprocess.run(a, capture_output=True, text=True, timeout=5).stdout
    except Exception: return ""
def iso(s):
    try: return time.mktime(time.strptime((s or "")[:19], "%Y-%m-%dT%H:%M:%S")) - time.timezone
    except Exception: return None
def meta(path):
    # {id, cwd, at} of a session: a codex/pi file, or a grok folder.
    try:
        if kind == "grok":
            m = json.load(open(os.path.join(path, "summary.json")))
            return {"id": m.get("id") or os.path.basename(path), "cwd": m.get("cwd"), "at": iso(m.get("created_at"))}
        with open(path, encoding="utf-8", errors="replace") as f:
            d = json.loads(f.readline())
        if kind == "codex":
            p = d.get("payload") or {}
            return d.get("type") == "session_meta" and {"id": p.get("id"), "cwd": p.get("cwd"), "at": iso(p.get("timestamp"))}
        return d.get("type") == "session" and {"id": d.get("id"), "cwd": d.get("cwd"), "at": iso(d.get("timestamp"))}
    except Exception: return None
real_root = os.path.realpath(root)
def session_of(n):
    # The session a path under root belongs to, if any; lsof reports resolved paths.
    if n.startswith(real_root + "/") and real_root != root: n = root + n[len(real_root):]
    base = os.path.basename(n)
    if kind == "codex": return n if base.startswith("rollout-") and base.endswith(".jsonl") else None
    if not n.startswith(root + "/"): return None
    if kind == "grok":
        parts = n[len(root) + 1:].split("/")
        return os.path.join(root, parts[0], parts[1]) if len(parts) > 2 else None
    return n if base.endswith(".jsonl") else None
def out(path):
    m = meta(path) or {}
    print(json.dumps({"path": path, "id": m.get("id") or os.path.basename(path), "cwd": m.get("cwd") or cwd}))
    sys.exit()
pids, todo = [], [pid]
while todo and len(pids) < 50:
    p = todo.pop(); pids.append(p); todo += run("pgrep", "-P", p).split()
for line in run("lsof", "-Fn", "-p", ",".join(pids)).splitlines():
    s = line.startswith("n") and session_of(line[1:])
    if s: out(s)
el = run("ps", "-o", "etime=", "-p", pid).strip()
secs = 0
if el:
    d, _, hms = el.rpartition("-")
    for part in hms.split(":"): secs = secs * 60 + int(part)
    secs += int(d or 0) * 86400
start = time.time() - secs
best = None
for dirpath, dirs, files in os.walk(root):
    names = dirs if kind == "grok" else files
    for fn in names:
        path = os.path.join(dirpath, fn)
        if session_of(path + ("/x" if kind == "grok" else "")) is None: continue
        try:
            if os.path.getmtime(path) < start - 60: continue
        except OSError: continue
        m = meta(path)
        if not m or m.get("cwd") != cwd: continue
        gap = abs((m.get("at") or os.path.getctime(path)) - start)
        if best is None or gap < best[0]: best = (gap, path)
if best: out(best[1])
`;
// Prints the latest context use, model, effort, cache and quota of a codex, pi or grok session.
const AGENT_READ = `
import json, os, sys
# The latest {used, size, model, effort, at, cache, rate_limits, rl_at} of a codex/pi/grok session.
kind, path = sys.argv[1], sys.argv[2]
def tail(p, n=3000000):
    try:
        size = os.path.getsize(p)
        with open(p, "rb") as f:
            f.seek(max(0, size - n))
            return f.read().decode("utf-8", "replace").splitlines()
    except OSError: return []
def find(o, key):
    # The first value of key anywhere inside o.
    if isinstance(o, dict):
        if key in o: return o[key]
        o = list(o.values())
    if isinstance(o, list):
        for v in o:
            r = find(v, key)
            if r is not None: return r
    return None
def sum_pi_cost(p):
    # Every answer's cost.total in a pi session, in dollars.
    total = 0.0
    try:
        for line in open(p, encoding="utf-8", errors="replace"):
            if '"cost"' not in line: continue
            try: m = json.loads(line).get("message") or {}
            except Exception: continue
            total += float(((m.get("usage") or {}).get("cost") or {}).get("total") or 0)
    except OSError: pass
    return round(total, 4)
res = {}
if kind == "codex":
    for line in reversed(tail(path)):
        if '"token_count"' not in line and '"turn_context"' not in line: continue
        try: d = json.loads(line)
        except Exception: continue
        p = d.get("payload") or {}
        if p.get("type") == "token_count":
            info = p.get("info") or {}
            if "used" not in res and info.get("last_token_usage"):
                u = info["last_token_usage"]
                res["used"] = u.get("total_tokens") or (u.get("input_tokens", 0) + u.get("output_tokens", 0))
                res["size"] = info.get("model_context_window")
                res["at"] = d.get("timestamp")
            if "rate_limits" not in res and p.get("rate_limits"):
                res["rate_limits"] = p["rate_limits"]; res["rl_at"] = d.get("timestamp")
        elif d.get("type") == "turn_context" and "model" not in res:
            res["model"] = p.get("model"); res["effort"] = p.get("effort")
        if all(k in res for k in ("used", "rate_limits", "model")): break
elif kind == "pi":
    for line in reversed(tail(path)):
        try: d = json.loads(line)
        except Exception: continue
        m = d.get("message") or {}
        if d.get("type") == "message" and m.get("role") == "assistant" and m.get("usage") and "used" not in res:
            u = m["usage"]
            res["used"] = u.get("totalTokens") or sum(u.get(k) or 0 for k in ("input", "output", "cacheRead", "cacheWrite"))
            res["cost"] = sum_pi_cost(path)
            res["model"] = m.get("model"); res["at"] = d.get("timestamp")
            # Anthropic keeps a prompt cache 5 minutes after its last use.
            if m.get("provider") == "anthropic" and (u.get("cacheRead") or u.get("cacheWrite")): res["cache"] = 300
        elif d.get("type") == "thinking_level_change" and "effort" not in res:
            res["effort"] = d.get("thinkingLevel")
        if "used" in res and "effort" in res: break
elif kind == "grok":
    ticks = 0
    for line in tail(os.path.join(path, "updates.jsonl"), 20000000):
        if "turn_completed" not in line or "costUsdTicks" not in line: continue
        try: ticks += find(json.loads(line), "costUsdTicks") or 0
        except Exception: pass
    if ticks: res["cost"] = round(ticks / 1e10, 4)
    for line in reversed(tail(os.path.join(path, "updates.jsonl"))):
        if "turn_completed" not in line: continue
        try: d = json.loads(line)
        except Exception: continue
        if find(d, "sessionUpdate") != "turn_completed": continue
        i, o = find(d, "inputTokens"), find(d, "outputTokens")
        if i is None: continue
        res["used"] = (i or 0) + (o or 0)
        mu = find(d, "modelUsage")
        if isinstance(mu, dict) and mu: res["model"] = list(mu)[-1]
        break
    try:
        s = json.load(open(os.path.join(path, "summary.json")))
        res["model"] = s.get("current_model_id") or res.get("model")
    except Exception: pass
    for line in reversed(tail(os.path.join(path, "chat_history.jsonl"), 500000)):
        try: d = json.loads(line)
        except Exception: continue
        if d.get("type") == "assistant" and d.get("reasoning_effort"): res["effort"] = d["reasoning_effort"]; break
print(json.dumps(res))
`;
// Codex quota windows, labelled by their length (300 min: 5h, 10080: 7d).
// Only an agent's output from its screen: drops the input box with everything under it
// (model, mode, hints), the spinner or "Worked for" line and what sits between it and the box,
// right-aligned notices and rule lines.
function outputLines(text, n) {
  let lines = text.split("\n").map((l) => l.replace(/\s+$/, ""));
  const rule = (l) => /^\s*[─━═]{8,}\s*$/.test(l);
  const prompt = (l) => /^\s*[❯›>]( | |$)/.test(l);
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 12); i--) {
    if (!prompt(lines[i])) continue;
    lines = lines.slice(0, i > 0 && rule(lines[i - 1]) ? i - 1 : i);
    break;
  }
  const spinner = (l) => /^[^\w\s]\s+\S+(…|\.\.\.| for \d)/u.test(l) || /^\s*(─ )?Worked for \d|^\s*•\s+Working\b/.test(l);
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 8); i--) {
    if (spinner(lines[i])) { lines = lines.slice(0, i); break; }
  }
  lines = lines.filter((l) => !rule(l) && !/^\s{20,}\S/.test(l));
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines.slice(-n);
}

function codexWindows(rl, at) {
  const label = (x, d) => (!x?.window_minutes ? d : x.window_minutes % 1440 === 0 ? `${x.window_minutes / 1440}d` : `${Math.round(x.window_minutes / 60)}h`);
  const w = (x) => x && { used_percentage: x.used_percent, resets_at: x.resets_at ?? (x.resets_in_seconds != null ? (Date.parse(at) || Date.now()) / 1000 + x.resets_in_seconds : null) };
  return [[label(rl.primary, "5h"), w(rl.primary)], [label(rl.secondary, "7d"), w(rl.secondary)]];
}
// Prints {kind: [model, …]}: the models codex, pi and grok used, from config and sessions.
const MODELS_SEEN = `
import glob, json, os
# Models each agent has used, newest first: from its config and its latest sessions.
env = lambda k, d: os.environ.get(k) or os.path.expanduser(d)
out = {}
def add(k, m):
    if isinstance(m, str) and m and m not in out.setdefault(k, []): out[k].append(m)
def newest(pattern, n=80):
    files = glob.glob(pattern, recursive=True)
    files.sort(key=lambda f: os.path.getmtime(f) if os.path.exists(f) else 0, reverse=True)
    return files[:n]
def lines(path, n=400):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for i, line in enumerate(f):
                if i >= n: break
                try: yield json.loads(line)
                except Exception: pass
    except OSError: return
codex = env("CODEX_HOME", "~/.codex")
try:
    for line in open(codex + "/config.toml"):
        k, _, v = line.partition("=")
        if k.strip() == "model": add("codex", v.strip().strip('"'))
except OSError: pass
for f in newest(codex + "/sessions/**/rollout-*.jsonl"):
    for d in lines(f, 60):
        if d.get("type") == "turn_context": add("codex", (d.get("payload") or {}).get("model")); break
pi = env("PI_CODING_AGENT_DIR", "~/.pi/agent")
try: add("pi", json.load(open(pi + "/settings.json")).get("defaultModel"))
except Exception: pass
for f in newest(pi + "/sessions/*/*.jsonl"):
    for d in lines(f):
        if d.get("type") == "model_change": add("pi", d.get("modelId"))
        m = d.get("message") or {}
        if m.get("role") == "assistant": add("pi", m.get("model"))
for f in newest(env("GROK_HOME", "~/.grok") + "/sessions/*/*/summary.json"):
    try: add("grok", json.load(open(f)).get("current_model_id"))
    except Exception: pass
print(json.dumps(out))
`;
// Effort levels each agent takes; Claude's come per model from cli-models.json.
const AGENT_EFFORTS = {
  codex: ["minimal", "low", "medium", "high", "xhigh"],
  pi: ["off", "minimal", "low", "medium", "high", "xhigh"],
  grok: ["low", "medium", "high"],
};
const CLONE_DIR = "code"; // under home: where /space clones GitHub repos
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// Sizes from the picture (23 px text there), scaled to 15 px text.
const S = 15 / 23;
const px = (n) => Math.round(n * S * 10) / 10;
const ROW = px(31.4);
const CH = px(13.9);
const FONT = "Geist Mono";

const num = (addr) => addr.replace(/^.*\/t?|^t/, "");
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}$]+/u, "").trim();
// Three letters for a repo: the initials of its first three words, else of two words the
// first word's first letter and next consonant plus the second's initial, else the first
// letter and the next two consonants ("invoicing" inv, "landing-page" lnp).
function abbr(name) {
  const parts = name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9äöü]+/).filter(Boolean);
  if (!parts.length) return "";
  const cons = (w) => w.slice(1).replace(/[aeiouäöüy]/g, "") + w.slice(1);
  if (parts.length === 1 && parts[0].length <= 3) return parts[0];
  if (parts.length >= 3) return parts.slice(0, 3).map((w) => w[0]).join("");
  if (parts.length === 2) return (parts[0][0] + (cons(parts[0])[0] ?? "") + parts[1][0]).slice(0, 3);
  return (parts[0][0] + cons(parts[0])).slice(0, 3);
}
const machineOf = (addr) => (addr.includes("/") ? addr.split("/")[0] : null);
const localAddr = (addr) => addr.replace(/^.*\//, "");

function ago(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`;
}
const money = (d) => (d >= 100 ? `$${Math.round(d)}` : d >= 10 ? `$${d.toFixed(1)}` : `$${d.toFixed(2)}`);
const tokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M` : `${Math.round(n / 1000)}k`);
function clock(sec) {
  const d = new Date(sec * 1000), now = new Date();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return d.toDateString() === now.toDateString() ? hm : `${T().days[d.getDay()]} ${hm}`;
}
const programKey = (p) => (p?.agent ? (p.key || "agent").toLowerCase().replace(/-code$/, "") : null);

export default class Shepherd extends View {
  init(_props, cx) {
    // The layout block only holds the place: Herdr keeps the keyboard with its
    // panes there, so the list lives in a frameless window over the block,
    // where the line and the keys reach it.
    // A guard copy rides in the agent window and says while it is open, however it closes.
    this.guard = Boolean(props()?.guard);
    if (this.guard) return setShared("shepherd.peek", props().guard);
    this.host = !props()?.overlay;
    if (this.host) return;
    setShared("shepherd.window", props().overlay);
    this.handle = cx.focus_handle();
    this.top = 0;       // first shown row
    this.listH = 600;   // the list's height, px
    this.wheel = 0;     // scroll px not yet a whole row
    this.input = InputState.new({ placeholder: "" });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); this.sugI = 0; if (this.text && this.confirm) { this.confirm = null; this.msg = null; } this.loadDirs(cx); cx.notify(); });
    this.sugI = 0;       // highlighted suggestion
    this.dirs = { for: null, list: [] }; // folders for /space's path
    this.input.on("submit", (_e, cx) => { this.submit(cx); cx.notify(); });
    // The line keeps the keyboard: ↑/↓ reach the list from it, Enter submits it.
    this.typing = false;
    this.input.on("focus", (_e, cx) => {
      // While an agent is open the keyboard stays in its window; the line takes it only once it's closed.
      // Just opened, the guard may not have said so yet.
      if (this.peeked && (Date.now() - this.peekAt < 1500 || this.peekOpen())) return run("pane.focus", { terminal: this.peekedAddr });
      this.peeked = null;
      this.typing = true;
      cx.notify();
    });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.input.focus();
    // Escape (keys.json, layout:shepherd) closes the open agent, else clears the line;
    // ⌘↩ (shepherd.type) closes it too and puts the keyboard on the line, for the selected row.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "type") { const was = this.peeked; this.toLine(); if (was) { await cx.sleep(80); this.input.focus(); } cx.notify(); continue; }
        if (c !== "escape") continue;
        if (this.confirm) { this.confirm = null; this.msg = null; }
        else if (this.peeked && this.peekOpen()) { this.closePeek(); await cx.sleep(80); this.input.focus(); }
        else this.escape();
        cx.notify();
      }
    });
    this.text = "";
    this.selKey = localStorage.getItem("sel");
    this.stars = JSON.parse(localStorage.getItem("stars") ?? "[]");
    this.short = JSON.parse(localStorage.getItem("short") ?? "{}"); // session id → short name
    this.naming = new Set(); // session ids being named
    this.names = {};         // session id (or address, for shells) → a name from /rename
    this.marks = new Set();  // addresses marked with ⌘-click or shift+↑/↓
    this.filter = "";        // /find text
    this.cost = {};          // address → session cost in dollars
    this.screen = {};        // address → last lines of its screen, for the preview
    this.repoOf = {};        // session cwd → its repo's name (origin, else the repo folder, else the folder)
    this.cfg = { who: "claude", where: null, model: null, effort: "medium", lang: "en", preview: true, ...JSON.parse(localStorage.getItem("cfg") ?? "{}") };
    LANG = this.cfg.lang;
    this.info = {};     // address → hc get facts
    this.sess = {};     // address → Claude Code session (name, id, cwd)
    this.ctx = {};      // address → context and cache of its session
    this.quota = {};    // agent kind → quota windows
    this.models = { claude: [] }; // claude: {id, label, efforts}; others: model names
    this.agentsKnown = [];
    this.repos = [];    // GitHub repos, for /space gh:
    this.clones = {};   // owner/repo (lower case) → its folder under ~/dev
    this.mhome = home(); // home folder on /machine's computer
    this.msg = null;
    cx.spawn(async (cx) => { await this.loadState(); await this.loadStatic(); await this.refresh(); await this.refreshSelected(); cx.notify(); });
    cx.timer.every(8000, (cx) => cx.spawn(async (cx) => { await this.refresh(); cx.notify(); }));
    cx.timer.every(3000, (cx) => cx.spawn(async (cx) => { this.adoptNewSpace(); await this.refreshSelected(); cx.notify(); }));
  }

  // Settings, stars, selection and short names live in one file: localStorage belongs to a
  // single copy of the mod, and the window opens as a new copy on every resize or reload.
  statePath() {
    return `${appHome()}/data/shepherd/state.json`;
  }

  async loadState() {
    try {
      const text = await readTextFile(this.statePath());
      if (!text) return;
      const d = JSON.parse(text);
      this.cfg = { ...this.cfg, ...d.cfg };
      this.stars = d.stars ?? this.stars;
      this.short = { ...this.short, ...d.short };
      this.names = { ...this.names, ...d.names };
      this.selKey = d.sel ?? this.selKey;
      LANG = this.cfg.lang;
      this.stored = text;
    } catch {}
  }

  save() {
    localStorage.setItem("cfg", JSON.stringify(this.cfg));
    localStorage.setItem("stars", JSON.stringify(this.stars));
    if (this.selKey) localStorage.setItem("sel", this.selKey);
    // Writes go one after another; a stale snapshot (another copy wrote) reads the file again.
    this.writing = (this.writing ?? Promise.resolve()).then(async () => {
      const text = JSON.stringify({ cfg: this.cfg, stars: this.stars, short: this.short, names: this.names, sel: this.selKey }, null, 1);
      if (text === this.stored) return;
      try {
        if (this.stored === undefined) await exec("mkdir", ["-p", `${appHome()}/data/shepherd`]);
        await writeTextFile(this.statePath(), text, this.stored ?? null);
      } catch {
        this.stored = await readTextFile(this.statePath());
        await writeTextFile(this.statePath(), text, this.stored ?? null);
      }
      this.stored = text;
    }).catch(() => {});
  }

  async loadStatic() {
    try {
      const m = JSON.parse((await readTextFile(`${home()}/.shepherdr/cli-models.json`)) ?? "{}");
      this.models.claude = [...(m.claude?.models ?? []), ...(m.claude?.others ?? [])];
      this.claudeEfforts = m.claude?.efforts;
      if (!this.cfg.model) this.cfg.model = (m.claude?.models ?? []).find((x) => x.id === m.claude?.default)?.label ?? "Opus 5.5";
    } catch {}
    try { this.agentsKnown = await knownAgents(); } catch {}
    try {
      const r = await exec("python3", ["-I", "-c", MODELS_SEEN]);
      Object.assign(this.models, JSON.parse(r.stdout.trim() || "{}"));
    } catch {}
    await this.loadRepos();
  }

  // Every GitHub repo gh can reach, recently pushed first, and which ones ~/dev already holds.
  async loadRepos() {
    try {
      const r = await exec("gh", ["api", "user/repos?per_page=100&sort=pushed", "--paginate", "--jq", '.[] | [.full_name, (.description // "")] | @tsv']);
      if (r.code === 0) this.repos = r.stdout.split("\n").filter(Boolean).map((l) => { const [repo, desc] = l.split("\t"); return { repo, desc }; });
    } catch {}
    await this.loadMachine();
  }

  // /machine's home folder and the repos its ~/dev already holds.
  async loadMachine() {
    const on = this.cfg.machine ?? undefined;
    this.clones = {};
    this.dirs = { for: null, list: [] };
    try {
      const r = await exec("sh", ["-c", 'printf "%s\\n" "$HOME"; for d in "$HOME/$1"/*/; do u=$(git -C "$d" remote get-url origin 2>/dev/null) && printf "%s\\t%s\\n" "${d%/}" "$u"; done', "sh", CLONE_DIR], { on });
      if (r.code !== 0) throw new Error(r.stderr);
      const [h, ...rest] = r.stdout.split("\n");
      this.mhome = h || home();
      r.stdout = rest.join("\n");
      for (const l of r.stdout.split("\n").filter(Boolean)) {
        const [dir, url] = l.split("\t");
        const m = url.match(/github\.com[:/](.+?)(\.git)?\/?$/);
        if (m) this.clones[m[1].toLowerCase()] = dir;
      }
    } catch { this.mhome = on ? "~" : home(); }
  }

  // Facts hc keeps per terminal (start, last change, foreground pid) and the
  // Claude Code session behind each claude terminal.
  async refresh() {
    for (const p of panes()) {
      if (!p.terminal) continue;
      const addr = p.terminal;
      try {
        const r = await hc(["get", addr, "--json"]);
        if (r.code !== 0) continue;
        const g = JSON.parse(r.stdout);
        this.info[addr] = g;
        const on = machineOf(addr);
        const pid = g.foreground?.pid;
        const isClaude = (g.status?.app ?? "").startsWith("claude") || (g.foreground?.argv?.[0] ?? "").endsWith("claude");
        if (pid && isClaude) {
          const read = JSON.parse((await readTextFile(`${home()}/.claude/sessions/${pid}.json`, { on })) ?? "null");
          // The id becomes part of a file name below, so only an id-shaped one is used.
          const s = /^[A-Za-z0-9-]{1,80}$/.test(read?.sessionId ?? "") ? read : null;
          if (s) this.sess[addr] = { kind: "claude", name: s.name, id: s.sessionId, cwd: s.cwd, on };
          if (s && !this.short[s.sessionId]) this.nameSession(this.sess[addr]);
          if (s && !(s.cwd in this.repoOf)) this.findRepo(s.cwd, on);
        }
        // Codex, pi and grok: their session file (or grok's folder), found once per process.
        const app = g.status?.app ?? "", argv = g.foreground?.argv ?? [];
        const kind = isClaude ? null : ["codex", "pi", "grok"].find((k) => app.startsWith(k) || argv.some((a) => new RegExp(`(^|/)${k}(\\.js)?$`).test(a)));
        if (pid && kind && this.sess[addr]?.pid !== pid) {
          const r = await exec("python3", ["-I", "-c", AGENT_FIND, kind, String(pid), g.foreground?.cwd ?? g.cwd ?? ""], { on });
          const f = JSON.parse(r.stdout.trim() || "null");
          if (f) this.sess[addr] = { kind, pid, id: f.id, cwd: f.cwd, path: f.path, on };
        }
        const cs = kind && this.sess[addr];
        if (cs && !this.short[cs.id]) this.nameSession(cs);
        if (cs && !(cs.cwd in this.repoOf)) this.findRepo(cs.cwd, on);
      } catch {}
    }
    await this.loadCosts();
    await this.loadQuota();
  }

  // Each session's cost: Claude's from the statusline cache, pi's and grok's from their
  // sessions (Codex has none). Kept per address for the rows, the footer and the total.
  async loadCosts() {
    for (const [addr, s] of Object.entries(this.sess)) {
      try {
        if (s.kind === "claude") {
          const line = JSON.parse((await readTextFile(`${home()}/.claude/statusline-cache/${s.id}.json`, { on: s.on })) ?? "null");
          const c = line?.cost?.total_cost_usd;
          if (c != null) this.cost[addr] = c;
        } else if (s.kind === "pi" || s.kind === "grok") {
          const r = await exec("python3", ["-I", "-c", AGENT_READ, s.kind, s.path], { on: s.on });
          const d = JSON.parse(r.stdout.trim() || "null");
          if (d?.cost != null) this.cost[addr] = d.cost;
        }
      } catch {}
    }
  }

  // The first real request (FIRST_ASK), named by NAMER;
  // retried on a later refresh while the session has none yet.
  async nameSession(s) {
    // Off: naming runs `claude -p` on every session's first request,
    // unasked, and bills the Claude quota. Rows keep the session's own name.
    return;
    if (this.naming.has(s.id)) return;
    this.naming.add(s.id);
    try {
      const path = s.path ?? `${home()}/.claude/projects/${s.cwd.replace(/[^A-Za-z0-9]/g, "-")}/${s.id}.jsonl`;
      // Streamed by python: a message with an image is one huge line.
      const r = await exec("python3", ["-I", "-c", FIRST_ASK, path], { on: s.on });
      const ask = (r.stdout ?? "").trim();
      if (!ask) return;
      const n = await exec("sh", ["-c", 'printf "%s" "$1" | claude -p --model haiku --no-session-persistence --tools "" --setting-sources "" --strict-mcp-config --system-prompt "$2" "Name for this request:"', "sh", ask.slice(0, 3000), NAMER], { cwd: home() });
      const name = (n.stdout ?? "").trim().split("\n").pop().toLowerCase()
        .replace(/[^a-z0-9äöüß-]+/g, "-").split("-").filter(Boolean).slice(0, 3).join("-");
      if (n.code !== 0 || !name) return;
      this.short[s.id] = name;
      this.save();
    } catch {} finally { this.naming.delete(s.id); }
  }

  // "psd-mail-filter": the repo's three letters, then the short name of the first request.
  shortName(s) {
    const short = s && this.short[s.id];
    if (!short) return null;
    const a = abbr(this.repoOf[s.cwd] ?? "");
    return a ? `${a}-${short}` : short;
  }

  async findRepo(cwd, on) {
    this.repoOf[cwd] = cwd.split("/").pop();
    try {
      const r = await exec("sh", ["-c", 'u=$(git -C "$1" remote get-url origin 2>/dev/null) && { basename "$u" .git; exit; }; t=$(git -C "$1" rev-parse --show-toplevel 2>/dev/null) && basename "$t"', "sh", cwd], { on });
      const name = (r.stdout ?? "").trim();
      if (name) this.repoOf[cwd] = name;
    } catch {}
  }

  async loadQuota() {
    try {
      const q = JSON.parse((await readTextFile(`${home()}/.claude/quota-cache.json`)) ?? "null");
      if (q?.rate_limits) this.quota.claude = { at: q.at, windows: [["5h", q.rate_limits.five_hour], ["7d", q.rate_limits.seven_day]] };
    } catch {}
    // Codex: the newest rollout's last rate limits.
    try {
      const r = await exec("sh", ["-c", 'f=$(ls -t "${CODEX_HOME:-$HOME/.codex}"/sessions/*/*/*/rollout-*.jsonl 2>/dev/null | head -1); [ -n "$f" ] && python3 -I -c "$1" codex "$f"', "sh", AGENT_READ]);
      const d = JSON.parse(r.stdout.trim() || "null");
      if (d?.rate_limits) this.setCodexQuota(d);
    } catch {}
  }

  setCodexQuota(d) {
    const at = Date.parse(d.rl_at) / 1000 || null;
    if (this.quota.codex?.at && at && at < this.quota.codex.at) return;
    this.quota.codex = { at, windows: codexWindows(d.rate_limits, d.rl_at) };
  }

  // Context window and prompt cache of the selected row's session.
  async refreshSelected() {
    const row = this.rows && this.selected();
    if (row?.kind === "term" && this.cfg.preview) await this.loadScreen(row.addr);
    const s = row?.addr && this.sess[row.addr];
    if (!s?.id) return;
    const out = { at: Date.now() };
    if (s.kind !== "claude") {
      // Codex and grok keep no cache time; pi on Anthropic keeps 5 minutes. Without a known
      // window size, ctx shows only the tokens used.
      try {
        const r = await exec("python3", ["-I", "-c", AGENT_READ, s.kind, s.path], { on: s.on });
        const d = JSON.parse(r.stdout.trim() || "null");
        if (d?.used != null) Object.assign(out, { used: d.used, size: d.size ?? null, pct: d.size ? (100 * d.used) / d.size : null });
        if (d?.cache && d.at) out.cacheUntil = Date.parse(d.at) + d.cache * 1000;
        if (d) Object.assign(out, { model: d.model, effort: d.effort });
        if (d?.rate_limits) this.setCodexQuota(d);
      } catch {}
      this.ctx[row.addr] = out;
      return;
    }
    try {
      const line = JSON.parse((await readTextFile(`${home()}/.claude/statusline-cache/${s.id}.json`, { on: s.on })) ?? "null");
      const cw = line?.context_window;
      if (cw?.context_window_size) {
        const u = cw.current_usage ?? {};
        out.size = cw.context_window_size;
        out.used = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) || null;
        out.pct = cw.used_percentage ?? (out.used ? (100 * out.used) / out.size : null);
        out.model = line.model?.display_name;
        out.effort = line.effort?.level;
      }
    } catch {}
    try {
      const path = `${home()}/.claude/projects/${s.cwd.replace(/[^A-Za-z0-9]/g, "-")}/${s.id}.jsonl`;
      const r = await exec("tail", ["-c", "600000", path], { on: s.on });
      const lines = r.stdout.split("\n").slice(1);
      let last = null, ttl = null;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].includes('"usage"')) continue;
        let d;
        try { d = JSON.parse(lines[i]); } catch { continue; }
        const u = d.message?.usage;
        if (d.type !== "assistant" || !u) continue;
        if (!last) last = { at: Date.parse(d.timestamp), u, model: d.message.model };
        const cc = u.cache_creation ?? {};
        if (cc.ephemeral_1h_input_tokens > 0) { ttl = 3600e3; break; }
        if (cc.ephemeral_5m_input_tokens > 0) { ttl = 300e3; break; }
      }
      if (last) {
        out.cacheUntil = last.at + (ttl ?? 300e3);
        if (out.used == null) {
          out.used = (last.u.input_tokens ?? 0) + (last.u.cache_creation_input_tokens ?? 0) + (last.u.cache_read_input_tokens ?? 0);
          out.size = out.size ?? (/1m/i.test(last.model ?? "") ? 1e6 : 2e5);
          out.pct = (100 * out.used) / out.size;
        }
        out.model = out.model ?? last.model;
      }
    } catch {}
    this.ctx[row.addr] = out;
  }

  // The last output lines of a terminal's screen, for the preview.
  async loadScreen(addr) {
    try {
      const r = await hc(["read", addr, "--json"]);
      this.screen[addr] = outputLines(JSON.parse(r.stdout).text ?? "", PREVIEW_LINES);
    } catch {}
  }

  // Header and terminal rows, space by space; starred rows first, then by number.
  buildRows() {
    const all = panes();
    const live = terminals().filter((k) => k.state === "live");
    const status = new Map(agents().map((a) => [a.address, a.status]));
    const rows = [];
    spaces().forEach((sp, i) => {
      const tabIds = new Map(sp.tabs.map((t) => [t.id, t]));
      const mine = all.filter((p) => p.terminal && tabIds.has(p.tab)).map((p) => {
        const g = this.info[p.terminal] ?? {};
        const tab = tabIds.get(p.tab);
        const agent = Boolean(p.program?.agent || p.status);
        const fg = g.foreground?.argv?.[0]?.split("/").pop();
        const own = this.names[this.sess[p.terminal]?.id ?? p.terminal];
        const name = own ? (agent ? own : `$ ${own}`) : agent
          ? this.shortName(this.sess[p.terminal]) || this.sess[p.terminal]?.name || (tab.named ? tab.name : null) || g.name || clean(p.title) || p.program?.name
          : `$ ${tab.named ? tab.name : g.name || `term-${num(p.terminal)}`}`;
        return {
          key: p.terminal, kind: "term", addr: p.terminal, pane: p.pane, tab: p.tab, space: sp, agent,
          status: agent ? (status.get(p.terminal) ?? p.status ?? "idle") : null,
          name,
          kids: live.filter((k) => k.parent === p.terminal).length,
          changed: g.status_ms ?? null,
          created: g.created_ms ?? null,
          program: agent ? programKey(p.program) ?? "agent" : "terminal",
          title: agent ? clean(g.status?.msg || g.title || p.title) : fg || clean(p.title),
          star: this.stars.includes(p.terminal),
          mark: this.marks.has(p.terminal),
        };
      }).filter((r) => this.matches(r));
      mine.sort((a, b) => (b.star - a.star) || (Number(num(a.addr)) - Number(num(b.addr))));
      const label = sp.machine ? `${sp.machine}/${sp.name}` : sp.name;
      if (this.filter && !mine.length) return;
      rows.push({ key: `space:${sp.id}`, kind: "space", space: sp, label, count: mine.length, color: SPACE_COLORS[i % SPACE_COLORS.length] });
      rows.push(...mine);
    });
    return rows;
  }

  // /find: a status or kind word picks by that, other text by name, title, program or space.
  matches(r) {
    const f = this.filter.toLowerCase();
    if (!f) return true;
    if (f === "agents") return r.agent;
    if (f === "shells") return !r.agent;
    if (FIND_WORDS.includes(f)) return r.status === f;
    return [r.name, r.title, r.program, r.space.name].some((x) => (x ?? "").toLowerCase().includes(f));
  }

  // The rows an action is for: the marked ones, else the selected one.
  targets() {
    const marked = this.rows.filter((r) => r.kind === "term" && this.marks.has(r.addr));
    if (marked.length) return marked;
    const r = this.selected();
    return r?.kind === "term" ? [r] : [];
  }

  // Esc without a question or open agent: clear the line, else the filter, else the marks.
  escape() {
    if (this.text) { this.input.set_value(""); this.text = ""; }
    else if (this.filter) this.filter = "";
    else this.marks.clear();
    this.msg = null;
  }

  selected() {
    return this.rows.find((r) => r.key === this.selKey && r.kind === "term") ?? this.rows.find((r) => r.kind === "term");
  }

  // Steps over space headers: only terminals take a task.
  // A pending question belongs to the row it was asked on: moving away drops it, so Enter
  // does what the new row expects instead of sending or closing after all.
  dropConfirm() {
    if (!this.confirm) return;
    this.confirm = null;
    this.msg = null;
  }

  move(by, cx, mark = false) {
    this.dropConfirm();
    if (mark && this.selected()) this.marks.add(this.selected().addr);
    const terms = this.rows.filter((r) => r.kind === "term");
    if (!terms.length) return;
    const i = Math.max(0, terms.findIndex((r) => r.key === this.selected()?.key));
    const next = terms[Math.min(terms.length - 1, Math.max(0, i + by))];
    this.selKey = next.key;
    if (mark) { this.marks.add(next.addr); this.msg = { text: T().marked(this.marks.size), color: C.dim }; }
    const j = this.rows.indexOf(next);
    // At the top of a space, show its header too.
    this.reveal(this.rows[j - 1]?.kind === "space" ? j - 1 : j);
    this.reveal(j);
    this.save();
    cx.spawn(async (cx) => { await this.refreshSelected(); cx.notify(); });
  }

  // Keeps row i on screen.
  reveal(i) {
    const fit = Math.max(1, Math.floor(this.listH / ROW));
    if (i < this.top) this.top = i;
    else if (i >= this.top + fit) this.top = i - fit + 1;
  }

  scrollBy(dy) {
    this.wheel += dy;
    const step = Math.trunc(this.wheel / ROW);
    if (!step) return false;
    this.wheel -= step * ROW;
    const fit = Math.max(1, Math.floor(this.listH / ROW));
    this.top = Math.max(0, Math.min(Math.max(0, this.rows.length - fit), this.top - step));
    return true;
  }

  // Where a new agent goes: /where's space, else the selected row's.
  whereSpace() {
    return spaces().find((s) => s.id === this.cfg.where) ?? this.selected()?.space ?? spaces()[0];
  }

  argvFor() {
    // Values may come from state.json, so they are checked here again.
    const known = this.agentsKnown.find((a) => a.key === this.cfg.who);
    const who = ["claude", "codex"].includes(this.cfg.who) || known ? this.cfg.who : "claude";
    const cfg = { model: SAFE_VALUE.test(this.cfg.model ?? "") ? this.cfg.model : null,
      effort: /^[a-z]+$/.test(this.cfg.effort ?? "") ? this.cfg.effort : "medium" };
    const model = this.models.claude.find((m) => m.label === cfg.model || m.id === cfg.model);
    if (who === "claude") return ["claude", ...(model ? ["--model", model.id] : cfg.model ? ["--model", cfg.model] : []), "--effort", cfg.effort];
    if (who === "codex") return ["codex", ...(cfg.model ? ["-m", cfg.model] : []), "-c", `model_reasoning_effort="${cfg.effort}"`];
    const run_ = known?.run ?? [who];
    // pi: --model/--thinking (its README); grok: -m/--effort (xAI's CLI reference).
    if (who === "pi") return [...run_, ...(cfg.model ? ["--model", cfg.model] : []), "--thinking", cfg.effort];
    if (who === "grok") return [...run_, ...(cfg.model ? ["-m", cfg.model] : []), "--effort", cfg.effort];
    return run_;
  }

  startAgent(task) {
    const sp = this.whereSpace();
    run("tab.new", { space: sp.id, argv: this.argvFor(), ...(task ? { task } : {}) });
    this.msg = { text: T().newAgent(this.cfg.who, sp.name), ok: true };
  }

  // /space ~/dev/api [name]: a word that looks like a path is the folder, the rest the name.
  newSpace(arg, cx) {
    if (!arg) return (this.msg = { text: T().spaceUsage });
    const words = arg.split(/\s+/);
    const gi = words.findIndex((w) => /^gh:/i.test(w));
    const repo = gi < 0 ? null : words.splice(gi, 1)[0].slice(3);
    // owner/repo in GitHub's characters only: no leading "-" (a gh flag), no "." or ".." parts.
    if (repo && !/^[A-Za-z0-9_.][A-Za-z0-9_.-]*\/[A-Za-z0-9_.][A-Za-z0-9_.-]*$/.test(repo) || /(^|\/)\.\.?($|\/)/.test(repo ?? ""))
      return (this.msg = { text: T().badRepo(repo) });
    const i = words.findIndex((w) => /^[~/.]/.test(w));
    let folder = i < 0 ? null : words.splice(i, 1)[0].replace(/^~(?=\/|$)/, this.mhome);
    const on = this.cfg.machine ?? undefined;
    const name = words.join(" ") || (repo ? repo.split("/").pop() : null);
    const make = () => {
      this.spacesBefore = new Set(spaces().map((s) => s.id));
      // Its first tab runs the /who agent with /model and /effort, not a shell.
      run("space.new", { ...(name ? { name } : {}), ...(folder ? { folder } : {}), ...(on ? { machine: on } : {}), argv: this.argvFor() });
      this.msg = { text: T().newSpace(name ?? folder, this.cfg.who, on), ok: true };
      this.adoptNewSpace();
    };
    if (!repo) return make();
    folder ??= this.clones[repo.toLowerCase()];
    if (folder) return make();
    // Clone into ~/dev/<repo>, or ~/dev/<owner>-<repo> when that name is taken.
    this.msg = { text: T().cloning(repo, on), ok: true };
    cx.spawn(async (cx) => {
      const base = `${this.mhome}/${CLONE_DIR}`;
      const [owner, short] = repo.split("/");
      const taken = await exec("test", ["-e", `${base}/${short}`], { on });
      const dest = taken.code === 0 ? `${base}/${owner}-${short}` : `${base}/${short}`;
      const r = await exec("gh", ["repo", "clone", repo, dest], { on });
      if (r.code !== 0) { this.msg = { text: T().cloneFailed((r.stderr ?? "").trim().split("\n").pop()) }; return cx.notify(); }
      this.clones[repo.toLowerCase()] = dest;
      folder = dest;
      make();
      cx.notify();
    });
  }

  // Closes the open agent and selects its row, so ↑/↓ go on from there.
  // Herdr hands the keyboard back to the terminal as it closes, so callers focus the line after a beat.
  closePeek() {
    closeOverlay(this.peeked);
    this.peeked = null;
    const i = this.rows.findIndex((r) => r.key === this.peekedAddr);
    if (i >= 0) { this.selKey = this.peekedAddr; this.reveal(i); this.save(); }
    this.input.focus();
  }

  // The line takes the keyboard, its next text going to the selected row.
  toLine() {
    if (this.peeked) this.closePeek();
    this.confirm = null;
    const r = this.selected();
    this.msg = r?.kind === "term" ? { text: T().typingFor(r.name), color: C.dim } : null;
    this.input.focus();
  }

  // Ask before closing: the selected row, every finished agent, or every shell.
  askClose(arg = "") {
    const [first, ...rest] = arg.split(/\s+/);
    // "gewählt" is the German word for selected.
    const word = first.toLowerCase() === "gewählt" ? "selected" : first.toLowerCase();
    const which = this.options("close").find((o) => o.startsWith(word)) ?? "selected";
    if (which === "space") return this.askCloseSpace(rest.join(" "));
    const terms = this.rows.filter((r) => r.kind === "term");
    const sel = this.selected();
    const list = which === "done" ? terms.filter((r) => r.agent && r.status === "done")
      : which === "shells" ? terms.filter((r) => !r.agent)
      : this.targets();
    if (!list.length) return (this.msg = { text: which === "selected" ? T().pickAgent : which === "done" ? T().noneDone : T().noShells });
    const busy = list.filter((r) => r.agent && r.status === "working").length;
    // Closing a space's last tab closes the space too.
    const gone = [...new Set(list.map((r) => r.space))].filter((sp) => sp.tabs.every((t) => list.some((r) => r.tab === t.id)));
    const what = list.length === 1 ? list[0].name : which === "shells" ? T().nShells(list.length) : which === "done" ? T().nDone(list.length) : T().nMarked(list.length);
    this.confirm = list;
    this.msg = {
      text: T().askClose(what) + (busy ? ` ${busy === 1 && list.length === 1 ? T().busyOne : T().busyN(busy)}` : "")
        + (gone.length ? ` ${T().alsoSpace(gone.map((sp) => sp.name).join(", "))}` : "") + `  ${T().yesNo}`,
      color: busy || gone.length ? C.blocked : C.star,
    };
  }

  // A whole space, with every agent and shell in it.
  askCloseSpace(name) {
    const low = name.toLowerCase();
    const sp = name
      ? spaces().find((s) => s.name.toLowerCase() === low) ?? spaces().find((s) => s.name.toLowerCase().includes(low))
      : this.selected()?.space;
    if (!sp) return (this.msg = { text: name ? T().noSpace(name) : T().pickRow });
    const mine = this.rows.filter((r) => r.kind === "term" && r.space.id === sp.id);
    const agents = mine.filter((r) => r.agent).length;
    const busy = mine.filter((r) => r.agent && r.status === "working").length;
    this.confirm = { space: sp, rows: mine };
    this.msg = {
      text: T().askCloseSpace(sp.name, agents, mine.length - agents) + (busy ? ` ${T().busyN(busy)}` : "") + `  ${T().yesNo}`,
      color: C.blocked,
    };
  }

  // A terminal alone in its tab closes the tab; one beside others ends just itself.
  closeRows(list) {
    if (list.space) {
      run("space.close", { id: list.space.id, confirmed: true });
      if (this.cfg.where === list.space.id) { this.cfg.where = null; this.save(); }
      if (this.peeked && list.rows.some((r) => r.addr === this.peekedAddr)) { closeOverlay(this.peeked); this.peeked = null; }
      return (this.msg = { text: T().spaceClosed(list.space.name), ok: true });
    }
    const all = panes();
    for (const tab of new Set(list.map((r) => r.tab))) {
      const mine = list.filter((r) => r.tab === tab);
      const others = all.filter((p) => p.tab === tab && !mine.some((r) => r.pane === p.pane));
      if (!others.length) run("tab.close", { id: tab, confirmed: true });
      else for (const r of mine) run("terminal.kill", { terminal: r.addr });
    }
    if (this.peeked && list.some((r) => r.addr === this.peekedAddr)) { closeOverlay(this.peeked); this.peeked = null; }
    for (const r of list) this.marks.delete(r.addr);
    this.msg = { text: T().closed(list.length === 1 ? list[0].name : list.length), ok: true };
  }

  // The space /space just made becomes /where once Herdr lists it.
  adoptNewSpace() {
    if (!this.spacesBefore) return;
    const sp = spaces().find((s) => !this.spacesBefore.has(s.id));
    if (!sp) return;
    this.spacesBefore = null;
    this.cfg.where = sp.id;
    this.save();
    this.msg = { text: T().newSpaceWhere(sp.name), ok: true };
  }

  // Values a command can take, for the suggestions.
  options(cmd) {
    if (cmd === "close") return ["selected", "done", "shells", "space"];
    if (cmd === "language") return Object.keys(TEXT);
    if (cmd === "find") return FIND_WORDS;
    if (cmd === "preview") return ["on", "off"];
    if (cmd === "machine") return [T().local, ...machines().filter((m) => m.name && !m.temporary).map((m) => m.name)];
    if (cmd === "who") return (this.agentsKnown.length ? this.agentsKnown.filter((a) => a.installed).map((a) => programKey(a) ?? a.key) : ["claude", "codex"]);
    if (cmd === "where") return spaces().map((s) => s.name);
    if (cmd === "model") return this.cfg.who === "claude" ? this.models.claude.map((m) => m.label) : this.models[this.cfg.who] ?? [];
    if (cmd === "effort") return this.efforts();
    return [];
  }

  // The /who agent's effort levels; for Claude those of the /model, else of its main models.
  efforts() {
    if (this.cfg.who !== "claude") return AGENT_EFFORTS[this.cfg.who] ?? EFFORTS;
    const m = this.models.claude.find((x) => x.label === this.cfg.model || x.id === this.cfg.model);
    return m?.efforts?.length ? m.efforts : this.claudeEfforts ?? EFFORTS;
  }

  command(cmd, arg, cx) {
    const pick = (list) => list.find((o) => o.toLowerCase() === arg.toLowerCase()) ?? list.find((o) => o.toLowerCase().includes(arg.toLowerCase()));
    const set = (k, v, shown = v) => { this.cfg[k] = v; this.save(); this.msg = { text: `${cmd} → ${shown}`, ok: true }; };
    if (cmd === "new") return this.startAgent(arg);
    if (cmd === "space") return this.newSpace(arg, cx);
    if (cmd === "close") return this.askClose(arg);
    if (cmd === "yes" || cmd === "no") return this.answer(cmd === "yes" ? ["enter"] : ["esc"], cmd, cx);
    if (cmd === "answer") return arg ? this.answer(null, arg, cx) : (this.msg = { text: T().enterName(cmd) });
    if (cmd === "find") { this.filter = arg; this.top = 0; return; }
    if (cmd === "preview" && arg) {
      this.cfg.preview = !/^(off|aus|0|no)$/i.test(arg);
      this.save();
      return (this.msg = { text: this.cfg.preview ? T().previewOn : T().previewOff, ok: true });
    }
    if (cmd === "rename") {
      const r = this.selected();
      if (r?.kind !== "term") return (this.msg = { text: T().pickRow });
      const key = this.sess[r.addr]?.id ?? r.addr;
      if (arg) this.names[key] = arg; else delete this.names[key];
      this.save();
      return (this.msg = { text: arg ? T().renamed(arg) : T().autoName, ok: true });
    }
    if (cmd === "star") {
      const r = this.selected();
      if (r?.kind !== "term") return;
      this.stars = this.stars.includes(r.addr) ? this.stars.filter((s) => s !== r.addr) : [...this.stars, r.addr];
      return this.save();
    }
    if (cmd === "machine") {
      const list = this.options("machine");
      if (!arg) return (this.msg = { text: `/machine: ${list.join("  ")}` });
      const v = pick(list);
      if (!v) return (this.msg = { text: T().noComputer(arg) });
      set("machine", v === T().local ? null : v, v);
      return cx?.spawn(async (cx) => { await this.loadMachine(); cx.notify(); });
    }
    if (cmd === "preview" && !arg) { this.input.set_value("/preview "); this.text = "/preview "; return; }
    if (cmd === "language" && !arg) { this.input.set_value("/language "); this.text = "/language "; return; }
    if (cmd === "language") {
      const v = pick(this.options("language"));
      if (!v) return (this.msg = { text: `/language: ${this.options("language").join("  ")}` });
      LANG = v;
      return set("lang", v);
    }
    if (!["who", "where", "model", "effort"].includes(cmd)) return (this.msg = { text: T().unknown(cmd, COMMANDS.map((c) => `/${c}`).join(" ")) });
    // Without a value the line opens the list to pick from.
    if (!arg) {
      if (!this.options(cmd).length) return (this.msg = { text: T().enterName(cmd) });
      this.input.set_value(`/${cmd} `);
      this.text = `/${cmd} `;
      return;
    }
    if (cmd === "where") {
      if (arg === "." || arg === "-") return set("where", null, T().selectedSpace);
      const sp = spaces().find((s) => s.name.toLowerCase() === arg.toLowerCase()) ?? spaces().find((s) => s.name.toLowerCase().includes(arg.toLowerCase()));
      return sp ? set("where", sp.id, sp.name) : (this.msg = { text: T().noSpace(arg) });
    }
    if (cmd === "effort") { const e = pick(this.efforts()); return e ? set("effort", e) : (this.msg = { text: `effort: ${this.efforts().join(" ")}` }); }
    if (cmd === "model") {
      const list = this.options("model");
      const v = (list.length && pick(list)) || arg;
      // The value goes into the agent's start command, where "-x" would be an option.
      if (!SAFE_VALUE.test(v)) return (this.msg = { text: T().badValue(v) });
      set("model", v);
      // An effort the new model doesn't take falls back to its default (or medium).
      const efforts = this.efforts();
      if (!efforts.includes(this.cfg.effort)) {
        const m = this.models.claude.find((x) => x.label === this.cfg.model);
        this.cfg.effort = (this.cfg.who === "claude" && m?.effort) || (efforts.includes("medium") ? "medium" : efforts[0]);
        this.save();
        this.msg = { text: `model → ${this.cfg.model} · effort → ${this.cfg.effort}`, ok: true };
      }
      return;
    }
    if (cmd === "who") {
      const v = pick(this.options("who"));
      if (!v) return (this.msg = { text: T().badValue(arg) });
      set("who", v);
      if (v !== "claude") this.cfg.model = this.models[v]?.[0] ?? null;
      else if (!this.models.claude.some((m) => m.label === this.cfg.model)) this.cfg.model = "Opus 5.5";
      if (!this.efforts().includes(this.cfg.effort)) this.cfg.effort = this.efforts().includes("medium") ? "medium" : this.efforts()[0];
      this.save();
      this.loadQuota();
    }
  }

  submit(cx) {
    if (this.confirm && !this.text.trim()) {
      const c = this.confirm;
      this.confirm = null;
      if (c.send) { for (const x of c.send) this.send(x, c.text, cx); return; }
      if (c.answer) return this.answer(c.answer.keys, c.answer.label, cx, true);
      return this.closeRows(c);
    }
    this.confirm = null;
    const sug = this.suggestions()[this.sugI];
    // Enter takes the highlighted suggestion, except a /space path, which Enter creates as typed.
    if (sug && sug.value.trim() !== this.text.trim() && !/^\/space\s+[~/.]/.test(this.text)) return this.accept(sug, cx);
    const text = this.text.trim();
    const r = this.selected();
    this.msg = null;
    if (!text) { if (r?.kind === "term") this.peek(r.addr, cx); return; }
    this.input.set_value("");
    this.text = "";
    const m = text.match(/^\/(\w+)\s*(.*)$/);
    if (m) return this.command(m[1].toLowerCase(), m[2].trim(), cx);
    const list = this.targets();
    if (!list.length) return (this.msg = { text: T().pickAgentOrNew });
    // A shell runs what it gets, so text for one is asked about first.
    const shell = list.find((x) => !x.agent);
    if (shell) {
      this.confirm = { send: list, text };
      this.msg = { text: `${T().askShell(shell.name, text)}  ${T().yesNo}`, color: C.star };
      return;
    }
    for (const x of list) this.send(x, text, cx);
  }

  // /yes and /no press Enter (the highlighted, usually approving, choice) or Esc in each
  // blocked target; /answer types text there even though it's blocked. More than one target
  // (except /no) is asked about first, with each agent's question, and every agent is checked
  // again right before the keys go out, since its question may have changed since the refresh.
  answer(keys, label, cx, confirmed) {
    const list = this.targets();
    if (!list.length) return (this.msg = { text: T().pickAgent });
    const blocked = list.filter((r) => r.agent && r.status === "blocked");
    if (!blocked.length) return (this.msg = { text: T().notBlocked(list[0].name) });
    const shown = keys ? `/${label}` : label;
    if (blocked.length > 1 && label !== "no" && !confirmed) {
      this.confirm = { answer: { keys, label } };
      this.msg = { text: `${T().askAnswer(shown, blocked.map((r) => `${r.name}: ${r.title || "?"}`))}  ${T().yesNo}`, color: C.blocked };
      return;
    }
    cx.spawn(async (cx) => {
      const live = new Set(agents().filter((a) => a.status === "blocked").map((a) => a.address));
      const still = blocked.filter((r) => live.has(r.addr));
      for (const r of still) await hc(keys ? ["keys", r.addr, ...keys] : ["send", "--force", r.addr, "--", label]);
      this.msg = still.length ? { text: T().answered(still.length === 1 ? still[0].name : still.length, shown), ok: true } : { text: T().gaveNone };
      cx.notify();
    });
  }

  send(r, text, cx) {
    cx.spawn(async (cx) => {
      // "--": text starting with "-" stays text, not an option of hc.
      const res = await hc(["send", r.addr, "--", text]);
      this.msg = res.code === 0 ? { text: `→ ${r.name}`, ok: true } : { text: res.stderr.trim() || T().sendFailed };
      cx.notify();
    });
  }

  // What the line could become: commands, then each command's values.
  suggestions() {
    const m = this.text.match(/^\/(\w*)(\s+)?(.*)$/);
    if (!m) return [];
    if (!m[2]) return COMMANDS.filter((c) => c.startsWith(m[1].toLowerCase()))
      .map((c) => ({ label: `/${c}`, desc: T().cmd[c], value: `/${c} `, final: false }));
    const cmd = m[1].toLowerCase(), arg = m[3], low = arg.toLowerCase();
    if (cmd === "space") {
      if (!/^[~/.]/.test(arg)) {
        if (arg.includes(" ")) return [];
        const want = low.replace(/^gh:/, "");
        const folder = arg ? [] : [{ label: "~/", desc: T().pickFolder, value: "/space ~/", final: false }];
        return [...folder, ...this.repos.filter((r) => r.repo.toLowerCase().includes(want))
          .sort((a, b) => (a.repo.toLowerCase().split("/")[1].startsWith(want) ? 0 : 1) - (b.repo.toLowerCase().split("/")[1].startsWith(want) ? 0 : 1))
          .map((r) => {
            const have = this.clones[r.repo.toLowerCase()];
            return { label: `gh:${r.repo}`, desc: have ? T().already(have.replace(this.mhome, "~")) : r.desc || T().willClone(CLONE_DIR), value: `/space gh:${r.repo}`, final: true };
          })];
      }
      if (arg.includes(" ")) return [];
      return this.dirs.list.filter((d) => d.toLowerCase().startsWith(low))
        .map((d) => ({ label: d, value: `/space ${d}`, final: false }));
    }
    const cs = cmd === "close" && arg.match(/^space\s+(.*)$/i);
    if (cs) return spaces().filter((sp) => sp.name.toLowerCase().includes(cs[1].toLowerCase()))
      .sort((a, b) => (b.id === this.selected()?.space.id) - (a.id === this.selected()?.space.id))
      .map((sp) => ({ label: sp.name, desc: sp.id === this.selected()?.space.id ? T().selected : null, value: `/close space ${sp.name}`, final: true }));
    const opts = this.options(cmd);
    const starts = opts.filter((o) => o.toLowerCase().startsWith(low));
    const has = opts.filter((o) => !starts.includes(o) && o.toLowerCase().includes(low));
    const cur = { who: this.cfg.who, where: this.whereSpace()?.name, model: this.cfg.model, effort: this.cfg.effort, machine: this.cfg.machine ?? T().local, language: LANG }[cmd];
    const info = (o) => {
      const m = cmd === "model" && this.cfg.who === "claude" && this.models.claude.find((x) => x.label === o);
      return [o === cur ? T().current : null, m ? m.id : null, m?.effort ? `effort ${m.effort}` : null].filter(Boolean).join(" · ") || null;
    };
    return [...starts, ...has].map((o) => ({ label: o, desc: info(o), value: `/${cmd} ${o}`, final: true }));
  }

  // Folders under the typed path, for /space; ~ stays ~ in the list.
  loadDirs(cx) {
    const m = this.text.match(/^\/space\s+([~/.]\S*)$/);
    if (!m) return;
    const dir = m[1].slice(0, m[1].lastIndexOf("/") + 1);
    if (!dir || this.dirs.for === dir) return;
    this.dirs = { for: dir, list: [] };
    const real = dir.replace(/^~(?=\/)/, this.mhome);
    cx.spawn(async (cx) => {
      const r = await exec("sh", ["-c", 'for d in "$1"*/; do [ -d "$d" ] && printf "%s\\n" "$d"; done | head -200', "sh", real], { on: this.cfg.machine ?? undefined });
      if (this.dirs.for !== dir) return;
      this.dirs.list = (r.stdout ?? "").split("\n").filter(Boolean).map((d) => dir + d.slice(real.length));
      cx.notify();
    });
  }

  // Take the highlighted suggestion; a final value runs at once.
  accept(sug, cx) {
    if (!sug) return false;
    if (sug.final) { this.input.set_value(sug.value); this.text = sug.value; this.submit(cx); return true; }
    this.input.set_value(sug.value);
    this.text = sug.value;
    this.sugI = 0;
    this.loadDirs(cx);
    return true;
  }

  click(key, twice, cx, mark = false) {
    this.dropConfirm();
    if (mark) {
      const r = this.rows.find((x) => x.key === key && x.kind === "term");
      if (r) this.marks.has(r.addr) ? this.marks.delete(r.addr) : this.marks.add(r.addr);
      this.msg = { text: T().marked(this.marks.size), color: C.dim };
      return cx.notify();
    }
    // A space header selects its first terminal.
    const i = this.rows.findIndex((x) => x.key === key);
    if (this.rows[i]?.kind === "space") key = this.rows[i + 1]?.kind === "term" ? this.rows[i + 1].key : this.selKey;
    this.selKey = key;
    this.save();
    const r = this.rows.find((x) => x.key === key);
    if (twice && r?.kind === "term") this.peek(r.addr, cx);
    else this.input.focus();
    cx.spawn(async (cx) => { await this.refreshSelected(); cx.notify(); });
    cx.notify();
  }

  // The agent's terminal over the list, with the peek bar on top. Opened here
  // rather than with terminal.peek, so Escape knows which overlay to close.
  peek(addr, cx) {
    if (this.peeked) closeOverlay(this.peeked);
    this.peeked = openOverlay({ kind: "dialog", width: 0.8, height: 0.8, layout: { type: "column", children: [
      { type: "block", size: { px: 30 }, content: { mod: "peek", props: { terminal: addr } } },
      { type: "block", content: { terminal: addr } },
      { type: "block", size: { px: 0 }, content: { mod: "shepherd", props: { guard: addr } } },
    ] } });
    this.peekedAddr = addr;
    this.peekAt = Date.now();
    run("pane.focus", { terminal: addr });
    // Again after a beat, in case the line's focus from this same press lands later.
    cx?.timer.after(80, () => { if (this.peekedAddr === addr && this.peeked) run("pane.focus", { terminal: addr }); });
  }

  // Whether the agent window is still open: its ✕, a click beside it or its terminal ending close it without us.
  peekOpen() {
    return shared("shepherd.peek") === this.peekedAddr;
  }


  // The pixel shepherd and the four counts.
  summary(rows) {
    const terms = rows.filter((r) => r.kind === "term" && r.agent);
    const n = (s) => terms.filter((r) => r.status === s).length;
    // The cost of every session shown.
    const total = terms.reduce((sum, r) => sum + (this.cost[r.addr] ?? 0), 0);
    // Boxes widen together when a value (the cost) is longer than two characters.
    const values = [terms.length, n("working"), n("blocked"), n("done"), ...(total > 0 ? [money(total)] : [])].map(String);
    const boxW = px(55 + 14 * Math.max(0, ...values.map((v) => v.length - 2)));
    const box = (value, label, bg) => h_flex().h(px(31.4)).items_center()
      .child(div().w(boxW).flex_none().whitespace_nowrap().h_full().bg(bg).flex().items_center().justify_end().pr(px(13)).text_color("#111318").child(String(value)))
      .child(div().pl(px(14)).text_color(C.idle).child(label));
    return h_flex().flex_none().pt(px(20)).pl(px(15)).h(px(238)).items_start()
      .child(image("mods/shepherd/shepherd.svg").w(px(126)).h(px(196)).flex_none())
      .child(v_flex().pl(px(41)).pt(px(66))
        .child(box(terms.length, "agents", C.box.agents))
        .child(box(n("working"), "working", C.box.working))
        .child(box(n("blocked"), "paused", C.box.paused))
        .child(box(n("done"), "done", C.box.done))
        .when(total > 0, (el) => el.child(box(money(total), T().cost, C.box.cost))));
  }

  rowEl(r, on, now) {
    const base = h_flex().h(ROW).w_full().items_center().pl(px(15)).whitespace_nowrap().relative().when(on, (el) => el.bg(C.sel))
      // A marked row has a bar at its left edge.
      .when(Boolean(r.mark), (el) => el.child(div().absolute().left_0().top_0().w(px(4)).h_full().bg(C.mark)));
    if (r.kind === "space") {
      return base.child(div().text_color(r.color).font_semibold().child(r.label))
        .child(div().text_color(C.num).child(` · ${r.count}`));
    }
    const st = r.status;
    // The status mark and the name carry the status color, the program its own; the rest is plain text.
    // A star still shows its agent's status by its color.
    const statusColor = !r.agent ? C.shell : C[st] ?? C.idle;
    const mark = div().text_color(statusColor);
    const icon = !r.agent ? mark.child("▸")
      : r.star ? mark.child("★")
      : st === "working" ? mark.frames(SPIN, 90)
      : st === "done" ? mark.child("✔")
      : st === "blocked" ? mark.child("‖")
      : mark.child("●");
    const right = (w, text) => div().w(w * CH).flex_none().text_right().child(text ?? "");
    const progColor = r.program === "terminal" ? C.terminal : PROGRAM_COLORS[r.program] ?? C.plus;
    return base.text_color(C.text)
      .child(right(2, num(r.addr)))
      .child(div().w(3.5 * CH).flex_none())
      .child(div().w(CH).flex_none().child(icon))
      .child(div().w(0.55 * CH).flex_none())
      .child(div().w(30 * CH).flex_none().truncate().when(r.agent, (el) => el.text_color(statusColor)).child(r.name))
      .child(div().w(3 * CH).flex_none().child(r.kids ? `+${r.kids}` : ""))
      .child(div().w(10 * CH).flex_none().pr(CH).truncate().child(r.space?.machine ?? T().local))
      .child(right(4, r.agent && r.changed ? ago(now - r.changed) : ""))
      .child(right(5, r.created ? ago(now - r.created) : ""))
      .child(div().w(1.1 * CH).flex_none())
      .child(div().w(9 * CH).flex_none().text_color(progColor).child(r.program))
      .child(div().flex_1().min_w(0).truncate().child(r.title || ""));
  }

  // Only the rows that fit are drawn; the wheel and the selection move the window.
  // The selected row's last screen lines, under the list.
  preview(sel) {
    const lines = sel?.kind === "term" ? this.screen[sel.addr] : null;
    if (!this.cfg.preview || !lines?.length) return null;
    // Fixed height that never gives way, so a short window does not squash the lines.
    return v_flex().flex_none().h(PREVIEW_LINES * 17 + 12).min_h(PREVIEW_LINES * 17 + 12).px(px(15)).py(6).border_t(1).border_color(C.line)
      .text_size(12).text_color(C.dim).overflow_hidden()
      .children(lines.map((l) => div().flex_none().h(17).line_height("17px").whitespace_nowrap().truncate().child(l || " ")));
  }

  list(rows, sel, now) {
    const fit = Math.max(1, Math.floor(this.listH / ROW));
    this.top = Math.max(0, Math.min(this.top, Math.max(0, rows.length - fit)));
    const shown = rows.slice(this.top, this.top + fit + 1);
    const thumb = rows.length > fit ? { h: Math.max(24, (this.listH * fit) / rows.length), y: (this.listH * this.top) / rows.length } : null;
    return div().id("list").flex_1().min_h(0).relative().overflow_hidden()
      .on_size_change((size, cx) => { this.listH = size.height; cx.notify(); })
      .on_scroll_wheel((e, cx) => { if (this.scrollBy(e.delta_lines ? e.delta_lines.y * ROW : e.delta.y)) cx.notify(); })
      .children(shown.map((r) => this.rowEl(r, r.key === sel?.key, now).id(`row-${r.key}`)
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.click(r.key, e.click_count >= 2, cx, e.modifiers?.platform); })
        .on_mouse_down("right", (_e, cx) => { this.dropConfirm(); this.selKey = r.key; this.command("star", ""); cx.notify(); })))
      .when(Boolean(thumb), (el) => el.child(div().absolute().right(px(4)).top(thumb.y).w(px(5)).h(thumb.h).rounded(3).bg(C.line)));
  }

  // What a new agent gets, and the selected session's context, cache and quota.
  footer(sel, now) {
    const kv = (k, v, color = C.text) => h_flex().gap(px(9)).child(div().text_color(C.dim).child(k)).child(div().text_color(color).child(v ?? "—"));
    const where = this.cfg.where ? this.whereSpace()?.name : `${this.whereSpace()?.name ?? "—"}`;
    const ctx = sel?.kind === "term" ? this.ctx[sel.addr] : null;
    const pctColor = (p) => (p >= 80 ? C.blocked : p >= 60 ? C.star : C.done);
    const left = ctx?.cacheUntil ? ctx.cacheUntil - now : null;
    // Quota of the selected agent when its kind has one, else of the /who agent.
    const qKind = sel?.kind === "term" && sel.agent && this.quota[sel.program] ? sel.program : this.cfg.who;
    const q = this.quota[qKind];
    const sugs = this.suggestions();
    const si = Math.min(this.sugI, Math.max(0, sugs.length - 1));
    const first = Math.max(0, Math.min(si - 3, sugs.length - 7));
    const placeholder = this.marks.size ? T().taskForMarked(this.marks.size) : sel?.kind === "term" ? T().taskFor(sel.name) : T().newIn(this.cfg.who, where);
    return v_flex().flex_none().border_t(1).border_color(C.line).px(px(15)).pt(px(10)).pb(px(14)).gap(px(8))
      .when(sugs.length > 0, (el) => el.child(v_flex().flex_none().text_size(14)
        .children(sugs.slice(first, first + 7).map((g, j) => h_flex().id(`sug-${first + j}`).h(px(26)).px(px(10)).gap(px(16)).items_center().rounded(4).cursor_pointer()
          .when(first + j === si, (el) => el.bg(C.sel))
          .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.accept(g, cx); this.input.focus(); cx.notify(); })
          .child(div().flex_none().text_color(first + j === si ? C.text : C.title).child(g.label))
          .when(Boolean(g.desc), (el) => el.child(div().text_color(C.dim).truncate().child(g.desc)))))
        .child(div().h(px(18)).px(px(10)).text_size(12).text_color(C.dim)
          .child(`${T().sugHint(sugs[si]?.final)}${sugs.length > 7 ? ` · ${si + 1}/${sugs.length}` : ""}`))))
      .when(!sugs.length && !this.msg && Boolean(this.filter), (el) => el.child(h_flex().h(ROW).flex_none().items_center().text_color(C.dim).truncate()
        .child(T().filter(this.filter, this.rows.filter((r) => r.kind === "term").length))))
      .when(!sugs.length && Boolean(this.msg), (el) => el.child(h_flex().h(ROW).flex_none().items_center().text_color(this.msg.color ?? (this.msg.ok ? C.done : C.blocked)).truncate().child(this.msg.text)))
      .child(h_flex().id("line").h(ROW).items_center().gap(px(14)).cursor_text()
        .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.input.focus(); })
        .child(div().text_color(this.typing ? SPACE_COLORS[0] : C.dim).font_semibold().child("›"))
        .child(div().flex_1().relative().h_full().flex().items_center()
          .when(!this.text, (el) => el.child(div().absolute().left_0().text_color(C.dim).truncate()
            .child(this.typing ? placeholder : T().clickToType)))
          .child(Input.new(this.input).w_full().h_full().text_color(C.text).font_family(FONT).text_size(15))))
      .child(h_flex().gap(px(28)).text_size(13)
        .child(kv("machine", this.cfg.machine ?? T().local, this.cfg.machine ? SPACE_COLORS[2] : C.text))
        .child(kv("where", where + (this.cfg.where ? "" : " ·sel"), SPACE_COLORS[1]))
        .child(kv("who", this.cfg.who, PROGRAM_COLORS[this.cfg.who] ?? C.plus))
        .child(kv("model", this.cfg.model ?? "default"))
        .child(kv("effort", this.cfg.effort)))
      .child(h_flex().gap(px(28)).text_size(13)
        .child(kv("ctx", ctx?.used != null ? (ctx.size ? `${tokens(ctx.used)} / ${tokens(ctx.size)}  ${Math.round(ctx.pct)}%` : tokens(ctx.used)) : "—", ctx?.pct != null ? pctColor(ctx.pct) : C.text))
        .child(kv("cache", left == null ? "—" : left > 60000 ? T().cacheLeft(Math.floor(left / 60000)) : left > 0 ? T().cacheLt1 : T().expired, left > 0 ? C.done : C.blocked))
        .children((q?.windows ?? []).filter(([, w]) => w?.used_percentage != null).map(([k, w]) =>
          kv(k, `${Math.round(w.used_percentage)}%${w.resets_at ? `  ↻ ${clock(w.resets_at)}` : ""}`, pctColor(w.used_percentage))))
        .when(!q, (el) => el.child(kv("quota", T().noQuota(qKind), C.dim)))
        .when(sel?.kind === "term" && this.cost[sel.addr] != null, (el) => el.child(kv(T().cost, money(this.cost[sel?.addr] ?? 0))))
        // Herdr's settings, far right.
        .child(div().flex_1())
        .child(div().id("settings").flex_none().p(px(3)).rounded(4).cursor_pointer().text_color(C.dim)
          .hover((st) => st.text_color(C.text).bg(C.sel))
          .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); run("app.settings"); })
          .child(svg("mods/shepherd/settings.svg").size(16))));
  }

  // Opens (or, with the same key, resizes) the window over this block.
  place(size) {
    const w = Math.round(size.width), h = Math.round(size.height);
    // Window coordinates start above the system title bar (28 px on macOS, full screen too).
    const win = window();
    const top = win.titlebar === "system" && win.platform === "macos" ? 28 : 0;
    if (this.size?.w === w && this.size?.h === h && this.size.top === top) return;
    this.size = { w, h, top };
    // Reopening by the same key would keep the old spot: close it first.
    // A window key keeps the spot it first opened at, so each size gets its own;
    // a reload of the same size finds and replaces its window.
    // The last window, also one a previous build of this mod opened.
    const old = shared("shepherd.window");
    if (old) closeOverlay(old);
    this.win = openOverlay({ mod: "shepherd", kind: "window", key: `shepherd-${w}x${h}+${top}`, frame: "none", width: w, height: h, at: { x: 0, y: top } });
  }

  async close() {
    if (this.guard && shared("shepherd.peek") === props().guard) setShared("shepherd.peek", null);
    if (this.host && shared("shepherd.window")) closeOverlay(shared("shepherd.window"));
  }

  render(cx) {
    if (this.guard) return div();
    if (this.host) return div().id("host").size_full().bg(C.bg).on_size_change((size) => this.place(size));
    const now = Date.now();
    const rows = (this.rows = this.buildRows());
    const sel = this.selected();
    return v_flex().id("shepherd").size_full().bg(C.bg).text_color(C.text)
      .font_family(FONT).text_size(15)
      .on_key_down((e, cx) => {
        const k = e.key;
        const sugs = this.suggestions();
        if (sugs.length && (k === "up" || k === "down")) this.sugI = (this.sugI + (k === "up" ? -1 : 1) + sugs.length) % sugs.length;
        else if (k === "up") this.move(-1, cx, e.modifiers.shift);
        else if (k === "down") this.move(1, cx, e.modifiers.shift);
        else if (k === "pageup") this.move(-15, cx);
        else if (k === "pagedown") this.move(15, cx);
        else if (k === "backspace" && e.modifiers.platform && !this.text) this.askClose();
        else if (k === "enter" && e.modifiers.platform) this.toLine();
        else if (k === "tab") this.accept(sugs[this.sugI] && { ...sugs[this.sugI], final: false }, cx);
        else if (k === "escape") { if (this.confirm) { this.confirm = null; this.msg = null; } else this.escape(); }
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.input.focus(); })
      .child(this.summary(rows))
      .child(this.list(rows, sel, now))
      .children([this.preview(sel)].filter(Boolean))
      .child(this.footer(sel, now));
  }
}
