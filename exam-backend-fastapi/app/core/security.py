from __future__ import annotations

"""Fonctions de sécurité pour le chiffrement des mots de passe et les tokens JWT."""

from datetime import datetime, timedelta, timezone
from typing import Any

from jose import jwt
from passlib.context import CryptContext

from .config import settings


pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
BCRYPT_MAX_PASSWORD_BYTES = 72


def is_password_too_long(password: str) -> bool:
    """Return True if the raw password exceeds bcrypt's byte limit."""
    return len(password.encode("utf-8")) > BCRYPT_MAX_PASSWORD_BYTES


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plaintext password against its bcrypt hash.

    Returns False for passwords that are too long or when verification fails.
    """
    if is_password_too_long(plain_password):
        return False
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except ValueError:
        return False


def hash_password(password: str) -> str:
    """Hash a plaintext password using bcrypt.

    Raises ValueError when the password exceeds bcrypt's supported length.
    """
    if is_password_too_long(password):
        raise ValueError("Password too long for bcrypt")
    return pwd_context.hash(password)


def create_access_token(subject: str, extra: dict[str, Any] | None = None) -> str:
    """Create a JWT access token embedding the user subject and optional claims."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload: dict[str, Any] = {"sub": subject, "exp": expire}
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict[str, Any]:
    """Decode a JWT and return its payload.

    Raises JWTError or ExpiredSignatureError when the token is invalid.
    """
    return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
