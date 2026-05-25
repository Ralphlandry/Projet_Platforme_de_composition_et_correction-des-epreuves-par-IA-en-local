from __future__ import annotations

import os
import requests
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ia_correction.models import CorrectRequest, CorrectResponse, ResultatQuestion
from ia_correction.engine import _correct_qcm, _correct_courte, _correct_longue

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:3b")


def _warmup_model() -> None:
    """Précharge le modèle Ollama en mémoire au démarrage."""
    try:
        requests.post(
            OLLAMA_URL,
            json={"model": OLLAMA_MODEL, "prompt": "ok", "stream": False,
                  "keep_alive": -1, "options": {"num_predict": 1, "num_ctx": 128}},
            timeout=60,
        )
    except Exception:
        pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    _warmup_model()
    yield


app = FastAPI(title=f"IA Correction - {OLLAMA_MODEL}", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok", "model": OLLAMA_MODEL, "engine": "ollama"}


@app.post("/api/corriger-copie", response_model=CorrectResponse)
def corriger_copie(payload: CorrectRequest):
    evaluation = payload.evaluation
    copie = payload.copie

    reponses_map = {r.question_id: r.reponse for r in copie.reponses}
    resultats: list[ResultatQuestion] = []
    score_total = 0.0

    for question in evaluation.questions:
        reponse_eleve = reponses_map.get(question.id, "")
        pts_max = question.points_max
        q_type = question.type.lower()

        if q_type in ("qcm", "vrai_faux"):
            est_correct, ratio, feedback = _correct_qcm(
                question.reponse_attendue,
                reponse_eleve,
                question.options,
            )
            pts = round(pts_max * ratio, 2)

        elif q_type == "courte":
            pts, feedback = _correct_courte(
                question.enonce,
                question.reponse_attendue,
                reponse_eleve,
                pts_max,
            )
            pts = round(pts, 2)
            est_correct = pts >= pts_max * 0.5

        else:  # longue
            pts, feedback = _correct_longue(
                question.enonce,
                question.reponse_attendue,
                reponse_eleve,
                pts_max,
            )
            pts = round(pts, 2)
            est_correct = pts >= pts_max * 0.5

        score_total += pts
        resultats.append(ResultatQuestion(
            question_id=question.id,
            points_obtenus=pts,
            points_max=pts_max,
            est_correct=est_correct,
            feedback=feedback,
        ))

    return CorrectResponse(
        evaluation_id=evaluation.id,
        eleve_id=copie.eleve_id,
        eleve_nom=copie.eleve_nom,
        score_total=round(score_total, 2),
        bareme_total=evaluation.bareme_total,
        resultats=resultats,
    )
