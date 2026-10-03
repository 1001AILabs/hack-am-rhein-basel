"""7 agent tools for the Basel Life Sciences Ecosystem Navigator.

Each tool is a function that Codex can call during orchestration.
All return structured dicts for downstream assembly by Apertus.
"""

from __future__ import annotations

import os
from typing import Optional

import httpx
from dotenv import load_dotenv

load_dotenv()

ZEFIX_API_URL = os.getenv("ZEFIX_API_URL", "https://www.zefix.admin.ch/ZefixREST/api/v1")
POSTGRES_URL = os.getenv("POSTGRES_URL", "")
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "")


# ---------------------------------------------------------------------------
# Tool 1: search_labs
# ---------------------------------------------------------------------------
async def search_labs(discipline: str, location: str = "Basel") -> dict:
    """Search for lab spaces by discipline and location."""
    # TODO: query pgvector for lab entities
    return {
        "tool": "search_labs",
        "query": {"discipline": discipline, "location": location},
        "results": [],
    }


# ---------------------------------------------------------------------------
# Tool 2: search_investors
# ---------------------------------------------------------------------------
async def search_investors(
    stage: str, sector: str, ticket_size: Optional[str] = None
) -> dict:
    """Search for investors by stage, sector, and ticket size."""
    # TODO: query pgvector for investor entities
    return {
        "tool": "search_investors",
        "query": {"stage": stage, "sector": sector, "ticket_size": ticket_size},
        "results": [],
    }


# ---------------------------------------------------------------------------
# Tool 3: search_programs
# ---------------------------------------------------------------------------
async def search_programs(stage: str, sector: str) -> dict:
    """Search for accelerator/incubator programs."""
    # TODO: query pgvector for program entities
    return {
        "tool": "search_programs",
        "query": {"stage": stage, "sector": sector},
        "results": [],
    }


# ---------------------------------------------------------------------------
# Tool 4: search_companies (Zefix live)
# ---------------------------------------------------------------------------
async def search_companies(
    sector: str,
    size: Optional[str] = None,
    zefix_filter: Optional[str] = None,
) -> dict:
    """Search Swiss companies via Zefix API with optional sector/size filters."""
    params = {"name": zefix_filter or sector, "maxNbrOfResults": 20}
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.get(
                f"{ZEFIX_API_URL}/company/search", params=params
            )
            resp.raise_for_status()
            companies = resp.json()
        except httpx.HTTPError:
            companies = []

    return {
        "tool": "search_companies",
        "query": {"sector": sector, "size": size, "zefix_filter": zefix_filter},
        "results": companies[:20],
    }


# ---------------------------------------------------------------------------
# Tool 5: graph_traverse
# ---------------------------------------------------------------------------
async def graph_traverse(
    entity: str, relation: str, depth: int = 2
) -> dict:
    """Traverse the knowledge graph from an entity along a relation type."""
    # TODO: query graph store
    return {
        "tool": "graph_traverse",
        "query": {"entity": entity, "relation": relation, "depth": depth},
        "results": [],
    }


# ---------------------------------------------------------------------------
# Tool 6: generate_action_plan
# ---------------------------------------------------------------------------
async def generate_action_plan(user_profile: dict) -> dict:
    """Generate a 90-day action plan based on user profile and retrieved context.

    This is called AFTER search tools have returned results.
    The orchestrator assembles context and passes it to Apertus.
    """
    return {
        "tool": "generate_action_plan",
        "user_profile": user_profile,
        "plan": None,  # filled by Apertus in orchestrator
    }


# ---------------------------------------------------------------------------
# Tool 7: voice_response
# ---------------------------------------------------------------------------
async def voice_response(text: str, lang: str = "fr") -> dict:
    """Convert text to speech via ElevenLabs."""
    if not ELEVENLABS_API_KEY:
        return {"tool": "voice_response", "error": "ELEVENLABS_API_KEY not set"}

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE_ID}",
            headers={
                "xi-api-key": ELEVENLABS_API_KEY,
                "Content-Type": "application/json",
            },
            json={
                "text": text,
                "model_id": "eleven_multilingual_v2",
                "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
            },
        )
        if resp.status_code == 200:
            audio_path = f"/tmp/voice_{lang}_{hash(text) % 10000}.mp3"
            with open(audio_path, "wb") as f:
                f.write(resp.content)
            return {"tool": "voice_response", "audio_path": audio_path, "lang": lang}

    return {"tool": "voice_response", "error": f"ElevenLabs returned {resp.status_code}"}


# ---------------------------------------------------------------------------
# Tool registry (for Codex / orchestrator)
# ---------------------------------------------------------------------------
TOOLS = {
    "search_labs": search_labs,
    "search_investors": search_investors,
    "search_programs": search_programs,
    "search_companies": search_companies,
    "graph_traverse": graph_traverse,
    "generate_action_plan": generate_action_plan,
    "voice_response": voice_response,
}
