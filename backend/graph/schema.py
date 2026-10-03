"""Knowledge graph schema for Basel life sciences ecosystem.

Entities and relationships are stored as edges in a simple adjacency model.
Reazul will extend this with a proper graph DB if time allows.
"""

from __future__ import annotations

from enum import Enum


class EntityType(str, Enum):
    COMPANY = "company"
    LAB = "lab"
    INVESTOR = "investor"
    PROGRAM = "program"
    INFRASTRUCTURE = "infrastructure"
    UNIVERSITY = "university"
    PERSON = "person"


class RelationType(str, Enum):
    FUNDS = "funds"
    IS_MEMBER_OF = "is-member-of"
    PORTFOLIO_COMPANY = "portfolio-company"
    OFFERS_LAB_SPACE = "offers-lab-space"
    SPECIALISES_IN = "specialises-in"
    PARTNERS_WITH = "partners-with"
    SPUN_OUT_FROM = "spun-out-from"
    LOCATED_AT = "located-at"
    MENTORS = "mentors"


class Entity:
    def __init__(self, id: str, name: str, type: EntityType, metadata: dict | None = None):
        self.id = id
        self.name = name
        self.type = type
        self.metadata = metadata or {}


class Edge:
    def __init__(self, source_id: str, target_id: str, relation: RelationType):
        self.source_id = source_id
        self.target_id = target_id
        self.relation = relation


class KnowledgeGraph:
    """In-memory knowledge graph (swap for Neo4j/NetworkX if needed)."""

    def __init__(self):
        self.entities: dict[str, Entity] = {}
        self.edges: list[Edge] = []

    def add_entity(self, entity: Entity):
        self.entities[entity.id] = entity

    def add_edge(self, edge: Edge):
        self.edges.append(edge)

    def traverse(self, entity_id: str, relation: str | None = None, depth: int = 2) -> list[dict]:
        """BFS traversal from entity, optionally filtered by relation type."""
        visited = set()
        queue = [(entity_id, 0)]
        results = []

        while queue:
            current_id, current_depth = queue.pop(0)
            if current_id in visited or current_depth > depth:
                continue
            visited.add(current_id)

            entity = self.entities.get(current_id)
            if entity and current_depth > 0:
                results.append({
                    "id": entity.id,
                    "name": entity.name,
                    "type": entity.type.value,
                    "depth": current_depth,
                    "metadata": entity.metadata,
                })

            for edge in self.edges:
                if edge.source_id == current_id:
                    if relation is None or edge.relation.value == relation:
                        queue.append((edge.target_id, current_depth + 1))
                elif edge.target_id == current_id:
                    if relation is None or edge.relation.value == relation:
                        queue.append((edge.source_id, current_depth + 1))

        return results

    def get_entity(self, entity_id: str) -> Entity | None:
        return self.entities.get(entity_id)

    def get_edges_for(self, entity_id: str) -> list[Edge]:
        return [e for e in self.edges if e.source_id == entity_id or e.target_id == entity_id]
