# Native Prime delegation

Default solo. Obtain explicit approval for the proposed role, bounded scope,
model and expected benefit before each delegation. A generic auto flag is not
consent. Any higher-priority solo rule forbids spawning, even after approval.
Do not launch a model session just to satisfy this workflow.

1. Establish the CURRENT parent model and effort from authoritative session state,
   not the startup model, model name in prompt text, or a cached profile.
2. Read the chosen contract in `../roles/`. Roles: arsenal-product-scout,
   arsenal-harness-analyst, arsenal-adversarial-reviewer, espresso-researcher.
3. Use `await rlm.find_models(...)` to resolve the exact one-tier-down selector.
   Astra -> Sol -> Terra -> Luna; Luna -> Luna, all openai-codex. No silent
   fallback. For other providers or justified same-model work, get an explicit
   decision. Do not retune the main model.
4. Load `../../scripts/delegation.py` with importlib.util from its absolute skill
   path if request/result checks are needed. `select_model(parent, selectors)`
   returns the exact target or fails. `prepare_request(...)` requires approved,
   non-solo context and a current child count. These caller-supplied fields do
   not enforce permissions or atomic concurrency. Append the full role contract.
5. Call the native API directly:

   `handle = await rlm(prompt, name=unique_name, model=exact_selector)`

   Omit `thinking`: Prime inherits the current effort, clamped to capabilities.
   Do not pin Low. Admission returns a handle, NOT the answer. Never await a
   nonexistent result field. Keep the handle; end the turn while work runs.
6. Use `agent_message` for explicit replies, `rlm.list_subagents` for registry
   recovery, and `rlm.delete_subagent` for explicit cancellation. Off switches
   stop future routing but do not kill running children. On user stop, cease
   new work and cancel owned children when appropriate; retain artifacts.
7. Validate the returned JSON with `validate_result(role, payload)`, then check
   evidence yourself. Invalid output is not success; request one correction or
   report the limitation, never loop indefinitely or manufacture findings.

At most three bounded Arsenal children, at most two Espresso research children;
count all active children on this task before admission. No nesting. One owner
for shared builds. Children inherit tools/skills; read-only is a prompt contract,
not isolation. Shape validation does not prove correctness. Child instructions
must not relax Plan, credentials, external-service consent or publication gates.

If the live session still carries the old Phase 1 solo overlay, do not bypass it.
Reload the updated instructions before a separate approved live delegation test.
