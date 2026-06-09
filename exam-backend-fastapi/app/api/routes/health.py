"""Endpoint de santé du service Backend."""

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
def health():
    """Retourne l'état de santé de l'application."""
    return {"status": "ok", "service": "exam-backend-fastapi"}
