from __future__ import annotations
from typing import Any
from pydantic import BaseModel


class Question(BaseModel):
    id: str
    type: str  # qcm, courte, longue
    enonce: str
    points_max: float
    reponse_attendue: str = ""
    options: list[Any] | None = None
    matiere: str = "informatique"


class Evaluation(BaseModel):
    id: str
    titre: str
    matiere: str = "informatique"
    questions: list[Question]
    duree_minutes: int = 60
    bareme_total: float = 20.0


class Reponse(BaseModel):
    question_id: str
    reponse: str = ""


class Copie(BaseModel):
    evaluation_id: str
    eleve_id: str = ""
    eleve_nom: str = ""
    reponses: list[Reponse]
    date_soumission: str = ""


class CorrectRequest(BaseModel):
    evaluation: Evaluation
    copie: Copie


class ResultatQuestion(BaseModel):
    question_id: str
    points_obtenus: float
    points_max: float
    est_correct: bool
    feedback: str


class CorrectResponse(BaseModel):
    evaluation_id: str
    eleve_id: str
    eleve_nom: str
    score_total: float
    bareme_total: float
    resultats: list[ResultatQuestion]
