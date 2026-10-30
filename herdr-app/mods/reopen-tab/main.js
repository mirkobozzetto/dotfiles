import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { hc, exec, spaces, panes, terminals, theme, props, run, closeOverlay, notify, appHome, readTextFile } from "herdr";
import * as fs from "fs/promises";
import { closedTabs, nextClose, position, splitArgv, tabArgv, start, names, tabName, base, readLedger, addToLedger, describe, RESUME } from "./plan.js";

// This mod's own folder under the app home: the ledger of reopened tabs, and the
// request/result pair an agent uses (bin/herdr-reopen-tab.mjs, the MCP server).
const DATA = () => `${appHome()}/data/reopen-tab`;
const REQUEST_MS = 15000;
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const wait = (cx, ms) => new Promise((resolve) => cx.timer.after(ms, () => resolve()));

/** Commands apply after this script yields: poll until `found()` sees the result. */
async function until(cx, found, what) {
  for (let i = 0; i < 320; i++) {
    const v = found();
    if (v) return v;
    await wait(cx, 25);
  }
  throw new Error(`Herdr did not make the ${what}`);
}

async function read(name) {
  try {
    return await readTextFile(`${DATA()}/${name}`);
  } catch (_) {
    return "";
  }
}

const write = (name, value) => fs.writeFile(`${DATA()}/${name}`, JSON.stringify(value, null, 2) + "\n");

async function remember(change) {
  await write("ledger.json", addToLedger(readLedger(await read("ledger.json")), change));
}

/** An agent's fresh request for one closed tab (else the newest close). */
async function request() {
  try {
    const r = JSON.parse(await read("request.json"));
    const done = JSON.parse((await read("result.json")) || "{}");
    return r?.id && Date.now() - r.at < REQUEST_MS && done.id !== r.id ? r : null;
  } catch (_) {
    return null;
  }
}

/** Finished terminals that were killed while in a Herdr tab, with their full records. */
async function closedRecords() {
  const ls = await hc(["ls", "--all", "--json"]);
  if (ls.code !== 0) throw new Error(ls.stderr.trim() || "hc ls failed");
  const listed = (JSON.parse(ls.stdout).terminals || []).filter((t) => t.state === "finished" && t.reason === "killed" && t.where);
  const records = [];
  for (let i = 0; i < listed.length; i += 16) {
    const batch = await Promise.all(listed.slice(i, i + 16).map(async (t) => {
      try {
        const r = await hc(["get", t.address, "--json"]);
        // Keep the machine-qualified address `ls` gave.
        return r.code === 0 ? { ...JSON.parse(r.stdout), address: t.address } : null;
      } catch (_) {
        return null;
      }
    }));
    records.push(...batch.filter(Boolean));
  }
  return records;
}

/** The folder still exists there (else the tab starts in its space's folder). */
async function exists(folder, machine) {
  if (!folder) return false;
  try {
    const r = await exec("sh", ["-c", 'test -d "$1"', "sh", folder], machine ? { on: machine } : {});
    return r.code === 0;
  } catch (_) {
    return true; // No sh there (Windows): let Herdr try.
  }
}

/** A space nobody named is called after its repo or folder: reopen it unnamed too. */
async function spaceName(name, folder, machine) {
  if (!name || name === "~" || name === base(folder)) return "";
  try {
    const r = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, ...(machine ? { on: machine } : {}) });
    if (r.code === 0 && base(r.stdout.trim()) === name) return "";
  } catch (_) {}
  return name;
}

const tabsOf = (space) => spaces().find((s) => s.id === space)?.tabs || [];
const panesIn = (tab) => panes().filter((p) => p.tab === tab).map((p) => p.pane);

/** When each open tab in a space was made: first made, for one reopened before; else its oldest
 *  terminal (null for a tab of mods only). */
function tabAges(space, firstMade) {
  const born = new Map(terminals().map((t) => [t.address, t.created_ms]));
  return tabsOf(space).map((tab) => {
    const times = panes().filter((p) => p.tab === tab.id && p.terminal).map((p) => born.get(p.terminal)).filter((v) => v != null);
    return { created: firstMade[tab.id] ?? (times.length ? Math.min(...times) : null) };
  });
}

/** The rest of a closed tab's panes, side by side after its first, sharing the width evenly. */
async function splitRest(cx, tab, first, rest) {
  let last = first;
  for (const t of rest) {
    const before = new Set(panesIn(tab));
    const argv = splitArgv(t, RESUME);
    run("pane.split", { pane: last, direction: "right", ...(argv ? { argv } : {}) });
    last = await until(cx, () => panesIn(tab).find((p) => !before.has(p)), "split");
  }
  if (rest.length) for (const p of panesIn(tab)) run("layout.resize", { id: p, weight: 1 });
}

/** Opens a new tab in `space` like the closed one; returns its ids. */
async function reopenTab(cx, space, closed, fallbackFolder, firstMade) {
  const [first, ...rest] = closed.terminals;
  const name = tabName(names(closed.where, spaces().find((s) => s.id === space)?.name).tab);
  const index = position(tabAges(space, firstMade), closed.created);
  const folder = (await exists(start(first).folder, closed.machine)) ? start(first).folder : fallbackFolder;
  const argv = tabArgv(first, RESUME);
  const before = new Set(tabsOf(space).map((t) => t.id));
  run("tab.new", { space, ...(name ? { name } : {}), ...(folder ? { folder } : {}), ...(argv ? { argv } : {}) });
  const tab = (await until(cx, () => tabsOf(space).find((t) => !before.has(t.id)), "tab")).id;
  const pane = await until(cx, () => panesIn(tab)[0], "tab's pane");
  await splitRest(cx, tab, pane, rest);
  if (index) run("tab.move", { id: tab, index });
  return { tab, pane };
}

/** Opens a new space like the closed one, with its first tab; returns its ids. */
async function reopenSpace(cx, plan) {
  const closed = plan.tabs[0];
  const [first, ...rest] = closed.terminals;
  const folder = (await exists(start(first).folder, plan.machine)) ? start(first).folder : "";
  const name = await spaceName(names(plan.where).space, folder, plan.machine);
  const tab = tabName(names(closed.where).tab);
  const argv = tabArgv(first, RESUME);
  const before = new Set(spaces().map((s) => s.id));
  run("space.new", { ...(name ? { name } : {}), ...(folder ? { folder } : {}), ...(tab ? { tab } : {}), ...(argv ? { argv } : {}), ...(plan.machine ? { machine: plan.machine } : {}) });
  const space = (await until(cx, () => spaces().find((s) => !before.has(s.id)), "space")).id;
  const firstTab = (await until(cx, () => tabsOf(space)[0], "space's tab")).id;
  const pane = await until(cx, () => panesIn(firstTab)[0], "tab's pane");
  await remember({ spaces: { [plan.oldSpace]: space } });
  await splitRest(cx, firstTab, pane, rest);
  return { space, tab: firstTab, pane };
}

export default class ReopenTab extends View {
  init(_props, cx) {
    this.text = "Looking for a closed tab…";
    cx.spawn(async (cx) => {
      const asked = await request();
      let result;
      try {
        result = { ok: true, ...(await this.reopen(cx, asked?.tab || null)) };
      } catch (e) {
        result = { ok: false, error: String(e?.message || e) };
        notify({ title: "Couldn't reopen the tab", body: result.error, level: "error" });
      }
      try {
        await write("result.json", { id: asked?.id || null, at: Date.now(), ...result });
      } finally {
        closeOverlay(props().overlay);
      }
    });
  }

  /** Reopens `wanted` (a closed tab's id), or the newest close. Returns what came back. */
  async reopen(cx, wanted) {
    const records = await closedRecords();
    const open = new Set(spaces().flatMap((s) => s.tabs.map((t) => t.id)));
    const ledger = readLedger(await read("ledger.json"));
    const plan = nextClose(closedTabs(records, open, new Set(ledger.tabs), ledger.born), new Set(spaces().map((s) => s.id)), ledger.spaces, wanted);
    if (!plan) {
      if (wanted) throw new Error(`No closed tab ${wanted} to reopen`);
      notify({ title: "No closed tab to reopen", level: "info", timeout: 2500 });
      return { reopened: [] };
    }
    // Claimed first, so a second press while this one works takes the next close.
    await remember({ tabs: plan.tabs.map((t) => t.tab) });
    const tab = tabName(names(plan.tabs[0].where).tab);
    this.text = plan.newSpace && plan.tabs.length > 1 ? `Reopening ${plan.tabs.length} tabs of ${names(plan.where).space}…` : `Reopening ${tab || "tab"}…`;
    cx.notify();

    let shown;
    const made = [];
    if (plan.newSpace) {
      shown = await reopenSpace(cx, plan);
      made.push(shown.tab);
      const folder = spaces().find((s) => s.id === shown.space)?.folder || "";
      for (const closed of plan.tabs.slice(1)) made.push((await reopenTab(cx, shown.space, closed, folder, ledger.born)).tab);
    } else {
      const folder = spaces().find((s) => s.id === plan.space)?.folder || "";
      shown = { space: plan.space, ...(await reopenTab(cx, plan.space, plan.tabs[0], folder, ledger.born)) };
      made.push(shown.tab);
    }
    // A reopened tab keeps its first-made time, so its place survives another close.
    await remember({ born: Object.fromEntries(plan.tabs.map((closed, i) => [made[i], closed.created])) });
    run("space.select", { id: shown.space });
    run("tab.select", { id: shown.tab });
    run("pane.focus", { pane: shown.pane });
    return {
      reopened: plan.tabs.map((closed, i) => ({ ...describe(closed, RESUME), now: { space: shown.space, tab: made[i] } })),
      new_space: plan.newSpace,
    };
  }

  render() {
    const t = theme();
    return h_flex().id("reopen-tab").w_full().h(40).px(14).gap(10).items_center()
      .rounded(10).bg(t.popover).border(1).border_color(t.border)
      .text_size(13).text_color(t.foreground)
      .children([
        div().w(12).text_color(t.accent).frames(SPIN, 80),
        div().flex_1().min_w(0).truncate().child(this.text),
      ]);
  }
}
