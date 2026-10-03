"""Append-only hash-linked audit events.

Each event includes a SHA-256 hash of itself and a reference to
the previous event's hash, forming an immutable chain.
"""

import hashlib
import json
from datetime import datetime, timezone
from uuid import uuid4


def create_audit_event(
    previous_hash: str | None,
    action: str,
    payload: dict,
) -> dict:
    """Create a new audit event linked to the previous event's hash.

    Args:
        previous_hash: SHA-256 hex of the prior event, or None for the first.
        action: What happened (e.g. CREATE_REVIEW_CASE, BLOCK_PROMPT_INJECTION).
        payload: Structured data about the event.

    Returns:
        Dict with event_id, timestamp, action, payload, previous_event_hash,
        and event_hash (SHA-256 of the canonical JSON representation).
    """
    event = {
        "event_id": f"EVT-{uuid4().hex[:12].upper()}",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "action": action,
        "payload": payload,
        "previous_event_hash": previous_hash,
    }

    # Hash the event before adding event_hash to avoid circular reference
    canonical = json.dumps(event, sort_keys=True, separators=(",", ":")).encode()
    event["event_hash"] = hashlib.sha256(canonical).hexdigest()
    return event


def verify_chain(events: list[dict]) -> bool:
    """Verify that a list of audit events forms a valid hash chain.

    Returns True if every event's previous_event_hash matches the prior
    event's event_hash, and the first event has previous_event_hash = None.
    """
    if not events:
        return True

    if events[0]["previous_event_hash"] is not None:
        return False

    for i in range(1, len(events)):
        if events[i]["previous_event_hash"] != events[i - 1]["event_hash"]:
            return False

    return True
