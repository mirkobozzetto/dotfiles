/**
 * Route the bash tool through a visible terminal pane.
 *
 * Port of the OMP extension ~/.omp/agent/extensions/pane-run.ts onto pi, so the
 * same agent behaves the same way in both harnesses. The runner itself is
 * shared: ~/.claude/bin/pane-run handles both multiplexers (herdr when
 * HERDR_ENV is set, tmux when TMUX is set) and falls back to local execution
 * with a visible notice when neither is live.
 *
 * Pi contract: `event.input` is mutable and mutations affect the real tool
 * execution. Return values from `tool_call` only control blocking, so the
 * command is patched in place rather than returned.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const RUNNER = join(homedir(), ".claude", "bin", "pane-run");

/** Anything already addressing a multiplexer or the runner would recurse. */
const ADDRESSES_PANE = /^\s*(tmux\b|herdr\b|\S*pane-run\b)/;

function quote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function inPane(): boolean {
	const herdr = process.env.HERDR_ENV === "1" && Boolean(process.env.HERDR_PANE_ID);
	return herdr || Boolean(process.env.TMUX);
}

export default function paneRunExtension(pi: any) {
	pi.on("tool_call", async (event: any, ctx: any) => {
		if (event.toolName !== "bash") return;
		if (!inPane() || !existsSync(RUNNER)) return;

		const command = String(event.input?.command ?? "");
		if (!command || ADDRESSES_PANE.test(command)) return;

		const cwd = String(ctx?.cwd ?? process.cwd());
		event.input.command = `${RUNNER} ${quote(cwd)} ${quote(command)}`;
	});
}
