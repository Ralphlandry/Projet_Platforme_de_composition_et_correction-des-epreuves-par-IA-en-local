from __future__ import annotations

"""Dependencies partagées pour l'API, notamment l'authentification JWT."""

from fastapi import Depends, Header, HTTPException, status
from jose import JWTError
from jose.exceptions import ExpiredSignatureError
from sqlalchemy.orm import Session

from app.core.security import decode_token
from app.db.session import get_db
from app.models import Profile


def parse_auth_token(authorization: str | None) -> str:
    """Extrait le token Bearer de l'en-tête Authorization.

    Args:
        authorization: Valeur complète de l'en-tête Authorization.

    Returns:
        Le token si l'en-tête est valide.

    Raises:
        HTTPException: Lorsque l'en-tête est manquant ou mal formé.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Non authentifié")
    return authorization.split(" ", 1)[1].strip()


def get_current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> Profile:
    """Résout l'utilisateur authentifié à partir du token JWT.

    Cette dépendance est utilisée par les routes protégées pour vérifier que
    la requête provient d'un compte utilisateur valide.
    """
    token = parse_auth_token(authorization)
    try:
        payload = decode_token(token)
    except ExpiredSignatureError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expiré") from exc
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token invalide") from exc

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token invalide")

    user = db.query(Profile).filter(Profile.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Utilisateur introuvable")
    return user
