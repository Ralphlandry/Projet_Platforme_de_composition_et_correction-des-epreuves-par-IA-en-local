from __future__ import annotations

import argparse
import uuid
from datetime import datetime
from pathlib import Path
import sys


BASE_DIR = Path(__file__).resolve().parents[1]
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

"""Script utilitaire pour créer ou mettre à jour un compte administrateur."""

from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models import Profile, UserRole


def main() -> None:
    """Parse les arguments CLI et crée / met à jour un utilisateur admin."""
    parser = argparse.ArgumentParser(description="Create initial admin user")
    parser.add_argument("--email", required=True, help="Admin email")
    parser.add_argument("--password", required=True, help="Admin password")
    parser.add_argument("--full-name", default="Administrateur", help="Admin full name")
    parser.add_argument(
        "--reset-password",
        action="store_true",
        help="Reset password if the user already exists",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        existing = db.query(Profile).filter(Profile.email == args.email).first()
        if existing:
            role = db.query(UserRole).filter(UserRole.user_id == existing.id).first()
            if role:
                role.role = "admin"
            else:
                db.add(UserRole(user_id=existing.id, role="admin"))

            if args.reset_password:
                existing.password_hash = hash_password(args.password)
                existing.updated_at = datetime.utcnow()

            db.commit()
            if args.reset_password:
                print(f"Admin existed, role ensured and password reset for: {args.email}")
            else:
                print(f"Admin already existed, role ensured for: {args.email}")
            return

        user = Profile(
            id=str(uuid.uuid4()),
            email=args.email,
            full_name=args.full_name,
            password_hash=hash_password(args.password),
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(user)
        db.flush()

        db.add(UserRole(user_id=user.id, role="admin"))
        db.commit()
        print(f"Admin created: {args.email}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
