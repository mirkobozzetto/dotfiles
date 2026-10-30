// What to reopen and how, from herdr-core's records of finished terminals.
// Pure functions (no "herdr" imports), so `node --test` can check them.

/** Terminals of one tab that end this close apart still count as one close
 *  (core kills a tab's terminals one by one; a stubborn one takes seconds). */
export const SAME_CLOSE_MS = 15000;

/** At most this many closes are offered, newest first (like a browser). */
export const DEPTH = 25;

/**
 * How a reopened agent picks up its last conversation in that folder.
 * `session`: the command already names one (rerun it, minus its first task).
 * `skip`: a one-shot or help run: rerun exactly as it was.
 * Remove an entry to start that agent fresh instead.
 */
export const RESUME = {
  claude: {
    session: ["-c", "--continue", "-r", "--resume", "--session-id", "--from-pr"],
    skip: ["-p", "--print", "-h", "--help", "-v", "--version"],
    resume: (cmd) => [...cmd, "--continue"],
  },
  codex: {
    session: ["resume"],
    skip: ["-h", "--help", "-V", "--version"],
    resume: (cmd) => [cmd[0], "resume", "--last", ...cmd.slice(1)],
  },
};

const SHELLS = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh", "mksh", "tcsh", "csh", "nu", "xonsh", "elvish", "pwsh", "powershell", "cmd"]);

/** A program's name without its folder or Windows extension. */
export function base(path) {
  return String(path || "").split(/[\\/]/).pop().replace(/\.(exe|cmd|bat)$/i, "");
}

/** `vps/t7` -> "vps"; `t7` -> null (this computer). */
export function machineOf(address) {
  const i = String(address).indexOf("/");
  return i < 0 ? null : address.slice(0, i);
}

/** Labels hold ids local to their machine; the app shows other machines' ids as `machine/id`. */
export function qualify(id, machine) {
  return machine ? `${machine}/${id}` : id;
}

/**
 * Splits a recorded argv into the shell Herdr wrapped an agent in and the agent's command.
 * Herdr starts agents as `[sh, -ic|-c, '"$@"; exec "$0" -i', sh, ...cmd]` (fish and other
 * machines use their own script of the same shape). `cmd` is null for a plain shell.
 */
export function unwrap(argv) {
  const a = Array.isArray(argv) ? argv : [];
  if (a.length >= 4 && (a[1] === "-ic" || a[1] === "-c") && /exec .*-i$/.test(a[2] || "")) {
    const cmd = a.slice(4);
    return { shell: a.slice(0, 4), cmd: cmd.length ? cmd : null };
  }
  if (!a.length || (SHELLS.has(base(a[0])) && a.slice(1).every((x) => x.startsWith("-")))) return { shell: a, cmd: null };
  return { shell: null, cmd: a };
}

/** The command a reopened pane runs: the same one, with agents resuming instead of starting over. */
export function agentCommand(cmd, rules = RESUME) {
  if (!cmd || !cmd.length) return cmd;
  const rule = rules[base(cmd[0])];
  if (!rule) return cmd;
  const args = cmd.slice(1);
  if (args.some((a) => rule.skip.includes(a))) return cmd;
  // Herdr appends a first message (task) as the last argument: don't send it twice.
  const last = cmd[cmd.length - 1];
  const bare = cmd.length > 1 && !last.startsWith("-") && /\s/.test(last) ? cmd.slice(0, -1) : cmd;
  const rest = bare.slice(1);
  if (rest.some((a) => rule.session.includes(a))) return bare;
  // A word that is neither a flag nor a flag's value is a subcommand (`claude doctor`).
  const word = rest.some((a, i) => !a.startsWith("-") && !(i > 0 && rest[i - 1].startsWith("-") && !rest[i - 1].includes("=")));
  return word ? cmd : rule.resume(bare);
}

const CD = 'cd -- "$1" 2>/dev/null; shift; [ $# -gt 0 ] && exec "$@"; exec "${SHELL:-sh}" -i';

/** Where a pane started and what it ran, with this mod's own split wrapper (`sh -c CD sh <folder> ...`) taken off. */
export function start(record) {
  let argv = Array.isArray(record?.argv) ? record.argv : [];
  let folder = record?.cwd || null;
  while (argv.length >= 5 && argv[0] === "sh" && argv[1] === "-c" && argv[2] === CD) {
    folder = argv[4];
    argv = argv.slice(5);
  }
  return { folder, argv };
}

/**
 * The argv for `pane.split`, which runs argv as given in the split pane's folder:
 * the pane's own command, started in its own folder. Null: the default shell there.
 */
export function splitArgv(record, resume = RESUME) {
  const { folder, argv } = start(record);
  const { shell, cmd } = unwrap(argv);
  const next = cmd && agentCommand(cmd, resume);
  const raw = next ? (shell ? [...shell, ...next] : next) : shell && shell.length ? shell : null;
  const windows = [argv[0], raw?.[0]].some((p) => /\.exe$|\\/i.test(p || ""));
  if (windows || !folder) return raw;
  return ["sh", "-c", CD, "sh", folder, ...(raw || [])];
}

/** The agent command for `tab.new`/`space.new` (Herdr wraps it in the shell itself), or null for a shell. */
export function tabArgv(record, resume = RESUME) {
  const { cmd } = unwrap(start(record).argv);
  return cmd ? agentCommand(cmd, resume) : null;
}

/** "Space / Tab" from Herdr's `where` label; the space part is known when the space is still open. */
export function names(where, spaceName) {
  const w = String(where || "");
  if (spaceName && w.startsWith(spaceName + " / ")) return { space: spaceName, tab: w.slice(spaceName.length + 3) };
  const i = w.indexOf(" / ");
  return i < 0 ? { space: w, tab: "" } : { space: w.slice(0, i), tab: w.slice(i + 3) };
}

/** A tab nobody named is called by its position ("2"): reopen it unnamed. */
export function tabName(name) {
  return /^\d+$/.test(name || "") ? "" : name || "";
}

/**
 * Closed tabs, newest first. `records`: `hc get --json` of finished terminals.
 * `open`: ids (machine-qualified) of tabs Herdr shows now; `reopened`: tab ids already reopened;
 * `born`: when a reopened tab was first made (its new id -> ms), so it keeps its place.
 */
export function closedTabs(records, open, reopened, born = {}) {
  const tabs = new Map();
  for (const r of records) {
    const l = r?.labels || {};
    if (r?.state !== "finished" || r.reason !== "killed" || !l["herdr.tab"] || !l["herdr.space"]) continue;
    const machine = machineOf(r.address);
    const tab = qualify(l["herdr.tab"], machine);
    if (open.has(tab) || reopened.has(tab)) continue;
    let g = tabs.get(tab);
    if (!g) tabs.set(tab, (g = { tab, space: qualify(l["herdr.space"], machine), machine, where: "", terminals: [], closed: 0 }));
    g.terminals.push(r);
    g.closed = Math.max(g.closed, r.finished_ms || 0);
  }
  const out = [];
  for (const g of tabs.values()) {
    // A pane closed earlier in that tab stays closed.
    g.terminals = g.terminals.filter((t) => (t.finished_ms || 0) >= g.closed - SAME_CLOSE_MS).sort((a, b) => (a.created_ms || 0) - (b.created_ms || 0));
    // Herdr re-adopts a terminal that outlives its tab's close and relabels it ("Space / 7"):
    // the pane that died first still carries the names the tab had.
    const first = g.terminals.reduce((a, b) => ((b.finished_ms || 0) < (a.finished_ms || 0) ? b : a));
    g.where = first.labels.where || "";
    g.died = first.finished_ms || 0;
    g.created = born[g.tab] ?? (g.terminals[0]?.created_ms || 0);
    out.push(g);
  }
  return out.sort((a, b) => b.closed - a.closed).slice(0, DEPTH);
}

/**
 * The next thing Cmd+Shift+T brings back: the newest closed tab, into its space when that is
 * open (or was reopened: `moved` maps old space ids to new ones), else its whole space with
 * every tab closed along with it.
 */
export function nextClose(tabs, openSpaces, moved = {}, tab = null) {
  const newest = tab ? tabs.find((g) => g.tab === tab) : tabs[0];
  if (!newest) return null;
  const target = openSpaces.has(newest.space) ? newest.space : openSpaces.has(moved[newest.space]) ? moved[newest.space] : null;
  if (target) return { space: target, oldSpace: newest.space, machine: newest.machine, tabs: [newest], newSpace: false };
  const together = tabs.filter((g) => g.space === newest.space && Math.abs(g.closed - newest.closed) <= SAME_CLOSE_MS).sort((a, b) => a.created - b.created);
  // The space's name, from the tab that died first (see closedTabs).
  const where = together.reduce((a, b) => (b.died < a.died ? b : a)).where;
  return { space: null, oldSpace: newest.space, machine: newest.machine, where, tabs: together, newSpace: true };
}

/**
 * Where a reopened tab goes among its space's tabs (1 = first): before the first open tab that
 * was made after it. `open`: that space's tabs in order, each `{ created }` (ms, or null for a
 * tab of mods only). Null: at the end.
 */
export function position(open, created) {
  const i = open.findIndex((t) => t.created != null && t.created > created);
  return i < 0 ? null : i + 1;
}


/** Remembered across presses: tabs already reopened, where a reopened space went (old id -> new id),
 *  and when each reopened tab was first made (new id -> ms). */
export const KEEP = 200;

export function readLedger(text) {
  try {
    const l = JSON.parse(text || "{}");
    const map = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
    return { tabs: Array.isArray(l.tabs) ? l.tabs : [], spaces: map(l.spaces), born: map(l.born) };
  } catch (_) {
    return { tabs: [], spaces: {}, born: {} };
  }
}

export function addToLedger(ledger, change) {
  const tabs = [...ledger.tabs, ...(change.tabs || [])].slice(-KEEP);
  const keep = (old, add) => Object.fromEntries(Object.entries({ ...old, ...(add || {}) }).slice(-KEEP));
  return { tabs, spaces: keep(ledger.spaces, change.spaces), born: keep(ledger.born || {}, change.born) };
}

/** The panes of a closed tab, left to right, as they come back. */
export function panesOf(close, resume = RESUME) {
  return close.terminals.map((t) => ({ terminal: t.address, folder: start(t).folder, command: tabArgv(t, resume) }));
}

/** A closed tab as agents see it (`list`): what comes back if it is reopened. */
export function describe(close, resume = RESUME) {
  const where = names(close.where);
  return {
    tab: close.tab,
    space: close.space,
    machine: close.machine,
    name: tabName(where.tab) || null,
    space_name: where.space || null,
    closed_at: close.closed ? new Date(close.closed).toISOString() : null,
    panes: panesOf(close, resume),
  };
}
