from __future__ import annotations
import os
import re
import requests

try:
    from sentence_transformers import SentenceTransformer, util
except ImportError:  # pragma: no cover
    SentenceTransformer = None
    util = None

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate")
MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:3b")
EMBEDDING_MODEL = os.getenv("SENTENCE_TRANSFORMER_MODEL", "all-MiniLM-L6-v2")
_embedding_model = None


def _normalize(text: str) -> str:
    return " ".join((text or "").strip().lower().split())


def _extract_letter(text: str) -> str | None:
    m = re.match(r"^\s*([a-d])(?:[\)\.\-\s]|$)", text.strip(), re.IGNORECASE)
    return m.group(1).upper() if m else None


def _get_sentence_transformer_model() -> "SentenceTransformer":
    global _embedding_model
    if SentenceTransformer is None:
        raise RuntimeError(
            "sentence-transformers n'est pas installé. Ajoutez le package dans ia/requirements.txt et installez-le."
        )
    if _embedding_model is None:
        _embedding_model = SentenceTransformer(EMBEDDING_MODEL)
    return _embedding_model


def _semantic_similarity(text_a: str, text_b: str) -> float:
    if not text_a or not text_b:
        return 0.0
    model = _get_sentence_transformer_model()
    embeddings = model.encode([text_a, text_b], convert_to_tensor=True, normalize_embeddings=True)
    similarity = float(util.cos_sim(embeddings[0], embeddings[1]).item())
    return max(0.0, min(1.0, similarity))


def _correct_qcm(reponse_attendue: str, reponse_eleve: str, options: list | None) -> tuple[bool, float, str]:
    """Correction déterministe pour QCM et Vrai/Faux."""
    expected_norm = _normalize(reponse_attendue)
    answer_norm = _normalize(reponse_eleve)

    if not answer_norm:
        return False, 0.0, "Aucune réponse fournie."

    if expected_norm == answer_norm:
        return True, 1.0, "Réponse correcte."

    exp_letter = _extract_letter(reponse_attendue) or (reponse_attendue.upper() if len(reponse_attendue) == 1 else None)
    ans_letter = _extract_letter(reponse_eleve) or (reponse_eleve.upper() if len(reponse_eleve) == 1 else None)

    if exp_letter and ans_letter and exp_letter == ans_letter:
        return True, 1.0, "Réponse correcte."

    if exp_letter and isinstance(options, list):
        idx = ord(exp_letter) - ord("A")
        if 0 <= idx < len(options):
            if answer_norm == _normalize(str(options[idx])):
                return True, 1.0, "Réponse correcte."

    return False, 0.0, f"Réponse incorrecte. La bonne réponse était : {reponse_attendue}"


def _ask_ollama(prompt: str, num_ctx: int = 512, num_predict: int = 150) -> str:
    """Appel à Ollama avec Qwen2.5:3b."""
    try:
        response = requests.post(
            OLLAMA_URL,
            json={
                "model": MODEL,
                "prompt": prompt,
                "stream": False,
                "keep_alive": -1,
                "options": {"temperature": 0, "num_predict": num_predict, "num_ctx": num_ctx},
            },
            timeout=120,
        )
        response.raise_for_status()
        return response.json().get("response", "").strip()
    except Exception as e:
        return f"ERREUR_IA: {e}"


def _correct_courte(enonce: str, reponse_attendue: str, reponse_eleve: str, points_max: float) -> tuple[float, str]:
    """Correction IA pour réponse courte."""
    if not reponse_eleve.strip():
        return 0.0, "Aucune réponse fournie."

    norm_eleve = _normalize(reponse_eleve)
    norm_attendue = _normalize(reponse_attendue)
    if norm_eleve == norm_attendue:
        return points_max, "Réponse correcte."

    similarity = _semantic_similarity(reponse_attendue, reponse_eleve)
    if similarity >= 0.94:
        return points_max, f"Réponse sémantiquement très proche de la référence ({similarity:.2f})."

    prompt = f"""Tu es un correcteur bienveillant d'examen en informatique. Ton role est d'evaluer si l'etudiant a compris le concept, pas de verifier la formulation exacte.

Question : {enonce}
Reponse de reference : {reponse_attendue}
Reponse etudiant : {reponse_eleve}
Points maximum : {points_max}
Similarite sémantique avec la reference : {similarity:.2f}

Regles IMPORTANTES :
- Evalue le SENS et la comprehension, pas les mots exacts.
- Un synonyme, une reformulation ou une explication differente mais correcte = points PLEINS.
- Accorde des points PARTIELS si l'etudiant a compris une partie du concept.
- Sois GENEREUX : en cas de doute, accorde le benefice du doute a l'etudiant.
- Donne 0 UNIQUEMENT si la reponse est completement hors sujet ou vide de sens.
- Fautes d'orthographe et de syntaxe n'affectent PAS la note.

Reponds UNIQUEMENT avec ce JSON (rien d'autre) :
{{"points": <nombre decimal entre 0 et {points_max}>, "feedback": "<commentaire constructif et bienveillant en francais>"}}"""  # noqa: E501

    raw = _ask_ollama(prompt, num_ctx=1024, num_predict=150)
    result = _parse_ia_result(raw, points_max)
    # Filet de securite : si le modele retourne 0 sur une reponse non vide, on accorde au minimum 20%
    if result[0] == 0.0 and reponse_eleve.strip():
        return round(points_max * 0.2, 2), result[1] + " (note minimale accordee car reponse non vide)"
    return result


def _correct_longue(enonce: str, reponse_attendue: str, reponse_eleve: str, points_max: float) -> tuple[float, str]:
    """Correction IA pour réponse longue/développement."""
    if not reponse_eleve.strip():
        return 0.0, "Aucune réponse fournie."

    similarity = _semantic_similarity(reponse_attendue, reponse_eleve)
    prompt = f"""Tu es un correcteur bienveillant d'examen universitaire en informatique. Evalue cette redaction.

Question : {enonce}
Elements attendus (reference) : {reponse_attendue}
Redaction de l'etudiant : {reponse_eleve}
Points maximum : {points_max}
Similarite sémantique avec la reference : {similarity:.2f}

Methode d'evaluation (sois GENEREUX et BIENVEILLANT) :
1. Identifie les concepts cles dans la reponse de reference.
2. Verifie si l'etudiant a mentionne ces concepts (meme avec ses propres mots).
3. Accorde des points proportionnels aux concepts correctement abordes.
4. Valorise l'effort de redaction et la logique du raisonnement.
5. Les fautes d'orthographe et de style ne doivent PAS penaliser l'etudiant.
6. En cas de doute sur un element, accorde le benefice du doute.
7. Donne 0 UNIQUEMENT si le texte est completement hors sujet.
8. Note minimale si l'etudiant a fait un effort : au moins 25% des points.

Reponds UNIQUEMENT avec ce JSON (rien d'autre) :
{{"points": <nombre decimal entre 0 et {points_max}>, "feedback": "<commentaire detaille et encourageant : points forts puis axes d'amelioration>"}}"""  # noqa: E501

    raw = _ask_ollama(prompt, num_ctx=1536, num_predict=250)
    result = _parse_ia_result(raw, points_max)
    # Filet de securite : si le modele retourne 0 sur une redaction non vide, on accorde au minimum 25%
    if result[0] == 0.0 and reponse_eleve.strip():
        return round(points_max * 0.25, 2), result[1] + " (note minimale accordee car effort de redaction constate)"
    return result


def _parse_ia_result(raw: str, points_max: float) -> tuple[float, str]:
    """Parse la réponse JSON de l'IA."""
    try:
        json_match = re.search(r'\{.*?"points"\s*:\s*([\d.]+).*?"feedback"\s*:\s*"([^"]*)".*?\}', raw, re.DOTALL)
        if not json_match:
            json_match = re.search(r'\{.*?"feedback"\s*:\s*"([^"]*)".*?"points"\s*:\s*([\d.]+).*?\}', raw, re.DOTALL)
            if json_match:
                feedback = json_match.group(1)
                pts = min(float(json_match.group(2)), points_max)
                return pts, feedback

        if json_match:
            pts = min(float(json_match.group(1)), points_max)
            feedback = json_match.group(2)
            return pts, feedback

        pts_match = re.search(r'"points"\s*:\s*([\d.]+)', raw)
        if pts_match:
            pts = min(float(pts_match.group(1)), points_max)
            return pts, "Correction effectuée par IA."
    except Exception:
        pass

    return points_max * 0.5, "Correction automatique approximative."
