# Prime Adapter

Use this adapter in Prime Agent. Prime Normal/Plan mode and all higher-priority
system or project instructions remain authoritative. Arsenal does not change modes.

- Work solo by default. Approved native delegation follows delegation.md.
  Higher-priority solo instructions remain binding. No Agent Hub, Task-style
  agents, automatic reviewers, or main-model switches.
- Discover skills from the live Prime resource inventory and their real filesystem
  paths. Do not use `skill://` URLs or infer plugin-cache locations.
- Use the existing personal `websearch` skill when external research is needed.
- If a routed skill, tool, authentication, or network capability is unavailable,
  say so. Offer a native fallback, and stop when the capability is essential.
- Ask before dangerous or destructive operations. Proposals require explicit
  acceptance before implementation. Commits are opt-in. Never publish, push,
  create/close issues, install software, or open a browser without authorization.
- Preserve the current model and thinking level. Plain-text questions and status
  are supported; do not claim unavailable structured UI or agent capabilities.
