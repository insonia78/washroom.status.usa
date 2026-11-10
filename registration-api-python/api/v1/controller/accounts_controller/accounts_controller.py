from datetime import datetime, timedelta, timezone
from secrets import token_urlsafe

from fastapi import HTTPException, status
from sqlmodel import select

from controller.accounts_controller.account_access import (
    create_account_password,
    get_account,
    get_account_access,
)
from controller.accounts_controller.account_crud import (
    create_account,
    deactivate_account,
    delete_account,
    patch_account,
    update_account,
)
from controller.accounts_controller.account_helpers import (
    find_account_by_email,
    get_password_reset_ttl_minutes,
    hash_password_reset_token,
    normalize_account_role,
    normalize_email,
)
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
