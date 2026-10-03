"""Zefix connector — Swiss commercial register live API."""

from __future__ import annotations

import os
from typing import Optional

import httpx
from dotenv import load_dotenv

load_dotenv()

ZEFIX_API_URL = os.getenv("ZEFIX_API_URL", "https://www.zefix.admin.ch/ZefixREST/api/v1")


async def search_zefix(
    name: str,
    legal_seat: Optional[str] = None,
    max_results: int = 20,
) -> list[dict]:
    """Search Zefix for companies by name, optionally filtered by legal seat (canton/city)."""
    params = {"name": name, "maxNbrOfResults": max_results}
    if legal_seat:
        params["legalSeat"] = legal_seat

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{ZEFIX_API_URL}/company/search", params=params)
        resp.raise_for_status()
        return resp.json()


async def get_company_by_uid(uid: str) -> dict:
    """Get a specific company by its Swiss UID (CHE-xxx.xxx.xxx)."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{ZEFIX_API_URL}/company/uid/{uid}")
        resp.raise_for_status()
        return resp.json()


async def search_life_sciences_basel(sector_keywords: list[str] | None = None) -> list[dict]:
    """Search for life-sciences companies in Basel region."""
    keywords = sector_keywords or [
        "pharma", "biotech", "medtech", "life sciences",
        "diagnostics", "therapeutics", "clinical",
    ]
    results = []
    for keyword in keywords:
        companies = await search_zefix(name=keyword, legal_seat="Basel")
        results.extend(companies)

    seen_uids = set()
    deduped = []
    for c in results:
        uid = c.get("uid", c.get("name"))
        if uid not in seen_uids:
            seen_uids.add(uid)
            deduped.append(c)
    return deduped


def normalize_zefix_entity(raw: dict) -> dict:
    """Normalize a Zefix company record to our common entity schema."""
    return {
        "source": "zefix",
        "type": "company",
        "name": raw.get("name", ""),
        "uid": raw.get("uid", ""),
        "legal_seat": raw.get("legalSeat", ""),
        "status": raw.get("status", ""),
        "purpose": raw.get("purpose", ""),
        "tags": _extract_tags(raw.get("purpose", "")),
        "url": f"https://www.zefix.admin.ch/en/search/entity/list/firm/{raw.get('ehraid', '')}",
    }


def _extract_tags(purpose: str) -> list[str]:
    """Extract sector tags from company purpose text."""
    tags = []
    keywords = {
        "pharma": "pharma",
        "biotech": "biotech",
        "medtech": "medtech",
        "diagnostic": "diagnostics",
        "therapeutic": "therapeutics",
        "clinical": "clinical",
        "oncolog": "oncology",
        "immun": "immunology",
        "neuro": "neuroscience",
        "digital health": "digital-health",
    }
    purpose_lower = purpose.lower()
    for keyword, tag in keywords.items():
        if keyword in purpose_lower:
            tags.append(tag)
    return tags
