"""Deterministic input guardrail for RAVEN endpoints.

Scans user-supplied content for prompt-injection patterns BEFORE any
model inference or pipeline processing. Pure pattern matching — no LLM,
no external calls, no bypass of deterministic validation.

Flagged content is never silently dropped: it receives a
PROMPT_INJECTION risk flag, which MorgianaReviewCase.can_execute_action()
already treats as a hard block on downstream action execution.

NeMo Guardrails equivalence
---------------------------
This module implements the NeMo Guardrails **input rail** semantics
(https://docs.nvidia.com/nemo/guardrails/latest/user-guides/guardrails-process.html):

  - request-time scan on untrusted content BEFORE the model runs,
  - deterministic + auditable (regex + magic-byte skip, no ML),
  - refusal returned to caller as a structured risk flag, not a masked answer.

To swap in the `nemoguardrails` library later:

    from nemoguardrails import LLMRails, RailsConfig
    config = RailsConfig.from_path("guardrails/config")
    rails = LLMRails(config)
    # then call rails.generate(messages=...) inside the /process handler
    # and translate its refusal event into the same PROMPT_INJECTION flag.

The blocking_flags execution rail (main.py:1302 approve_demo_case) and
the post-model output rail (apertus_tax_analyzer.enforce_tax_safety)
already round out the four-rail NeMo pattern: input · retrieval ·
execution · output. Retrieval rail is TODO — will be enforced once
rag_repo.similar_supplier() adds source-lineage dedup.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

MAX_CONTENT_BYTES = 10 * 1024 * 1024  # 10 MiB upload ceiling

_INJECTION_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("IGNORE_INSTRUCTIONS", re.compile(
        r"ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions|prompts|rules)", re.I)),
    ("DISREGARD_INSTRUCTIONS", re.compile(
        r"disregard\s+(all\s+)?(previous|prior|above|your)\s+(instructions|programming|rules)", re.I)),
    ("SYSTEM_PROMPT_LEAK", re.compile(
        r"(reveal|print|show|repeat|output)\s+(me\s+)?(your|the)\s+(system\s+)?(prompt|instructions)", re.I)),
    ("ROLE_HIJACK", re.compile(
        r"(you\s+are\s+now|act\s+as|pretend\s+to\s+be|from\s+now\s+on\s+you\s+are)\b", re.I)),
    ("DAN_JAILBREAK", re.compile(
        r"\b(DAN|do\s+anything\s+now|jailbreak|developer\s+mode)\b", re.I)),
    ("TOKEN_SMUGGLE", re.compile(
        r"<\s*(system|/s|im_start|im_end)\s*>|\[\[|\{\{system", re.I)),
]

_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


@dataclass
class GuardResult:
    clean: bool
    risk_flags: list[str] = field(default_factory=list)
    matched_patterns: list[str] = field(default_factory=list)
    detail: str = ""


def scan_text(text: str) -> GuardResult:
    """Scan text for prompt-injection patterns. Deterministic, no model call."""
    flags: list[str] = []
    matched: list[str] = []
    for name, pattern in _INJECTION_PATTERNS:
        if pattern.search(text):
            matched.append(name)
    if matched:
        flags.append("PROMPT_INJECTION")
    return GuardResult(
        clean=not matched,
        risk_flags=flags,
        matched_patterns=matched,
        detail=f"Matched patterns: {', '.join(matched)}" if matched else "",
    )


def sanitize_text(text: str) -> str:
    """Strip control characters that can smuggle instructions past parsers."""
    return _CONTROL_CHARS.sub("", text)


_BINARY_MAGIC = (
    b"%PDF-",     # PDF
    b"\x89PNG\r\n\x1a\n",  # PNG
    b"\xff\xd8\xff",  # JPEG
    b"GIF87a", b"GIF89a",  # GIF
    b"II*\x00", b"MM\x00*",  # TIFF
    b"BM",  # BMP
)


def scan_document(content: bytes) -> GuardResult:
    """Scan an uploaded document's decodable text for injection patterns.

    Binary formats (PDF, PNG, JPEG, TIFF, GIF, BMP) are skipped here; their raw
    bytes are noise for text-injection regexes and the extracted OCR text is
    scanned later with scan_text().
    """
    if len(content) > MAX_CONTENT_BYTES:
        return GuardResult(
            clean=False,
            risk_flags=["PROMPT_INJECTION", "OVERSIZED_UPLOAD"],
            matched_patterns=["SIZE_LIMIT"],
            detail=f"Upload exceeds {MAX_CONTENT_BYTES} bytes",
        )
    head = content[:16]
    if any(head.startswith(m) for m in _BINARY_MAGIC):
        return GuardResult(clean=True)
    text = sanitize_text(content.decode("utf-8", errors="ignore"))
    return scan_text(text)
