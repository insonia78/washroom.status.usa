from fastapi import HTTPException, status
from sqlalchemy import delete

from controller.accounts_controller.account_helpers import find_account_by_email, normalize_email
from controller.accounts_controller.models.models import (
    Account,
    AccountBase,
    AccountDeactivatedPublic,
    AccountDeactivationRequest,
    AccountPublic,
    AccountUpdate,
    PasswordResetToken,
)
from controller.accounts_controller.passwords import create_password_hash
from database.postgres import SessionDep


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
