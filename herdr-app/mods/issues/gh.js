// gh with the GitHub account hop gives the repo's folder, so a work repo never
// gets a comment from the personal account. The logins sit in the private
// ~/.config/herdr-app/custom.json: { "gh_users": { "<hop account>": "<GitHub login>" } }.
import { exec, appHome, readTextFile, shared, setShared } from "herdr";

const PERSONAL = "mirko";
const KEY = "issues.gh-account";

// hop's own rule: the nearest .hop above the folder names the account, else the personal one.
async function hopAccount(dir) {
  for (let d = dir; d && d !== "/"; d = d.slice(0, d.lastIndexOf("/")) || "/") {
    const pinned = (await readTextFile(`${d}/.hop`).catch(() => null))?.trim();
    if (pinned) return pinned;
  }
  return PERSONAL;
}

async function logins() {
  const text = await readTextFile(`${appHome()}/custom.json`).catch(() => null);
  try { return JSON.parse(text ?? "{}").gh_users ?? {}; } catch { return {}; }
}

// The focused terminal's folder: every gh call after this one uses its account.
// Another machine's folders have no .hop here: gh keeps that machine's own login.
export async function useFolder(cwd, on) {
  const account = on ? null : await hopAccount(cwd);
  const now = account ? { account, login: (await logins())[account] ?? null } : null;
  if (JSON.stringify(shared(KEY)) !== JSON.stringify(now)) setShared(KEY, now);
}

export function ghLogin() {
  return shared(KEY)?.login ?? "";
}

// A work account without a login in custom.json stops here rather than fall
// back to the app's default, personal, login.
const RUN = 'u=$1; shift; if [ -n "$u" ]; then GH_TOKEN=$(gh auth token -u "$u" 2>/dev/null) || { echo "gh: no token for $u" >&2; exit 4; }; export GH_TOKEN; fi; exec gh "$@"';

export async function gh(args, options = {}) {
  const now = shared(KEY);
  if (now && now.account !== PERSONAL && !now.login) {
    return { code: 4, stdout: "", stderr: `No GitHub login for hop account "${now.account}": add it to gh_users in ~/.config/herdr-app/custom.json` };
  }
  return exec("sh", ["-c", RUN, "sh", now?.login ?? "", ...args], options);
}
