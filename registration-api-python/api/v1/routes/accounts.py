from fastapi import APIRouter, status

from controller.accounts_controller.accounts_controller import (
    create_account,
    create_account_password,
    deactivate_account,
    delete_account,
    get_account,
    get_account_access,
    patch_account,
    request_password_reset,
    reset_account_password,
    update_account,
)
from controller.accounts_controller.models.models import (
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
)
from database.postgres import SessionDep


accounts_router = APIRouter(prefix="/accounts", tags=["accounts"])


@accounts_router.post("/access", status_code=status.HTTP_200_OK, response_model=AccountLoginPublic)
def do_access(body: AccountEmailLookup, session: SessionDep) -> AccountLoginPublic:
    return get_account_access(body, session)


@accounts_router.post("/login", status_code=status.HTTP_200_OK, response_model=AccountLoginPublic)
def do_get(body: AccountBase, session: SessionDep) -> AccountLoginPublic:
    return get_account(body, session)


@accounts_router.post("/password/setup", status_code=status.HTTP_200_OK, response_model=AccountLoginPublic)
def do_create_password(body: AccountPasswordSetup, session: SessionDep) -> AccountLoginPublic:
    return create_account_password(body, session)


@accounts_router.post("/reset-password", status_code=status.HTTP_200_OK, response_model=AccountPasswordResetRequestedPublic)
def do_request_password_reset(
    body: AccountPasswordResetRequest,
    session: SessionDep,
) -> AccountPasswordResetRequestedPublic:
    return request_password_reset(body, session)


@accounts_router.post("/reset-password/confirm", status_code=status.HTTP_200_OK, response_model=AccountPasswordResetCompletedPublic)
def do_confirm_password_reset(
    body: AccountPasswordResetConfirm,
    session: SessionDep,
) -> AccountPasswordResetCompletedPublic:
    return reset_account_password(body, session)


@accounts_router.post("/deactivate", status_code=status.HTTP_200_OK, response_model=AccountDeactivatedPublic)
def do_deactivate_account(
    body: AccountDeactivationRequest,
    session: SessionDep,
) -> AccountDeactivatedPublic:
    return deactivate_account(body, session)


@accounts_router.post("/", status_code=status.HTTP_201_CREATED)
async def do_post(body: AccountBase, session: SessionDep) -> AccountPublic:
    return await create_account(body, session)


@accounts_router.put("/{id}", status_code=status.HTTP_200_OK)
def do_put(id: int, body: AccountBase, session: SessionDep) -> AccountPublic:
    return update_account(id, body, session)


@accounts_router.patch("/{id}", status_code=status.HTTP_200_OK)
def do_patch(id: int, body: AccountUpdate, session: SessionDep) -> AccountPublic:
    return patch_account(id, body, session)


@accounts_router.delete("/{id}", status_code=status.HTTP_200_OK)
def do_delete(id: int, session: SessionDep) -> AccountPublic:
    return delete_account(id, session)
