"""Endpoint d'initialisation des données de référence pour l'application."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import Level, Specialty, Subject

router = APIRouter(prefix="/api/setup", tags=["setup"])


@router.post("/init")
def init_setup(db: Session = Depends(get_db)):
    """Crée les sujets, spécialités et niveaux par défaut si absents."""
    created = {"subjects": 0, "levels": 0, "specialties": 0}

    default_subjects = [
        {"name": "Mathématiques", "color": "#3B82F6"},
        {"name": "Informatique", "color": "#10B981"},
        {"name": "Réseaux", "color": "#F59E0B"},
    ]
    for subject in default_subjects:
        if not db.query(Subject).filter(Subject.name == subject["name"]).first():
            db.add(Subject(name=subject["name"], color=subject["color"], description=None))
            created["subjects"] += 1

    db.flush()

    all_subject_ids = [s.id for s in db.query(Subject).all()]
    default_specialties = [
        {"name": "Informatique", "color": "#10B981", "allowed_subject_ids": all_subject_ids},
        {"name": "Réseaux", "color": "#F59E0B", "allowed_subject_ids": all_subject_ids},
    ]
    for specialty in default_specialties:
        if not db.query(Specialty).filter(Specialty.name == specialty["name"]).first():
            db.add(
                Specialty(
                    name=specialty["name"],
                    color=specialty["color"],
                    description=None,
                    allowed_subject_ids=specialty["allowed_subject_ids"],
                )
            )
            created["specialties"] += 1

    default_levels = ["Licence 1", "Licence 2", "Licence 3", "Master 1", "Master 2"]
    for level in default_levels:
        if not db.query(Level).filter(Level.name == level).first():
            db.add(Level(name=level, description=None))
            created["levels"] += 1

    db.commit()
    return {"message": "Initialisation terminée", "created": created}
