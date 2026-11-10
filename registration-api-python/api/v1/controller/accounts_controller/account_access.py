from fastapi import HTTPException, status

from controller.accounts_controller.account_helpers import find_account_by_email, normalize_account_role
from controller.accounts_controller.models.models import (
    Account,
    AccountBase,
    AccountEmailLookup,
    AccountLoginPublic,
    AccountPasswordSetup,
)
from controller.accounts_controller.passwords import create_password_hash, verify_password
from database.postgres import SessionDep


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
