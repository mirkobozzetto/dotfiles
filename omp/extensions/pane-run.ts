import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

// Port of ~/.claude/hooks/pane-route.cjs onto OMP. Claude Code enforced the pane
// rule through a PreToolUse hook while OMP enforced nothing, so the same agent
// obeyed in one harness and drifted in the other. Same runner, same contract.
//
// The runner handles both multiplexers: tmux when TMUX is set, herdr when the
// session carries HERDR_ENV. Outside either one it runs locally and says so.
//
// Unlike the Claude Code version, there is no silent-read exemption: Mirko wants
// the reads in his history too, they are part of the trail.

const RUNNER = join(homedir(), ".claude", "bin", "pane-run");

function quote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

// Anything already addressing a multiplexer or the runner would recurse.
const ADDRESSES_PANE = /^\s*(tmux\b|herdr\b|hc\b|\S*herdr-core\b|\S*pane-run\b)/;

export default function paneRunExtension(pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return;

		// The Herdr app's core gives every terminal its id and socket.
		const inPane =
			Boolean(process.env.TMUX) ||
			process.env.HERDR_ENV === "1" ||
			Boolean(process.env.HC_TERMINAL_ID && process.env.HC_TERMINAL_SOCKET);
		if (!inPane) return;

		const command = String(event.input?.command ?? "");
		if (!command || ADDRESSES_PANE.test(command)) return;

		// Backgrounded commands never return output to relay, so wrapping them
		// would hang the runner on a result file that never lands.
		if (event.input?.async === true) return;

		const cwd = String(event.input?.cwd ?? ctx.cwd ?? process.cwd());
		return {
			input: {
				...event.input,
				command: `${RUNNER} ${quote(cwd)} ${quote(command)}`,
			},
		};
	});
}
