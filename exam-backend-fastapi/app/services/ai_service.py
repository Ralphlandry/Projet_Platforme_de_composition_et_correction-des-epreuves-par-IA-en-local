from __future__ import annotations

"""Service d'IA pour l'auto-correction et l'analyse de questions."""

from datetime import datetime
import re

import requests
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Answer, Exam, ExamQuestion, Profile, Question, Submission


def _map_question_type(qt: str | None) -> str:
    """Normalise le type interne de question pour le service IA."""
    if qt == "qcm":
        return "qcm"
    if qt == "vrai_faux":
        return "qcm"
    if qt == "reponse_courte":
        return "courte"
    return "longue"


def _normalize_text(value: str | None) -> str:
    """Normalise le texte pour comparaison sans casse ni espaces redondants."""
    if not value:
        return ""
    return " ".join(value.strip().lower().split())


def _extract_choice_letter(value: str | None) -> str | None:
    """Extrait une lettre de choix (A-D) d'une réponse formatée."""
    if not value:
        return None
    match = re.match(r"^\s*([a-d])(?:[\)\.\-\s]|$)", value.strip(), flags=re.IGNORECASE)
    if match:
        return match.group(1).upper()
    return None


def _is_qcm_answer_correct(question: Question, answer_text: str | None) -> bool:
    """Vérifie si une réponse QCM/Vrai-Faux correspond à la réponse attendue."""
    expected = (question.correct_answer or "").strip()
    answer = (answer_text or "").strip()
    if not expected or not answer:
        return False

    expected_norm = _normalize_text(expected)
    answer_norm = _normalize_text(answer)
    if expected_norm == answer_norm:
        return True

    # Handle letter-based answers (A/B/C/D), including formats like "A." or "A)".
    expected_letter = _extract_choice_letter(expected) or (expected.upper() if len(expected) == 1 and expected.isalpha() else None)
    answer_letter = _extract_choice_letter(answer) or (answer.upper() if len(answer) == 1 and answer.isalpha() else None)
    if expected_letter and answer_letter and expected_letter == answer_letter:
        return True

    # If expected is a letter, match it against the option text.
    if expected_letter and isinstance(question.options, list):
        index = ord(expected_letter) - ord("A")
        if 0 <= index < len(question.options):
            option_text = _normalize_text(str(question.options[index]))
            if answer_norm == option_text:
                return True

    return False


def auto_correct_submission(db: Session, submission_id: str) -> None:
    """Corrige automatiquement une soumission en utilisant le moteur d'IA.

    Cette fonction construit un payload d'évaluation, interroge le service IA et
    applique un recalcul déterministe pour les questions objectives.
    """
    submission = db.query(Submission).filter(Submission.id == submission_id).first()
    if not submission or not submission.exam_id:
        return

    exam = db.query(Exam).filter(Exam.id == submission.exam_id).first()
    if not exam:
        return

    student = None
    if submission.student_id:
        student = db.query(Profile).filter(Profile.id == submission.student_id).first()

    eq_rows = (
        db.query(ExamQuestion)
        .filter(ExamQuestion.exam_id == exam.id)
        .order_by(ExamQuestion.order_index.asc())
        .all()
    )

    answers = db.query(Answer).filter(Answer.submission_id == submission_id).all()
    question_by_id: dict[str, Question] = {}

    question_payload = []
    for eq in eq_rows:
        if not eq.question_id:
            continue
        q = db.query(Question).filter(Question.id == eq.question_id).first()
        if not q:
            continue
        question_by_id[q.id] = q
        options = q.options if isinstance(q.options, list) else None
        question_payload.append(
            {
                "id": q.id,
                "type": _map_question_type(q.question_type),
                "matiere": "informatique",
                "enonce": q.question_text,
                "points_max": float(eq.points if eq.points is not None else (q.points or 1)),
                "reponse_attendue": q.correct_answer or "",
                "options": options,
            }
        )

    copie_payload = {
        "evaluation_id": exam.id,
        "eleve_id": submission.student_id or "",
        "eleve_nom": (student.full_name if student and student.full_name else (student.email if student else "Étudiant")),
        "reponses": [
            {
                "question_id": a.question_id,
                "reponse": a.answer_text or "",
            }
            for a in answers
            if a.question_id
        ],
        "date_soumission": datetime.utcnow().isoformat(),
    }

    evaluation_payload = {
        "id": exam.id,
        "titre": exam.title,
        "matiere": "informatique",
        "questions": question_payload,
        "duree_minutes": exam.duration_minutes or 60,
        "bareme_total": float(exam.total_points or 20),
    }

    try:
        response = requests.post(
            f"{settings.ia_api_url}/api/corriger-copie",
            json={"evaluation": evaluation_payload, "copie": copie_payload},
            timeout=300,
        )
        response.raise_for_status()
        payload = response.json()
    except Exception:
        return

    resultats = payload.get("resultats", []) if isinstance(payload, dict) else []
    res_by_qid = {r.get("question_id"): r for r in resultats if r.get("question_id")}

    total_score = 0.0
    for ans in answers:
        if not ans.question_id:
            continue

        # Business rule: blank answer always gets zero.
        if not (ans.answer_text or "").strip():
            ans.points_awarded = 0.0
            ans.feedback = "Aucune réponse fournie: note 0."
            ans.is_correct = False
            continue

        result = res_by_qid.get(ans.question_id)
        pts = float(result.get("points_obtenus", 0) or 0) if result else 0.0
        ans_feedback = result.get("feedback") if result else None
        ans_correct = bool(result.get("est_correct", False)) if result else False

        q = question_by_id.get(ans.question_id)
        if q and q.question_type in {"qcm", "vrai_faux"}:
            # Guardrail déterministe pour les questions objectives.
            if _is_qcm_answer_correct(q, ans.answer_text):
                pts = float(q.points or 1)
                ans_correct = True
                if not ans_feedback:
                    ans_feedback = "Réponse correcte."
            else:
                pts = 0.0
                ans_correct = False
                if not ans_feedback:
                    ans_feedback = "Réponse incorrecte."

        ans.points_awarded = pts
        ans.feedback = ans_feedback
        ans.is_correct = ans_correct
        total_score += pts

    # Recalcule final du score par somme des points attribués.
    submission.score = float(total_score)
    submission.status = "corrige_auto"
    submission.graded_at = datetime.utcnow()
    db.commit()
