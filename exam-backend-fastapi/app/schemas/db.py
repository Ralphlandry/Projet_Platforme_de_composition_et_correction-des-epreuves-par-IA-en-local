from __future__ import annotations

"""Schémas de requête génériques pour l'API de base de données."""

from typing import Any, Literal

from pydantic import BaseModel


class FilterItem(BaseModel):
    """Représente un filtre simple appliqué à une colonne."""

    op: Literal["eq", "in", "not"]
    column: str
    value: Any = None
    operator: str | None = None


class QueryOrder(BaseModel):
    """Ordre de tri pour les requêtes."""

    column: str
    ascending: bool = True


class DBQueryIn(BaseModel):
    """Payload de requête générique pour obternir des lignes d'une table."""

    table: str
    select: str = "*"
    filters: list[FilterItem] = []
    order: QueryOrder | None = None
    limit: int | None = None
    count: str | None = None
    head: bool = False
    single: bool = False
    maybe_single: bool = False


class DBInsertIn(BaseModel):
    """Payload d'insertion pour une ou plusieurs lignes."""

    table: str
    data: dict[str, Any] | list[dict[str, Any]]


class DBUpdateIn(BaseModel):
    """Payload de mise à jour pour une ou plusieurs lignes."""

    table: str
    data: dict[str, Any]
    filters: list[FilterItem] = []


class DBDeleteIn(BaseModel):
    """Payload de suppression pour une ou plusieurs lignes."""

    table: str
    filters: list[FilterItem] = []
