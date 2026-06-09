"""Regroupe les routes de l'API sous un routeur FastAPI unique."""

from fastapi import APIRouter

from app.api.routes.auth import router as auth_router
from app.api.routes.db import router as db_router
from app.api.routes.exams import router as exams_router
from app.api.routes.health import router as health_router
from app.api.routes.setup import router as setup_router
from app.api.routes.sse import router as sse_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(setup_router)
api_router.include_router(auth_router)
api_router.include_router(db_router)
api_router.include_router(exams_router)
api_router.include_router(sse_router)
