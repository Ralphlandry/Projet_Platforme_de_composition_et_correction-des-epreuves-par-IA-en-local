from __future__ import annotations

"""Opérations de requête et sérialisation partagées pour l'API database."""

from datetime import datetime
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import (
    Answer,
    Class,
    ClassStudent,
    Exam,
    ExamPart,
    ExamQuestion,
    Level,
    Notification,
    Profile,
    Question,
    Specialty,
    Submission,
    Subject,
    StudentProfile,
    UserRole,
)


TABLE_MODELS = {
    "profiles": Profile,
    "student_profiles": StudentProfile,
    "user_roles": UserRole,
    "subjects": Subject,
    "specialties": Specialty,
    "levels": Level,
    "classes": Class,
    "class_students": ClassStudent,
    "questions": Question,
    "exams": Exam,
    "exam_parts": ExamPart,
    "exam_questions": ExamQuestion,
    "submissions": Submission,
    "answers": Answer,
    "notifications": Notification,
}


def get_user_role(db: Session, user_id: str) -> str:
    """Retourne le rôle principal de l'utilisateur ou 'etudiant' par défaut."""
    role = db.query(UserRole).filter(UserRole.user_id == user_id).first()
    return role.role if role else "etudiant"


def get_student_profile(db: Session, user_id: str) -> StudentProfile | None:
    """Récupère le profil étudiant associé à un utilisateur."""
    return db.query(StudentProfile).filter(StudentProfile.user_id == user_id).first()


def serialize_value(value: Any) -> Any:
    """Convertit les valeurs de colonne en formats JSON compatibles."""
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def parse_datetime(value: Any) -> datetime | None:
    """Convertit une chaîne ISO en datetime naive UTC, ou renvoie None si invalide."""
    if value is None or isinstance(value, datetime):
        return value
    if isinstance(value, str) and value.strip():
        # Remove trailing 'Z' and replace with +00:00 for Python < 3.11 compatibility
        s = value.strip().replace('Z', '+00:00')
        try:
            dt = datetime.fromisoformat(s)
            # Strip timezone info — store as naive UTC (TIMESTAMP WITHOUT TIME ZONE)
            return dt.replace(tzinfo=None)
        except ValueError:
            return None
    return None


DATETIME_COLUMNS = {
    "exams": {"start_date", "end_date", "created_at", "updated_at"},
    "submissions": {"started_at", "submitted_at", "created_at", "updated_at"},
    "exam_parts": {"created_at"},
    "exam_questions": {"created_at"},
    "questions": {"created_at", "updated_at"},
}


def serialize_row(row: Any) -> dict[str, Any]:
    """Sérialise un enregistrement SQLAlchemy en dictionnaire JSON-friendly."""
    data: dict[str, Any] = {}
    for column in row.__table__.columns:
        if column.name == "password_hash":
            continue
        data[column.name] = serialize_value(getattr(row, column.name))
    return data


def apply_filters(query, model, filters):
    """Applique une liste de filtres simples sur une requête SQLAlchemy."""
    for f in filters:
        col = getattr(model, f.column, None)
        if col is None:
            continue
        if f.op == "eq":
            if f.value is None:
                query = query.filter(col.is_(None))
            else:
                query = query.filter(col == f.value)
        elif f.op == "in" and isinstance(f.value, list):
            query = query.filter(col.in_(f.value))
        elif f.op == "not":
            if f.operator == "is" and f.value is None:
                query = query.filter(col.is_not(None))
            else:
                query = query.filter(col != f.value)
    return query


def count_query(query) -> int:
    """Retourne le nombre d'enregistrements d'une requête sans charger les lignes."""
    return query.with_entities(func.count()).scalar() or 0


def hydrate_related(db: Session, table: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Ajoute des relations dérivées aux résultats pour éviter des requêtes supplémentaires côté client."""
    if table == "classes":
        level_ids = [r.get("level_id") for r in rows if r.get("level_id")]
        levels = db.query(Level).filter(Level.id.in_(level_ids)).all() if level_ids else []
        level_map = {l.id: serialize_row(l) for l in levels}
        for r in rows:
            r["level"] = level_map.get(r.get("level_id"))
    elif table == "questions":
        subject_ids = [r.get("subject_id") for r in rows if r.get("subject_id")]
        subjects = db.query(Subject).filter(Subject.id.in_(subject_ids)).all() if subject_ids else []
        subject_map = {s.id: serialize_row(s) for s in subjects}
        creator_ids = [r.get("created_by") for r in rows if r.get("created_by")]
        creators = db.query(Profile).filter(Profile.id.in_(creator_ids)).all() if creator_ids else []
        creator_map = {c.id: {"full_name": c.full_name, "email": c.email} for c in creators}
        for r in rows:
            r["subject"] = subject_map.get(r.get("subject_id"))
            r["creator"] = creator_map.get(r.get("created_by"))
    elif table == "student_profiles":
        level_ids = [r.get("level_id") for r in rows if r.get("level_id")]
        specialty_ids = [r.get("specialty_id") for r in rows if r.get("specialty_id")]
        levels = db.query(Level).filter(Level.id.in_(level_ids)).all() if level_ids else []
        specialties = db.query(Specialty).filter(Specialty.id.in_(specialty_ids)).all() if specialty_ids else []
        level_map = {l.id: serialize_row(l) for l in levels}
        specialty_map = {s.id: serialize_row(s) for s in specialties}
        for r in rows:
            r["level"] = level_map.get(r.get("level_id"))
            r["specialty"] = specialty_map.get(r.get("specialty_id"))
    elif table == "exams":
        subject_ids = [r.get("subject_id") for r in rows if r.get("subject_id")]
        level_ids = [r.get("level_id") for r in rows if r.get("level_id")]
        specialty_ids = [r.get("specialty_id") for r in rows if r.get("specialty_id")]
        subjects = db.query(Subject).filter(Subject.id.in_(subject_ids)).all() if subject_ids else []
        levels = db.query(Level).filter(Level.id.in_(level_ids)).all() if level_ids else []
        specialties = db.query(Specialty).filter(Specialty.id.in_(specialty_ids)).all() if specialty_ids else []
        subject_map = {s.id: serialize_row(s) for s in subjects}
        level_map = {l.id: serialize_row(l) for l in levels}
        specialty_map = {s.id: serialize_row(s) for s in specialties}
        for r in rows:
            r["subject"] = subject_map.get(r.get("subject_id"))
            r["level"] = level_map.get(r.get("level_id"))
            r["specialty"] = specialty_map.get(r.get("specialty_id"))
    elif table == "submissions":
        exam_ids = [r.get("exam_id") for r in rows if r.get("exam_id")]
        student_ids = [r.get("student_id") for r in rows if r.get("student_id")]
        exams = db.query(Exam).filter(Exam.id.in_(exam_ids)).all() if exam_ids else []
        students = db.query(Profile).filter(Profile.id.in_(student_ids)).all() if student_ids else []
        exam_map = {e.id: serialize_row(e) for e in exams}
        student_map = {s.id: serialize_row(s) for s in students}
        for r in rows:
            exam_obj = exam_map.get(r.get("exam_id"))
            if exam_obj:
                subject = None
                if exam_obj.get("subject_id"):
                    sub = db.query(Subject).filter(Subject.id == exam_obj["subject_id"]).first()
                    subject = serialize_row(sub) if sub else None
                exam_obj = {
                    "id": exam_obj.get("id"),
                    "title": exam_obj.get("title"),
                    "total_points": exam_obj.get("total_points"),
                    "subject": subject,
                }
            st = student_map.get(r.get("student_id"))
            if st:
                st = {"full_name": st.get("full_name"), "email": st.get("email")}
            r["exam"] = exam_obj
            r["student"] = st
    elif table == "exam_questions":
        q_ids = [r.get("question_id") for r in rows if r.get("question_id")]
        part_ids = [r.get("part_id") for r in rows if r.get("part_id")]
        questions = db.query(Question).filter(Question.id.in_(q_ids)).all() if q_ids else []
        parts = db.query(ExamPart).filter(ExamPart.id.in_(part_ids)).all() if part_ids else []
        q_map = {q.id: serialize_row(q) for q in questions}
        part_map = {p.id: serialize_row(p) for p in parts}
        for r in rows:
            r["question"] = q_map.get(r.get("question_id"))
            r["part"] = part_map.get(r.get("part_id"))
    elif table == "answers":
        q_ids = [r.get("question_id") for r in rows if r.get("question_id")]
        questions = db.query(Question).filter(Question.id.in_(q_ids)).all() if q_ids else []
        q_map = {q.id: serialize_row(q) for q in questions}
        for r in rows:
            q = q_map.get(r.get("question_id"))
            if q:
                r["question"] = {
                    "id": q.get("id"),
                    "question_text": q.get("question_text"),
                    "points": q.get("points"),
                    "correct_answer": q.get("correct_answer"),
                    "question_type": q.get("question_type"),
                }
            else:
                r["question"] = None
    return rows
