"""Pure request/response checks. Spawn only through Prime's native rlm API."""
import json

LADDER = {
    "openai-codex/gpt-6-astra": "openai-codex/gpt-5.6-sol",
    "openai-codex/gpt-5.6-sol": "openai-codex/gpt-5.6-terra",
    "openai-codex/gpt-5.6-terra": "openai-codex/gpt-5.6-luna",
    "openai-codex/gpt-5.6-luna": "openai-codex/gpt-5.6-luna",
}
ROLES = {"arsenal-product-scout", "arsenal-harness-analyst",
         "arsenal-adversarial-reviewer", "espresso-researcher"}

def select_model(parent_selector, available_selectors):
    """Fail closed rather than selecting a different provider or guessing."""
    if parent_selector not in LADDER:
        raise ValueError("Parent outside configured ladder; explicit decision required")
    target = LADDER[parent_selector]
    if target not in available_selectors:
        raise ValueError("Exact target unavailable: " + target)
    return target

def prepare_request(role, root, question, frozen_context, *, approved=False,
                    solo=False, active_children=0, limit=3):
    """Caller must establish consent; booleans are not a permission system."""
    if not approved or solo:
        raise PermissionError("Explicit delegation approval and non-solo policy required")
    if limit not in (2, 3) or not 0 <= active_children < limit:
        raise ValueError("Concurrent child limit reached or invalid")
    if role not in ROLES:
        raise ValueError("Unknown role")
    if not all(isinstance(v, str) and v.strip() for v in (root, question, frozen_context)):
        raise ValueError("Root, bounded question, and frozen context required")
    return (f"Role: {role}\nRoot: {root}\nQuestion: {question}\n"
            f"Frozen context: {frozen_context}\n"
            "Read-only investigation. No file edits, external mutations, user questions, "
            "delegation, model switches, advisor, or unrelated repository discovery. "
            "Respect inherited Plan/Normal and permissions. These are behavioral "
            "restrictions, not a sandbox. Report evidence and uncertainty. "
            "Send the result explicitly to the parent with agent_message.send.")

def _record(value, keys):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise ValueError("Unexpected result keys")
    if not all(isinstance(v, str) for v in value.values()):
        raise ValueError("Expected string fields")

def validate_result(role, payload):
    """Validate shape, not truth, completeness, or safety of the findings."""
    if role not in ROLES:
        raise ValueError("Unknown role")
    value = json.loads(payload)
    if role == "arsenal-harness-analyst":
        if not isinstance(value, dict) or set(value) != {"capability_matrix", "risks", "recommendations"}:
            raise ValueError("Unexpected analyst result")
        if not all(isinstance(v, list) for v in value.values()):
            raise ValueError("Analyst fields must be arrays")
        for row in value["capability_matrix"]:
            _record(row, ("capability", "status", "evidence"))
        for row in value["risks"]:
            _record(row, ("risk", "impact", "mitigation"))
        if not all(isinstance(v, str) for v in value["recommendations"]):
            raise ValueError("Recommendations must be strings")
    else:
        if not isinstance(value, list):
            raise ValueError("Expected array")
        if role == "arsenal-product-scout" and len(value) > 5:
            raise ValueError("Scout returns at most five results")
        for row in value:
            if role == "arsenal-product-scout":
                _record(row, ("name", "url", "borrow", "avoid", "confidence", "risk"))
                if row["confidence"] not in {"high", "medium", "low"}:
                    raise ValueError("Invalid confidence")
            elif role == "arsenal-adversarial-reviewer":
                _record(row, ("severity", "section", "issue", "suggestion"))
                if row["severity"] not in {"BLOCKER", "MAJOR", "MINOR", "NIT"}:
                    raise ValueError("Invalid severity")
            else:
                _record(row, ("finding", "evidence", "uncertainty"))
    return value
