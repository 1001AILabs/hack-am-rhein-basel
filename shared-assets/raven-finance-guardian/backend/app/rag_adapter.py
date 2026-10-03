"""RAVEN RAG Adapter — connects to NVIDIA RAG Blueprint.

Uses the RAG Blueprint's ingestion and retrieval APIs to:
1. Ingest invoice/receipt documents (PDF, images) via NeMo Retriever
2. Retrieve similar past invoices for matching
3. Query vendor/supplier context from the knowledge base
4. Apply NeMo Guardrails for prompt injection defense

The RAG Blueprint runs as a separate Docker Compose stack.
RAVEN's MCP tools call this adapter for document-grounded operations.
"""

import os
import httpx
from typing import Optional

RAG_SERVER_URL = os.environ.get("RAG_SERVER_URL", "http://localhost:8081")
INGESTOR_URL = os.environ.get("RAG_INGESTOR_URL", "http://localhost:8082")


async def check_rag_health() -> dict:
    """Check if the RAG Blueprint stack is healthy."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{RAG_SERVER_URL}/v1/health",
                params={"check_dependencies": "true"},
            )
            return {"status": "healthy" if resp.status_code == 200 else "unhealthy",
                    "detail": resp.json() if resp.status_code == 200 else resp.text}
    except httpx.ConnectError:
        return {"status": "unavailable", "detail": "RAG server not reachable"}


async def ingest_document(
    file_path: str,
    collection_name: str = "raven_invoices",
    metadata: Optional[dict] = None,
) -> dict:
    """Ingest a document into the RAG knowledge base.

    Uses the RAG Blueprint's ingestor server to parse, chunk,
    embed, and store a document (invoice, receipt, bank statement).

    Args:
        file_path: Path to the document (PDF, image, etc.)
        collection_name: Vector DB collection to store in
        metadata: Optional metadata (invoice_id, supplier_id, etc.)
    """
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            with open(file_path, "rb") as f:
                files = {"file": (os.path.basename(file_path), f)}
                data = {"collection_name": collection_name}
                if metadata:
                    data["metadata"] = str(metadata)

                resp = await client.post(
                    f"{INGESTOR_URL}/v1/ingest",
                    files=files,
                    data=data,
                )
                resp.raise_for_status()
                return resp.json()
    except httpx.ConnectError:
        return {"error": "Ingestor server not reachable"}
    except Exception as e:
        return {"error": str(e)}


async def search_similar_invoices(
    query: str,
    collection_name: str = "raven_invoices",
    top_k: int = 5,
) -> dict:
    """Search for similar invoices in the RAG knowledge base.

    Uses vector similarity to find past invoices matching a query.
    Useful for:
    - Finding duplicate invoices by content similarity
    - Matching invoices to transactions
    - Vendor pattern analysis

    Args:
        query: Natural language query or invoice text
        collection_name: Which collection to search
        top_k: Number of results to return
    """
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{RAG_SERVER_URL}/v1/generate",
                json={
                    "messages": [{"role": "user", "content": query}],
                    "collection_name": collection_name,
                    "top_k": top_k,
                    "use_knowledge_base": True,
                    # Disable LLM generation, return only retrieved docs
                    "retrieval_only": True,
                },
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.ConnectError:
        return {"error": "RAG server not reachable"}
    except Exception as e:
        return {"error": str(e)}


async def generate_investigation_report(
    case_evidence: dict,
    collection_name: str = "raven_invoices",
) -> dict:
    """Generate an investigation report using RAG-grounded LLM.

    Retrieves relevant context from the knowledge base and generates
    a structured report with the Nemotron LLM.

    The system prompt enforces RAVEN's safety boundaries:
    - Never confirm fraud
    - Never approve payments
    - Separate facts from hypotheses
    - Cite retrieved documents

    Args:
        case_evidence: The investigation case dict from case_service
        collection_name: Knowledge base to ground the report in
    """
    system_prompt = """You are RAVEN Finance Guardian, a sovereign financial
investigation assistant. Generate a structured investigation report based on
the evidence provided and any relevant documents retrieved from the knowledge base.

Rules:
- Use ONLY the evidence and retrieved documents provided.
- Separate FACTS (verified data) from HYPOTHESES (possible explanations).
- List MISSING INFORMATION that would help resolve the case.
- Recommend HUMAN ACTIONS — never approve payments or confirm fraud.
- Cite retrieved documents when used.
- Never execute trades, post ledger entries, or change supplier IBANs.

Report structure:
1. OBSERVED FACTS
2. CALCULATED FINDINGS
3. RETRIEVED CONTEXT (with citations)
4. UNCONFIRMED HYPOTHESES
5. MISSING INFORMATION
6. RECOMMENDED HUMAN ACTIONS"""

    query = f"""Investigate this financial case and generate a structured report:

Case ID: {case_evidence.get('case_id', 'UNKNOWN')}
Risk Level: {case_evidence.get('risk_level', 'UNKNOWN')}
Status: {case_evidence.get('status', 'UNKNOWN')}

Facts:
{_format_facts(case_evidence.get('facts', []))}

Findings:
{_format_findings(case_evidence.get('findings', []))}

Recommended Actions:
{chr(10).join('- ' + a for a in case_evidence.get('recommended_actions', []))}"""

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{RAG_SERVER_URL}/v1/generate",
                json={
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": query},
                    ],
                    "collection_name": collection_name,
                    "top_k": 3,
                    "use_knowledge_base": True,
                    "temperature": 0,
                    "max_tokens": 1500,
                },
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.ConnectError:
        return {"error": "RAG server not reachable"}
    except Exception as e:
        return {"error": str(e)}


def _format_facts(facts: list[dict]) -> str:
    return "\n".join(
        f"- {f['label']}: {f['value']} (source: {f.get('source', 'unknown')})"
        for f in facts
    )


def _format_findings(findings: list[dict]) -> str:
    return "\n".join(
        f"- {f.get('status', 'UNKNOWN')}: {', '.join(f'{k}={v}' for k, v in f.items() if k != 'status')}"
        for f in findings
    )
