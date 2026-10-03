# Hack am Rhein — Basel Life Sciences Ecosystem Navigator

## Project Context
Hackathon project for Hack am Rhein Challenge 1 (Oct 3-5, 2026).
Team: Alaa, Reazul, Leticia, Trudy, Daria.
Pitch: Sunday Oct 5.

## Architecture
Three-layer "Triangle":
1. **Codex** — orchestration, tool-calling, agent reasoning
2. **NVIDIA RAG Blueprint** — pgvector retrieval, knowledge graph, 6 Basel data sources
3. **Apertus 1.5** — Swiss sovereign LLM for final generation (DE/FR/EN)

Plus: React UI (chat + plan + graph viz), ElevenLabs (voice in/out).

## Key Files
- `docs/architecture.md` — full architecture doc
- `backend/agents/tools.py` — 7 agent tools (search_labs, search_investors, etc.)
- `backend/agents/orchestrator.py` — FastAPI main endpoint, Codex-style loop
- `backend/apertus/client.py` — Apertus 1.5 wrapper (OpenAI-compatible vLLM)
- `backend/rag/ingestion/zefix.py` — Zefix Swiss company register connector
- `backend/rag/pgvector/store.py` — pgvector entity store
- `backend/graph/schema.py` — knowledge graph schema + traversal

## Branching
- `main` — stable, working
- `feature/alaa-rag` — backend, RAG, agent tools
- `feature/reazul-graph` — knowledge graph, UI
- `feature/leticia-voice` — ElevenLabs voice
- `feature/trudy-demo` — demo script, pitch
- `feature/daria-data` — data curation

## Commands
```bash
# Backend
python -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
cp .env.example .env
python -m backend.agents.orchestrator  # starts on :8000

# Frontend (once scaffolded)
cd frontend && npm install && npm run dev
```

## Rules
- No secrets in code — use .env (gitignored)
- Commit often, push often
- PR to main, someone reviews
- Keep data/ for JSON snapshots only (gitignored except .gitkeep)
