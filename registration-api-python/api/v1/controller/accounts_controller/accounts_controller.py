import os
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from secrets import token_urlsafe

from fastapi import HTTPException, status
from sqlalchemy import delete, func
from sqlmodel import select

from controller.accounts_controller.models.models import (
    Account,
    AccountBase,
    AccountDeactivatedPublic,
    AccountDeactivationRequest,
    AccountEmailLookup,
    AccountLoginPublic,
    AccountPasswordResetCompletedPublic,
    AccountPasswordResetConfirm,
    AccountPasswordResetRequest,
    AccountPasswordResetRequestedPublic,
    AccountPasswordSetup,
    AccountPublic,
    AccountUpdate,
    PasswordResetToken,
)
from controller.accounts_controller.password_reset_delivery import (
    assert_password_reset_delivery_available,
    build_password_reset_url,
    deliver_password_reset_email,
)
from controller.accounts_controller.passwords import create_password_hash, verify_password
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


def get_account_access(body: AccountEmailLookup, session: SessionDep) -> AccountLoginPublic:
    try:
        account = find_account_by_email(body.email, session)
        if not account:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Account not found",
            )

        role = normalize_account_role(account, session)
        return AccountLoginPublic(
            email=account.email,
            role=role,
            password_setup_required=not account.password,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to read account access state",
        ) from exc


def get_account(body: AccountBase, session: SessionDep) -> AccountLoginPublic:
    try:
        account = find_account_by_email(body.email, session)
        if not account or not verify_password(body.password, account.password, account.password_salt):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Account not found",
            )

        role = normalize_account_role(account, session)
        if account.password_salt is None:
            account.password, account.password_salt = create_password_hash(body.password)
            session.add(account)
            session.commit()
            session.refresh(account)

        return AccountLoginPublic(
            email=account.email,
            role=role,
            password_setup_required=False,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get account",
        ) from exc


def create_account_password(body: AccountPasswordSetup, session: SessionDep) -> AccountLoginPublic:
    try:
        account = find_account_by_email(body.email, session)
        if not account:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Account not found",
            )

        if account.password:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Account password already exists",
            )

        role = normalize_account_role(account, session)
        account.password, account.password_salt = create_password_hash(body.password)
        session.add(account)
        session.commit()
        session.refresh(account)

        return AccountLoginPublic(
            email=account.email,
            role=role,
            password_setup_required=False,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create account password",
        ) from exc


def request_password_reset(
    body: AccountPasswordResetRequest,
    session: SessionDep,
) -> AccountPasswordResetRequestedPublic:
    try:
        assert_password_reset_delivery_available()
        account = find_account_by_email(body.email, session)
        if not account:
            return AccountPasswordResetRequestedPublic(
                message="If an account exists for that email, a password reset link has been sent.",
            )

        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(minutes=get_password_reset_ttl_minutes())
        raw_token = token_urlsafe(32)
        token_hash = hash_password_reset_token(raw_token)

        active_tokens = session.exec(
            select(PasswordResetToken).where(
                PasswordResetToken.account_id == account.id,
                PasswordResetToken.used_at.is_(None),
            )
        ).all()
        for token_record in active_tokens:
            token_record.used_at = now
            session.add(token_record)

        reset_token = PasswordResetToken(
            account_id=account.id,
            token_hash=token_hash,
            created_at=now,
            expires_at=expires_at,
        )
        session.add(reset_token)
        session.commit()

        reset_url = build_password_reset_url(raw_token)
        delivery_result = deliver_password_reset_email(account.email, reset_url)
        return AccountPasswordResetRequestedPublic(
            message="If an account exists for that email, a password reset link has been sent.",
            preview_url=delivery_result.preview_url,
        )
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to start password reset",
        ) from exc


def reset_account_password(
    body: AccountPasswordResetConfirm,
    session: SessionDep,
) -> AccountPasswordResetCompletedPublic:
    try:
        now = datetime.now(timezone.utc)
        token_hash = hash_password_reset_token(body.token.strip())
        reset_token = session.exec(
            select(PasswordResetToken).where(
                PasswordResetToken.token_hash == token_hash,
                PasswordResetToken.used_at.is_(None),
            )
        ).first()

        token_expires_at = reset_token.expires_at if reset_token else None
        if token_expires_at and token_expires_at.tzinfo is None:
            token_expires_at = token_expires_at.replace(tzinfo=timezone.utc)

        if not reset_token or not token_expires_at or token_expires_at < now:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Password reset token is invalid or expired",
            )

        account = session.get(Account, reset_token.account_id)
        if not account:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Password reset token is invalid or expired",
            )

        account.password, account.password_salt = create_password_hash(body.password)
        reset_token.used_at = now
        session.add(account)
        session.add(reset_token)
        session.commit()
        return AccountPasswordResetCompletedPublic(
            message="Password reset completed successfully.",
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to reset account password",
        ) from exc


async def create_account(body: AccountBase, session: SessionDep) -> AccountPublic:
    try:
        normalized_email = normalize_email(body.email)
        existing_account = find_account_by_email(normalized_email, session)
        if existing_account:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account with this email already exists",
            )

        password_hash, password_salt = create_password_hash(body.password)
        account = Account(
            email=normalized_email,
            password=password_hash,
            password_salt=password_salt,
            role="user",
        )

        session.add(account)
        session.commit()
        session.refresh(account)
        return account
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create account",
        ) from exc


def update_account(id: int, body: AccountBase, session: SessionDep) -> AccountPublic:
    try:
        account = session.get(Account, id)
        if not account:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
        for k, v in body.model_dump().items():
            if k == "password":
                account.password, account.password_salt = create_password_hash(v)
                continue
            if k == "email":
                v = normalize_email(v)
            setattr(account, k, v)
        session.add(account)
        session.commit()
        session.refresh(account)
        return account
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update account {exc}",
        ) from exc


def patch_account(id: int, body: AccountUpdate, session: SessionDep) -> AccountPublic:
    try:
        account = session.get(Account, id)
        if not account:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
        for k, v in body.model_dump(exclude_unset=True).items():
            if k == "password":
                account.password, account.password_salt = create_password_hash(v)
                continue
            if k == "email":
                v = normalize_email(v)
            setattr(account, k, v)
        session.add(account)
        session.commit()
        session.refresh(account)
        return account
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to patch account {exc}",
        ) from exc


def delete_account(id: int, session: SessionDep) -> AccountPublic:
    try:
        account = session.get(Account, id)
        if not account:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
        session.delete(account)
        session.commit()
        return account
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete account",
        ) from exc


def deactivate_account(
    body: AccountDeactivationRequest,
    session: SessionDep,
) -> AccountDeactivatedPublic:
    try:
        account = find_account_by_email(body.email, session)
        if not account:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

        session.exec(
            delete(PasswordResetToken).where(PasswordResetToken.account_id == account.id)
        )
        session.delete(account)
        session.commit()
        return AccountDeactivatedPublic(email=account.email)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to deactivate account",
        ) from exc
