from __future__ import annotations

"""Routes de gestion des examens, import PDF et suggestions d'IA."""

import re
from typing import Any

import requests
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from pypdf import PdfReader
from sqlalchemy.orm import Session

import threading

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import get_db, SessionLocal
from app.models import Profile
from app.services.db_ops import get_user_role
from app.services.ai_service import auto_correct_submission

router = APIRouter(prefix="/api/exams", tags=["exams"])


def _guess_question_type(item: dict[str, Any]) -> str:
    """Déduit si une question est QCM ou réponse courte d'après ses options."""
    if item.get("options"):
        return "qcm"
    return "reponse_courte"


def _extract_questions_from_text(text: str) -> list[dict[str, Any]]:
    """Extrait des questions textuelles à partir du contenu d'un PDF."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not lines:
        return []

    question_re = re.compile(r"^(?:question\s*)?(\d+)\s*[\)\.:\-]\s*(.+)$", re.IGNORECASE)
    option_re = re.compile(r"^([A-D])[\)\.:\-]\s*(.+)$", re.IGNORECASE)

    extracted: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None

    def flush_current() -> None:
        nonlocal current
        if not current:
            return
        current["question_type"] = _guess_question_type(current)
        current.setdefault("points", 1)
        current.setdefault("correct_answer", "")
        extracted.append(current)
        current = None

    for ln in lines:
        q_match = question_re.match(ln)
        if q_match:
            flush_current()
            current = {
                "question_text": q_match.group(2).strip(),
                "options": [],
            }
            continue

        opt_match = option_re.match(ln)
        if opt_match and current is not None:
            current.setdefault("options", []).append(opt_match.group(2).strip())
            continue

        if current is not None:
            current["question_text"] = f"{current.get('question_text', '')} {ln}".strip()

    flush_current()

    if extracted:
        return extracted

    # Fallback: split by '?' pour détecter des questions en texte libre.
    fallback = [chunk.strip() for chunk in text.split("?") if chunk.strip()]
    return [
        {
            "question_text": f"{chunk}?",
            "question_type": "reponse_courte",
            "options": [],
            "correct_answer": "",
            "points": 1,
        }
        for chunk in fallback
    ]


@router.post("/import-pdf")
def import_exam_pdf(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: Profile = Depends(get_current_user),
):
    """Importe un PDF et tente d'en extraire des questions d'examen."""
    role = get_user_role(db, current_user.id)
    if role not in {"admin", "professeur"}:
        raise HTTPException(status_code=403, detail="Accès refusé")

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Veuillez importer un fichier PDF")

    try:
        reader = PdfReader(file.file)
        text_parts: list[str] = []
        for page in reader.pages:
            page_text = page.extract_text() or ""
            if page_text.strip():
                text_parts.append(page_text)

        full_text = "\n".join(text_parts).strip()
        if not full_text:
            raise HTTPException(status_code=400, detail="Aucun texte exploitable trouvé dans le PDF")

        questions = _extract_questions_from_text(full_text)
        if not questions:
            raise HTTPException(status_code=400, detail="Aucune question détectée dans le PDF")

        return {
            "data": {
                "questions": questions,
                "detected_count": len(questions),
            },
            "error": None,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Import PDF impossible: {exc}") from exc


# ---------------------------------------------------------------------------
# Suggest answers using LLM (Ollama via IA micro-service)
# ---------------------------------------------------------------------------


class _QuestionIn(BaseModel):
    """Schéma interne pour une question à traiter par l'IA."""

    question_text: str
    question_type: str = "reponse_courte"
    options: list[str] = []
    correct_answer: str = ""
    points: float = 1


class _SuggestPayload(BaseModel):
    """Payload attendu pour la génération de suggestions de réponses."""

    questions: list[_QuestionIn]


def _has_letter_prefix(options: list[str]) -> bool:
    """Détecte si les options sont préfixées par une lettre (A/B/C/D)."""
    return bool(options) and all(
        re.match(r'^[A-Da-d][.\)]\s', o) for o in options
    )


def _build_answer_prompt(q: _QuestionIn) -> str:
    """Construit le prompt envoyé au modèle d'IA."""

    if q.question_type == "qcm" and q.options:
        if _has_letter_prefix(q.options):
            opts_str = "\n".join(q.options)
            letters = "/".join(chr(65 + i) for i in range(len(q.options)))
            return (
                "### Instruction\n"
                "Tu es un assistant expert en informatique et en commerce electronique. "
                f"Reponds a la question a choix multiples en donnant UNIQUEMENT la lettre correcte ({letters}).\n\n"
                f"### Question\n{q.question_text}\n\n"
                f"### Options\n{opts_str}\n\n"
                "### Reponse\n"
            )
        else:
            opts_str = "\n".join(f"{i+1}. {o}" for i, o in enumerate(q.options))
            return (
                "### Instruction\n"
                "Tu es un assistant expert en informatique et en commerce electronique. "
                "Reponds a la question a choix multiples en donnant UNIQUEMENT le numero de la bonne reponse.\n\n"
                f"### Question\n{q.question_text}\n\n"
                f"### Options\n{opts_str}\n\n"
                "### Reponse\n"
            )

    if q.question_type == "vrai_faux":
        return (
            "### Instruction\n"
            "Tu es un assistant expert en informatique et en commerce electronique. "
            "Reponds UNIQUEMENT par Vrai ou Faux.\n\n"
            f"### Question\n{q.question_text}\n\n"
            "### Reponse\n"
        )

    return (
        "### Instruction\n"
        "Tu es un assistant expert en informatique et en commerce electronique. "
        "Donne une reponse courte et precise en une phrase.\n\n"
        f"### Question\n{q.question_text}\n\n"
        "### Reponse\n"
    )


def _ask_ollama(prompt: str, question_type: str = "") -> str | None:
    """Interroge le service Ollama et renvoie le texte de réponse brut."""
    ollama_host = settings.ollama_url.rstrip("/")
    if question_type == "vrai_faux":
        max_tokens = 5
        num_ctx = 512
    elif question_type == "qcm_options":
        max_tokens = 5
        num_ctx = 512
    elif question_type in ("reponse_courte", "qcm"):
        max_tokens = 80
        num_ctx = 512
    else:
        max_tokens = 300
        num_ctx = 1024
    try:
        resp = requests.post(
            f"{ollama_host}/api/generate",
            json={
                "model": "qwen2.5:3b",
                "prompt": prompt,
                "stream": False,
                "keep_alive": -1,
                "options": {"temperature": 0, "num_predict": max_tokens, "num_ctx": num_ctx},
            },
            timeout=120,
        )
        resp.raise_for_status()
        return (resp.json().get("response") or "").strip()
    except Exception:
        return None


def _clean_llm_answer(raw: str | None, q: _QuestionIn) -> str:
    """Nettoie et normalise la réponse renvoyée par le modèle."""
    if not raw:
        return ""

    if q.question_type == "qcm" and q.options:
        if _has_letter_prefix(q.options):
            m = re.search(r'\b([A-Da-d])\b', raw)
            if m:
                idx = ord(m.group(1).upper()) - ord('A')
                if 0 <= idx < len(q.options):
                    return q.options[idx]
            raw_low = raw.lower()
            for opt in q.options:
                if opt[3:].strip().lower() in raw_low:
                    return opt
            return ""
        else:
            m = re.search(r"\b([1-9])\b", raw)
            if m:
                index = int(m.group(1)) - 1
                if 0 <= index < len(q.options):
                    return q.options[index]
            return ""

    if q.question_type == "vrai_faux":
        low = raw.lower()
        if "vrai" in low:
            return "Vrai"
        if "faux" in low:
            return "Faux"
        return ""

    cleaned = raw.strip()
    cleaned = re.sub(r"^(?:R[ée]ponses?\s*:\s*)", "", cleaned, flags=re.IGNORECASE).strip()
    if len(cleaned) > 1000:
        cleaned = cleaned[:1000]
    return cleaned


def _process_one_question(q: _QuestionIn) -> dict[str, Any]:
    """Traite une question via l'IA et renvoie la suggestion de réponse."""
    if q.question_type == "qcm" and q.options:
        effective_type = "qcm_options"
    else:
        effective_type = q.question_type

    prompt = _build_answer_prompt(q)
    print(f"\n{'='*60}")
    print(f"[IA SUGGEST] type={effective_type}")
    print(f"[IA SUGGEST] PROMPT ENVOYE:\n{prompt}")

    raw_answer = _ask_ollama(prompt, effective_type)
    print(f"[IA SUGGEST] REPONSE BRUTE OLLAMA: {repr(raw_answer)}")

    suggested = _clean_llm_answer(raw_answer, q)
    print(f"[IA SUGGEST] REPONSE NETTOYEE: {repr(suggested)}")
    print(f"{'='*60}\n")

    return {
        "question_text": q.question_text,
        "question_type": q.question_type,
        "options": q.options,
        "correct_answer": suggested or q.correct_answer,
        "points": q.points,
        "ai_suggested": bool(suggested),
    }


@router.post("/suggest-answers")
def suggest_answers(
    payload: _SuggestPayload,
    db: Session = Depends(get_db),
    current_user: Profile = Depends(get_current_user),
):
    """Génère des suggestions de réponses à partir des questions fournies."""
    role = get_user_role(db, current_user.id)
    if role not in {"admin", "professeur"}:
        raise HTTPException(status_code=403, detail="Accès refusé")

    from concurrent.futures import ThreadPoolExecutor, as_completed

    results: list[dict[str, Any]] = [None] * len(payload.questions)  # type: ignore[list-item]

    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {
            pool.submit(_process_one_question, q): i
            for i, q in enumerate(payload.questions)
        }
        for future in as_completed(futures):
            idx = futures[future]
            try:
                results[idx] = future.result()
            except Exception:
                q = payload.questions[idx]
                results[idx] = {
                    "question_text": q.question_text,
                    "question_type": q.question_type,
                    "options": q.options,
                    "correct_answer": q.correct_answer,
                    "points": q.points,
                    "ai_suggested": False,
                }

    return {
        "data": {"questions": results},
        "error": None,
    }


@router.post("/submissions/{submission_id}/auto-correct")
def trigger_auto_correct(
    submission_id: str,
    db: Session = Depends(get_db),
    current_user: Profile = Depends(get_current_user),
):
    """Lance en arrière-plan la correction automatique d'une soumission."""
    role = get_user_role(db, current_user.id)
    if role not in {"admin", "professeur", "etudiant"}:
        raise HTTPException(status_code=403, detail="Accès refusé")

    def _run():
        bg_db = SessionLocal()
        try:
            auto_correct_submission(bg_db, submission_id)
        finally:
            bg_db.close()

    threading.Thread(target=_run, daemon=True).start()
    return {"status": "correction_en_cours", "submission_id": submission_id}
