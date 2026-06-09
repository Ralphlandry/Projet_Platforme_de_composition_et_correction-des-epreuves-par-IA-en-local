from __future__ import annotations

"""Configure l'accès à la base de données et fournit un générateur de session."""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings


engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    """Fournit une session SQLAlchemy utilisable dans les dépendances FastAPI.

    La session est fermée proprement quelle que soit l'issue de la requête.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
