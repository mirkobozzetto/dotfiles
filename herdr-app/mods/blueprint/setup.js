// The tab bar button next to Files and Changes that opens Blueprint as a side
// panel. Herdr's own `main` layout and `tabs` mod are read-only (replaced on
// every start), so this clones them as main-blueprint and tabs-blueprint,
// patches the clones and switches the window to them. It runs on Herdr's own
// JS runtime, so it works wherever Herdr does: no shell, no Python.
//
//   herdr-app do blueprint.add-button      (with a Blueprint pane open)
//   herdr-app do blueprint.remove-button
//
// Clones are the person's and never updated by Herdr. After a Herdr release
// changes the tab bar or the main layout: remove-button, then add-button.
// Running either twice is fine: steps already done are skipped. More than one
// Blueprint may get the command at once, which is fine for the same reason.

import * as fs from "fs/promises";
import { appHome, run, shared } from "herdr";
import { slashes } from "./store.js";

const LAYOUT = "main-blueprint", TABS = "tabs-blueprint";
const app = () => slashes(appHome());
const previousFile = () => `${app()}/data/blueprint/previous-layout.txt`;

// run() only queues a command; wait for what it makes.
async function appears(path, wait) {
  for (let i = 0; i < 50; i++) {
    if (await fs.exists(path)) return;
    await wait(100);
  }
  throw new Error(`${path} did not appear`);
}

function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const c of node.children ?? []) {
    const f = find(c, id);
    if (f) return f;
  }
  return null;
}

// The tab bar: "blueprint" among the panels, its button after Changes, and the
// side panel remembered per tab instead of per space (Blueprint belongs to the
// tab whose agent it shows, so another tab starts closed).
export function patchTabs(s) {
  if (!s.includes('"blueprint"')) {
    const enabled = 'const enabled = shared("workspace.panels") ?? ["files", "changes"];';
    const changes = 'el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))';
    if (!s.includes(enabled) || !s.includes(changes)) throw new Error("This Herdr's tab bar changed: add the button by hand (see mods/blueprint/setup.js)");
    s = s.replace(enabled, 'const enabled = [...(shared("workspace.panels") ?? ["files", "changes"]), "blueprint"];')
      .replace(changes, `${changes}\n      .child(panelButton("blueprint", "Blueprint", "mods/blueprint/icon.svg"))`);
  }
  if (!s.includes("panelKey")) {
    const call = "this.syncPanel(space, panel, body, enabled);";
    if (!s.includes(call)) throw new Error("This Herdr's tab bar changed: make the panel per tab by hand (see mods/blueprint/setup.js)");
    s = s.replace(call, "const panelKey = space && { id: `${space.id}/${space.tabs?.find((t) => t.active)?.id}` }; // per tab\n    this.syncPanel(panelKey, panel, body, enabled);");
  }
  return s;
}

// The layout: the cloned tab bar, and Blueprint as one more side panel.
export function patchLayout(d) {
  const tabs = find(d, "tabs"), body = find(d, "panel-body");
  if (!tabs?.content || !body?.children) throw new Error("This Herdr's main layout changed: add the panel by hand (see mods/blueprint/setup.js)");
  tabs.content.mod = TABS;
  if (!body.children.some((c) => c.id === "blueprint")) {
    body.children.push({ id: "blueprint", type: "block", content: { mod: "blueprint", props: { panel: true } } });
  }
  return d;
}

export async function addButton(wait) {
  const now = shared("layout");
  if (now && now !== LAYOUT) {
    await fs.mkdir(`${app()}/data/blueprint`, { recursive: true });
    await fs.writeFile(previousFile(), String(now));
  }
  const tabsMain = `${app()}/mods/${TABS}/main.js`;
  if (!(await fs.exists(tabsMain))) {
    run("mod.clone", { name: "tabs", as: TABS });
    await appears(tabsMain, wait);
  }
  const src = await fs.readFile(tabsMain, "utf8");
  const patched = patchTabs(src);
  if (patched !== src) await fs.writeFile(tabsMain, patched);
  // The layout file is written here rather than with layout.clone, which
  // switches to it before it has the panel (and a switch can restart this
  // Blueprint mid-way). It starts from main's file; clicks made on main
  // (sizes, theme) stay with main.
  const file = `${app()}/layouts/${LAYOUT}.json`;
  const base = (await fs.exists(file)) ? file : `${app()}/layouts/main.json`;
  const d = JSON.parse(await fs.readFile(base, "utf8"));
  const text = `${JSON.stringify(patchLayout(d), null, 2)}\n`;
  if (base !== file || text !== (await fs.readFile(file, "utf8"))) await fs.writeFile(file, text);
  run("layout.switch", { name: LAYOUT });
  return `Blueprint button added: layout ${LAYOUT} (ctrl-shift-l switches back)`;
}

export async function removeButton(wait) {
  let back = "main";
  try {
    back = (await fs.readFile(previousFile(), "utf8")).trim() || "main";
  } catch (_) {}
  if (back === LAYOUT) back = "main";
  if (shared("layout") === LAYOUT) {
    run("layout.switch", { name: back });
    await wait(500); // let the window leave the clones before they go
  }
  await fs.unlink(`${app()}/layouts/${LAYOUT}.json`).catch(() => {});
  const dir = `${app()}/mods/${TABS}`;
  if (await fs.exists(dir)) {
    for (const f of await fs.readdir(dir)) await fs.unlink(`${dir}/${f}`).catch(() => {});
    await fs.rmdir(dir).catch(() => {});
  }
  await fs.unlink(previousFile()).catch(() => {});
  return `Blueprint button removed: back to layout ${back}`;
}
