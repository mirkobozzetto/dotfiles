/**
 * Translate pi 0.86's transcript-style provider input back to the 0.85-style `Context`
 * the rest of the bridge speaks (issue #106).
 *
 * pi 0.86 changed the provider contract from `Context` to `TranscriptContext`: the system
 * prompt and tool set now live in `role: "system"` messages inside `messages` (the leading
 * one holds the base prompt and initial tools; later ones patch sections and tool deltas),
 * and `context.systemPrompt` / `context.tools` are undefined. Every consumer downstream of
 * the stream entry points — session bookkeeping, cursor counts, prompt capture, MCP tool
 * resolution, prompt extraction — assumes the 0.85 shape, so reconstruct it once here.
 *
 * Same algorithm as pi-ai 0.86's `getCurrentSystemPrompt` / `getCurrentTools`
 * (packages/ai/src/utils/transcript.ts), vendored because the bridge's declared pi-ai range
 * starts at 0.85 where neither exists.
 */
import type { Context, Tool } from "@earendil-works/pi-ai";

/** System message as pi 0.86 shapes it. Kept local: pi-ai 0.85's Message union has no system role. */
interface TranscriptSystemMessage {
	role: "system";
	content: string | { type: "text"; text: string }[];
	sections?: Record<string, string | null>;
	toolsAdded?: Tool[];
	toolsRemoved?: { name: string }[];
}

/** Anything with a role — lets us test `role === "system"` without tripping TS2367 on 0.85 types. */
type Roled = { role?: string };

/** Render message content as text (pi-ai `contentText`). */
function contentText(content: string | { type: "text"; text: string }[]): string {
	if (typeof content === "string") return content;
	return content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
}

/**
 * Replay transcript system messages into the 0.85 fields they replaced.
 *
 * Mirrors pi-ai 0.86 `getCurrentSystemMessage` + `getSystemMessageText`: content pieces
 * concatenate in message order, sections merge by name (a later value replaces an earlier
 * one, `null` deletes), tools resolve in first-declaration order with removals applied —
 * matching what pi 0.85 assembled into `context.systemPrompt` / `context.tools`. The
 * rendering must stay byte-identical to `ctx.getSystemPrompt()` for prompt capture's
 * exact-key lookup.
 */
function replaySystemState(messages: readonly Roled[]): {
	systemPrompt: string | undefined;
	tools: Tool[] | undefined;
} {
	const content: string[] = [];
	const sections = new Map<string, string>();
	const tools = new Map<string, Tool>();
	for (const message of messages) {
		if (message.role !== "system") continue;
		const system = message as TranscriptSystemMessage;
		const text = contentText(system.content);
		if (text.length > 0) content.push(text);
		for (const [name, value] of Object.entries(system.sections ?? {})) {
			if (value === null) sections.delete(name);
			else sections.set(name, value);
		}
		for (const removed of system.toolsRemoved ?? []) tools.delete(removed.name);
		for (const added of system.toolsAdded ?? []) tools.set(added.name, added);
	}
	// Emit sections in pi's canonical render order. The capture handlers record
	// `ctx.getSystemPrompt()`, which renders from the canonical builder, so a Map-order
	// replay can diverge: a section deleted (null) then re-added, or first appearing
	// mid-session, lands at the Map tail instead of its canonical slot — and the exact-key
	// prompt-capture lookup throws on a legitimate turn. Unknown names (extension
	// sections, future built-ins) keep their replayed position so an already-canonical
	// replay is untouched.
	const ordered = stableRanked(sections, SECTION_RANK);
	const parts = [...content, ...ordered.values()].filter((part) => part.length > 0);
	return {
		systemPrompt: parts.length > 0 ? parts.join("\n\n") : undefined,
		tools: tools.size > 0 ? [...tools.values()] : undefined,
	};
}

/** pi's built-in section order (system-prompt.ts buildSystemPromptSections). */
const SECTION_RANK = new Map<string, number>([
	["preamble", 0], ["tools", 1], ["rules", 2], ["docs", 3], ["addendum", 4],
	["project_context", 5], ["skills", 6], ["cwd", 7],
]);

/**
 * The map's entries, stably sorted by canonical rank. A name absent from the rank table
 * inherits its replayed predecessor's rank, so replay order that is already canonical
 * (fresh pi sections, extension customs at the tail) sorts as a no-op.
 */
function stableRanked(sections: Map<string, string>, ranks: Map<string, number>): Map<string, string> {
	let predecessorRank = -1;
	const ranked = [...sections].map(([name, value]) => {
		const rank = ranks.get(name) ?? predecessorRank;
		predecessorRank = rank;
		return { name, value, rank };
	});
	ranked.sort((a, b) => a.rank - b.rank);
	return new Map(ranked.map(({ name, value }) => [name, value]));
}

/**
 * Normalize a provider context to the 0.85 shape. A context with no system messages is a
 * 0.85 host — returned as-is. Otherwise every system message (leading and mid-conversation
 * updates) is folded into `systemPrompt` / `tools` and dropped from `messages`.
 */
export function toBridgeContext(context: Context): Context {
	const roleOf = (message: Context["messages"][number]): string => (message as Roled).role ?? "";
	const hasSystem = context.messages.some((message) => roleOf(message) === "system");
	if (!hasSystem) return context;
	const { systemPrompt, tools } = replaySystemState(context.messages);
	return {
		...context,
		systemPrompt,
		tools,
		messages: context.messages.filter((message) => roleOf(message) !== "system"),
	};
}

/**
 * `messages` with every system message dropped — conversation history space.
 *
 * Keeps `toolResult` messages (they are session history); drops only `system`, which pi 0.86
 * folds prompt and tool state into and which the bridge never imports into a CC session.
 */
export function nonSystemMessages<T extends Roled>(messages: readonly T[]): T[] {
	return messages.filter((message) => message.role !== "system");
}
