import { watch, type FSWatcher } from "node:fs";
import { mkdtemp, realpath, stat, readFile, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, isAbsolute, resolve } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const MAX_FILE_BYTES = 1024 * 1024;
const IGNORED: Record<string, true> = { ".git": true, node_modules: true, ".venv": true, venv: true, target: true, dist: true, build: true, ".next": true, __pycache__: true };
const LUA = String.raw`
local root = vim.uv.fs_realpath(vim.fn.getcwd())
vim.g.omp_follow_events = {}
vim.g.omp_follow_paused = false
vim.opt.autoread = true
-- LazyVim enables autowrite; a follow-only viewer must never save on buffer switches.
vim.opt.autowrite = false
vim.opt.autowriteall = false
-- Block custom BufLeave/FocusLost autosave commands in this viewer too.
vim.opt.write = false
vim.opt.swapfile = false
pcall(function() require('persistence').stop() end)
pcall(function() require("config.hover-mouse").suspend_until_input() end)
vim.api.nvim_create_user_command('OmpFollowPause', function()
  vim.g.omp_follow_paused = not vim.g.omp_follow_paused
  print('OMP follow paused: ' .. tostring(vim.g.omp_follow_paused))
end, {force = true})
function OmpFollow(encoded)
  local data = vim.json.decode(encoded)
  local file = vim.uv.fs_realpath(data.path)
  if not file or file:sub(1, #root + 1) ~= root .. '/' then return 'outside-root' end
  if vim.g.omp_follow_paused or vim.api.nvim_get_mode().mode ~= 'n' then return 'paused' end
  if vim.bo.modified then return 'modified-current' end
  local existing = vim.fn.bufnr(file)
  if existing ~= -1 and vim.bo[existing].modified then return 'modified-target' end
  pcall(function() require("config.hover-mouse").suspend_until_input() end)
  local buf = vim.fn.bufadd(file)
  vim.bo[buf].buflisted = true
  vim.fn.bufload(buf)
  vim.api.nvim_buf_call(buf, function() vim.cmd('checktime') end)
  vim.api.nvim_set_current_buf(buf)
  local line = math.max(1, math.min(data.line or 1, vim.api.nvim_buf_line_count(buf)))
  vim.api.nvim_win_set_cursor(0, {line, 0})
  vim.cmd('normal! zz')
  local events = vim.g.omp_follow_events
  table.insert(events, {path = file, line = line, preview = vim.api.nvim_buf_get_lines(buf, line - 1, line, false)[1]:sub(1, 120)})
  if #events > 100 then table.remove(events, 1) end
  vim.g.omp_follow_events = events
  return 'shown'
end
`;

async function run(args: string[], cwd?: string): Promise<string> {
  const child = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill(), 3000);
  try {
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0) throw new Error(stderr.trim() || `${args[0]} exited ${code}`);
    return stdout.trim();
  } finally { clearTimeout(timer); }
}

export default function nvimFollow(pi: ExtensionAPI) {
  let root = "";
  let socket = "";
  let paneId = "";
  let watcher: FSWatcher | undefined;
  let working = false;
  let timer: NodeJS.Timeout | undefined;
  let draining: Promise<void> | undefined;
  const pending = new Map<string, number>();
  const shown = new Map<string, string>();
  let lastError = "";
  let lastResult = "";

  function stop() {
    watcher?.close(); watcher = undefined;
    clearTimeout(timer);
    pending.clear();
  }
  function queue(file: string, line = 1) {
    if (!watcher) return;
    const absolute = resolve(root, file);
    const rel = relative(root, absolute);
    if (!rel || rel.startsWith("..") || isAbsolute(rel) || rel.split(/[\\/]/).some(part => Object.hasOwn(IGNORED, part))) return;
    if (/\.(swp|swo|tmp|log)$/.test(rel) || rel.endsWith("~")) return;
    pending.set(absolute, line);
    clearTimeout(timer);
    timer = setTimeout(() => { void flush(); }, 180);
  }
  async function flush() {
    if (draining) { await draining; if (pending.size) return flush(); return; }
    draining = (async () => {
      while (watcher && pending.size) {
        const [file, line] = pending.entries().next().value!;
        pending.delete(file);
        try {
          const canonical = await realpath(file);
          if (!canonical.startsWith(root + "/")) continue;
          const info = await stat(canonical);
          if (!info.isFile() || info.size > MAX_FILE_BYTES) continue;
          const bytes = await readFile(canonical);
          if (bytes.includes(0)) continue;
          const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
          if (shown.get(canonical) === hash) continue;
          const payload = JSON.stringify({ path: canonical, line });
          const expr = `luaeval('OmpFollow(_A)', '${payload.replaceAll("'", "''")}')`;
          lastResult = await run(["nvim", "--headless", "--clean", "-i", "NONE", "--server", socket, "--remote-expr", expr]);
          if (lastResult === "shown") shown.set(canonical, hash);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          lastError = String(error);
          stop();
          break;
        }
      }
    })();
    try { await draining; } finally { draining = undefined; }
  }
  async function start(cwd: string) {
    if (watcher) return;
    const nextRoot = await realpath(cwd);
    if (root && nextRoot !== root) throw new Error("Project changed: start a new OMP session for a different root.");
    root = nextRoot;
    let alive = false;
    if (socket) {
      try { await run(["nvim", "--headless", "--clean", "-i", "NONE", "--server", socket, "--remote-expr", "1"]); alive = true; } catch { /* A closed viewer gets a new socket and pane. */ }
    }
    if (!alive) {
      const parent = process.env.OMP_NVIM_PARENT_PANE || process.env.HERDR_PANE_ID;
      if (!parent) throw new Error("Run this command inside a Herdr pane.");
      const dir = await mkdtemp(join(tmpdir(), "omp-nvim-"));
      socket = join(dir, "nvim.sock");
      const created = JSON.parse(await run(["herdr", "pane", "split", parent, "--direction", "right", "--ratio", "0.45", "--cwd", root, "--no-focus"]));
      const pane = created.result.pane.pane_id;
      paneId = pane;
      const receiver = join(dir, "follow.lua");
      await writeFile(receiver, LUA, { mode: 0o600 });
      const args = ["nvim", "-i", "NONE", "-n", "--listen", socket, "--cmd", "let g:started_with_stdin=1", "-c", `lua dofile(${JSON.stringify(receiver)})`];
      const quoted = args.map(arg => `'${arg.replaceAll("'", "'\\''")}'`).join(" ");
      await run(["herdr", "pane", "run", pane, quoted]);
      let ready = false;
      for (let i = 0; i < 60; i++) {
        try { await access(socket); if (await run(["nvim", "--headless", "--clean", "-i", "NONE", "--server", socket, "--remote-expr", "luaeval('type(OmpFollow)')"]) === "function") { ready = true; break; } } catch { }
        await Bun.sleep(100);
      }
      if (!ready) throw new Error(`Neovim did not become ready in pane ${paneId}.`);
    }
    shown.clear(); lastError = "";
    watcher = watch(root, { recursive: true }, (_event, file) => { if (working && file) queue(String(file)); });
    watcher.on("error", error => { lastError = String(error); stop(); });
  }
  pi.registerCommand("nvim-follow", {
    description: "Follow this OMP session in a right-hand Neovim pane: on, off, status",
    handler: async (args, ctx) => {
      const action = args.trim() || "on";
      try {
        if (action === "on") await start(ctx.cwd);
        else if (action === "off") { stop(); if (draining) await draining; }
        else if (action !== "status") throw new Error("Usage: /nvim-follow [on|off|status]");
        ctx.ui.notify(`Neovim follow ${watcher ? "ON" : "OFF"} | ${paneId || "no pane"} | ${socket || "no socket"}${lastError ? " | " + lastError : ""}${lastResult ? " | " + lastResult : ""}`, lastError ? "warning" : "info");
      } catch (error) { ctx.ui.notify(String(error), "error"); }
    },
  });
  pi.on("agent_start", () => { working = true; });
  pi.on("agent_end", async () => { working = false; clearTimeout(timer); await flush(); });
  pi.on("tool_result", event => {
    if (!watcher || event.isError || !["write", "edit", "ast_edit"].includes(event.toolName)) return;
    const details = event.details as { resolvedPath?: string; path?: string; firstChangedLine?: number } | undefined;
    if (details?.resolvedPath) queue(details.resolvedPath);
    if (details?.path) queue(details.path, details.firstChangedLine);
  });
  pi.on("session_shutdown", stop);
}
