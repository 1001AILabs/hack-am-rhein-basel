# Hack am Rhein — Basel Life Sciences Ecosystem Navigator

**Team:** Alaa (1001 AI Labs), Reazul, Leticia, Trudy, Daria
**Challenge 1** | Pitch: Sunday Oct 5, 2026
**Stack:** Codex + NVIDIA RAG Blueprint + Apertus 1.5 + ElevenLabs

## Quick Start

```bash
# Clone
gh repo clone 1001AILabs/hack-am-rhein-basel
cd hack-am-rhein-basel

# Backend
python -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
cp .env.example .env  # fill in API keys
python backend/agents/orchestrator.py

# Frontend
cd frontend && npm install && npm run dev
```

## Architecture

See [docs/architecture.md](docs/architecture.md) for the full plan.

```
USER (voice or text, DE/FR/EN)
  → ElevenLabs (voice in/out)
    → Codex (orchestration + tool-calling)
      → NVIDIA RAG Blueprint (retrieval + graph)
        → Apertus 1.5 (Swiss sovereign LLM, final generation)
```

## Data Sources

| Source | Type |
|---|---|
| Zefix | Swiss commercial register (live API) |
| Basel Super Cluster | Life-sciences cluster |
| BaseLaunch | Biotech accelerator |
| DayOne (Basel Area) | Healthtech innovation |
| Startup.ch | Swiss investor directory |
| Switzerland Innovation Park Basel | Lab space + infrastructure |

## Team Branches

- `feature/alaa-rag` — backend, RAG, Apertus, agent tools
- `feature/reazul-graph` — knowledge graph, UI
- `feature/leticia-voice` — ElevenLabs, polish
- `feature/trudy-demo` — demo script, pitch slides
- `feature/daria-data` — data curation, demo script
