from __future__ import annotations

"""Définit les entités SQLAlchemy utilisées par l'application."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def uuid_str() -> str:
    """Generate a UUID string for primary key defaults."""
    return str(uuid.uuid4())


class Profile(Base):
    __tablename__ = "profiles"

    """Représente un compte utilisateur général."""

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class UserRole(Base):
    __tablename__ = "user_roles"

    """Stocke le rôle attribué à un utilisateur."""

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="etudiant")


class StudentProfile(Base):
    __tablename__ = "student_profiles"

    """Informations spécifiques au profil étudiant."""

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    student_number: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    level_id: Mapped[str] = mapped_column(String(36), ForeignKey("levels.id", ondelete="RESTRICT"), nullable=False, index=True)
    specialty_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Subject(Base):
    __tablename__ = "subjects"

    """Représente un sujet d'examen.

    Les matières sont utilisées pour catégoriser les questions et les épreuves.
    """

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    color: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Specialty(Base):
    __tablename__ = "specialties"

    """Définit une spécialité et les matières autorisées associées."""

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    color: Mapped[str | None] = mapped_column(String(16), nullable=True)
    allowed_subject_ids: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Level(Base):
    __tablename__ = "levels"

    """Représente le niveau d'études d'un étudiant."""

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Class(Base):
    __tablename__ = "classes"

    """Regroupe des élèves dans une classe ou promotion."""

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    level_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("levels.id", ondelete="SET NULL"), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ClassStudent(Base):
    __tablename__ = "class_students"

    """Lien entre une classe et un étudiant."""

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    class_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("classes.id", ondelete="CASCADE"), nullable=True, index=True)
    student_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Question(Base):
    __tablename__ = "questions"

    """Représente une question pouvant appartenir à une épreuve."""

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    question_type: Mapped[str] = mapped_column(String(64), nullable=False, default="qcm")
    options: Mapped[dict | list | None] = mapped_column(JSONB, nullable=True)
    correct_answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    points: Mapped[float | None] = mapped_column(Float, nullable=True, default=1.0)
    difficulty: Mapped[str | None] = mapped_column(String(64), nullable=True, default="moyen")
    subject_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("subjects.id", ondelete="SET NULL"), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Exam(Base):
    __tablename__ = "exams"

    """Représente une épreuve planifiée ou publiée."""

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    class_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("classes.id", ondelete="SET NULL"), nullable=True)
    subject_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("subjects.id", ondelete="SET NULL"), nullable=True)
    specialty_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("specialties.id", ondelete="SET NULL"), nullable=True)
    level_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("levels.id", ondelete="SET NULL"), nullable=True)
    evaluation_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    semester: Mapped[str | None] = mapped_column(String(32), nullable=True)
    duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True, default=60)
    total_points: Mapped[float | None] = mapped_column(Float, nullable=True, default=20)
    status: Mapped[str | None] = mapped_column(String(64), nullable=True, default="brouillon")
    start_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    end_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ExamPart(Base):
    __tablename__ = "exam_parts"

    """Partie d'un examen qui permet de structurer les questions."""

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    exam_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("exams.id", ondelete="CASCADE"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    subtitle: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    order_index: Mapped[int | None] = mapped_column(Integer, nullable=True, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    """Journal de piste immuable pour les opérations CRUD importantes."""

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    user_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    action: Mapped[str] = mapped_column(String(16), nullable=False)          # insert | update | delete
    table_name: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    row_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    changes: Mapped[str | None] = mapped_column(Text, nullable=True)         # JSON string
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class ExamQuestion(Base):
    __tablename__ = "exam_questions"

    """Association entre un examen et une question donnée."""

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    exam_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("exams.id", ondelete="CASCADE"), nullable=True, index=True)
    part_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("exam_parts.id", ondelete="SET NULL"), nullable=True, index=True)
    question_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("questions.id", ondelete="CASCADE"), nullable=True)
    order_index: Mapped[int | None] = mapped_column(Integer, nullable=True, default=0)
    points: Mapped[float | None] = mapped_column(Float, nullable=True)


class Submission(Base):
    __tablename__ = "submissions"

    """Copie d'un étudiant pour un examen donné."""

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    exam_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("exams.id", ondelete="CASCADE"), nullable=True, index=True)
    student_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("profiles.id", ondelete="SET NULL"), nullable=True, index=True)
    status: Mapped[str | None] = mapped_column(String(64), nullable=True, default="en_cours")
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    graded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    graded_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    incidents: Mapped[str | None] = mapped_column(Text, nullable=True)


class Answer(Base):
    __tablename__ = "answers"

    """Réponse d'un étudiant à une question d'examen."""

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    submission_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("submissions.id", ondelete="CASCADE"), nullable=True, index=True)
    question_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("questions.id", ondelete="SET NULL"), nullable=True)
    answer_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    points_awarded: Mapped[float | None] = mapped_column(Float, nullable=True)
    feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Notification(Base):
    __tablename__ = "notifications"

    """Notification envoyée à un utilisateur."""

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    type: Mapped[str | None] = mapped_column(String(64), nullable=True, default="info")
    is_read: Mapped[bool | None] = mapped_column(Boolean, nullable=True, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
