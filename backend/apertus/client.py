"""Apertus 1.5 client — Swiss sovereign LLM for final generation."""

from __future__ import annotations

import os

import httpx
from dotenv import load_dotenv

load_dotenv()

APERTUS_API_URL = os.getenv("APERTUS_API_URL", "http://localhost:8010/v1")
APERTUS_API_KEY = os.getenv("APERTUS_API_KEY", "")
APERTUS_MODEL = os.getenv("APERTUS_MODEL", "apertus-v1.5-8b")


async def generate_with_apertus(
    system_prompt: str,
    user_message: str,
    temperature: float = 0.3,
    max_tokens: int = 2048,
) -> str:
    """Call Apertus 1.5 via OpenAI-compatible API (vLLM endpoint)."""
    headers = {"Content-Type": "application/json"}
    if APERTUS_API_KEY:
        headers["Authorization"] = f"Bearer {APERTUS_API_KEY}"

    payload = {
        "model": APERTUS_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{APERTUS_API_URL}/chat/completions",
            headers=headers,
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()

    return data["choices"][0]["message"]["content"]
