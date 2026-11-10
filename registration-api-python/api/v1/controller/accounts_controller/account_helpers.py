import os
from hashlib import sha256

from sqlalchemy import func
from sqlmodel import select

from controller.accounts_controller.models.models import Account
from database.postgres import SessionDep


def normalize_email(email: str) -> str:
    return email.strip().lower()


def hash_password_reset_token(token: str) -> str:
    return sha256(token.encode("utf-8")).hexdigest()


def get_password_reset_ttl_minutes() -> int:
    try:
        parsed_value = int((os.getenv("PASSWORD_RESET_TOKEN_TTL_MINUTES") or "30").strip())
    except ValueError:
        parsed_value = 30

    return parsed_value if parsed_value > 0 else 30


def find_account_by_email(email: str, session: SessionDep) -> Account | None:
    normalized_email = normalize_email(email)
    statement = select(Account).where(func.lower(Account.email) == normalized_email)
    return session.exec(statement).first()


def normalize_account_role(account: Account, session: SessionDep) -> str:
    role = (account.role or "").strip().lower()
    if role in {"user", "admin"}:
        return role

    account.role = "user"
    session.add(account)
    session.commit()
    session.refresh(account)
    return "user"
