from __future__ import annotations

"""Routes d'authentification et gestion des comptes utilisateurs."""

import time
import uuid
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.security import create_access_token, hash_password, is_password_too_long, verify_password
from app.db.session import get_db
from app.models import AuditLog, Level, Notification, Profile, Specialty, StudentProfile, Subject, UserRole
from app.schemas import (
    AdminCreateUserIn,
    AdminDisableUserIn,
    AdminResetPasswordIn,
    AdminUpdateRoleIn,
    SessionOut,
    SignInIn,
    SignUpIn,
    UserOut,
)
from app.services.db_ops import get_user_role

router = APIRouter(prefix="/api/auth", tags=["auth"])

# ----- Rate limiting en mémoire (5 tentatives / 5 minutes par IP) -----
_login_attempts: dict[str, list[float]] = defaultdict(list)
_LOGIN_MAX = 5
_LOGIN_WINDOW = 300  # secondes


def _check_rate_limit(ip: str) -> None:
    """Vérifie et met à jour le compteur de tentatives pour une IP donnée."""
    now = time.time()
    _login_attempts[ip] = [t for t in _login_attempts[ip] if now - t < _LOGIN_WINDOW]
    if len(_login_attempts[ip]) >= _LOGIN_MAX:
        raise HTTPException(status_code=429, detail="Trop de tentatives de connexion. Réessayez dans 5 minutes.")
    _login_attempts[ip].append(now)


def _reset_rate_limit(ip: str) -> None:
    """Réinitialise le compteur de tentatives pour une IP après une connexion réussie."""
    _login_attempts.pop(ip, None)


def _ensure_valid_student_dependencies(db: Session, level_id: str | None, specialty_id: str | None) -> None:
    """Vérifie que le niveau et la spécialité existent pour un étudiant."""
    level = db.query(Level).filter(Level.id == level_id).first()
    if not level:
        raise HTTPException(status_code=400, detail="Niveau étudiant invalide")

    specialty = db.query(Specialty).filter(Specialty.id == specialty_id).first()
    if not specialty:
        raise HTTPException(status_code=400, detail="Spécialité étudiante invalide")


def _create_welcome_notification(db: Session, user: Profile, role: str) -> None:
    """Crée une notification de bienvenue pour le nouvel utilisateur."""
    existing = (
        db.query(Notification)
        .filter(
            Notification.user_id == user.id,
            Notification.title == "Bienvenue sur EvalPro",
        )
        .first()
    )
    if existing:
        return

    role_label = {
        "admin": "administrateur",
        "professeur": "professeur",
        "etudiant": "étudiant",
    }.get(role, "utilisateur")

    db.add(
        Notification(
            user_id=user.id,
            title="Bienvenue sur EvalPro",
            message=(
                f"Bonjour {user.full_name or user.email}, votre compte {role_label} est prêt. "
                "Vous recevrez ici les informations importantes sur vos épreuves et votre activité."
            ),
            type="success",
            is_read=False,
        )
    )


def _create_user_with_role(db: Session, payload: AdminCreateUserIn | SignUpIn) -> Profile:
    """Crée un utilisateur et ses données associées selon le rôle demandé."""
    existing = db.query(Profile).filter(Profile.email == payload.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Cet email est déjà utilisé")

    if payload.role == "etudiant":
        existing_student_number = (
            db.query(StudentProfile)
            .filter(StudentProfile.student_number == payload.student_number)
            .first()
        )
        if existing_student_number:
            raise HTTPException(status_code=400, detail="Ce matricule étudiant est déjà utilisé")
        _ensure_valid_student_dependencies(db, payload.level_id, payload.specialty_id)

    try:
        password_hash = hash_password(payload.password)
    except ValueError:
        raise HTTPException(status_code=400, detail="Mot de passe invalide pour le chiffrement bcrypt")

    user = Profile(
        id=str(uuid.uuid4()),
        email=payload.email,
        full_name=payload.full_name,
        password_hash=password_hash,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(user)
    db.flush()

    db.add(UserRole(user_id=user.id, role=payload.role))

    if payload.role == "etudiant":
        db.add(
            StudentProfile(
                user_id=user.id,
                student_number=payload.student_number or "",
                level_id=payload.level_id or "",
                specialty_id=payload.specialty_id or "",
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
        )

    _create_welcome_notification(db, user, payload.role)

    db.commit()
    return user


def _ensure_admin(db: Session, user_id: str) -> None:
    """Vérifie que l'utilisateur connecté a le rôle administrateur."""
    if get_user_role(db, user_id) != "admin":
        raise HTTPException(status_code=403, detail="Accès réservé aux administrateurs")


@router.post("/signup", response_model=SessionOut)
def signup(payload: SignUpIn, db: Session = Depends(get_db)):
    """Inscription publique d'un nouvel utilisateur."""
    if is_password_too_long(payload.password):
        raise HTTPException(status_code=400, detail="Mot de passe trop long (maximum 72 octets)")

    if payload.role == "admin":
        raise HTTPException(status_code=403, detail="La création des comptes administrateur est réservée à l'administrateur")

    user = _create_user_with_role(db, payload)

    token = create_access_token(subject=user.id)
    return SessionOut(access_token=token, user=UserOut(id=user.id, email=user.email, full_name=user.full_name))


@router.post("/login", response_model=SessionOut)
def login(request: Request, payload: SignInIn, db: Session = Depends(get_db)):
    """Authentifie un utilisateur et renvoie un token JWT."""
    client_ip = request.client.host if request.client else "unknown"
    _check_rate_limit(client_ip)
    if is_password_too_long(payload.password):
        raise HTTPException(status_code=400, detail="Mot de passe trop long (maximum 72 octets)")

    user = db.query(Profile).filter(Profile.email == payload.email).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email ou mot de passe incorrect")

    if user.password_hash.startswith("<disabled>"):
        raise HTTPException(status_code=403, detail="Ce compte a été désactivé. Contactez l'administrateur.")

    _reset_rate_limit(client_ip)
    token = create_access_token(subject=user.id)
    return SessionOut(access_token=token, user=UserOut(id=user.id, email=user.email, full_name=user.full_name))


@router.get("/me")
def me(current_user: Profile = Depends(get_current_user), db: Session = Depends(get_db)):
    """Retourne les informations du compte connecté."""
    role = get_user_role(db, current_user.id)
    return {
        "user": {
            "id": current_user.id,
            "email": current_user.email,
            "full_name": current_user.full_name,
        },
        "role": role,
    }


@router.get("/signup-options")
def signup_options(db: Session = Depends(get_db)):
    """Renvoie les options de niveaux et spécialités disponibles pour l'inscription."""
    levels = db.query(Level).order_by(Level.name.asc()).all()
    specialties = db.query(Specialty).order_by(Specialty.name.asc()).all()
    return {
        "levels": [{"id": level.id, "name": level.name} for level in levels],
        "specialties": [{"id": specialty.id, "name": specialty.name} for specialty in specialties],
    }


@router.post("/admin/users")
def admin_create_user(
    payload: AdminCreateUserIn,
    current_user: Profile = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Création d'un utilisateur par un administrateur."""
    _ensure_admin(db, current_user.id)

    if is_password_too_long(payload.password):
        raise HTTPException(status_code=400, detail="Mot de passe trop long (maximum 72 octets)")

    user = _create_user_with_role(db, payload)
    return {
        "user": {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
        },
        "role": payload.role,
    }


@router.patch("/admin/users/{user_id}/role")
def admin_update_role(
    user_id: str,
    payload: AdminUpdateRoleIn,
    current_user: Profile = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Met à jour le rôle d'un utilisateur et ses données étudiantes associées."""
    _ensure_admin(db, current_user.id)

    user = db.query(Profile).filter(Profile.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")

    user_role = db.query(UserRole).filter(UserRole.user_id == user_id).first()
    if not user_role:
        user_role = UserRole(user_id=user_id, role=payload.role)
        db.add(user_role)
    user_role.role = payload.role

    student_profile = db.query(StudentProfile).filter(StudentProfile.user_id == user_id).first()

    if payload.role == "etudiant":
        existing_student_number = (
            db.query(StudentProfile)
            .filter(StudentProfile.student_number == payload.student_number, StudentProfile.user_id != user_id)
            .first()
        )
        if existing_student_number:
            raise HTTPException(status_code=400, detail="Ce matricule étudiant est déjà utilisé")
        _ensure_valid_student_dependencies(db, payload.level_id, payload.specialty_id)

        if not student_profile:
            student_profile = StudentProfile(user_id=user_id)
            db.add(student_profile)

        student_profile.student_number = payload.student_number or ""
        student_profile.level_id = payload.level_id or ""
        student_profile.specialty_id = payload.specialty_id or ""
        student_profile.updated_at = datetime.now(timezone.utc)
    elif student_profile:
        db.delete(student_profile)

    db.commit()
    return {"message": "Rôle mis à jour"}


@router.get("/admin/users")
def admin_list_users(
    current_user: Profile = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Liste les utilisateurs et leurs rôles pour l'administration."""
    _ensure_admin(db, current_user.id)

    profiles = db.query(Profile).order_by(Profile.created_at.desc()).all()
    roles = db.query(UserRole).all()
    student_profiles = db.query(StudentProfile).all()

    role_map = {role.user_id: role.role for role in roles}
    student_map = {sp.user_id: sp for sp in student_profiles}

    return {
        "users": [
            {
                "id": profile.id,
                "email": profile.email,
                "full_name": profile.full_name,
                "role": role_map.get(profile.id, "etudiant"),
                "student_profile": (
                    {
                        "student_number": student_map[profile.id].student_number,
                        "level_id": student_map[profile.id].level_id,
                        "specialty_id": student_map[profile.id].specialty_id,
                    }
                    if profile.id in student_map
                    else None
                ),
            }
            for profile in profiles
        ]
    }


@router.post("/admin/reset-password")
def admin_reset_password(
    payload: AdminResetPasswordIn,
    current_user: Profile = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Réinitialise le mot de passe d'un utilisateur (admin uniquement)."""
    _ensure_admin(db, current_user.id)

    target = db.query(Profile).filter(Profile.id == payload.user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")

    if is_password_too_long(payload.new_password):
        raise HTTPException(status_code=400, detail="Mot de passe trop long (maximum 72 octets)")

    target.password_hash = hash_password(payload.new_password)
    target.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": "Mot de passe réinitialisé avec succès"}


@router.post("/admin/disable-user")
def admin_disable_user(
    payload: AdminDisableUserIn,
    current_user: Profile = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Active ou désactive un compte utilisateur (admin uniquement)."""
    _ensure_admin(db, current_user.id)

    if payload.user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Impossible de désactiver son propre compte")

    target = db.query(Profile).filter(Profile.id == payload.user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")

    # Préfixe "<disabled>" pour signaler un compte désactivé sans supprimer le hash
    if payload.disabled:
        if not target.password_hash.startswith("<disabled>"):
            target.password_hash = f"<disabled>{target.password_hash}"
    else:
        if target.password_hash.startswith("<disabled>"):
            target.password_hash = target.password_hash[len("<disabled>"):]

    target.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": "Compte mis à jour", "disabled": payload.disabled}


@router.get("/audit-logs")
def get_audit_logs(
    limit: int = 100,
    offset: int = 0,
    table_name: str | None = None,
    current_user: Profile = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Retourne les logs d'audit (admin uniquement)."""
    _ensure_admin(db, current_user.id)

    query = db.query(AuditLog).order_by(AuditLog.created_at.desc())
    if table_name:
        query = query.filter(AuditLog.table_name == table_name)
    total = query.count()
    logs = query.offset(offset).limit(min(limit, 500)).all()

    return {
        "total": total,
        "logs": [
            {
                "id": log.id,
                "user_id": log.user_id,
                "user_email": log.user_email,
                "action": log.action,
                "table_name": log.table_name,
                "row_id": log.row_id,
                "changes": log.changes,
                "ip_address": log.ip_address,
                "created_at": log.created_at.isoformat() if log.created_at else None,
            }
            for log in logs
        ],
    }
