/**
 * Ctrl+P model configurator for OMP.
 *
 * Serves a local page listing the models `Ctrl+P` cycles through, the thinking
 * effort attached to each, and the roles OMP drives itself (`plan`, `commit`,
 * `advisor`, `agents`, ...). Every role is editable, including built-in ones
 * that ship without an explicit model.
 *
 * Edits save themselves: each change rewrites the `modelRoles` and `cycleOrder`
 * blocks and nothing else, so comments and unrelated settings survive byte for
 * byte. The first write of a session copies the file to a single rolling
 * `config.yml.bak`, so backups never pile up.
 *
 * Models whose provider has no stored credential are flagged, because OMP
 * accepts them in the config and only fails when the role is used.
 *
 * OMP loads settings once at startup and exposes no reload hook, so the page
 * says a new session is needed.
 *
 * `/models` opens the page; it also opens once on interactive session start.
 */

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

/**
 * Finds the agent directory that holds `config.yml`, whichever way this file was
 * installed: dropped into `<agent dir>/extensions/`, or shipped as a marketplace
 * plugin, where the module lives under the plugin cache instead. Candidates are
 * probed, never assumed, so no user name or OS is hardcoded.
 */
function resolveAgentDir(): string {
	const fallback = path.join(os.homedir(), ".omp", "agent");
	const candidates = [path.dirname(import.meta.dir), fallback];
	const xdg = process.env.XDG_DATA_HOME;
	if (xdg) candidates.push(path.join(xdg, "omp", "agent"));
	for (const dir of candidates) {
		if (existsSync(path.join(dir, "config.yml"))) return dir;
	}
	return fallback; // fresh install: the file is created on the first save
}

const AGENT_DIR = resolveAgentDir();
const CONFIG_PATH = path.join(AGENT_DIR, "config.yml");
const AGENT_DB = path.join(AGENT_DIR, "agent.db");
/** Single rolling backup, rewritten once per session: never a pile of stamped files. */
const BACKUP_PATH = `${CONFIG_PATH}.bak`;
const PORT = 8931;

/** Opens a URL with the platform's own launcher; macOS, Windows and Linux differ. */
function openPage(url: string): void {
	const argv =
		process.platform === "darwin"
			? ["open", url]
			: process.platform === "win32"
				? ["cmd", "/c", "start", "", url]
				: ["xdg-open", url];
	try {
		Bun.spawn(argv, { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref();
	} catch {
		// no launcher on this box: the notify message still carries the URL
	}
}

/** Roles OMP resolves on its own: valid cycle entries even with no `modelRoles` line. */
const BUILTIN_ROLES = new Set([
	"default",
	"smol",
	"slow",
	"vision",
	"plan",
	"designer",
	"commit",
	"tiny",
	"task",
	"advisor",
]);

interface CatalogEntry {
	selector: string;
	provider: string;
	name: string;
	efforts: string[];
	context: number;
	images: boolean;
	authed: boolean;
}

interface RoleRow {
	role: string;
	selector: string;
	effort: string;
	builtin: boolean;
}

interface SavePayload {
	cycle: RoleRow[];
	others: RoleRow[];
}

let catalogCache: CatalogEntry[] = [];
let server: { stop: () => void } | undefined;
let sessionBackup: string | undefined;
let pageUrl = "";

function readBlocks(text: string): { roles: Map<string, string>; cycle: string[] } {
	const roles = new Map<string, string>();
	const cycle: string[] = [];
	let section = "";
	for (const line of text.split("\n")) {
		if (/^[A-Za-z_$]/.test(line)) {
			section = line.split(":")[0] ?? "";
			continue;
		}
		if (section === "modelRoles") {
			const match = /^ {2}([\w-]+):\s*(\S.*?)\s*$/.exec(line);
			if (match?.[1] && match[2]) roles.set(match[1], match[2]);
		} else if (section === "cycleOrder") {
			const match = /^ {2}-\s*(\S+)\s*$/.exec(line);
			if (match?.[1]) cycle.push(match[1]);
		}
	}
	return { roles, cycle };
}

/** Reads the config, tolerating a fresh install where the file does not exist yet. */
async function readConfigText(): Promise<string> {
	const file = Bun.file(CONFIG_PATH);
	return (await file.exists()) ? file.text() : "";
}

function writeBlocks(text: string, roles: Map<string, string>, cycle: string[]): string {
	const lines = text.split("\n");
	const out: string[] = [];
	let sawRoles = false;
	let sawCycle = false;
	let i = 0;
	while (i < lines.length) {
		const line = lines[i] ?? "";
		const head = /^[A-Za-z_$]/.test(line) ? line.split(":")[0] : undefined;
		if (head === "modelRoles" || head === "cycleOrder") {
			out.push(line);
			i += 1;
			while (i < lines.length && !/^[A-Za-z_$]/.test(lines[i] ?? "")) i += 1;
			if (head === "modelRoles") {
				sawRoles = true;
				for (const [role, value] of roles) out.push(`  ${role}: ${value}`);
			} else {
				sawCycle = true;
				for (const role of cycle) out.push(`  - ${role}`);
			}
			continue;
		}
		out.push(line);
		i += 1;
	}

	// a config that never mentioned these keys gets them appended, otherwise
	// saving would be a silent no-op on a fresh install
	const added: string[] = [];
	if (!sawRoles) {
		added.push("modelRoles:", ...[...roles].map(([role, value]) => `  ${role}: ${value}`));
	}
	if (!sawCycle) {
		added.push("cycleOrder:", ...cycle.map(role => `  - ${role}`));
	}
	let result = out.join("\n");
	if (added.length > 0) {
		if (result.length > 0 && !result.endsWith("\n")) result += "\n";
		result += `${added.join("\n")}\n`;
	}
	return result;
}

/** `deepseek/deepseek-v4-pro:high` splits into selector plus effort; a bare selector keeps none. */
function splitEffort(value: string): { selector: string; effort: string } {
	const cut = value.lastIndexOf(":");
	if (cut > 0 && !value.slice(cut + 1).includes("/")) {
		return { selector: value.slice(0, cut), effort: value.slice(cut + 1) };
	}
	return { selector: value, effort: "" };
}

function authedProviders(): Set<string> {
	try {
		const db = new Database(AGENT_DB, { readonly: true });
		const rows = db.query("select distinct provider from auth_credentials").all() as Array<{
			provider: string;
		}>;
		db.close();
		return new Set(rows.map(row => row.provider));
	} catch {
		return new Set(); // no store readable: flag nothing rather than lie
	}
}

function buildCatalog(ctx: ExtensionContext): CatalogEntry[] {
	const authed = authedProviders();
	return ctx.models.list().map(model => {
		// the catalog Model is structurally stable but its type is not exported to extensions
		const record = model as unknown as {
			id: string;
			name?: string;
			provider: string;
			thinking?: string[] | { efforts?: string[] } | null;
			contextWindow?: number;
			input?: string[];
		};
		const thinking = record.thinking;
		let efforts: string[] = [];
		if (Array.isArray(thinking)) {
			efforts = thinking;
		} else if (thinking && Array.isArray(thinking.efforts)) {
			efforts = thinking.efforts;
		}
		return {
			selector: `${record.provider}/${record.id}`,
			provider: record.provider,
			name: record.name ?? "",
			efforts,
			context: record.contextWindow ?? 0,
			images: (record.input ?? []).includes("image"),
			authed: authed.size === 0 || authed.has(record.provider),
		};
	});
}

async function statePayload(): Promise<unknown> {
	const { roles, cycle } = readBlocks(await readConfigText());
	const cycleRows: RoleRow[] = cycle.map(role => ({
		role,
		...splitEffort(roles.get(role) ?? ""),
		builtin: BUILTIN_ROLES.has(role),
	}));
	const otherRows: RoleRow[] = [];
	for (const [role, value] of roles) {
		if (!cycle.includes(role)) {
			otherRows.push({ role, ...splitEffort(value), builtin: BUILTIN_ROLES.has(role) });
		}
	}
	return {
		config: CONFIG_PATH,
		cycle: cycleRows,
		others: otherRows,
		catalog: catalogCache,
		backup: sessionBackup,
	};
}

async function saveConfig(payload: SavePayload): Promise<unknown> {
	const text = await readConfigText();
	const roles = new Map<string, string>();
	const cycle: string[] = [];

	for (const row of [...payload.cycle, ...payload.others]) {
		const role = row.role.trim();
		const selector = row.selector.trim();
		const effort = row.effort.trim();
		if (!/^[\w-]+$/.test(role)) return { ok: false, error: `invalid role name: "${role}"` };
		if (selector) {
			if (!selector.includes("/")) {
				return { ok: false, error: `invalid model: "${selector}", expected provider/model-id` };
			}
			if (roles.has(role)) return { ok: false, error: `role "${role}" appears twice` };
			roles.set(role, effort ? `${selector}:${effort}` : selector);
		} else if (!BUILTIN_ROLES.has(role)) {
			return { ok: false, error: `"${role}" has no model and is not a built-in role` };
		}
	}
	for (const row of payload.cycle) {
		const role = row.role.trim();
		if (cycle.includes(role)) return { ok: false, error: `"${role}" is twice in the cycle` };
		cycle.push(role);
	}
	if (cycle.length === 0) return { ok: false, error: "the cycle would be empty" };

	const updated = writeBlocks(text, roles, cycle);
	if (updated === text) return { ok: true, unchanged: true, cycle, backup: sessionBackup };
	if (!sessionBackup) {
		await Bun.write(BACKUP_PATH, text);
		sessionBackup = path.basename(BACKUP_PATH);
	}
	await Bun.write(CONFIG_PATH, updated);
	return { ok: true, cycle, backup: sessionBackup };
}

const PAGE = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Ctrl+P models - OMP</title>
<style>
:root { color-scheme: dark; --bg:#16161e; --panel:#1a1b26; --line:#2a2b3d; --hair:#22232f;
        --fg:#c0caf5; --dim:#565f89; --acc:#7aa2f7; --ok:#9ece6a; --err:#f7768e; --warn:#e0af68;
        --radius:10px; }
* { box-sizing:border-box; }
body { margin:0; padding:28px 32px 72px; background:var(--bg); color:var(--fg);
       font:13.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; }
.head { display:flex; align-items:baseline; justify-content:space-between; gap:20px; }
h1 { font-size:17px; margin:0; letter-spacing:-.01em; }
h2 { font-size:11px; margin:0 0 10px; color:var(--acc); font-weight:700;
     text-transform:uppercase; letter-spacing:.1em; }
.path { color:var(--dim); font-size:12px; margin:6px 0 14px; }
.note { border-left:2px solid var(--warn); padding:8px 0 8px 12px; margin:0 0 24px;
        color:var(--dim); font-size:12px; max-width:840px; }
.note b { color:var(--warn); font-weight:600; }
section { margin-bottom:28px; }
.panel { background:var(--panel); border:1px solid var(--line); border-radius:var(--radius);
         padding:4px 2px; }
table { width:100%; border-collapse:separate; border-spacing:0; }
th { text-align:left; font-weight:600; color:var(--dim); font-size:10.5px; letter-spacing:.08em;
     padding:9px 14px; text-transform:uppercase; border-bottom:1px solid var(--hair); }
td { padding:7px 14px; border-bottom:1px solid var(--hair); vertical-align:middle; }
tr:last-child td { border-bottom:none; }
input, select { background:#13141c; color:var(--fg); border:1px solid var(--line);
                border-radius:7px; padding:6px 9px; font:inherit; height:33px; width:100%; }
input:focus, select:focus { outline:none; border-color:var(--acc); }
input::placeholder { color:#3b4261; }
button { background:transparent; color:var(--dim); border:1px solid transparent;
         border-radius:7px; padding:0 11px; height:31px; font:inherit; cursor:pointer;
         transition:border-color .12s, color .12s; white-space:nowrap; }
button:hover { border-color:var(--acc); color:var(--fg); }
button.step { width:31px; padding:0; }
button.solid { background:#20222f; color:var(--fg); border-color:var(--line); }
.actions { display:flex; gap:8px; justify-content:flex-end; flex-wrap:nowrap; }
.hint { margin:12px 14px 8px; color:var(--dim); font-size:11.5px; line-height:1.65; }
.addbar { display:flex; gap:10px; align-items:center; margin-top:14px; }
.addbar input { width:340px; }
.tag { font-size:11px; color:var(--dim); }
.tag.no { color:var(--err); }
.filterbar { display:flex; gap:14px; align-items:center; padding:10px 14px 6px; }
.filterbar input { width:320px; }
.scroll { max-height:312px; overflow:auto; }
.scroll th { position:sticky; top:0; background:var(--panel); z-index:1; }
#status { font-size:12px; color:var(--dim); white-space:nowrap; }
#status.ok { color:var(--ok); } #status.err { color:var(--err); }
code { color:var(--acc); }
</style></head>
<body>
<div class="head">
  <h1>Models cycled by Ctrl+P</h1>
  <span id="status">loading</span>
</div>
<p class="path">File <code id="cfgpath"></code></p>
<p class="note"><b>Saved as you type.</b> OMP reads its settings once, at startup, and exposes no reload
hook, so the running session keeps the old cycle: open a new OMP session, or restart the terminal, to use
these. The first change of a session copies the file to <code id="bak">config.yml.bak</code>.</p>

<section>
  <h2>The cycle</h2>
  <div class="panel"><table id="cycle"><thead><tr>
    <th style="width:170px">role</th><th>model</th><th style="width:130px">effort</th>
    <th style="width:250px"></th></tr></thead><tbody></tbody></table>
    <p class="hint">The role name is the label Ctrl+P shows. On a built-in role, an empty model keeps
    the OMP default; type a model to pin it.</p>
  </div>
  <div class="addbar">
    <input type="text" id="custom" placeholder="custom model: provider/model-id">
    <button class="solid" id="addcustom">Add to cycle</button>
  </div>
</section>

<section>
  <h2>Roles outside the cycle</h2>
  <div class="panel"><table id="others"><thead><tr>
    <th style="width:170px">role</th><th>model</th><th style="width:130px">effort</th>
    <th style="width:250px"></th></tr></thead><tbody></tbody></table>
    <p class="hint">OMP drives these itself: <code>plan</code> in plan mode, <code>commit</code> for
    commit messages, <code>advisor</code> for the reviewer, <code>agents</code> for subagents,
    <code>tiny</code> for short internal calls, <code>slow</code> for --slow.</p>
  </div>
</section>

<section>
  <h2>Catalogue</h2>
  <div class="panel">
    <div class="filterbar">
      <input type="text" id="filter" placeholder="filter by name, provider or id">
      <span class="tag" id="count"></span>
    </div>
    <div class="scroll"><table id="catalog"><thead><tr>
      <th>model</th><th style="width:100px">context</th><th style="width:210px">efforts</th>
      <th style="width:80px">images</th><th style="width:90px"></th></tr></thead><tbody></tbody></table></div>
  </div>
</section>

<script>
let state = { config: '', cycle: [], others: [], catalog: [], backup: null };
let timer = null;
let inFlight = false;

async function load() {
  state = await (await fetch('/api/state')).json();
  document.getElementById('cfgpath').textContent = state.config;
  if (state.backup) document.getElementById('bak').textContent = state.backup;
  render();
  setStatus('up to date');
}

function entryFor(selector) {
  return state.catalog.find(entry => entry.selector === selector);
}

function effortsFor(selector) {
  const hit = entryFor(selector);
  return hit && Array.isArray(hit.efforts) ? hit.efforts : [];
}

function setStatus(message, kind) {
  const element = document.getElementById('status');
  element.textContent = message;
  element.className = kind || '';
}

function scheduleSave() {
  setStatus('saving');
  clearTimeout(timer);
  timer = setTimeout(commit, 600);
}

async function commit() {
  if (inFlight) return scheduleSave();
  inFlight = true;
  try {
    const response = await fetch('/api/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cycle: state.cycle, others: state.others }),
    });
    const result = await response.json();
    if (!result.ok) return setStatus(result.error, 'err');
    if (result.backup) document.getElementById('bak').textContent = result.backup;
    setStatus(result.unchanged
      ? 'up to date'
      : 'saved ' + new Date().toTimeString().slice(0, 8), 'ok');
  } catch (error) {
    setStatus(String(error), 'err');
  } finally {
    inFlight = false;
  }
}

function button(label, onclick, cls) {
  const element = document.createElement('button');
  element.textContent = label;
  element.onclick = onclick;
  if (cls) element.className = cls;
  return element;
}

function textCell(value, placeholder, oninput) {
  const td = document.createElement('td');
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  input.oninput = () => { oninput(input.value); scheduleSave(); };
  td.appendChild(input);
  return td;
}

function modelCell(row) {
  const placeholder = row.builtin ? 'empty = OMP default model' : 'provider/model-id';
  const td = textCell(row.selector, placeholder, value => { row.selector = value; });
  const entry = entryFor(row.selector);
  if (row.selector && entry && !entry.authed) {
    const warning = document.createElement('div');
    warning.className = 'tag no';
    warning.textContent = 'no credential for ' + entry.provider + ': this role will fail when used';
    td.appendChild(warning);
  }
  return td;
}

function effortCell(row) {
  const td = document.createElement('td');
  const select = document.createElement('select');
  const options = ['', ...effortsFor(row.selector)];
  if (row.effort && !options.includes(row.effort)) options.push(row.effort);
  for (const value of options) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value || 'adaptive';
    option.selected = value === row.effort;
    select.appendChild(option);
  }
  select.onchange = () => { row.effort = select.value; scheduleSave(); };
  td.appendChild(select);
  return td;
}

function roleRow(row, buttons) {
  const tr = document.createElement('tr');
  tr.appendChild(textCell(row.role, 'role', value => { row.role = value; }));
  tr.appendChild(modelCell(row));
  tr.appendChild(effortCell(row));
  const cell = document.createElement('td');
  const actions = document.createElement('div');
  actions.className = 'actions';
  for (const element of buttons) actions.appendChild(element);
  cell.appendChild(actions);
  tr.appendChild(cell);
  return tr;
}

function render() {
  const cycleBody = document.querySelector('#cycle tbody');
  cycleBody.innerHTML = '';
  state.cycle.forEach((row, index) => {
    cycleBody.appendChild(roleRow(row, [
      button('\u2191', () => move(index, -1), 'step'),
      button('\u2193', () => move(index, 1), 'step'),
      button('out of cycle', () => {
        const [moved] = state.cycle.splice(index, 1);
        state.others.push(moved);
        render();
        scheduleSave();
      }),
    ]));
  });

  const othersBody = document.querySelector('#others tbody');
  othersBody.innerHTML = '';
  state.others.forEach((row, index) => {
    othersBody.appendChild(roleRow(row, [
      button('to Ctrl+P', () => {
        const [moved] = state.others.splice(index, 1);
        state.cycle.push(moved);
        render();
        scheduleSave();
      }),
      button('delete', () => {
        state.others.splice(index, 1);
        render();
        scheduleSave();
      }),
    ]));
  });

  renderCatalog();
}

function move(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= state.cycle.length) return;
  const [row] = state.cycle.splice(index, 1);
  state.cycle.splice(target, 0, row);
  render();
  scheduleSave();
}

function roleNameFor(selector) {
  let base = selector.split('/').pop().replace(/-(exp|preview|latest|\d{8})$/, '');
  base = base.replace(/[^\w-]/g, '-');
  const taken = new Set([...state.cycle, ...state.others].map(row => row.role));
  let name = base;
  let n = 2;
  while (taken.has(name)) name = base + '-' + n++;
  return name;
}

function add(selector) {
  if (!selector.includes('/')) return setStatus('expected provider/model-id', 'err');
  if ([...state.cycle, ...state.others].some(row => row.selector === selector)) {
    return setStatus('already configured: ' + selector, 'err');
  }
  state.cycle.push({ role: roleNameFor(selector), selector, effort: '', builtin: false });
  render();
  scheduleSave();
}

function renderCatalog() {
  const query = document.getElementById('filter').value.toLowerCase();
  const rows = state.catalog.filter(entry => !query
    || entry.selector.toLowerCase().includes(query)
    || (entry.name || '').toLowerCase().includes(query));
  document.getElementById('count').textContent =
    rows.length + ' / ' + state.catalog.length + ' models';
  const body = document.querySelector('#catalog tbody');
  body.innerHTML = '';
  for (const entry of rows.slice(0, 400)) {
    const tr = document.createElement('tr');
    const flag = entry.authed ? '' : ' <span class="tag no">no key</span>';
    tr.innerHTML = '<td>' + entry.selector + flag
      + '<br><span class="tag">' + (entry.name || '') + '</span></td>'
      + '<td class="tag">' + (entry.context ? Math.round(entry.context / 1000) + 'K' : '?') + '</td>'
      + '<td class="tag">' + (entry.efforts.join(', ') || 'none') + '</td>'
      + '<td class="tag">' + (entry.images ? 'yes' : 'no') + '</td>';
    const cell = document.createElement('td');
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.appendChild(button('add', () => add(entry.selector)));
    cell.appendChild(actions);
    tr.appendChild(cell);
    body.appendChild(tr);
  }
}

document.getElementById('filter').oninput = renderCatalog;
document.getElementById('addcustom').onclick = () => {
  const field = document.getElementById('custom');
  add(field.value.trim());
  field.value = '';
};
load();
</script>
</body></html>`;

/**
 * Binds the first free port of the range and returns its URL. A second OMP
 * instance therefore gets its own page instead of silently giving up, and a
 * machine where 8931 belongs to something else still works.
 */
function ensureServer(): string {
	if (pageUrl) return pageUrl;
	let lastError: unknown;
	for (let port = PORT; port < PORT + 10; port++) {
		try {
			server = Bun.serve({
				port,
				hostname: "127.0.0.1",
				idleTimeout: 60,
				fetch: async request => {
					const { pathname } = new URL(request.url);
					if (pathname === "/") {
						return new Response(PAGE, {
							headers: { "content-type": "text/html; charset=utf-8" },
						});
					}
					if (pathname === "/api/state") return Response.json(await statePayload());
					if (pathname === "/api/save" && request.method === "POST") {
						try {
							return Response.json(await saveConfig((await request.json()) as SavePayload));
						} catch (error) {
							return Response.json({ ok: false, error: String(error) });
						}
					}
					return new Response("not found", { status: 404 });
				},
			});
			pageUrl = `http://127.0.0.1:${port}/`;
			return pageUrl;
		} catch (error) {
			lastError = error;
		}
	}
	throw new Error(`no free port in ${PORT}-${PORT + 9}: ${String(lastError)}`);
}

export default function models(pi: ExtensionAPI): void {
	pi.registerCommand("models", {
		description: "configure the models Ctrl+P cycles through, in the browser",
		handler: async (args, ctx) => {
			if (catalogCache.length === 0) catalogCache = buildCatalog(ctx);
			try {
				const url = ensureServer();
				if (!args.includes("--no-open")) openPage(url);
				ctx.ui.notify(`Ctrl+P models: ${url}`, "info");
			} catch (error) {
				ctx.ui.notify(String(error), "error");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (!process.stdout.isTTY) return;
		if (catalogCache.length === 0) catalogCache = buildCatalog(ctx);
		try {
			openPage(ensureServer());
		} catch {
			// every port of the range is busy: /models will report it on demand
		}
	});
}
