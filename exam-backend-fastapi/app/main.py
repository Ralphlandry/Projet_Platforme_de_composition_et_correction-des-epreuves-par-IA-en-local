from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from app.api.router import api_router
from app.core.config import settings
from app.db.base import Base
from app.db.session import engine

app = FastAPI(
    title="Exam Creator Backend",
    version="1.0.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup_event() -> None:
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS specialties (
                    id VARCHAR(36) PRIMARY KEY,
                    name VARCHAR(255) UNIQUE NOT NULL,
                    description TEXT NULL,
                    color VARCHAR(16) NULL,
                    allowed_subject_ids JSONB NULL,
                    created_at TIMESTAMP NULL
                );
                """
            )
        )
        conn.execute(text("ALTER TABLE exams ADD COLUMN IF NOT EXISTS specialty_id VARCHAR(36);"))
        conn.execute(text("ALTER TABLE exams ADD COLUMN IF NOT EXISTS evaluation_type VARCHAR(64);"))
        conn.execute(text("ALTER TABLE exams ADD COLUMN IF NOT EXISTS semester VARCHAR(32);"))
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS exam_parts (
                    id VARCHAR(36) PRIMARY KEY,
                    exam_id VARCHAR(36) NULL,
                    title VARCHAR(255) NOT NULL,
                    subtitle TEXT NULL,
                    description TEXT NULL,
                    order_index INTEGER NULL DEFAULT 0,
                    created_at TIMESTAMP NULL
                );
                """
            )
        )
        conn.execute(text("ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS part_id VARCHAR(36);"))
        # Remove legacy FK to subjects for student specialty to allow dedicated filiere ids.
        conn.execute(text("ALTER TABLE student_profiles DROP CONSTRAINT IF EXISTS student_profiles_specialty_id_fkey;"))


app.include_router(api_router)
