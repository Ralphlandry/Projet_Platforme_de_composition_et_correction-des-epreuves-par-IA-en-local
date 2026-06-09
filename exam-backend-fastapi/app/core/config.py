from __future__ import annotations

"""Configuration centralisée de l'application avec chargement depuis .env."""

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BASE_DIR / ".env")


@dataclass
class Settings:
    """Contient les paramètres de configuration de l'application."""

    database_url: str = os.getenv("DATABASE_URL", "postgresql+psycopg2://exam_user:exam_pass_123@localhost:5432/exam_creator")
    jwt_secret_key: str = os.getenv("JWT_SECRET_KEY", "change-me")
    jwt_algorithm: str = os.getenv("JWT_ALGORITHM", "HS256")
    jwt_expire_minutes: int = int(os.getenv("JWT_EXPIRE_MINUTES", "1440"))
    ollama_url: str = os.getenv("OLLAMA_URL", "http://localhost:11434")
    cors_origins: list[str] = field(
        default_factory=lambda: [
            origin.strip()
            for origin in os.getenv(
                "CORS_ORIGINS",
                "http://localhost:5173,http://localhost:8080",
            ).split(",")
            if origin.strip()
        ]
    )

    ia_api_url: str = os.getenv("IA_API_URL", "http://localhost:8000")

    @property
    def cors_allow_all(self) -> bool:
        """Indicate whether CORS doit autoriser toutes les origines."""
        return os.getenv("CORS_ORIGINS", "").strip() == "*"


settings = Settings()
