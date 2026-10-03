"""Base connector interface for data source ingestion."""

from __future__ import annotations

from abc import ABC, abstractmethod


class BaseConnector(ABC):
    """All 6 data source connectors implement this interface."""

    source_name: str = ""

    @abstractmethod
    async def fetch(self) -> list[dict]:
        """Fetch raw records from the data source."""
        ...

    @abstractmethod
    def normalize(self, raw: dict) -> dict:
        """Normalize a raw record to the common entity schema.

        Common schema:
        {
            "source": str,
            "type": str (company | lab | investor | program | infrastructure),
            "name": str,
            "description": str,
            "tags": list[str],
            "location": str,
            "url": str,
            "contact": str | None,
            "relationships": list[{"target": str, "relation": str}],
        }
        """
        ...

    async def ingest(self) -> list[dict]:
        """Fetch and normalize all records."""
        raw_records = await self.fetch()
        return [self.normalize(r) for r in raw_records]
