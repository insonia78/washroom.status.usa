
import os
from typing import Annotated
from dotenv import load_dotenv
from fastapi import Depends
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.pool import NullPool
from sqlmodel import SQLModel, Session, create_engine

from controller.accounts_controller.models import models

load_dotenv()

postgre_file_name = os.getenv("POSTGRES_FILE_NAME")
postgre_url=f"{os.getenv('POSTGRES_URL')}"

DEFAULT_POOL_SIZE = 3
DEFAULT_MAX_OVERFLOW = 1
DEFAULT_POOL_TIMEOUT_SECONDS = 30
DEFAULT_POOL_RECYCLE_SECONDS = 1800


def _get_positive_int_env(env_var_name: str, default_value: int) -> int:
    raw_value = (os.getenv(env_var_name) or "").strip()
    if not raw_value:
        return default_value

    try:
        parsed_value = int(raw_value)
    except ValueError as exc:
        raise RuntimeError(f"{env_var_name} must be a positive integer.") from exc

    if parsed_value < 1:
        raise RuntimeError(f"{env_var_name} must be a positive integer.")

    return parsed_value


def _build_main_engine_kwargs() -> dict:
    return {
        "echo": True,
        "pool_pre_ping": True,
        "pool_size": _get_positive_int_env("POSTGRES_POOL_SIZE", DEFAULT_POOL_SIZE),
        "max_overflow": _get_positive_int_env("POSTGRES_MAX_OVERFLOW", DEFAULT_MAX_OVERFLOW),
        "pool_timeout": _get_positive_int_env("POSTGRES_POOL_TIMEOUT_SECONDS", DEFAULT_POOL_TIMEOUT_SECONDS),
        "pool_recycle": _get_positive_int_env("POSTGRES_POOL_RECYCLE_SECONDS", DEFAULT_POOL_RECYCLE_SECONDS),
    }


def _create_admin_engine():
    admin_url = make_url(postgre_url).set(database="postgres")
    return create_engine(
        admin_url,
        isolation_level="AUTOCOMMIT",
        poolclass=NullPool,
    )

engine = create_engine(
    postgre_url,
    **_build_main_engine_kwargs(),
)


def ensure_database_exists():
    admin_engine = _create_admin_engine()

    with admin_engine.connect() as connection:
        database_exists = connection.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :database_name"),
            {"database_name": postgre_file_name},
        ).scalar_one_or_none()

        if database_exists is None:
            connection.exec_driver_sql(f'DROP DATABASE IF EXISTS "{postgre_file_name}"')
            connection.exec_driver_sql(f'CREATE DATABASE "{postgre_file_name}"')

def create_db_and_tables():
    ensure_database_exists()
    SQLModel.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                ALTER TABLE accounts
                ADD COLUMN IF NOT EXISTS password_salt VARCHAR(64)
                """
            )
        )
        connection.execute(
            text(
                """
                ALTER TABLE accounts
                ADD COLUMN IF NOT EXISTS role VARCHAR(32) NOT NULL DEFAULT 'user'
                """
            )
        )
        connection.execute(
            text(
                """
                ALTER TABLE accounts
                ALTER COLUMN password DROP NOT NULL
                """
            )
        )
        connection.execute(
            text(
                """
                UPDATE accounts
                SET role = 'user'
                WHERE role IS NULL OR TRIM(role) = ''
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS idx_password_reset_tokens_token_hash
                ON password_reset_tokens (token_hash)
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_account_id_created_at
                ON password_reset_tokens (account_id, created_at DESC)
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at
                ON password_reset_tokens (expires_at)
                """
            )
        )

def get_session():
    with Session(engine) as session:
        yield session

SessionDep = Annotated[Session, Depends(get_session)]