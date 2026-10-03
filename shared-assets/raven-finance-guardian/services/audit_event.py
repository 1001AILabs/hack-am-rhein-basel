"""
OCSF audit event builder for RAVEN pipeline decisions.
Every document processing step produces a signed, structured audit record.

Chain linkage: each event carries ``previous_event_hash`` and hashes over
a canonical payload that INCLUDES that link. Modifying any earlier event
breaks every subsequent hash — verify with ``verify_chain(events)``.
"""
from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional


@dataclass
class OCSFAuditEvent:
    class_uid: int = 6003
    category_uid: int = 6
    activity_id: int = 1
    severity_id: int = 1

    document_sha256: str = ""
    pipeline_step: str = ""
    model_id: str = ""
    model_revision: str = ""
    hardware: str = ""
    gpu_count: int = 0
    inference_location: str = "on-premise"
    data_egress: str = "NONE"
    human_approved: bool = False
    approver_id: Optional[str] = None

    confidence: Optional[float] = None
    result_summary: str = ""
    regulatory_basis: list[str] = field(default_factory=lambda: [
        "nLPD Art.6",
        "OR Art.957ff",
    ])

    pipeline_version: str = ""
    policy_version: str = ""
    signature_status: str = "software-test-signature"
    timestamp: str = ""
    previous_event_hash: Optional[str] = None

    def __post_init__(self):
        if not self.timestamp:
            self.timestamp = datetime.now(timezone.utc).isoformat()

    def _canonical_payload(self) -> bytes:
        payload = {k: v for k, v in asdict(self).items()}
        return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()

    def compute_hash(self) -> str:
        return hashlib.sha256(self._canonical_payload()).hexdigest()

    def to_dict(self) -> dict:
        d = asdict(self)
        d["event_hash"] = self.compute_hash()
        return d

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent, default=str)


def verify_chain(events: Iterable[dict]) -> bool:
    """Verify a sequence of serialized OCSF events keeps the hash chain intact.

    Each event's ``event_hash`` must equal the SHA-256 of its canonical payload
    (i.e. ``to_dict()`` minus ``event_hash``), and its ``previous_event_hash``
    must equal the prior event's ``event_hash`` (or None for the first).
    """
    prev_hash: Optional[str] = None
    for evt in events:
        if not isinstance(evt, dict):
            return False
        stored_hash = evt.get("event_hash")
        if stored_hash is None:
            return False
        if evt.get("previous_event_hash") != prev_hash:
            return False
        payload = {k: v for k, v in evt.items() if k != "event_hash"}
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()
        recomputed = hashlib.sha256(canonical).hexdigest()
        if recomputed != stored_hash:
            return False
        prev_hash = stored_hash
    return True


def hash_document(file_path: str) -> str:
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def create_pipeline_event(
    document_path: str,
    step: str,
    model_id: str,
    hardware: str,
    gpu_count: int = 0,
    confidence: Optional[float] = None,
    result_summary: str = "",
    human_approved: bool = False,
    approver_id: Optional[str] = None,
    pipeline_version: str = "0.1.0",
) -> OCSFAuditEvent:
    doc_hash = hash_document(document_path) if Path(document_path).exists() else ""

    return OCSFAuditEvent(
        document_sha256=doc_hash,
        pipeline_step=step,
        model_id=model_id,
        hardware=hardware,
        gpu_count=gpu_count,
        confidence=confidence,
        result_summary=result_summary,
        human_approved=human_approved,
        approver_id=approver_id,
        pipeline_version=pipeline_version,
    )


def write_audit_log(event: OCSFAuditEvent, log_dir: str = "audit") -> str:
    log_path = Path(log_dir)
    log_path.mkdir(parents=True, exist_ok=True)

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"ocsf_{event.pipeline_step}_{ts}.json"
    filepath = log_path / filename

    filepath.write_text(event.to_json())
    return str(filepath)
