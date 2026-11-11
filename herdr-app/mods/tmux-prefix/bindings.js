// The keys after ctrl+space, grouped as the menu shows them. keys-help reads
// GROUPS from this file's text: keep one group or row per line, as below.
import { agents, appHome, layout, notify, readTextFile, run, spaces, writeTextFile } from "herdr";

// Agents waiting on you, most urgent first: a question before a finished job.
const WAITING = ["blocked", "done"];

// The next agent that needs you; from one of them, the one after it, so
// pressing again walks through all of them.
function waitingNext() {
  const waiting = WAITING.flatMap((status) => agents().filter((a) => a.status === status));
  if (!waiting.length) return null;
  const at = waiting.findIndex((a) => a.focused);
  return waiting[(at + 1) % waiting.length].address;
}

async function nextWaiting() {
  const terminal = waitingNext();
  if (terminal) run("agent.focus", { terminal });
}

// The same agent, over the current tab: you stay where you are.
async function peekWaiting() {
  const terminal = waitingNext();
  if (terminal) run("terminal.peek", { terminal });
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Same as the panel buttons of my-tabs: close the panel when it's the one shown, else show it.
async function togglePanel(id) {
  const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
  if (panel && !panel.hidden && body?.active === id) run("layout.hide", { id: "panel" });
  else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
}

// One step left or right in its space, stopping at the ends.
async function moveTab(step) {
  const tabs = spaces().find((s) => s.active)?.tabs ?? [];
  const tab = tabs.find((t) => t.active);
  if (!tab) return;
  const index = Math.min(tabs.length, Math.max(1, tab.index + step));
  if (index !== tab.index) run("tab.move", { id: tab.id, index });
}

// Sound alerts on/off: settings.json `sounds.enabled`, which Herdr applies live.
async function toggleSound() {
  const path = `${appHome()}/settings.json`;
  const text = await readTextFile(path);
  const settings = JSON.parse(text ?? "{}");
  const enabled = settings.sounds?.enabled === false;
  settings.sounds = { ...settings.sounds, enabled };
  await writeTextFile(path, `${JSON.stringify(settings, null, 2)}\n`, text);
  notify({ title: enabled ? "Sound alerts on" : "Sound alerts off", level: "info", timeout: 2000 });
}

// [key, label, command, args, repeatable]: two columns, three groups each.
export const GROUPS = [
  ["Tabs", [
    ["c", "New tab", "tab.new"],
    ["X", "Close tab", "tab.close"],
    ["n", "Next tab", "tab.next", {}, true],
    ["p", "Previous tab", "tab.prev", {}, true],
    ["t", "Rename tab", "tab.rename"],
    ["<", "Move tab left", () => moveTab(-1)],
    [">", "Move tab right", () => moveTab(1)],
  ]],
  ["Panes", [
    ["|", "Split right", "pane.split", { direction: "right" }],
    ["-", "Split down", "pane.split", { direction: "down" }],
    ["x", "Close pane", "pane.close"],
    ["z", "Zoom pane", "pane.zoom"],
  ]],
  ["Spaces", [
    [")", "Next space", "space.next", {}, true],
    ["(", "Previous space", "space.prev", {}, true],
    ["J", "Next space", "space.next", {}, true],
    ["K", "Previous space", "space.prev", {}, true],
    ["T", "Rename space", "space.rename"],
  ]],
  ["Panels", [
    ["f", "Files", () => togglePanel("files")],
    ["d", "Changes", () => togglePanel("changes")],
    ["G", "Graph", () => togglePanel("graph")],
    ["b", "GitHub", () => togglePanel("github")],
    ["u", "omp usage", () => togglePanel("usage-omp")],
    ["v", "Blueprint", () => togglePanel("blueprint")],
    ["I", "GitHub issues", () => togglePanel("issues")],
    ["e", "Sidebar", "layout.toggle", { id: "sidebar" }],
  ]],
  ["Agents", [
    ["enter", "Agent that needs you", nextWaiting],
    ["a", "Peek at it, stay here", peekWaiting],
    ["g", "Next agent", "agent.next", {}, true],
    ["y", "Agent's last answer", "mod.open", { name: "fleece" }],
    ["r", "Walk through the diff", "mod.open", { name: "walkthrough" }],
    ["i", "Linear issues", "mod.open", { name: "linear" }],
  ]],
  ["App", [
    ["s", "Go to anything", "mod.open", { name: "picker" }],
    ["w", "Go to anything", "mod.open", { name: "picker" }],
    ["o", "Open a folder", "mod.open", { name: "space-picker" }],
    [":", "Command palette", "app.palette"],
    ["?", "All shortcuts", "mod.open", { name: "keys-help" }],
    ["m", "Sound alerts on/off", toggleSound],
    ["S", "Settings", "app.settings"],
    ["q", "Minimize window", "window.minimize"],
  ]],
];

// Work too, but the menu names them in its footer instead of a row each.
const UNLISTED = [
  ...[["h", "left"], ["j", "down"], ["k", "up"], ["l", "right"], ["left", "left"], ["down", "down"], ["up", "up"], ["right", "right"]]
    .map(([key, direction]) => [key, `Focus ${direction}`, "pane.go", { direction }, true]),
  ...Array.from({ length: 10 }, (_, i) => [String(i), `Tab ${i === 0 ? 10 : i}`, "tab.select", { index: i === 0 ? 10 : i }]),
];

export const UNLISTED_NOTE = "0-9 tabs (0 = 10) · h j k l or arrows: focus panes";

export const BINDINGS = [...GROUPS.flatMap(([, rows]) => rows), ...UNLISTED];
