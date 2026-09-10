import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

type WorkMode = "normal" | "plan";

const STATE_TYPE = "work-mode-state";
const PLAN_INSTRUCTIONS = `

[PLAN MODE]
You are in Plan mode. Analyze the request and inspect, read, or research what is
needed to produce a clear implementation plan. Do not modify user files and do
not cause external mutations. Explain the proposed plan, relevant findings,
risks, and verification steps. Ask for clarification only when it is necessary.
This is a behavioral instruction, not a security sandbox: tools remain available,
but you must use them only for non-mutating analysis, inspection, and research.
Do not implement the plan until the user switches to Normal mode or explicitly
changes the instruction.`;

export default function workModes(pi: ExtensionAPI): void {
  let mode: WorkMode = "normal";

  function updateStatus(ctx: ExtensionContext): void {
    const label = mode === "plan" ? "Mode: Plan" : "Mode: Normal";
    const color = mode === "plan" ? "warning" : "muted";
    ctx.ui.setStatus("work-mode", ctx.ui.theme.fg(color, label));
  }

  function setMode(next: WorkMode, ctx: ExtensionContext): void {
    mode = next;
    pi.appendEntry(STATE_TYPE, { mode });
    updateStatus(ctx);
    ctx.ui.notify(mode === "plan" ? "Mode: Plan" : "Mode: Normal", "info");
  }

  function toggleMode(ctx: ExtensionContext): void {
    setMode(mode === "plan" ? "normal" : "plan", ctx);
  }

  pi.registerCommand("plan", {
    description: "Enable Plan mode (behavioral read-only planning)",
    handler: async (_args, ctx) => setMode("plan", ctx),
  });

  pi.registerCommand("normal", {
    description: "Return to Normal mode",
    handler: async (_args, ctx) => setMode("normal", ctx),
  });

  pi.registerCommand("mode", {
    description: "Show the current mode; use /mode toggle to switch",
    handler: async (args, ctx) => {
      if (args.trim().toLowerCase() === "toggle") {
        toggleMode(ctx);
        return;
      }
      updateStatus(ctx);
      ctx.ui.notify(mode === "plan" ? "Mode: Plan" : "Mode: Normal", "info");
    },
  });

  pi.registerShortcut("ctrl+alt+p", {
    description: "Toggle Plan/Normal mode",
    handler: async (ctx) => toggleMode(ctx),
  });

  pi.on("session_start", async (_event, ctx) => {
    const latest = ctx.sessionManager
      .getEntries()
      .filter(
        (entry: { type: string; customType?: string }) =>
          entry.type === "custom" && entry.customType === STATE_TYPE,
      )
      .pop() as { data?: { mode?: WorkMode } } | undefined;

    mode = latest?.data?.mode === "plan" ? "plan" : "normal";
    updateStatus(ctx);
  });

  pi.on("before_agent_start", async (event) => {
    if (mode !== "plan") return undefined;
    return { systemPrompt: event.systemPrompt + PLAN_INSTRUCTIONS };
  });
}
