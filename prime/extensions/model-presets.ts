import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

type ThinkingLevel = "low" | "medium" | "high";

interface ModelProfile {
  name: string;
  label: string;
  provider: string;
  model: string;
  effort: ThinkingLevel;
}

const PROFILES: ModelProfile[] = [
  {
    name: "astra-low",
    label: "Astra Low",
    provider: "openai-codex",
    model: "gpt-6-astra",
    effort: "low",
  },
  {
    name: "astra-med",
    label: "Astra Medium",
    provider: "openai-codex",
    model: "gpt-6-astra",
    effort: "medium",
  },
  {
    name: "astra-high",
    label: "Astra High",
    provider: "openai-codex",
    model: "gpt-6-astra",
    effort: "high",
  },
  {
    name: "sol-low",
    label: "Sol Low",
    provider: "openai-codex",
    model: "gpt-5.6-sol",
    effort: "low",
  },
  {
    name: "sol-med",
    label: "Sol Medium",
    provider: "openai-codex",
    model: "gpt-5.6-sol",
    effort: "medium",
  },
  {
    name: "sol-high",
    label: "Sol High",
    provider: "openai-codex",
    model: "gpt-5.6-sol",
    effort: "high",
  },
];

export default function modelPresets(pi: ExtensionAPI): void {
  let activeProfileIndex: number | undefined;

  async function applyProfile(
    index: number,
    ctx: ExtensionContext,
  ): Promise<void> {
    const normalizedIndex = (index + PROFILES.length) % PROFILES.length;
    const profile = PROFILES[normalizedIndex];
    const model = ctx.modelRegistry.find(profile.provider, profile.model);

    if (!model) {
      ctx.ui.notify(
        `Profile ${profile.label}: model ${profile.provider}/${profile.model} not found`,
        "error",
      );
      return;
    }

    if (!(await pi.setModel(model))) {
      ctx.ui.notify(
        `Profile ${profile.label}: authentication is unavailable`,
        "error",
      );
      return;
    }

    pi.setThinkingLevel(profile.effort);
    activeProfileIndex = normalizedIndex;
    ctx.ui.notify(`Profile: ${profile.label}`, "info");
  }

  function findCurrentProfile(ctx: ExtensionContext): number {
    const effort = pi.getThinkingLevel();
    return PROFILES.findIndex(
      (profile) =>
        profile.provider === ctx.model?.provider &&
        profile.model === ctx.model?.id &&
        profile.effort === effort,
    );
  }

  async function cycleProfile(
    direction: 1 | -1,
    ctx: ExtensionContext,
  ): Promise<void> {
    const current = findCurrentProfile(ctx);
    const base = current >= 0 ? current : activeProfileIndex ?? (direction > 0 ? -1 : 0);
    await applyProfile(base + direction, ctx);
  }

  function setEffort(level: ThinkingLevel, ctx: ExtensionContext): void {
    pi.setThinkingLevel(level);
    activeProfileIndex = undefined;
    ctx.ui.notify(`Effort: ${level}`, "info");
  }

  for (const [index, profile] of PROFILES.entries()) {
    pi.registerCommand(profile.name, {
      description: `Switch to ${profile.label}`,
      handler: async (_args, ctx) => applyProfile(index, ctx),
    });
  }

  pi.registerCommand("profile-next", {
    description: "Switch to the next Astra/Sol profile",
    handler: async (_args, ctx) => cycleProfile(1, ctx),
  });

  pi.registerCommand("profile-previous", {
    description: "Switch to the previous Astra/Sol profile",
    handler: async (_args, ctx) => cycleProfile(-1, ctx),
  });

  pi.registerShortcut("alt+p", {
    description: "Next Astra/Sol profile",
    handler: async (ctx) => cycleProfile(1, ctx),
  });

  pi.registerShortcut("alt+shift+p", {
    description: "Previous Astra/Sol profile",
    handler: async (ctx) => cycleProfile(-1, ctx),
  });

  pi.registerShortcut("alt+1", {
    description: "Set effort to low",
    handler: async (ctx) => setEffort("low", ctx),
  });

  pi.registerShortcut("alt+2", {
    description: "Set effort to medium",
    handler: async (ctx) => setEffort("medium", ctx),
  });

  pi.registerShortcut("alt+3", {
    description: "Set effort to high",
    handler: async (ctx) => setEffort("high", ctx),
  });
}
