import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

type ToggleState = { enabled?: boolean };

const ARSENAL_STATE = "arsenal-mode-state";
const ESPRESSO_STATE = "espresso-mode-state";

const ARSENAL_GUIDANCE = `

[ARSENAL MODE]
Arsenal mode is enabled. For each request, use the installed router at
~/.prime/agent/skills/arsenal/SKILL.md and let it select the shortest sufficient
installed skill workflow. Prime Normal/Plan mode and higher-priority instructions
remain authoritative. Preserve every approval and permission boundary. This
Prime Phase 1 integration stays solo: do not delegate, launch external workers,
or create nested agents. Do not switch models, thinking effort, or tools.`;

const ESPRESSO_GUIDANCE = `

[ESPRESSO MODE]
Espresso is enabled as a concise policy overlay. Lead with the result. Remove
filler and repetition, but preserve needed explanations, evidence, uncertainty,
security, useful comments, and full French accents. Prefer the smallest correct
change and targeted verification. Active skills own their workflow; Arsenal owns
routing and consent. Espresso never grants delegation permission and does not
auto-delegate. If a separate instruction and user consent later permit native
delegation, prefer one model tier below the current parent (Astra -> Sol -> Terra
-> Luna; Luna stays Luna) and inherit effort where supported. Never substitute a
provider, bypass a solo rule, use an external worker, or create nested agents.
Do not switch models, thinking effort, or tools.`;

function latestState(
  ctx: ExtensionContext,
  customType: string,
): boolean {
  const latest = ctx.sessionManager
    .getEntries()
    .filter(
      (entry: { type: string; customType?: string }) =>
        entry.type === "custom" && entry.customType === customType,
    )
    .pop() as { data?: ToggleState } | undefined;

  return latest?.data?.enabled !== false;
}

export default function orchestrationModes(pi: ExtensionAPI): void {
  let arsenalEnabled = true;
  let espressoEnabled = true;

  function notifyStatus(ctx: ExtensionContext, name: string, enabled: boolean): void {
    ctx.ui.notify(`${name}: ${enabled ? "on" : "off"}`, "info");
  }

  function registerToggle(
    command: string,
    stateType: string,
    getEnabled: () => boolean,
    setEnabled: (enabled: boolean) => void,
  ): void {
    pi.registerCommand(command, {
      description: `Set ${command} on or off, or show status`,
      getArgumentCompletions: (prefix) => ["on", "off", "status"]
        .filter((value) => value.startsWith(prefix.trim().toLowerCase()))
        .map((value) => ({ value, label: value })),
      handler: async (args, ctx) => {
        const action = args.trim().toLowerCase();
        if (action === "status" || action === "") {
          notifyStatus(ctx, command, getEnabled());
          return;
        }
        if (action !== "on" && action !== "off") {
          ctx.ui.notify(`Use /${command} on, off, or status.`, "warning");
          return;
        }
        const enabled = action === "on";
        setEnabled(enabled);
        pi.appendEntry(stateType, { enabled });
        notifyStatus(ctx, command, enabled);
      },
    });
  }

  registerToggle(
    "arsenal-mode",
    ARSENAL_STATE,
    () => arsenalEnabled,
    (enabled) => { arsenalEnabled = enabled; },
  );
  registerToggle(
    "espresso",
    ESPRESSO_STATE,
    () => espressoEnabled,
    (enabled) => { espressoEnabled = enabled; },
  );

  pi.on("session_start", async (_event, ctx) => {
    arsenalEnabled = latestState(ctx, ARSENAL_STATE);
    espressoEnabled = latestState(ctx, ESPRESSO_STATE);
  });

  pi.on("before_agent_start", async (event) => {
    let systemPrompt = event.systemPrompt;
    if (arsenalEnabled) systemPrompt += ARSENAL_GUIDANCE;
    if (espressoEnabled) systemPrompt += ESPRESSO_GUIDANCE;
    return systemPrompt === event.systemPrompt ? undefined : { systemPrompt };
  });
}
