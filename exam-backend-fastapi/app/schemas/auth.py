from __future__ import annotations

"""Schémas Pydantic pour l'authentification et la gestion des utilisateurs."""

from typing import Literal

from pydantic import BaseModel, EmailStr, Field, model_validator


class SignUpIn(BaseModel):
    """Payload de création de compte pour l'inscription utilisateur."""

    email: EmailStr
    password: str = Field(min_length=6)
    full_name: str | None = None
    role: Literal["admin", "professeur", "etudiant"] = "etudiant"
    student_number: str | None = None
    level_id: str | None = None
    specialty_id: str | None = None

    @model_validator(mode="after")
    def validate_student_fields(self):
        if self.role == "etudiant":
            if not self.student_number:
                raise ValueError("Le matricule est obligatoire pour un étudiant")
            if not self.level_id:
                raise ValueError("Le niveau est obligatoire pour un étudiant")
            if not self.specialty_id:
                raise ValueError("La spécialité est obligatoire pour un étudiant")
        return self


class SignInIn(BaseModel):
    """Payload de connexion utilisateur."""

    email: EmailStr
    password: str


class UserOut(BaseModel):
    """Données publiques renvoyées pour un utilisateur authentifié."""

    id: str
    email: str
    full_name: str | None = None


class SessionOut(BaseModel):
    """Réponse de session contenant le token d'accès et l'utilisateur."""

    access_token: str
    token_type: Literal["bearer"] = "bearer"
    user: UserOut


class AdminCreateUserIn(BaseModel):
    """Payload de création de compte par un administrateur."""

    email: EmailStr
    password: str = Field(min_length=6)
    full_name: str | None = None
    role: Literal["admin", "professeur", "etudiant"]
    student_number: str | None = None
    level_id: str | None = None
    specialty_id: str | None = None

    @model_validator(mode="after")
    def validate_student_fields(self):
        if self.role == "etudiant":
            if not self.student_number:
                raise ValueError("Le matricule est obligatoire pour un étudiant")
            if not self.level_id:
                raise ValueError("Le niveau est obligatoire pour un étudiant")
            if not self.specialty_id:
                raise ValueError("La spécialité est obligatoire pour un étudiant")
        return self


class AdminUpdateRoleIn(BaseModel):
    """Payload de mise à jour du rôle utilisateur par un administrateur."""

    role: Literal["admin", "professeur", "etudiant"]
    student_number: str | None = None
    level_id: str | None = None
    specialty_id: str | None = None

    @model_validator(mode="after")
    def validate_student_fields(self):
        if self.role == "etudiant":
            if not self.student_number:
                raise ValueError("Le matricule est obligatoire pour un étudiant")
            if not self.level_id:
                raise ValueError("Le niveau est obligatoire pour un étudiant")
            if not self.specialty_id:
                raise ValueError("La spécialité est obligatoire pour un étudiant")
        return self


class AdminResetPasswordIn(BaseModel):
    """Payload de réinitialisation de mot de passe administrateur."""

    user_id: str
    new_password: str = Field(min_length=8)


class AdminDisableUserIn(BaseModel):
    """Payload de désactivation ou réactivation de compte."""

    user_id: str
    disabled: bool
