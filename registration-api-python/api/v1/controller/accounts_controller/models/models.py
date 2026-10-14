from datetime import datetime
from pydantic import EmailStr, StringConstraints
from sqlmodel import Field, SQLModel
from typing import Annotated, Literal
from uuid import UUID, uuid4


PasswordStr = Annotated[str, StringConstraints(min_length=8)]
AccountRole = Literal["user", "admin"]


class AccountBase(SQLModel):
    email: EmailStr = Field()
    password: PasswordStr = Field()


class AccountEmailLookup(SQLModel):
    email: EmailStr = Field()


class Account(SQLModel, table=True):
    __tablename__: str = "accounts"

    id: int | None = Field(default=None, primary_key=True)
    email: EmailStr = Field()
    password: str | None = Field(default=None)
    password_salt: str | None = Field(default=None)
    role: str = Field(default="user")


class AccountPublic(SQLModel):
    id: int
    email: EmailStr
    role: AccountRole


class AccountLoginPublic(SQLModel):
    email: EmailStr
    role: AccountRole
    password_setup_required: bool = False


class AccountPasswordSetup(SQLModel):
    email: EmailStr = Field()
    password: PasswordStr = Field()


class AccountUpdate(SQLModel):
    email: EmailStr | None = None
    password: PasswordStr | None = None


class PasswordResetToken(SQLModel, table=True):
    __tablename__: str = "password_reset_tokens"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    account_id: int = Field(foreign_key="accounts.id", index=True)
    token_hash: str = Field(index=True, unique=True, min_length=64, max_length=64)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    expires_at: datetime = Field()
    used_at: datetime | None = Field(default=None)


class AccountPasswordResetRequest(SQLModel):
    email: EmailStr = Field()


class AccountPasswordResetConfirm(SQLModel):
    token: str = Field(min_length=32)
    password: PasswordStr = Field()


class AccountPasswordResetRequestedPublic(SQLModel):
    accepted: bool = True
    message: str
    preview_url: str | None = None


class AccountPasswordResetCompletedPublic(SQLModel):
    reset: bool = True
    message: str


class AccountDeactivationRequest(SQLModel):
    email: EmailStr = Field()


class AccountDeactivatedPublic(SQLModel):
    deleted: bool = True
    email: EmailStr
