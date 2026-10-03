# Shared Assets from 1001 AI Labs

Existing production code from two 1001 AI Labs repos, provided as reference
and building blocks for the hackathon. Copy what you need into the main
`backend/` or `frontend/` trees — don't import directly from here.

## From `raven-finance-guardian`

| File | What it does | Reuse for Challenge 1 |
|---|---|---|
| `backend/app/rag_adapter.py` | NVIDIA RAG Blueprint client (ingest, search, generate) | Base for our RAG retrieval layer |
| `backend/app/audit.py` | SHA-256 hash-linked audit chain (append-only, verifiable) | Explainability: "why did the system recommend X?" |
| `backend/app/stores.py` | In-memory data store with JSON fixture loading | Pattern for loading Basel ecosystem seed data |
| `backend/app/main.py` | Full FastAPI backend with 20+ endpoints | Reference for our orchestrator API |
| `services/audit_event.py` | OCSF audit event builder + chain verification | Drop-in for audit logging |
| `services/input_guard.py` | Prompt injection scanner (deterministic) | Guard Apertus inputs |
| `services/nim_client.py` | Typed NVIDIA NIM client with retry | Call Nemotron OCR/Parse |
| `services/nim_health.py` | NIM service health checks | Health endpoint for our stack |
| `services/apertus_tax_analyzer.py` | Apertus 1.5 via vLLM (OpenAI-compat) | **Direct reuse** for our Apertus client |
| `services/document_pipeline.py` | OCR → Parse → field extract → validate | Ingest BaseLaunch/DayOne PDFs |
| `services/profile_loader.py` | Hardware profile YAML loader | Profile management |
| `configs/profiles/*.yaml` | Hardware profiles (cpu-only, h100-single, h100-dual) | Config templates |
| `docker-compose*.yml` | Docker Compose for the full stack | Reference for our deployment |
| `requirements.txt` | Python dependencies | Merge into ours |
| `audit/*.json` | Sample OCSF audit events | Reference for audit format |

## From `hackathon-2026`

| File | What it does | Reuse for Challenge 1 |
|---|---|---|
| `src/components/AIInsightPopover.tsx` | "Why did RAG return this?" explainability UI | Adapt for "why this lab/investor?" |
| `src/components/ArchiveUploader.tsx` | Drag-drop file upload with batch processing | Reuse for ingesting Basel PDFs |
| `src/components/DocumentViewer.tsx` | PDF/document viewer with annotations | View source documents |
| `src/components/Sparkline.tsx` | Inline sparkline chart component | Data visualization |
| `src/App.tsx` | Main React app with routing/tabs | Reference for frontend structure |

## Key patterns to reuse

1. **Apertus client** (`services/apertus_tax_analyzer.py`): Already talks to Apertus 1.5 via vLLM's OpenAI-compatible API. Change the system prompt from Swiss tax to Basel ecosystem.

2. **RAG adapter** (`backend/app/rag_adapter.py`): Uses NVIDIA RAG Blueprint's `/v1/ingest` and `/v1/generate`. For pgvector fallback, see `backend/rag/pgvector/store.py` in the main hackathon code.

3. **Audit chain** (`services/audit_event.py` + `backend/app/audit.py`): SHA-256 linked events. Shows judges we log every retrieval + decision. Differentiator.

4. **Input guard** (`services/input_guard.py`): Scans for prompt injection before calling any LLM. Swiss-aware regex patterns.
