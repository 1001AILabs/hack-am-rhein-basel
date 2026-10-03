"""Graph traversal utilities — wraps KnowledgeGraph for the agent tools."""

from __future__ import annotations

from backend.graph.schema import KnowledgeGraph

_graph: KnowledgeGraph | None = None


def get_graph() -> KnowledgeGraph:
    global _graph
    if _graph is None:
        _graph = KnowledgeGraph()
    return _graph


def set_graph(graph: KnowledgeGraph):
    global _graph
    _graph = graph


async def traverse(entity_id: str, relation: str | None = None, depth: int = 2) -> list[dict]:
    """Traverse from entity_id, return connected entities."""
    graph = get_graph()
    return graph.traverse(entity_id, relation, depth)


async def get_entity_info(entity_id: str) -> dict | None:
    """Get entity details by ID."""
    graph = get_graph()
    entity = graph.get_entity(entity_id)
    if not entity:
        return None
    edges = graph.get_edges_for(entity_id)
    return {
        "id": entity.id,
        "name": entity.name,
        "type": entity.type.value,
        "metadata": entity.metadata,
        "connections": [
            {
                "target": e.target_id if e.source_id == entity_id else e.source_id,
                "relation": e.relation.value,
            }
            for e in edges
        ],
    }
