// One generation is one `claude -p` run in the background, in a folder of its
// own: the prompt goes in as files, the answer comes out as a file. Nothing
// ties it to the window that asked, so closing the walkthrough (or Herdr)
// doesn't throw away a minute of paid work; the next look finds the answer.

import { parseJson } from "./walkthrough.js";

export const MODELS = [
  { key: "haiku", name: "Haiku", about: "Fast and cheap; fine for most changes" },
  { key: "sonnet", name: "Sonnet", about: "Better grouping on large or subtle changes" },
  { key: "opus", name: "Opus", about: "The most careful reading, the highest cost" },
];
export const DEFAULT_MODEL = "haiku";
export const modelOf = (key) => MODELS.find((m) => m.key === key) ?? MODELS[0];

// No tools, no MCP servers, no settings, hooks or skills: the model reads the
// prompt and answers. Each of those would otherwise ride along on every call
// (a full Claude Code setup can be hundreds of thousands of tokens).
export const CLAUDE_FLAGS = [
  "-p", "--output-format", "json", "--tools", "", "--no-session-persistence",
  "--strict-mcp-config", "--setting-sources", "", "--disable-slash-commands",
];

/** Whether a process's command line is a walkthrough run (its pid file may outlive it, and pids are reused). */
// Matched by the flags the run alone passes together: the program itself can show as claude, a
// versioned binary or node, depending on how Claude Code was installed.
export const isRunCommand = (command) => ["--json-schema", "--no-session-persistence", "--strict-mcp-config", "--disable-slash-commands"].every((flag) => String(command).includes(flag));

const shellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/**
 * The script a job folder runs: `sh run.sh <model> <seconds>`. A watchdog
 * stops claude after <seconds>, so a hung run ends even when no window is
 * open to notice; it checks every few seconds and leaves with claude.
 */
export function jobScript() {
  return `#!/bin/sh
# One walkthrough generation. Written by the walkthrough mod for Herdr.
cd "$(dirname "$0")" || exit 1
claude ${CLAUDE_FLAGS.map(shellQuote).join(" ")} --model "$1" --json-schema "$(cat schema.json)" --system-prompt "$(cat system.txt)" < prompt.txt > out.json 2> err.txt &
pid=$!
echo $pid > pid
( waited=0
  while kill -0 $pid 2>/dev/null; do
    if [ $waited -ge "\${2:-900}" ]; then echo "Stopped after $2 seconds without an answer." >> err.txt; kill $pid; exit 0; fi
    sleep 3; waited=$((waited + 3))
  done ) &
wait $pid
echo $? > code.tmp && mv code.tmp code
`;
}

/**
 * What a finished job left: the walkthrough's raw object and its cost, or an
 * error with a message a person can act on.
 * @param {{ out: string|null, err: string|null, code: string|null }} files
 * @returns {{ raw: any, cost: number|null }}
 */
export function readOutcome({ out, err, code }) {
  let answer = null;
  try { answer = out ? JSON.parse(out) : null; } catch { answer = null; }
  if (!answer) {
    const why = String(err ?? "").trim().split("\n").filter(Boolean).slice(-3).join(" ") || `claude exited with ${String(code ?? "?").trim()}`;
    throw Object.assign(new Error(why), { code: "failed" });
  }
  if (answer.is_error || (answer.subtype && answer.subtype !== "success")) {
    const why = typeof answer.result === "string" && answer.result.trim() ? answer.result.trim() : answer.subtype ?? "claude reported an error";
    throw Object.assign(new Error(why), { code: /log ?in/i.test(why) ? "login" : "failed" });
  }
  const raw = answer.structured_output ?? parseJson(answer.result);
  return { raw, cost: typeof answer.total_cost_usd === "number" ? answer.total_cost_usd : null };
}
