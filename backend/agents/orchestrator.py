"""Codex-style orchestrator: receives user query, calls tools, assembles context, calls Apertus."""

from __future__ import annotations

import asyncio
import json
import os

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from backend.agents.tools import TOOLS
from backend.apertus.client import generate_with_apertus

load_dotenv()

app = FastAPI(title="Basel Life Sciences Navigator", version="0.1.0")


class UserQuery(BaseModel):
    text: str
    lang: str = "en"
    user_profile: dict | None = None


class NavigatorResponse(BaseModel):
    answer: str
    sources: list[dict]
    action_plan: dict | None = None
    audio_url: str | None = None


TOOL_DESCRIPTIONS = [
    {
        "name": "search_labs",
        "description": "Search for lab spaces by discipline and location in Basel.",
        "parameters": {"discipline": "string", "location": "string (default: Basel)"},
    },
    {
        "name": "search_investors",
        "description": "Search for investors by stage, sector, and ticket size.",
        "parameters": {"stage": "string", "sector": "string", "ticket_size": "string (optional)"},
    },
    {
        "name": "search_programs",
        "description": "Search for accelerator/incubator programs by stage and sector.",
        "parameters": {"stage": "string", "sector": "string"},
    },
    {
        "name": "search_companies",
        "description": "Search Swiss companies via Zefix by sector, size, or name filter.",
        "parameters": {"sector": "string", "size": "string (optional)", "zefix_filter": "string (optional)"},
    },
    {
        "name": "graph_traverse",
        "description": "Traverse the knowledge graph from an entity along a relation type.",
        "parameters": {"entity": "string", "relation": "string", "depth": "int (default: 2)"},
    },
    {
        "name": "generate_action_plan",
        "description": "Generate a 90-day action plan based on user profile and retrieved context.",
        "parameters": {"user_profile": "dict"},
    },
    {
        "name": "voice_response",
        "description": "Convert text to speech via ElevenLabs.",
        "parameters": {"text": "string", "lang": "string (default: fr)"},
    },
]


async def execute_tool_calls(tool_calls: list[dict]) -> list[dict]:
    """Execute a list of tool calls in parallel."""
    tasks = []
    for call in tool_calls:
        tool_fn = TOOLS.get(call["name"])
        if tool_fn:
            tasks.append(tool_fn(**call.get("arguments", {})))
    return await asyncio.gather(*tasks)


@app.post("/api/query", response_model=NavigatorResponse)
async def handle_query(query: UserQuery):
    """Main endpoint: user query → tool calls → Apertus → response."""
    system_prompt = f"""You are the Basel Life Sciences Ecosystem Navigator.
You help founders, researchers, and growing companies navigate the Basel life sciences ecosystem.
Respond in {query.lang}. Be specific: name real organizations, programs, deadlines, contacts.

Available tools: {json.dumps(TOOL_DESCRIPTIONS)}

Given the user query, decide which tools to call and in what order.
Return a JSON array of tool calls: [{{"name": "tool_name", "arguments": {{...}}}}]"""

    # Step 1: Ask Apertus to plan tool calls
    planning_response = await generate_with_apertus(
        system_prompt=system_prompt,
        user_message=query.text,
    )

    # Step 2: Parse and execute tool calls
    try:
        tool_calls = json.loads(planning_response)
        if not isinstance(tool_calls, list):
            tool_calls = [tool_calls]
    except json.JSONDecodeError:
        tool_calls = []

    tool_results = await execute_tool_calls(tool_calls) if tool_calls else []

    # Step 3: Assemble context and generate final answer with Apertus
    context = {
        "user_query": query.text,
        "user_profile": query.user_profile,
        "tool_results": [r for r in tool_results if isinstance(r, dict)],
        "lang": query.lang,
    }

    final_prompt = f"""Based on the following retrieved information about the Basel life sciences ecosystem,
provide a comprehensive, actionable answer to the user's question.

Retrieved context: {json.dumps(context, default=str)}

Include:
1. Specific organizations, programs, and contacts
2. A 90-day action plan if the user is starting something new
3. Funding deadlines and lab availability if relevant
4. Respond in {query.lang}"""

    answer = await generate_with_apertus(
        system_prompt="You are the Basel Life Sciences Ecosystem Navigator. Be specific and actionable.",
        user_message=final_prompt,
    )

    # Step 4: Generate voice response if requested
    audio_url = None
    if query.lang in ("fr", "de"):
        voice_result = await TOOLS["voice_response"](text=answer[:500], lang=query.lang)
        audio_url = voice_result.get("audio_path")

    return NavigatorResponse(
        answer=answer,
        sources=[r for r in tool_results if isinstance(r, dict)],
        action_plan=context.get("user_profile"),
        audio_url=audio_url,
    )


@app.get("/health")
async def health():
    return {"status": "ok", "service": "basel-navigator"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
