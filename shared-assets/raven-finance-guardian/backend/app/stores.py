"""In-memory synthetic data stores.

Loads fixtures from data/synthetic/ JSON files.
Production would replace this with database queries.
"""

import json
from pathlib import Path

_DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "synthetic"

_invoices: dict[str, dict] | None = None
_transactions: dict[str, dict] | None = None
_vendors: dict[str, dict] | None = None


def _load_invoices() -> dict[str, dict]:
    global _invoices
    if _invoices is None:
        with open(_DATA_DIR / "invoices.json") as f:
            _invoices = {inv["invoice_id"]: inv for inv in json.load(f)}
    return _invoices


def _load_transactions() -> dict[str, dict]:
    global _transactions
    if _transactions is None:
        with open(_DATA_DIR / "transactions.json") as f:
            _transactions = {tx["transaction_id"]: tx for tx in json.load(f)}
    return _transactions


def _load_vendors() -> dict[str, dict]:
    global _vendors
    if _vendors is None:
        with open(_DATA_DIR / "vendors.json") as f:
            _vendors = {v["supplier_id"]: v for v in json.load(f)}
    return _vendors


def get_invoice(invoice_id: str) -> dict:
    """Return a synthetic invoice by ID, or raise KeyError."""
    invoices = _load_invoices()
    if invoice_id not in invoices:
        raise KeyError(f"Invoice not found: {invoice_id}")
    return invoices[invoice_id]


def get_transaction(transaction_id: str) -> dict:
    """Return a synthetic transaction by ID, or raise KeyError."""
    txs = _load_transactions()
    if transaction_id not in txs:
        raise KeyError(f"Transaction not found: {transaction_id}")
    return txs[transaction_id]


def get_vendor(supplier_id: str) -> dict:
    """Return a synthetic vendor by supplier ID, or raise KeyError."""
    vendors = _load_vendors()
    if supplier_id not in vendors:
        raise KeyError(f"Vendor not found: {supplier_id}")
    return vendors[supplier_id]


def known_hashes() -> set[str]:
    """Return document hashes of previously-settled invoices (for duplicate detection).

    In the POC, this simulates a ledger of already-processed documents.
    The demo-duplicate-001 hash is "already settled", so submitting
    INV-2026-0042 again triggers a duplicate warning.
    """
    return {"sha256:demo-duplicate-001"}


def reset_stores() -> None:
    """Clear cached data — useful for testing."""
    global _invoices, _transactions, _vendors
    _invoices = None
    _transactions = None
    _vendors = None
