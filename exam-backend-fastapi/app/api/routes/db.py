from __future__ import annotations

"""Routes génériques pour l'accès CRUD aux tables via l'API de base de données."""

import json
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import asc, desc
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import Answer, AuditLog, Exam, ExamQuestion, Notification, Profile, Specialty, StudentProfile, Submission, UserRole
from app.schemas import DBDeleteIn, DBInsertIn, DBQueryIn, DBUpdateIn
from app.services.db_ops import (
    DATETIME_COLUMNS,
    TABLE_MODELS,
    apply_filters,
    count_query,
    get_student_profile,
    get_user_role,
    hydrate_related,
    parse_datetime,
    serialize_row,
)

router = APIRouter(prefix="/api/db", tags=["db"])


def _write_audit(
    db: Session,
    *,
    user: Profile,
    action: str,
    table: str,
    row_id: str | None = None,
    changes: dict | None = None,
    ip: str | None = None,
) -> None:
    """Persist an immutable audit log entry. Errors are silenced to never break the main flow."""
    try:
        db.add(AuditLog(
            id=str(uuid.uuid4()),
            user_id=user.id,
            user_email=user.email,
            action=action,
            table_name=table,
            row_id=row_id,
            changes=json.dumps(changes, default=str) if changes else None,
            ip_address=ip,
        ))
        db.commit()
    except Exception:
        db.rollback()


def _student_exam_scope(db: Session, user_id: str):
    """Construit la portée des examens autorisés pour un étudiant."""
    student_profile = get_student_profile(db, user_id)
    if not student_profile:
        return None

    specialty = db.query(Specialty).filter(Specialty.id == student_profile.specialty_id).first()
    if not specialty:
        return None

    allowed_subject_ids = specialty.allowed_subject_ids or []
    if not isinstance(allowed_subject_ids, list) or not allowed_subject_ids:
        return None

    return db.query(Exam.id).filter(
        Exam.status == "publie",
        Exam.level_id == student_profile.level_id,
        Exam.specialty_id == student_profile.specialty_id,
        Exam.subject_id.in_(allowed_subject_ids),
    )


def _ensure_exam_allowed_for_student(db: Session, user_id: str, exam_id: str) -> bool:
    """Vérifie qu'un étudiant a le droit d'accéder à un examen exact."""
    scoped = _student_exam_scope(db, user_id)
    if not scoped:
        return False
    return scoped.filter(Exam.id == exam_id).first() is not None


def _create_notification_if_missing(
    db: Session,
    *,
    user_id: str,
    title: str,
    message: str,
    notif_type: str = "info",
) -> bool:
    """Crée une notification si aucune notification identique n'existe déjà."""
    existing = (
        db.query(Notification)
        .filter(
            Notification.user_id == user_id,
            Notification.title == title,
            Notification.message == message,
        )
        .first()
    )
    if existing:
        return False

    db.add(
        Notification(
            id=str(uuid.uuid4()),
            user_id=user_id,
            title=title,
            message=message,
            type=notif_type,
            is_read=False,
        )
    )
    return True


def _notify_students_for_exam_publication(db: Session, exam_row: Exam) -> int:
    """Envoie une notification aux étudiants concernés lorsqu'un examen est publié."""
    if not exam_row.specialty_id or not exam_row.level_id:
        return 0

    students = db.query(StudentProfile).filter(
        StudentProfile.specialty_id == exam_row.specialty_id,
        StudentProfile.level_id == exam_row.level_id,
    ).all()

    if not students:
        return 0

    title = "Nouvelle épreuve disponible"
    message = f"L'épreuve « {exam_row.title} » vient d'être publiée. Connectez-vous pour la consulter."

    created = 0
    for student_profile in students:
        if not student_profile.user_id:
            continue
        if _create_notification_if_missing(
            db,
            user_id=student_profile.user_id,
            title=title,
            message=message,
            notif_type="info",
        ):
            created += 1

    return created


def _notify_admins_for_exam_action(db: Session, exam_row: Exam, actor: Profile, actor_role: str, action: str) -> int:
    """Notifie les administrateurs lorsqu'un professeur publie ou programme un examen."""
    if actor_role != "professeur":
        return 0

    admin_ids = [row[0] for row in db.query(UserRole.user_id).filter(UserRole.role == "admin").all()]
    if not admin_ids:
        return 0

    actor_name = actor.full_name or actor.email or "Un enseignant"
    if action == "programme":
        title = "Épreuve programmée par un enseignant"
        schedule_suffix = f" pour le {exam_row.start_date.strftime('%d/%m/%Y à %H:%M')}" if exam_row.start_date else ""
        message = f"{actor_name} a programmé l'épreuve « {exam_row.title} »{schedule_suffix}."
    else:
        title = "Épreuve publiée par un enseignant"
        message = f"{actor_name} a publié l'épreuve « {exam_row.title} » et elle est maintenant disponible."

    created = 0
    for admin_id in admin_ids:
        if not admin_id:
            continue
        if _create_notification_if_missing(
            db,
            user_id=admin_id,
            title=title,
            message=message,
            notif_type="info",
        ):
            created += 1

    return created


@router.post("/query")
def db_query(
    payload: DBQueryIn,
    db: Session = Depends(get_db),
    current_user: Profile = Depends(get_current_user),
):
    """Exécute une requête générique sur une table avec isolation de rôle."""
    model = TABLE_MODELS.get(payload.table)
    if not model:
        raise HTTPException(status_code=400, detail="Table non supportée")

    current_role = get_user_role(db, current_user.id)

    # Auto-publier les examens programmés lorsque l'heure de début est atteinte.
    if payload.table == "exams":
        now_local = datetime.now()
        pending = db.query(Exam).filter(Exam.status == "programme", Exam.start_date != None, Exam.start_date <= now_local).all()
        if pending:
            for exam_row in pending:
                exam_row.status = "publie"
                _notify_students_for_exam_publication(db, exam_row)
            db.commit()

    query = db.query(model)
    query = apply_filters(query, model, payload.filters)

    if current_role == "etudiant":
        if payload.table == "exams":
            scoped = _student_exam_scope(db, current_user.id)
            if not scoped:
                return {"data": [] if not payload.single and not payload.maybe_single else None, "error": None}
            allowed_exam_ids = [row[0] for row in scoped.all()]
            if not allowed_exam_ids:
                return {"data": [] if not payload.single and not payload.maybe_single else None, "error": None}
            query = query.filter(Exam.id.in_(allowed_exam_ids))
        elif payload.table == "exam_questions":
            scoped = _student_exam_scope(db, current_user.id)
            if not scoped:
                return {"data": [] if not payload.single and not payload.maybe_single else None, "error": None}
            allowed_exam_ids = [row[0] for row in scoped.all()]
            if not allowed_exam_ids:
                return {"data": [] if not payload.single and not payload.maybe_single else None, "error": None}
            query = query.filter(ExamQuestion.exam_id.in_(allowed_exam_ids))
        elif payload.table == "submissions":
            query = query.filter(Submission.student_id == current_user.id)
        elif payload.table == "answers":
            query = query.join(Submission, Answer.submission_id == Submission.id).filter(Submission.student_id == current_user.id)
        elif payload.table == "profiles":
            query = query.filter(Profile.id == current_user.id)
        elif payload.table == "user_roles":
            query = query.filter(model.user_id == current_user.id)
        elif payload.table == "student_profiles":
            query = query.filter(model.user_id == current_user.id)
        elif payload.table == "notifications":
            query = query.filter(model.user_id == current_user.id)
        elif payload.table in {"classes", "class_students", "questions"}:
            raise HTTPException(status_code=403, detail="Accès refusé à cette ressource")

    if payload.table == "submissions" and current_role == "professeur":
        exam_id_filter = next((f.value for f in payload.filters if f.column == "exam_id"), None)
        if exam_id_filter:
            single_exam_id = exam_id_filter if isinstance(exam_id_filter, str) else (exam_id_filter[0] if isinstance(exam_id_filter, list) and len(exam_id_filter) == 1 else None)
            now_utc = datetime.utcnow()
            _exam_ac = db.query(Exam).filter(Exam.id == single_exam_id).first() if single_exam_id else None
            if _exam_ac:
                stale_subs = db.query(Submission).filter(
                    Submission.exam_id == single_exam_id,
                    Submission.status == "en_cours",
                ).all()
                _closed = False
                for _ss in stale_subs:
                    _dl_ac: datetime | None = None
                    if _exam_ac.end_date:
                        _dl_ac = _exam_ac.end_date.replace(tzinfo=None) if _exam_ac.end_date.tzinfo else _exam_ac.end_date
                    elif _exam_ac.duration_minutes and _ss.started_at:
                        _st_ac = _ss.started_at.replace(tzinfo=None) if _ss.started_at.tzinfo else _ss.started_at
                        _dl_ac = _st_ac + timedelta(minutes=_exam_ac.duration_minutes + 2)
                    if _dl_ac and now_utc > _dl_ac:
                        _ss.status = "soumis"
                        _ss.submitted_at = _ss.submitted_at or _dl_ac
                        _closed = True
                if _closed:
                    db.commit()

    elif current_role == "professeur":
        if payload.table == "exams":
            query = query.filter(Exam.created_by == current_user.id)
        elif payload.table == "exam_questions":
            prof_exam_ids = [r[0] for r in db.query(Exam.id).filter(Exam.created_by == current_user.id).all()]
            if not prof_exam_ids:
                return {"data": [] if not payload.single and not payload.maybe_single else None, "error": None}
            query = query.filter(ExamQuestion.exam_id.in_(prof_exam_ids))
        elif payload.table == "submissions":
            prof_exam_ids = [r[0] for r in db.query(Exam.id).filter(Exam.created_by == current_user.id).all()]
            query = query.filter(Submission.exam_id.in_(prof_exam_ids))

    if payload.count == "exact" and payload.head:
        return {"data": None, "count": count_query(query), "error": None}

    if payload.order and hasattr(model, payload.order.column):
        column = getattr(model, payload.order.column)
        query = query.order_by(asc(column) if payload.order.ascending else desc(column))

    if payload.limit:
        query = query.limit(payload.limit)

    rows = [serialize_row(row) for row in query.all()]
    rows = hydrate_related(db, payload.table, rows)

    if current_role == "etudiant" and payload.table == "exam_questions":
        for row in rows:
            if isinstance(row.get("question"), dict):
                row["question"].pop("correct_answer", None)

    if payload.single:
        if not rows:
            return {"data": None, "error": {"message": "No rows"}}
        return {"data": rows[0], "error": None}

    if payload.maybe_single:
        return {"data": rows[0] if rows else None, "error": None}

    return {"data": rows, "error": None}


@router.post("/insert")
def db_insert(
    payload: DBInsertIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Profile = Depends(get_current_user),
):
    """Insère des données dans une table, avec contraintes de rôle."""
    model = TABLE_MODELS.get(payload.table)
    if not model:
        raise HTTPException(status_code=400, detail="Table non supportée")

    current_role = get_user_role(db, current_user.id)
    if current_role == "etudiant" and payload.table not in {"submissions", "answers"}:
        raise HTTPException(status_code=403, detail="Accès refusé à cette ressource")

    rows_input = payload.data if isinstance(payload.data, list) else [payload.data]
    created_rows = []

    for raw in rows_input:
        data = dict(raw)
        data.setdefault("id", str(uuid.uuid4()))

        dt_cols = DATETIME_COLUMNS.get(payload.table, set())
        for col in dt_cols:
            if col in data:
                data[col] = parse_datetime(data[col])

        if current_role == "etudiant" and payload.table == "submissions":
            exam_id = data.get("exam_id")
            if not exam_id or not _ensure_exam_allowed_for_student(db, current_user.id, exam_id):
                raise HTTPException(status_code=403, detail="Épreuve non autorisée pour votre profil")
            existing_sub = db.query(Submission).filter(
                Submission.exam_id == exam_id,
                Submission.student_id == current_user.id,
            ).first()
            if existing_sub:
                raise HTTPException(status_code=409, detail="Vous avez déjà une soumission pour cette épreuve")
            _SUBMISSION_INSERT_ALLOWED = {"id", "exam_id", "student_id", "started_at"}
            data = {k: v for k, v in data.items() if k in _SUBMISSION_INSERT_ALLOWED}
            data["student_id"] = current_user.id
            data["status"] = "en_cours"
            data["score"] = None

        if current_role == "etudiant" and payload.table == "answers":
            submission_id = data.get("submission_id")
            if not submission_id:
                raise HTTPException(status_code=400, detail="submission_id requis")
            owned_submission = (
                db.query(Submission)
                .filter(Submission.id == submission_id, Submission.student_id == current_user.id)
                .first()
            )
            if not owned_submission:
                raise HTTPException(status_code=403, detail="Soumission non autorisée")
            _ANSWER_INSERT_ALLOWED = {"id", "submission_id", "question_id", "answer_text"}
            data = {k: v for k, v in data.items() if k in _ANSWER_INSERT_ALLOWED}

        obj = model(**data)
        db.add(obj)
        db.flush()

        if payload.table == "exams":
            exam_status = getattr(obj, "status", None)
            if exam_status == "publie":
                _notify_students_for_exam_publication(db, obj)
            if exam_status in {"programme", "publie"}:
                _notify_admins_for_exam_action(db, obj, current_user, current_role, exam_status)

        created_rows.append(serialize_row(obj))

    db.commit()
    for row in created_rows:
        _write_audit(db, user=current_user, action="insert", table=payload.table,
                     row_id=row.get("id"), changes=row,
                     ip=request.client.host if request.client else None)
    created_rows = hydrate_related(db, payload.table, created_rows)
    return {"data": created_rows, "error": None}


@router.post("/update")
def db_update(
    payload: DBUpdateIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Profile = Depends(get_current_user),
):
    """Met à jour des enregistrements en respectant les règles de périmètre."""
    model = TABLE_MODELS.get(payload.table)
    if not model:
        raise HTTPException(status_code=400, detail="Table non supportée")

    current_role = get_user_role(db, current_user.id)
    if current_role == "etudiant" and payload.table not in {"submissions", "answers", "notifications"}:
        raise HTTPException(status_code=403, detail="Accès refusé à cette ressource")

    query = db.query(model)
    query = apply_filters(query, model, payload.filters)

    if current_role == "etudiant" and payload.table == "notifications":
        query = query.filter(model.user_id == current_user.id)

    if current_role == "etudiant" and payload.table == "submissions":
        query = query.filter(Submission.student_id == current_user.id)

    if current_role == "etudiant" and payload.table == "answers":
        query = query.join(Submission, Answer.submission_id == Submission.id).filter(Submission.student_id == current_user.id)

    if current_role == "professeur":
        if payload.table == "exams":
            query = query.filter(Exam.created_by == current_user.id)
        elif payload.table == "exam_questions":
            prof_exam_ids = [r[0] for r in db.query(Exam.id).filter(Exam.created_by == current_user.id).all()]
            query = query.filter(ExamQuestion.exam_id.in_(prof_exam_ids))
        elif payload.table == "submissions":
            prof_exam_ids = [r[0] for r in db.query(Exam.id).filter(Exam.created_by == current_user.id).all()]
            query = query.filter(Submission.exam_id.in_(prof_exam_ids))

    rows = query.all()
    publish_candidates: list[Exam] = []
    admin_notification_candidates: list[tuple[Exam, str]] = []

    dt_cols = DATETIME_COLUMNS.get(payload.table, set())
    parsed_data = dict(payload.data)
    for col in dt_cols:
        if col in parsed_data:
            parsed_data[col] = parse_datetime(parsed_data[col])

    if current_role == "etudiant":
        if payload.table == "submissions":
            parsed_data = {k: v for k, v in parsed_data.items() if k in {"status", "incidents"}}
            if "status" in parsed_data and parsed_data["status"] not in {"en_cours", "soumis"}:
                raise HTTPException(status_code=403, detail="Modification de statut non autorisée")
            if parsed_data.get("status") == "soumis":
                for row in rows:
                    if row.exam_id and row.started_at:
                        exam_timer_obj = db.query(Exam).filter(Exam.id == row.exam_id).first()
                        if exam_timer_obj:
                            _deadline = None
                            if exam_timer_obj.end_date:
                                _deadline = exam_timer_obj.end_date
                            elif exam_timer_obj.duration_minutes:
                                _started = row.started_at.replace(tzinfo=None) if row.started_at.tzinfo else row.started_at
                                _deadline = _started + timedelta(minutes=exam_timer_obj.duration_minutes + 2)
                            if _deadline:
                                _dl_naive = _deadline.replace(tzinfo=None) if _deadline.tzinfo else _deadline
                                if datetime.utcnow() > _dl_naive:
                                    raise HTTPException(
                                        status_code=403,
                                        detail="Le délai de l'épreuve est dépassé. Votre copie ne peut plus être soumise."
                                    )
        elif payload.table == "answers":
            parsed_data = {k: v for k, v in parsed_data.items() if k in {"answer_text"}}
        elif payload.table == "notifications":
            parsed_data = {k: v for k, v in parsed_data.items() if k in {"is_read"}}

    for row in rows:
        previous_status = getattr(row, "status", None) if payload.table == "exams" else None

        for key, value in parsed_data.items():
            if hasattr(row, key):
                setattr(row, key, value)

        if payload.table == "answers" and not (getattr(row, "answer_text", "") or "").strip():
            setattr(row, "points_awarded", 0.0)

        if payload.table == "exams":
            current_status = getattr(row, "status", None)
            if previous_status != current_status and current_status in {"programme", "publie"}:
                admin_notification_candidates.append((row, current_status))
            if previous_status != "publie" and current_status == "publie":
                publish_candidates.append(row)

        if hasattr(row, "updated_at"):
            setattr(row, "updated_at", datetime.utcnow())

    db.commit()

    if payload.table == "exams":
        should_commit_notifications = False
        for exam_row, action in admin_notification_candidates:
            created = _notify_admins_for_exam_action(db, exam_row, current_user, current_role, action)
            should_commit_notifications = should_commit_notifications or created > 0
        for exam_row in publish_candidates:
            created = _notify_students_for_exam_publication(db, exam_row)
            should_commit_notifications = should_commit_notifications or created > 0
        if should_commit_notifications:
            db.commit()

    if payload.table == "submissions" and payload.data.get("status") == "corrige":
        for row in rows:
            if row.student_id:
                exam_title = ""
                if row.exam_id:
                    exam_obj = db.query(Exam).filter(Exam.id == row.exam_id).first()
                    exam_title = f"« {exam_obj.title} » " if exam_obj else ""
                score_str = f"{row.score:.1f}" if row.score is not None else "?"
                db.add(Notification(
                    id=str(uuid.uuid4()),
                    user_id=row.student_id,
                    title="Votre note est définitive",
                    message=f"La correction de votre épreuve {exam_title}a été validée par votre enseignant. Note finale : {score_str}.",
                    type="success",
                    is_read=False,
                ))
        db.commit()

    updated = [serialize_row(r) for r in rows]
    for row in updated:
        _write_audit(db, user=current_user, action="update", table=payload.table,
                     row_id=row.get("id"), changes={"updated_fields": list(parsed_data.keys())},
                     ip=request.client.host if request.client else None)
    updated = hydrate_related(db, payload.table, updated)
    return {"data": updated, "error": None}


@router.post("/delete")
def db_delete(
    payload: DBDeleteIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Profile = Depends(get_current_user),
):
    """Supprime des enregistrements en respectant les contraintes de rôle."""
    model = TABLE_MODELS.get(payload.table)
    if not model:
        raise HTTPException(status_code=400, detail="Table non supportée")

    current_role = get_user_role(db, current_user.id)
    if current_role == "etudiant" and payload.table not in {"answers", "notifications"}:
        raise HTTPException(status_code=403, detail="Accès refusé à cette ressource")

    query = db.query(model)
    query = apply_filters(query, model, payload.filters)

    if current_role == "professeur":
        if payload.table == "exams":
            query = query.filter(Exam.created_by == current_user.id)
        elif payload.table == "exam_questions":
            prof_exam_ids = [r[0] for r in db.query(Exam.id).filter(Exam.created_by == current_user.id).all()]
            query = query.filter(ExamQuestion.exam_id.in_(prof_exam_ids))

    if current_role == "etudiant" and payload.table == "notifications":
        query = query.filter(model.user_id == current_user.id)
        count = query.count()
        query.delete(synchronize_session=False)
        db.commit()
        _write_audit(db, user=current_user, action="delete", table=payload.table,
                     changes={"count": count},
                     ip=request.client.host if request.client else None)
        return {"data": {"deleted": count}, "error": None}

    if current_role == "etudiant" and payload.table == "answers":
        answer_ids = [
            row[0]
            for row in query
            .join(Submission, Answer.submission_id == Submission.id)
            .filter(Submission.student_id == current_user.id)
            .with_entities(Answer.id)
            .all()
        ]
        if not answer_ids:
            return {"data": {"deleted": 0}, "error": None}

        count = db.query(Answer).filter(Answer.id.in_(answer_ids)).count()
        db.query(Answer).filter(Answer.id.in_(answer_ids)).delete(synchronize_session=False)
        db.commit()
        _write_audit(db, user=current_user, action="delete", table=payload.table,
                     changes={"count": count},
                     ip=request.client.host if request.client else None)
        return {"data": {"deleted": count}, "error": None}

    count = query.count()
    query.delete(synchronize_session=False)
    db.commit()
    _write_audit(db, user=current_user, action="delete", table=payload.table,
                 changes={"count": count},
                 ip=request.client.host if request.client else None)

    return {"data": {"deleted": count}, "error": None}
