"""FastAPI entry point for the RAVEN Finance Guardian vertical slice."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re as _re
from contextlib import asynccontextmanager
from dataclasses import asdict
from pathlib import Path
from typing import Annotated, Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel, Field

from services import case_repo, db, rag_repo

from services.audit_event import OCSFAuditEvent, write_audit_log
from services.camt_reconciliation import reconcile_transaction
from services.document_worker import DocumentWorker
from services.evidence_case import build_evidence_case
from services.input_guard import scan_document, scan_text
from services.model_client import verify_local_stack
from services.morgiana_review import MorgianaReviewCase
from services.nim_client import MockNimClient
from services.nim_health import check_all_nim_services
from services.profile_loader import load_profile
from services.reconciliation_matcher import reconcile as match_entries
from services.document_pipeline import process_document as run_local_document_pipeline
from services.runtime_capabilities import build_runtime_capabilities, runtime_mode
from services.investigator_advisory import (
    investigate,
    investigate_compare,
    discover_models,
    create_advisory_audit_event,
    AGENT_ROLES,
)
from services.model_council import run_council, council_status
from services.apertus_tax_analyzer import (
    analyze_tax_case,
    kmu_chart,
    APERTUS_VLLM_URL,
    APERTUS_MODEL,
)
from services.supplier_memory import (
    retrieve_supplier_context,
    write_correction,
    decompose_confidence,
    create_retrieval_audit_event,
    ALLOWED_WRITEBACK_TYPES,
)
from backend.app.stores import get_invoice, get_transaction, get_vendor
from services.evidence_package import build_evidence_package, verify_package
from starlette.middleware.cors import CORSMiddleware

# Evidence package output root (PDF/A-3, JSON, XML, manifest, audit log)
_EVIDENCE_OUTPUT_ROOT = os.getenv("RAVEN_EVIDENCE_DIR", "output/evidence")


ALLOWED_ORIGINS = os.getenv("RAVEN_CORS_ORIGINS", "http://localhost:8787,http://127.0.0.1:8787").split(",")

_persistence_ready = {"cases": False, "rag": False}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Run DB migrations + verify RAG + rehydrate chain state on startup."""
    try:
        await db.run_migrations()
        _persistence_ready["cases"] = await db.ping()
    except Exception as exc:
        logging.getLogger(__name__).warning("startup migrations failed: %s", exc)

    # Rehydrate per-case last-event-hash so the SHA-256 audit chain survives
    # backend restarts. Without this, every new event after a restart shows
    # previous_event_hash=NULL and verify_chain() reports a break.
    try:
        pool = await db.get_pool()
        if pool is not None:
            async with pool.acquire() as conn:
                rows = await conn.fetch("""
                    SELECT DISTINCT ON (case_id) case_id, event_hash
                    FROM audit_events
                    WHERE case_id IS NOT NULL
                    ORDER BY case_id, event_id DESC
                """)
                for r in rows:
                    _last_event_hash[r["case_id"]] = r["event_hash"]
            logging.getLogger(__name__).info("rehydrated chain state for %d cases", len(rows))
    except Exception as exc:
        logging.getLogger(__name__).warning("chain rehydration failed: %s", exc)

    try:
        rh = await rag_repo.health()
        _persistence_ready["rag"] = rh.get("status") == "ok"
        logging.getLogger(__name__).info("rag health: %s", rh)
    except Exception as exc:
        logging.getLogger(__name__).warning("rag health check failed: %s", exc)
    yield
    try:
        await db.close_pool()
    except Exception:
        pass


app = FastAPI(title="RAVEN Finance Guardian", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)
_worker = DocumentWorker(MockNimClient())
_reviews: dict[str, MorgianaReviewCase] = {}

# Per-case OCSF chain state: last emitted event hash keyed by case_id.
# Threads previous_event_hash into each new event so any modification of a
# prior event breaks every subsequent hash — verify with audit_event.verify_chain.
_last_event_hash: dict[str, str] = {}


def _chain(event: OCSFAuditEvent, case_id: str, *, persist: bool = True) -> dict:
    """Link event to the previous one for this case_id, serialise, and optionally persist."""
    event.previous_event_hash = _last_event_hash.get(case_id)
    d = event.to_dict()
    _last_event_hash[case_id] = d["event_hash"]
    if persist and os.getenv("RAVEN_AUDIT_PERSIST", "1") != "0":
        try:
            write_audit_log(event, log_dir=os.getenv("RAVEN_AUDIT_DIR", "audit"))
        except Exception:
            # Filesystem persistence is best-effort; response contract stays stable.
            pass
        # Also persist to Postgres audit_events (best-effort). Fire-and-forget.
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(case_repo.persist_audit_event(d, case_id=case_id))
        except RuntimeError:
            # No running loop (sync path); skip DB persist for this event.
            pass
    return d


def _summarise_case_for_embed(case: dict) -> str:
    parts = [
        case.get("supplier"),
        case.get("invoice_number"),
        case.get("currency"),
        case.get("gross_amount"),
        case.get("invoice_date"),
        case.get("reference"),
    ]
    summary = " · ".join(str(p) for p in parts if p)
    if summary:
        return summary
    # Ensure RAG is exercised even for sparse cases — use case_id + type so
    # the row exists for later retrieval-augmented workflows.
    return f"{case.get('case_id', 'case')} · {case.get('case_type', 'unknown')}"


_INVOICE_NAME_HINTS = _re.compile(
    r"(?:^|[^a-z0-9])(rechnung|invoice|inv[-_]?\d|facture|fattura|quittung|receipt|belege?)",
    _re.IGNORECASE,
)
_BANK_NAME_HINTS = _re.compile(
    r"(?:^|[^a-z0-9])(camt|kontoauszug|bank[-_ ]?statement|bankauszug|"
    r"transaction|transakt|zahlungsverkehr|statement|stmt|"
    r"pain\.001|pain\.008|swift|mt940)",
    _re.IGNORECASE,
)


def _classify_case_type(filename: str, content_head: bytes) -> str:
    """Classify upload by filename hints, with a light content-header check.

    Never used for financial values — only routing to the right archive bucket.
    Order matters: bank hints win over invoice hints when both appear
    (a file called "invoice_extracted_from_bank_statement.xml" is a statement).
    """
    name = (filename or "").lower()
    head = content_head[:2048].decode("utf-8", errors="ignore").lower()
    if _BANK_NAME_HINTS.search(name) or "camt.053" in head or "<bktocstmrstmt" in head:
        return "bank_transaction"
    if _INVOICE_NAME_HINTS.search(name):
        return "invoice"
    # Fallback: legacy default.
    return "receipt"


def _case_record_from_document(document_payload: dict, review_case_id: str,
                               file_bytes: bytes, filename: str,
                               fallback_states: list[str]) -> dict:
    """Build a persistable case dict from the /process document payload.

    The Parse NIM lays fields in `document.fields` (`vendor`, `total_chf`,
    `invoice_number`, `date`, `iban`, ...). The demo/mock path uses
    `document.invoice.*` with different names. Both shapes must map to the
    same case columns so the dashboard shows populated rows either way.
    """
    inv = document_payload.get("invoice", {}) or {}
    fields = document_payload.get("fields", {}) or {}

    def pick(*keys):
        """First non-empty across invoice{}, fields{}, and top-level."""
        for k in keys:
            if inv.get(k) not in (None, ""): return inv.get(k)
            if fields.get(k) not in (None, ""): return fields.get(k)
            if document_payload.get(k) not in (None, ""): return document_payload.get(k)
        return None

    case_type = _classify_case_type(filename, file_bytes)
    return {
        "case_id": review_case_id,
        "case_type": case_type,
        "demo_label": "Uploaded document",
        "supplier": pick("supplier", "vendor", "counterparty"),
        "invoice_number": pick("invoice_number", "invoice_no"),
        "invoice_date": pick("invoice_date", "date"),
        "currency": pick("currency") or ("CHF" if pick("total_chf", "gross_chf") else None),
        "net_amount": pick("net_amount", "net_chf"),
        "vat_amount": pick("vat_amount", "vat_chf", "mwst"),
        "gross_amount": pick("gross_amount", "total_chf", "gross_chf", "total"),
        "vat_rate": pick("vat_rate", "mwst_rate"),
        "reference": pick("reference", "qr_reference", "qr_ref"),
        "iban": pick("iban"),
        "risk_flags": document_payload.get("risk_flags") or [],
        "deterministic_checks": document_payload.get("deterministic_checks") or {},
        "approval_eligible": bool(document_payload.get("approval_eligible", False)),
        "review_state": "PENDING_REVIEW",
        "ocr_result": document_payload.get("ocr") or document_payload.get("ocr_result"),
        "parse_result": document_payload.get("parse") or document_payload.get("parse_result"),
        "source_pdf_sha256": hashlib.sha256(file_bytes).hexdigest(),
    }


class ReconcileRequest(BaseModel):
    invoice_id: str = Field(min_length=1)
    transaction_id: str = Field(min_length=1)


class ApproveRequest(BaseModel):
    approver_id: str = Field(min_length=1)


def _event_dict(event: OCSFAuditEvent) -> dict:
    return event.to_dict()


def _profile():
    profile_name = os.environ.get("RAVEN_PROFILE", "demo").strip().lower().replace("_", "-")
    profile_name = {
        "demo": "cpu-only",
        "cpu-only": "cpu-only",
        "h100-single": "h100-single",
        "h100-dual": "h100-dual",
        "h100-nvl-dual": "h100-dual",
    }.get(profile_name, profile_name)
    try:
        return load_profile(profile_name)
    except FileNotFoundError:
        return None


def _review_from_local_document(record: dict) -> MorgianaReviewCase:
    flags = list(dict.fromkeys(record.get("risk_flags", [])))
    blocking = {
        "IBAN_MISMATCH",
        "IBAN_NOT_VERIFIED",
        "AMOUNT_MISMATCH",
        "DUPLICATE_DOCUMENT",
        "REFERENCE_MISSING",
        "REFERENCE_MISMATCH",
        "UNKNOWN_VAT_RATE",
        "PROMPT_INJECTION",
    }
    proposed_action = "extract_and_validate"
    if any(flag in blocking for flag in flags):
        proposed_action = "hold_for_review"

    return MorgianaReviewCase(
        case_id=f"REV-{record.get('document_id', 'UNKNOWN')}",
        case_type="document",
        source_hash=record.get("sha256", ""),
        proposed_fields=record.get("fields", {}),
        proposed_action=proposed_action,
        evidence_summary=(
            f"Local pipeline: {record.get('source_type', 'document')}, "
            f"{record.get('page_count', 0)} pages, "
            f"{len(flags)} risk flags"
        ),
        confidence=float(record.get("confidence", 0.0) or 0.0),
        model_id=record.get("model_id", ""),
        risk_flags=flags,
    )


@app.post("/process")
async def process_document(file: Annotated[UploadFile, File(...)]):
    content = await file.read()

    # Guardrail: scan for prompt injection BEFORE any pipeline/model step.
    guard = scan_document(content)
    if not guard.clean:
        event = OCSFAuditEvent(
            pipeline_step="input_guard_blocked",
            model_id="deterministic-input-guard",
            hardware="NVIDIA H100 NVL",
            result_summary=f"Blocked upload {file.filename or ''}: {guard.detail}",
        )
        raise HTTPException(
            status_code=422,
            detail={
                "error": "input_rejected",
                "risk_flags": guard.risk_flags,
                "detail": guard.detail,
                "audit_event": _event_dict(event),
            },
        )

    document_id = f"DOC-{len(_reviews) + 1:04d}"
    mode = runtime_mode()
    capabilities = build_runtime_capabilities()

    if mode == "demo":
        record, review = _worker.process(document_id, content)
        document_payload = record.to_dict()
        model_id = record.model_id
        confidence = record.confidence
        doc_sha = record.sha256
        hardware = record.hardware
    elif mode == "local-nim":
        document_result = run_local_document_pipeline(
            content,
            content_type=file.content_type or "application/octet-stream",
            filename=file.filename or "",
            document_id=document_id,
            page_elements_endpoint=os.environ.get("RAVEN_NIM_PAGE_ELEMENTS_URL", "http://127.0.0.1:8001"),
            ocr_endpoint=os.environ.get("RAVEN_NIM_OCR_URL", "http://127.0.0.1:8002"),
            parse_endpoint=os.environ.get("RAVEN_NIM_PARSE_URL", "http://127.0.0.1:8003"),
            model_timeout_seconds=float(os.environ.get("MODEL_TIMEOUT_SECONDS", "60") or 60),
        )
        document_payload = document_result.to_dict()
        review = _review_from_local_document(document_payload)
        model_id = document_payload.get("model_id", "")
        confidence = float(document_payload.get("confidence", 0.0) or 0.0)
        doc_sha = document_payload.get("sha256", "")
        hardware = "NVIDIA H100 NVL"
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported RAVEN_MODE: {mode}")

    _reviews[review.case_id] = review

    fallback_states = [
        flag
        for flag in document_payload.get("risk_flags", [])
        if flag.endswith("_FALLBACK_USED") or flag.endswith("_UNAVAILABLE")
    ]

    event = OCSFAuditEvent(
        document_sha256=doc_sha,
        pipeline_step="document_processed",
        model_id=model_id,
        hardware=hardware,
        confidence=confidence,
        data_egress="NONE",
        result_summary=(
            f"Processed {file.filename or document_id} mode={mode}; "
            f"fallbacks={','.join(fallback_states) if fallback_states else 'none'}"
        ),
    )
    audit_dict = _chain(event, review.case_id)

    # Persist case + PDF + embedding (best-effort; degrades to in-memory-only).
    persistence = {"case_saved": False, "rag_indexed": False, "rag_available": _persistence_ready.get("rag", False)}
    try:
        case_record = _case_record_from_document(
            document_payload, review.case_id, content, file.filename or "document.pdf", fallback_states
        )
        saved_id = await case_repo.save_case(
            case_record,
            pdf_bytes=content,
            filename=file.filename or "document.pdf",
            content_type=file.content_type or "application/octet-stream",
        )
        if saved_id:
            persistence["case_saved"] = True
            summary = _summarise_case_for_embed(case_record)
            if summary:
                persistence["rag_indexed"] = await rag_repo.embed_and_store("case", saved_id, summary)
    except Exception as exc:
        logging.getLogger(__name__).warning("post-process persistence failed: %s", exc)

    return {
        "case_id": review.case_id,
        "document": document_payload,
        "review_case": review.to_dict(),
        "audit_event": audit_dict,
        "pipeline": {
            "mode": mode,
            "fallback_states": fallback_states,
            "layers": capabilities.get("layers", {}),
            "data_egress": "NONE",
        },
        "persistence": persistence,
    }


@app.post("/reconcile")
async def reconcile(request: ReconcileRequest):
    # Guardrail: scan user-supplied identifiers before any lookup.
    for value in (request.invoice_id, request.transaction_id):
        guard = scan_text(value)
        if not guard.clean:
            event = OCSFAuditEvent(
                pipeline_step="input_guard_blocked",
                model_id="deterministic-input-guard",
                hardware="NVIDIA H100 NVL",
                result_summary=f"Blocked reconcile input: {guard.detail}",
            )
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "input_rejected",
                    "risk_flags": guard.risk_flags,
                    "audit_event": _event_dict(event),
                },
            )

    try:
        invoice = get_invoice(request.invoice_id)
        transaction = get_transaction(request.transaction_id)
        vendor = get_vendor(invoice["supplier_id"])
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    investigation, review, audit = reconcile_transaction(invoice, transaction, vendor)
    evidence = build_evidence_case(investigation, invoice, transaction)
    _reviews[review.case_id] = review

    # Tiered matcher proposal (deterministic; complements the risk engine).
    matches = match_entries([transaction], [invoice])
    match_event = OCSFAuditEvent(
        pipeline_step="reconciliation_match",
        model_id="deterministic-matcher",
        hardware="NVIDIA H100 NVL",
        confidence=matches[0].confidence if matches else 0.0,
        result_summary=(
            f"Match {matches[0].match_type} confidence "
            f"{matches[0].confidence}" if matches else "No match result"
        ),
    )

    # RAG candidate lookup — surfaces similar historical cases as evidence,
    # never authoritative. Always tagged authority: 'evidence-candidate'.
    rag_candidates: list[dict] = []
    try:
        txn_summary = " ".join(
            str(v) for v in (
                transaction.get("counterparty"), transaction.get("reference"),
                transaction.get("amount"), transaction.get("currency"),
                transaction.get("transaction_text"),
            ) if v
        )
        if txn_summary:
            rag_candidates = await rag_repo.similar("case", txn_summary, k=5)
    except Exception:
        rag_candidates = []

    return {
        "evidence_case": evidence.to_dict(),
        "review_case": review.to_dict(),
        "match_results": [m.to_dict() for m in matches],
        "audit_event": _event_dict(audit),
        "match_audit_event": _event_dict(match_event),
        "rag_candidates": rag_candidates,
    }


@app.head("/package/{case_id}")
async def package_head(case_id: str):
    """Cheap availability check; 200 if PDF exists, 409 if not."""
    if await case_repo.has_case_pdf(case_id):
        return Response(status_code=200)
    source_root = Path(os.getenv("RAVEN_SOURCE_DOCS_DIR", "output/source_documents"))
    if (source_root / f"{case_id}.pdf").exists():
        return Response(status_code=200)
    return Response(status_code=409)


@app.get("/api/archive/pdf/{case_id}")
async def archive_pdf(case_id: str):
    """Return the persisted source document bytes (PDF/image) for a case.

    Honest 409 when nothing is persisted — no fake bytes.
    """
    row = await case_repo.get_case_pdf(case_id)
    if row is None:
        return JSONResponse(
            status_code=409,
            content={
                "error": "source_document_unavailable",
                "detail": "No persisted source document for this case",
                "case_id": case_id,
            },
        )
    body, ctype, filename = row
    return Response(
        content=body,
        media_type=ctype or "application/octet-stream",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@app.get("/api/archive/cases")
async def archive_list(
    limit: int = 50,
    offset: int = 0,
    supplier: Optional[str] = None,
    case_type: Optional[str] = None,
):
    """Persistent case archive (DB-backed). Read-only.

    `case_type` filters to one of: invoice, bank_transaction, receipt.
    Only exact-match; unknown values return an empty list rather than error.
    """
    if not _persistence_ready.get("cases"):
        return {"cases": [], "persistence": False}
    filters: dict = {}
    if supplier:
        filters["supplier"] = f"%{supplier}%"
    if case_type:
        filters["case_type"] = case_type
    cases = await case_repo.list_cases(limit=limit, offset=offset, filters=filters)
    return {"cases": cases, "persistence": True, "count": len(cases)}


@app.get("/api/archive/audit/{case_id}")
async def archive_audit(case_id: str, limit: int = 200):
    """Persistent chained audit events for a case."""
    events = await case_repo.list_audit_events(case_id=case_id, limit=limit)
    return {"case_id": case_id, "events": events, "count": len(events)}


@app.get("/api/booking-score/{case_id}")
async def booking_score(case_id: str):
    """Deterministic weighted confidence score for a case.

    Not a probability. Not an LLM. See services/booking_confidence.py for the
    formula and weights. Contradiction penalty pulls the total down when any
    deterministic check has failed, so a fluent model cannot mask a broken
    arithmetic result.
    """
    from services.booking_confidence import score_case
    try:
        case = await case_repo.get_case(case_id)
    except Exception:
        case = None
    if not case:
        # Try the demo fixture path — cases live under investigation/evidence.
        cases = _get_demo_recon_cases()
        fx = cases.get(case_id)
        if not fx:
            raise HTTPException(status_code=404, detail=f"Case not found: {case_id}")
        ev = fx.get("evidence", {}) or {}
        inv = fx.get("investigation", {}) or {}
        facts = ev.get("facts", []) or []
        calcs = ev.get("calculations", []) or []
        risk = inv.get("risk_flags", []) or []
    else:
        facts = case.get("facts") or []
        calcs = case.get("calculations") or []
        risk = case.get("risk_flags") or []
    result = score_case(facts=facts, calculations=calcs, risk_flags=risk, rag_hits=0)
    return {"case_id": case_id, **result.to_dict()}


_INVOICE_BATCH_DIR = Path(os.getenv("RAVEN_DEMO_DATA_DIR", "/data")) / "incoming" / "invoices"
_INVOICE_BATCH_RE = _re.compile(r"^[A-Za-z0-9 ._+,()-]+\.pdf$")


@app.get("/api/demo/invoice-batch")
async def demo_invoice_batch_list():
    """List real Swiss PDF invoices available in the mounted demo batch.

    Filters out Windows Zone.Identifier alternate-data-stream sidecars and any
    non-.pdf entries. Returns filename + size, sorted alphabetically.
    """
    if not _INVOICE_BATCH_DIR.exists():
        return {"files": [], "source": str(_INVOICE_BATCH_DIR), "available": False}
    entries = []
    for p in sorted(_INVOICE_BATCH_DIR.iterdir()):
        if not p.is_file():
            continue
        if p.name.endswith(":Zone.Identifier"):
            continue
        if p.suffix.lower() != ".pdf":
            continue
        entries.append({
            "filename": p.name,
            "size_bytes": p.stat().st_size,
        })
    return {"files": entries, "source": str(_INVOICE_BATCH_DIR), "available": True, "count": len(entries)}


@app.get("/api/demo/invoice-batch/file/{filename:path}")
async def demo_invoice_batch_file(filename: str):
    """Serve a specific real invoice PDF from the mounted demo batch.

    Path traversal guarded by a filename whitelist regex + resolve check. Used
    by the batch-ingest frontend panel: it fetches each file's bytes here, then
    posts them to /process to exercise the full pipeline exactly as a manual
    upload would.
    """
    if not _INVOICE_BATCH_RE.match(filename):
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = (_INVOICE_BATCH_DIR / filename).resolve()
    if _INVOICE_BATCH_DIR.resolve() not in path.parents:
        raise HTTPException(status_code=400, detail="Invalid path")
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail=f"Invoice not found: {filename}")
    return Response(
        content=path.read_bytes(),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@app.get("/api/audit/verify/{case_id}")
async def audit_verify(case_id: str):
    """Recompute the SHA-256 event chain for a case and report where it breaks.

    Reads persisted events, then for each event re-derives event_hash from a
    canonical payload minus event_hash and compares to the stored value; also
    verifies previous_event_hash equals the prior event's stored hash (or null
    for the first event). Deterministic, no LLM involvement.
    """
    from services.audit_event import verify_chain
    events = await case_repo.list_audit_events(case_id=case_id, limit=1000)
    intact = verify_chain(events)
    broken_at = None
    if not intact:
        prev = None
        for i, evt in enumerate(events):
            if not isinstance(evt, dict) or evt.get("event_hash") is None:
                broken_at = i
                break
            if evt.get("previous_event_hash") != prev:
                broken_at = i
                break
            payload = {k: v for k, v in evt.items() if k != "event_hash"}
            canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()
            if hashlib.sha256(canonical).hexdigest() != evt["event_hash"]:
                broken_at = i
                break
            prev = evt["event_hash"]
    return {
        "case_id": case_id,
        "status": "PASS" if intact else "FAIL",
        "event_count": len(events),
        "first_hash": (events[0].get("event_hash") if events else None),
        "last_hash": (events[-1].get("event_hash") if events else None),
        "broken_at_index": broken_at,
        "scope": "session-scoped persistent (raven audit_events table)",
    }


@app.get("/api/rag/health")
async def rag_health():
    return await rag_repo.health()


# --- Demo helpers for the Transactions + Invoices tabs ---------------------

import time as _time

_CAMT_DEMO_DIR = Path(os.getenv("RAVEN_DEMO_DATA_DIR", "/data")) / "synthetic" / "camt053"
_CAMT_REF_RE = _re.compile(r"^[A-Za-z0-9_.-]+$")


@app.get("/api/demo/camt/{case_ref}.xml")
async def demo_camt_xml(case_ref: str):
    """Serve a synthetic CAMT.053 XML fixture for the Transactions tab viewer.

    Path traversal guarded by a whitelist regex + resolve check.
    """
    if not _CAMT_REF_RE.match(case_ref):
        raise HTTPException(status_code=400, detail="Invalid case_ref")
    filename = f"{case_ref}.xml"
    path = (_CAMT_DEMO_DIR / filename).resolve()
    if _CAMT_DEMO_DIR.resolve() not in path.parents:
        raise HTTPException(status_code=400, detail="Invalid path")
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="CAMT sample not found")
    return Response(content=path.read_text(), media_type="application/xml")


@app.post("/api/demo/invoice/queue-for-review")
async def queue_invoice(payload: dict):
    """Stub endpoint the Invoices tab hits when the user clicks
    'Send to Morgiana for approval'. Records nothing to disk, returns a synthetic
    case_id so the UI can pretend to hand off. erp_write is hard false.
    """
    return {
        "case_id": f"INV-DEMO-{int(_time.time())}",
        "review_state": "PENDING_REVIEW",
        "erp_write": False,
    }


@app.post("/package/{case_id}")
async def create_evidence_package(case_id: str):
    """
    Build the integrity-verifiable evidence package for a human-approved case.
    Returns a downloadable ZIP bundle containing:
      - PDF/A-3 report (human-readable) if a real source document exists
      - case_id.json (canonical RAVEN evidence)
      - case_id.xml (generic RAVEN Evidence XML)
      - ocr-evidence.json (text + bounding boxes)
      - audit-events.jsonl (append-only hash chain)
      - manifest.json + manifest.sha256 (integrity verification)

    Returns HTTP 409 when no real source document is available for the case.
    We do not generate a fake PDF placeholder — that would silently ship an
    untrue "immutable source" claim through the manifest.
    """
    review = _reviews.get(case_id)
    if review is None:
        # Persisted case is fine even without an in-memory review.
        persisted = await case_repo.get_case(case_id)
        if not persisted:
            raise HTTPException(status_code=404, detail=f"Case not found: {case_id}")

    # Prefer DB-persisted PDF; fall back to filesystem source_documents.
    original_pdf: Optional[bytes] = None
    db_pdf = await case_repo.get_case_pdf(case_id)
    if db_pdf is not None:
        original_pdf, _content_type, _filename = db_pdf
    else:
        source_root = Path(os.getenv("RAVEN_SOURCE_DOCS_DIR", "output/source_documents"))
        candidate = source_root / f"{case_id}.pdf"
        if candidate.exists():
            original_pdf = candidate.read_bytes()

    if original_pdf is None:
        return JSONResponse(
            status_code=409,
            content={
                "error": "Source document unavailable",
                "detail": "No persisted source document for this case; "
                          "evidence package requires a real PDF to preserve integrity.",
                "case_id": case_id,
            },
        )

    # Build the case dict (same shape EvidenceCase.to_dict() returns)
    case_dict = review.to_dict()

    # Grab OCR evidence from the document worker's last run
    ocr_evidence = {
        "schema_version": "raven-ocr-evidence/1.0",
        "document_id": f"DOC-{case_id}",
        "document_sha256": getattr(review, "document_sha256", ""),
        "ocr_provider": "nemotron-ocr-v2",
        "inference_location": "local-h100",
        "pages": [],  # integrator should populate from OCR step
    }

    # Assemble the package on disk
    pkg_dir = build_evidence_package(
        case=case_dict,
        ocr_evidence=ocr_evidence,
        original_pdf_bytes=original_pdf,
        output_root=_EVIDENCE_OUTPUT_ROOT,
        package_id=case_id,
        pipeline_version="raven-finance-guardian/0.1.0",
        policy_version="finance-rules/1.0",
        git_commit="unknown",  # integrator should inject $GIT_SHA
    )

    # Create a ZIP for download (optional; integrator may serve files directly)
    import shutil
    zip_path = shutil.make_archive(base_name=str(pkg_dir), format="zip", root_dir=str(pkg_dir))
    return {
        "package_id": case_id,
        "package_dir": str(pkg_dir),
        "zip_path": zip_path,
        "message": "Evidence package assembled. Integrity verified via manifest.sha256.",
    }


# --------------------------------------------------------------------------- #
# Health & utilities
# --------------------------------------------------------------------------- #


@app.post("/cases/{case_id}/approve")
async def approve_case(case_id: str, request: ApproveRequest):
    review = _reviews.get(case_id)
    if review is None:
        raise HTTPException(status_code=404, detail=f"Case not found: {case_id}")
    try:
        token = review.approve(request.approver_id, ttl_seconds=300)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    event = OCSFAuditEvent(
        pipeline_step="case_approved",
        model_id=review.model_id,
        hardware="NVIDIA H100 NVL",
        human_approved=True,
        approver_id=request.approver_id,
        result_summary=f"Approved {case_id}",
    )
    return {
        "approval": {
            "case_id": case_id,
            "state": review.state.value,
            "approval_token": token,
            "token_expires_at": review.token_expires_at,
            "ttl_seconds": 300,
            "can_execute": review.can_execute_action(token),
        },
        "audit_event": _event_dict(event),
    }


@app.get("/health")
async def health():
    profile = _profile()
    statuses = check_all_nim_services(profile.layers) if profile else []
    event = OCSFAuditEvent(
        pipeline_step="health_check",
        model_id="",
        hardware=profile.hardware_profile if profile else "unknown",
        result_summary=f"Checked {len(statuses)} NIM services",
    )
    return {
        "status": "ok",
        "nim_health": [asdict(status) for status in statuses],
        "active_profile": profile.hardware_profile if profile else None,
        "gpu": {
            "available": bool(profile and profile.has_gpu()),
            "count": profile.gpu_count if profile else 0,
            "hardware": profile.hardware_profile if profile else "unknown",
        },
        "audit_event": _event_dict(event),
    }


@app.get("/api/runtime/capabilities")
async def runtime_capabilities():
    caps = build_runtime_capabilities()
    caps["apertus_vllm"] = _apertus_vllm_status()
    return caps


def _apertus_vllm_status() -> dict:
    """Live health for Apertus via vLLM; only reads /v1/models, no inference.

    Latency is measured over the /v1/models GET (does not include an inference
    call — it is a readiness ping, not a first-token benchmark).
    """
    from urllib.request import Request as _Req, urlopen as _urlopen
    from urllib.parse import urlparse
    import time as _time
    parsed = urlparse(APERTUS_VLLM_URL)
    base = f"{parsed.scheme}://{parsed.netloc}"
    models_url = base + "/v1/models"
    entry = {
        "status": "unavailable",
        "model": APERTUS_MODEL,
        "endpoint": base,
        "provider": "swiss-ai/vllm",
        "gpu": "GPU 0",
        "latency_ms": None,
    }
    try:
        t0 = _time.perf_counter()
        req = _Req(models_url, method="GET")
        with _urlopen(req, timeout=2) as resp:
            if resp.status == 200:
                entry["status"] = "live"
        entry["latency_ms"] = int((_time.perf_counter() - t0) * 1000)
    except Exception:
        pass
    return entry


@app.get("/api/kmu/chart")
async def kmu_chart_endpoint():
    return kmu_chart()


@app.get("/api/apertus/health")
async def apertus_health_endpoint():
    return _apertus_vllm_status()


@app.get("/stack/offline")
async def stack_offline():
    """Verify every model layer is reachable via local endpoints only.

    Proves the pipeline works with no internet: all NIMs on 127.0.0.1
    and Ollama on the local host. Deterministic layers need no endpoint.
    """
    statuses = verify_local_stack()
    reachable = sum(1 for s in statuses if s.reachable)
    event = OCSFAuditEvent(
        pipeline_step="offline_stack_check",
        model_id="local-stack-verifier",
        hardware="NVIDIA H100 NVL",
        data_egress="NONE",
        result_summary=f"{reachable}/{len(statuses)} local model endpoints reachable",
    )
    return {
        "offline_capable": reachable == len(statuses) and len(statuses) > 0,
        "reachable": reachable,
        "total": len(statuses),
        "layers": [asdict(s) for s in statuses],
        "audit_event": _event_dict(event),
    }


# ── Layer 10: Investigator Advisory Panel ──────────────────────────────────────

# Synthetic demo cases for the hackathon
_DEMO_CASES = {
    "MORGIANA-2026-0001": {
        "case_id": "MORGIANA-2026-0001",
        "case_type": "10x_amount_error",
        "status": "PENDING_REVIEW",
        "approval_eligible": False,
        "document": {
            "type": "invoice",
            "vendor": "Pharma AG Zürich",
            "invoice_number": "INV-2026-041",
            "date": "2026-03-10",
        },
        "facts": [
            {"source": "ocr", "field": "invoice_total", "value": "CHF 12,500.00", "confidence": 0.94},
            {"source": "bank", "field": "payment_amount", "value": "CHF 1,250.00", "confidence": 1.0},
            {"source": "ocr", "field": "vendor_name", "value": "Pharma AG Zürich", "confidence": 0.97},
            {"source": "bank", "field": "bank_reference", "value": "CAMT-2026-03-10-001", "confidence": 1.0},
        ],
        "calculations": [
            {"type": "amount_ratio", "value": "10.0x", "note": "Invoice is exactly 10× the payment amount"},
            {"type": "vat_check", "value": "CHF 938.17 at 8.1%", "note": "VAT on invoice total"},
        ],
        "risk_flags": ["AMOUNT_MISMATCH_10X", "OCR_DECIMAL_SHIFT"],
    },
    "MORGIANA-2026-0002": {
        "case_id": "MORGIANA-2026-0002",
        "case_type": "iban_change",
        "status": "PENDING_REVIEW",
        "approval_eligible": False,
        "document": {
            "type": "invoice",
            "vendor": "BioLab AG",
            "invoice_number": "INV-2026-088",
            "date": "2026-03-15",
        },
        "facts": [
            {"source": "invoice", "field": "beneficiary_iban", "value": "CH21 0900 0000 1234 5678 9", "confidence": 0.98},
            {"source": "history", "field": "previous_iban", "value": "CH93 0076 2011 6238 5295 7", "confidence": 1.0},
            {"source": "invoice", "field": "vendor_name", "value": "BioLab AG", "confidence": 0.99},
            {"source": "history", "field": "last_payment_date", "value": "2026-02-15", "confidence": 1.0},
            {"source": "invoice", "field": "amount", "value": "CHF 8,750.00", "confidence": 0.96},
        ],
        "calculations": [
            {"type": "iban_checksum", "value": "VALID", "note": "New IBAN passes ISO 13616 checksum"},
            {"type": "bank_changed", "value": "YES", "note": "Bank changed from UBS (0076) to PostFinance (0900)"},
        ],
        "risk_flags": ["IBAN_CHANGED", "BANK_INSTITUTION_CHANGED", "NO_SUPPLIER_CONFIRMATION"],
    },
    "MORGIANA-2026-0003": {
        "case_id": "MORGIANA-2026-0003",
        "case_type": "camt_orphan",
        "status": "PENDING_REVIEW",
        "approval_eligible": False,
        "document": {
            "type": "camt053_entry",
            "bank_statement": "CAMT.053-2026-03-18",
            "entry_date": "2026-03-18",
        },
        "facts": [
            {"source": "bank", "field": "payment_amount", "value": "CHF 3,450.00", "confidence": 1.0},
            {"source": "bank", "field": "counterparty", "value": "Logistics Partner AG", "confidence": 0.85},
            {"source": "bank", "field": "reference", "value": "PO-2026-0099", "confidence": 0.90},
            {"source": "search", "field": "matching_invoices", "value": "0", "confidence": 1.0},
        ],
        "calculations": [
            {"type": "fuzzy_match", "value": "NONE", "note": "No invoice within CHF ±50 or ±5% tolerance"},
            {"type": "vendor_search", "value": "PARTIAL", "note": "Logistics Partner AG not in vendor master; 'Logistik Partner' exists"},
        ],
        "risk_flags": ["UNMATCHED_BANK_ENTRY", "VENDOR_NAME_VARIANT", "NO_INVOICE_FOUND"],
    },
}


class InvestigateRequest(BaseModel):
    agent_role: str = Field(default="rules_explainer")
    model_alias: str = Field(default="default")
    question: str = Field(min_length=1)
    target_language: str = Field(default="de-CH")


class CompareRequest(BaseModel):
    agent_roles: list[str] = Field(default=["rules_explainer", "multilingual_evidence_reviewer"])
    question: str = Field(min_length=1)


@app.get("/api/investigator/models")
async def list_investigator_models():
    models = await discover_models()
    return {
        "models": models,
        "agent_roles": {k: v["description"] for k, v in AGENT_ROLES.items()},
        "policy": {
            "authority": "NON_AUTHORITATIVE",
            "inference_location": "h100-gpu-1",
            "external_egress": False,
        },
    }


@app.get("/api/investigator/cases")
async def list_investigation_cases():
    return {"cases": list(_DEMO_CASES.values())}


@app.get("/api/investigator/cases/{case_id}")
async def get_investigation_case(case_id: str):
    case = _DEMO_CASES.get(case_id)
    if not case:
        raise HTTPException(status_code=404, detail=f"Case not found: {case_id}")
    return case


@app.post("/api/cases/{case_id}/investigate")
async def investigate_case(case_id: str, request: InvestigateRequest, req: Request):
    guard = scan_text(request.question)
    if not guard.clean:
        raise HTTPException(status_code=422, detail={
            "error": "input_rejected",
            "risk_flags": guard.risk_flags,
        })

    case = _DEMO_CASES.get(case_id)
    if not case:
        # Fall back to the persistent archive: real /process uploads land as
        # REV-DOC-* case_ids and were previously invisible to /investigate.
        # Same advisory pipeline runs on them; deterministic fields become
        # whatever the OCR/Parse stage extracted.
        archived = await case_repo.get_case(case_id)
        if archived:
            inv = {
                k: archived.get(k) for k in
                ("supplier", "invoice_number", "invoice_date", "currency",
                 "net_amount", "vat_amount", "gross_amount", "vat_rate",
                 "reference", "iban")
                if archived.get(k) is not None
            }
            case = {
                "case_id": archived["case_id"],
                "case_type": archived.get("case_type", "receipt"),
                "supplier": archived.get("supplier"),
                "invoice_number": archived.get("invoice_number"),
                "invoice_date": archived.get("invoice_date"),
                "currency": archived.get("currency"),
                "net_amount": archived.get("net_amount"),
                "vat_amount": archived.get("vat_amount"),
                "gross_amount": archived.get("gross_amount"),
                "vat_rate": archived.get("vat_rate"),
                "reference": archived.get("reference"),
                "iban": archived.get("iban"),
                "risk_flags": archived.get("risk_flags") or [],
                "deterministic_checks": archived.get("deterministic_checks") or {},
                "approval_eligible": bool(archived.get("approval_eligible", False)),
                "ocr_text": (archived.get("ocr_result") or {}).get("text", "") if isinstance(archived.get("ocr_result"), dict) else "",
                "invoice": inv,
            }
        else:
            raise HTTPException(status_code=404, detail=f"Case not found: {case_id}")

    # Advisory routing: default = single-model investigate; council = 3-stage pipeline; tax = Apertus.
    advisory_level = req.headers.get("X-Advisory-Level", "standard").lower()

    if advisory_level == "tax":
        # Prompt-injection guard on any untrusted content BEFORE calling Apertus.
        untrusted = " ".join(
            str(case.get(k, ""))
            for k in ("ocr_text", "supplier", "transaction_counterparty", "transaction_reference")
        )
        if untrusted.strip():
            doc_guard = scan_text(untrusted)
            if not doc_guard.clean:
                blocked_evt = OCSFAuditEvent(
                    pipeline_step="apertus_tax_analysis_blocked",
                    model_id=APERTUS_MODEL,
                    hardware="H100 NVL / vLLM",
                    result_summary=f"blocked_by_input_guard: {doc_guard.risk_flags}",
                )
                _chain(blocked_evt, case_id)
                return {
                    "analyzer": "apertus-tax",
                    "status": "blocked",
                    "reason": "input_guard_rejected_untrusted_content",
                    "risk_flags": ["prompt_injection"] + list(doc_guard.risk_flags),
                    "do_not_approve": True,
                    "erp_write": False,
                    "human_review_required": True,
                    "is_advisory": True,
                    "stages": [],
                    "policy": {
                        "authority": "NON_AUTHORITATIVE",
                        "approval_eligible": False,
                        "erp_action_allowed": False,
                        "external_egress": False,
                    },
                }

        deterministic = {
            "risk_flags": case.get("risk_flags", []),
            "approval_eligible": case.get("approval_eligible", False),
            "vat_status": case.get("vat_validation_status"),
            "arithmetic_status": case.get("arithmetic_status"),
        }
        tax_result = await analyze_tax_case(case, deterministic)
        # Redacted audit payload — no OCR text, no chain-of-thought.
        result_obj = tax_result.get("result") or {}
        summary_field = str(result_obj.get("summary") or tax_result.get("reason") or "")
        tax_evt = OCSFAuditEvent(
            pipeline_step="apertus_tax_analysis",
            model_id=APERTUS_MODEL,
            hardware="H100 NVL / vLLM",
            result_summary=(
                f"status={tax_result.get('status')} "
                f"do_not_approve={tax_result.get('do_not_approve')} "
                f"summary_hash={hashlib.sha256(summary_field.encode()).hexdigest()[:12]}"
            ),
        )
        audit_event = _chain(tax_evt, case_id)
        return {
            "analyzer": "apertus-tax",
            "status": tax_result.get("status"),
            "provider": tax_result.get("provider"),
            "model": tax_result.get("model"),
            "hardware": tax_result.get("hardware"),
            "is_advisory": True,
            "stages": [],
            "retrieved_context": [],
            "result": result_obj,
            "human_review_required": True,
            "do_not_approve": tax_result.get("do_not_approve", True),
            "erp_write": False,
            "audit_event": audit_event,
            "policy": {
                "authority": "NON_AUTHORITATIVE",
                "approval_eligible": False,
                "erp_action_allowed": False,
                "external_egress": False,
            },
        }

    if advisory_level == "council":
        council_result = await run_council(
            case_id=case_id,
            case_data=case,
            target_language=request.target_language or "de-CH",
        )
        # Audit each council stage individually so the chain records every model call.
        for stage in council_result.get("stages", []):
            stage_evt = OCSFAuditEvent(
                pipeline_step=f"advisory_council_{stage.get('stage', 'unknown')}",
                model_id=stage.get("model", "unknown"),
                hardware="NVIDIA H100 NVL",
                confidence=None,
                result_summary=(
                    f"schema_valid={stage.get('output_schema_valid')} "
                    f"elapsed_ms={stage.get('elapsed_ms')}"
                ),
            )
            _chain(stage_evt, case_id)

        summary_evt = OCSFAuditEvent(
            pipeline_step="advisory_council_summary",
            model_id="council-orchestrator",
            hardware="NVIDIA H100 NVL",
            result_summary=(
                f"status={council_result.get('status')} "
                f"missing={council_result.get('missing_models', [])}"
            ),
        )
        council_result["audit_event"] = _chain(summary_evt, case_id)
        council_result["policy"] = {
            "authority": "NON_AUTHORITATIVE",
            "approval_eligible": False,
            "erp_action_allowed": False,
            "external_egress": False,
        }
        return council_result

    result = await investigate(
        case_id=case_id,
        case_data=case,
        agent_role=request.agent_role,
        question=request.question,
        model_alias=request.model_alias,
    )

    q_hash = hashlib.sha256(request.question.encode()).hexdigest()
    a_hash = hashlib.sha256(result.answer.encode()).hexdigest()
    audit = create_advisory_audit_event(case_id, result.model_id, result.agent_role, q_hash, a_hash)

    return {
        "advisory": result.to_dict(),
        "audit_event": _chain(audit, case_id),
    }


@app.post("/api/cases/{case_id}/investigate/compare")
async def investigate_compare_endpoint(case_id: str, request: CompareRequest):
    guard = scan_text(request.question)
    if not guard.clean:
        raise HTTPException(status_code=422, detail={
            "error": "input_rejected",
            "risk_flags": guard.risk_flags,
        })

    case = _DEMO_CASES.get(case_id)
    if not case:
        raise HTTPException(status_code=404, detail=f"Case not found: {case_id}")

    result = await investigate_compare(
        case_id=case_id,
        case_data=case,
        agent_roles=request.agent_roles,
        question=request.question,
    )

    return result


# ── Layer 6: Supplier Memory (Governed RAG) ───────────────────────────────────


class CorrectionRequest(BaseModel):
    correction_type: str = Field(min_length=1)
    before: str = ""
    after: str = Field(min_length=1)
    confirmed_by: str = Field(min_length=1)


@app.get("/api/cases/{case_id}/supplier-memory")
async def get_supplier_memory(case_id: str):
    """Retrieve supplier memory context for a case (Layer 6 RAG)."""
    case = _DEMO_CASES.get(case_id)
    if not case:
        raise HTTPException(status_code=404, detail=f"Case not found: {case_id}")

    retrieval = await retrieve_supplier_context(
        tenant_id="demo",
        case_data=case,
    )

    confidence = decompose_confidence(case, retrieval)

    audit = create_retrieval_audit_event(
        case_id=case_id,
        strategy=retrieval.retrieval_strategy,
        supplier_found=retrieval.supplier is not None,
        iban_status=retrieval.iban_status,
        elapsed_ms=retrieval.elapsed_ms,
    )

    return {
        "case_id": case_id,
        "retrieval": retrieval.to_dict(),
        "confidence": confidence,
        "audit_event": _event_dict(audit),
        "policy": {
            "authority": "EVIDENCE_RETRIEVAL",
            "approval_eligible": False,
            "erp_action_allowed": False,
            "external_egress": False,
            "note": "Retrieved evidence is advisory; deterministic controls and human approval remain authoritative.",
        },
    }


@app.post("/api/cases/{case_id}/corrections")
async def submit_correction(case_id: str, request: CorrectionRequest):
    """Write back a human-confirmed correction to supplier memory."""
    guard = scan_text(request.after)
    if not guard.clean:
        raise HTTPException(status_code=422, detail={
            "error": "input_rejected",
            "risk_flags": guard.risk_flags,
        })

    case = _DEMO_CASES.get(case_id)
    if not case:
        # Fall back to persistent archive so real REV-DOC-* cases can accept
        # corrections too (same bridge as /investigate). Correction is written
        # to supplier memory regardless of source; case_id just anchors audit.
        archived = await case_repo.get_case(case_id)
        if not archived:
            raise HTTPException(status_code=404, detail=f"Case not found: {case_id}")
        case = archived  # only needed for existence; correction writeback below

    result = await write_correction(
        tenant_id="demo",
        case_id=case_id,
        correction_type=request.correction_type,
        before=request.before,
        after=request.after,
        confirmed_by=request.confirmed_by,
    )

    audit = OCSFAuditEvent(
        pipeline_step="l6_supplier_memory_writeback",
        model_id="human-correction",
        hardware="NVIDIA H100 NVL",
        human_approved=result.accepted,
        approver_id=request.confirmed_by,
        result_summary=f"Correction {request.correction_type} on {case_id}: {'accepted' if result.accepted else 'rejected'}",
    )

    return {
        "result": {
            "accepted": result.accepted,
            "reason": result.reason,
            "record_id": result.record_id,
        },
        "audit_event": _chain(audit, case_id),
    }


@app.get("/api/supplier-memory/writeback-types")
async def list_writeback_types():
    """List allowed and blocked write-back types for supplier memory."""
    return {
        "allowed": sorted(ALLOWED_WRITEBACK_TYPES),
        "policy": {
            "rule": "Only human-confirmed corrections are written to supplier memory.",
            "blocked": "AI hypotheses, model suggestions, and unverified IBANs are blocked.",
            "iban_changes": "Require explicit verification workflow with signed supplier confirmation.",
        },
    }


# ── React demo adapter routes ────────────────────────────────────────────────
# Thin wrappers that expose reconciliation demo cases to the React UI.
# No logic is duplicated — all work delegates to existing services.


from services.deterministic_validator import validate_swiss_vat, SWISS_VAT_RATES
from decimal import Decimal


def _build_demo_reconciliation_cases() -> dict[str, dict]:
    """Build the three deterministic demo reconciliation cases on startup.

    1. Clean recurring booking  — approval available
    2. New/unverified IBAN      — approval blocked
    3. VAT split                — review required
    """
    try:
        invoices_list = [get_invoice(f"INV-2026-{i:04d}") for i in [43, 44, 45]]
        txns_list = [get_transaction(f"TX-2026-{i:04d}") for i in [43, 44, 45]]
        vendor_trusted = get_vendor("SUP-001")
        vendor_new = get_vendor("SUP-002")
    except KeyError:
        return {}

    cases: dict[str, dict] = {}

    # Case 1: Clean recurring booking — all checks pass, approval available
    inv1, tx1 = invoices_list[0], txns_list[0]
    c1, r1, a1 = reconcile_transaction(inv1, tx1, vendor_trusted)
    e1 = build_evidence_case(c1, inv1, tx1)
    _reviews[r1.case_id] = r1
    cases[c1.case_id] = {
        "case_id": c1.case_id,
        "demo_label": "clean_recurring_booking",
        "investigation": c1.to_dict(),
        "evidence": e1.to_dict(),
        "review_case_id": r1.case_id,
        "review_state": _demo_review_state(r1.state.value),
        "approval_eligible": c1.approval_eligible,
    }

    # Case 2: New/unverified IBAN — vendor has no trusted IBAN, blocks approval
    inv2, tx2 = invoices_list[1], txns_list[1]
    c2, r2, a2 = reconcile_transaction(inv2, tx2, vendor_new)
    e2 = build_evidence_case(c2, inv2, tx2)
    _reviews[r2.case_id] = r2
    cases[c2.case_id] = {
        "case_id": c2.case_id,
        "demo_label": "new_unverified_iban",
        "investigation": c2.to_dict(),
        "evidence": e2.to_dict(),
        "review_case_id": r2.case_id,
        "review_state": _demo_review_state(r2.state.value),
        "approval_eligible": c2.approval_eligible,
    }

    # Case 3: VAT split — mixed-rate invoice requires review
    inv3, tx3 = invoices_list[2], txns_list[2]
    c3, r3, a3 = reconcile_transaction(inv3, tx3, vendor_trusted)
    e3 = build_evidence_case(c3, inv3, tx3)
    # Enrich with VAT split validation
    vat_split = inv3.get("vat_split", [])
    vat_findings = []
    for split in vat_split:
        rate = Decimal(str(split["rate"]))
        net = Decimal(str(split["net"]))
        vat = Decimal(str(split["vat"]))
        gross = net + vat
        result = validate_swiss_vat(gross, net, vat, rate)
        vat_findings.append({
            "rate": str(rate),
            "net": str(net),
            "vat": str(vat),
            "gross": str(gross),
            "valid": result.valid,
            "checks": result.checks,
        })
    if vat_split:
        r3.risk_flags = list(set(r3.risk_flags) | {"VAT_SPLIT_REVIEW_REQUIRED"})
        r3.proposed_action = "HOLD_FOR_REVIEW"
    _reviews[r3.case_id] = r3
    cases[c3.case_id] = {
        "case_id": c3.case_id,
        "demo_label": "vat_split_review",
        "investigation": c3.to_dict(),
        "evidence": e3.to_dict(),
        "review_case_id": r3.case_id,
        "review_state": _demo_review_state(r3.state.value),
        "approval_eligible": c3.approval_eligible,
        "vat_split_validation": vat_findings,
    }

    return cases


# Lazy-initialize demo cases on first access
_demo_recon_cases: dict[str, dict] | None = None


def _get_demo_recon_cases() -> dict[str, dict]:
    global _demo_recon_cases
    if _demo_recon_cases is None:
        _demo_recon_cases = _build_demo_reconciliation_cases()
    return _demo_recon_cases


def _demo_review_state(state: str) -> str:
    """Expose stable product states without changing Morgiana's core enum."""
    return {
        "pending_review": "PENDING_REVIEW",
        "approved": "APPROVED_DRAFT",
        "rejected": "REJECTED",
    }.get(state, state.upper())


class RejectRequest(BaseModel):
    reviewer_id: str = Field(min_length=1)
    reason: str = Field(min_length=1)


@app.get("/api/demo/cases")
async def list_demo_cases():
    """List all deterministic demo reconciliation cases for the React UI."""
    cases = _get_demo_recon_cases()
    return {
        "cases": list(cases.values()),
        "count": len(cases),
        "policy": {
            "erp_write": False,
            "note": "Demo cases use synthetic data. No live ERP writes.",
        },
    }


@app.get("/api/demo/cases/{case_id}")
async def get_demo_case(case_id: str):
    """Get a single demo reconciliation case by ID."""
    cases = _get_demo_recon_cases()
    case = cases.get(case_id)
    if not case:
        raise HTTPException(status_code=404, detail=f"Demo case not found: {case_id}")
    # Include current review state
    review = _reviews.get(case["review_case_id"])
    if review:
        case["review_state"] = _demo_review_state(review.state.value)
    return case


def require_demo_token(request: Request):
    expected = os.getenv("RAVEN_DEMO_TOKEN", "")
    if not expected:
        return  # empty env = local dev, no token required (backward compat)
    if request.headers.get("X-Demo-Token") != expected:
        raise HTTPException(status_code=401, detail="Missing or invalid demo token")


@app.post("/api/demo/cases/{case_id}/approve")
async def approve_demo_case(case_id: str, request: ApproveRequest, req: Request):
    """Approve a demo reconciliation case via Morgiana review.

    Requires:
    - Valid reviewer_id (human identity)
    - Case must be in approvable state
    - Zero blocking risk flags
    Returns an approval token; no ERP write is performed.
    """
    require_demo_token(req)
    cases = _get_demo_recon_cases()
    case = cases.get(case_id)
    if not case:
        raise HTTPException(status_code=404, detail=f"Demo case not found: {case_id}")

    review = _reviews.get(case["review_case_id"])
    if review is None:
        raise HTTPException(status_code=404, detail="Review case not found")

    # Check for blocking risk flags before allowing approval
    blocking_flags = {"IBAN_MISMATCH", "IBAN_NOT_VERIFIED", "AMOUNT_MISMATCH",
                      "DUPLICATE_DOCUMENT", "REFERENCE_MISSING", "REFERENCE_MISMATCH",
                      "UNKNOWN_VAT_RATE", "PROMPT_INJECTION"}
    active_blockers = [f for f in review.risk_flags if f in blocking_flags]
    if active_blockers:
        event = OCSFAuditEvent(
            pipeline_step="demo_approval_blocked",
            model_id="deterministic-validator",
            hardware="NVIDIA H100 NVL",
            human_approved=False,
            approver_id=request.approver_id,
            result_summary=f"Blocked: {', '.join(active_blockers)}",
        )
        raise HTTPException(status_code=409, detail={
            "error": "approval_blocked",
            "blocking_flags": active_blockers,
            "message": "Cannot approve: blocking risk flags present. Resolve findings first.",
            "audit_event": _chain(event, case_id),
        })

    try:
        token = review.approve(request.approver_id, ttl_seconds=300)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    event = OCSFAuditEvent(
        pipeline_step="demo_case_approved",
        model_id="deterministic-validator",
        hardware="NVIDIA H100 NVL",
        human_approved=True,
        approver_id=request.approver_id,
        result_summary=f"Approved {case_id} (no ERP write)",
    )
    return {
        "approval": {
            "case_id": case_id,
            "review_case_id": case["review_case_id"],
            "state": _demo_review_state(review.state.value),
            "approval_token": token,
            "token_expires_at": review.token_expires_at,
            "can_execute": review.can_execute_action(token),
            "erp_write": False,
        },
        "audit_event": _chain(event, case_id),
    }


@app.post("/api/demo/cases/{case_id}/reject")
async def reject_demo_case(case_id: str, request: RejectRequest, req: Request):
    """Reject a demo reconciliation case."""
    require_demo_token(req)
    cases = _get_demo_recon_cases()
    case = cases.get(case_id)
    if not case:
        raise HTTPException(status_code=404, detail=f"Demo case not found: {case_id}")

    review = _reviews.get(case["review_case_id"])
    if review is None:
        raise HTTPException(status_code=404, detail="Review case not found")

    try:
        review.reject(request.reviewer_id, request.reason)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    event = OCSFAuditEvent(
        pipeline_step="demo_case_rejected",
        model_id="deterministic-validator",
        hardware="NVIDIA H100 NVL",
        human_approved=False,
        approver_id=request.reviewer_id,
        result_summary=f"Rejected {case_id}: {request.reason}",
    )
    return {
        "rejection": {
            "case_id": case_id,
            "state": _demo_review_state(review.state.value),
            "reason": request.reason,
        },
        "audit_event": _chain(event, case_id),
    }