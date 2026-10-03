"""pgvector store for entity embeddings and similarity search."""

from __future__ import annotations

import os
from typing import Optional

import numpy as np
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()

POSTGRES_URL = os.getenv("POSTGRES_URL", "postgresql://localhost:5432/hack_basel")
EMBEDDING_DIM = int(os.getenv("POSTGRES_EMBEDDING_DIM", "768"))


def get_engine():
    return create_engine(POSTGRES_URL)


def init_schema(engine=None):
    """Create the entities table with pgvector extension."""
    engine = engine or get_engine()
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        conn.execute(text(f"""
            CREATE TABLE IF NOT EXISTS entities (
                id SERIAL PRIMARY KEY,
                source TEXT NOT NULL,
                type TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                tags TEXT[],
                location TEXT,
                url TEXT,
                contact TEXT,
                metadata JSONB DEFAULT '{{}}',
                embedding vector({EMBEDDING_DIM}),
                created_at TIMESTAMP DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_entities_embedding
            ON entities USING ivfflat (embedding vector_cosine_ops)
            WITH (lists = 50)
        """))


def upsert_entity(entity: dict, embedding: list[float], engine=None):
    """Insert or update an entity with its embedding."""
    engine = engine or get_engine()
    with engine.begin() as conn:
        conn.execute(text("""
            INSERT INTO entities (source, type, name, description, tags, location, url, contact, metadata, embedding)
            VALUES (:source, :type, :name, :description, :tags, :location, :url, :contact, :metadata, :embedding)
            ON CONFLICT (id) DO UPDATE SET
                description = EXCLUDED.description,
                tags = EXCLUDED.tags,
                embedding = EXCLUDED.embedding
        """), {
            "source": entity.get("source", ""),
            "type": entity.get("type", ""),
            "name": entity.get("name", ""),
            "description": entity.get("description", ""),
            "tags": entity.get("tags", []),
            "location": entity.get("location", ""),
            "url": entity.get("url", ""),
            "contact": entity.get("contact"),
            "metadata": "{}",
            "embedding": str(embedding),
        })


def search_similar(
    query_embedding: list[float],
    entity_type: Optional[str] = None,
    limit: int = 10,
    engine=None,
) -> list[dict]:
    """Find entities similar to query embedding."""
    engine = engine or get_engine()
    type_filter = "AND type = :entity_type" if entity_type else ""
    with engine.begin() as conn:
        result = conn.execute(text(f"""
            SELECT id, source, type, name, description, tags, location, url, contact,
                   1 - (embedding <=> :embedding) AS similarity
            FROM entities
            WHERE embedding IS NOT NULL {type_filter}
            ORDER BY embedding <=> :embedding
            LIMIT :limit
        """), {
            "embedding": str(query_embedding),
            "entity_type": entity_type,
            "limit": limit,
        })
        return [dict(row._mapping) for row in result]
