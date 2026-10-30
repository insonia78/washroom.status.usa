import unittest
from unittest.mock import Mock, patch

from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable
from sqlmodel import select

from controller.accounts_controller.models.models import Account, PasswordResetToken
from database import postgres


class AccountSchemaTests(unittest.TestCase):
    def test_account_queries_target_private_schema(self):
        for model in (Account, PasswordResetToken):
            with self.subTest(model=model.__name__):
                self.assertEqual(model.__table__.schema, "app_accounts")
                statement = str(select(model).compile(dialect=postgresql.dialect()))
                self.assertIn(f"FROM app_accounts.{model.__tablename__}", statement)

    def test_password_reset_foreign_key_targets_account_schema(self):
        foreign_key = next(iter(PasswordResetToken.__table__.c.account_id.foreign_keys))
        self.assertIs(foreign_key.column, Account.__table__.c.id)
        statement = str(CreateTable(PasswordResetToken.__table__).compile(
            dialect=postgresql.dialect(),
        ))
        self.assertIn("REFERENCES app_accounts.accounts (id)", statement)

    def test_startup_creates_schema_before_tables_and_qualifies_maintenance(self):
        connection = Mock()
        engine = Mock()
        engine.begin.return_value.__enter__ = Mock(return_value=connection)
        engine.begin.return_value.__exit__ = Mock(return_value=False)
        events = []
        connection.execute.side_effect = lambda statement: events.append(str(statement).strip())

        with (
            patch.object(postgres, "ensure_database_exists") as ensure_database,
            patch.object(postgres, "engine", engine),
            patch.object(postgres.SQLModel.metadata, "create_all",
                         side_effect=lambda _: events.append("create_all")),
        ):
            postgres.create_db_and_tables()

        ensure_database.assert_called_once_with()
        self.assertEqual(events[:2], ["CREATE SCHEMA IF NOT EXISTS app_accounts", "create_all"])
        self.assertEqual(len(events), 9)
        for statement in events[2:]:
            self.assertRegex(statement, r"app_accounts\.(accounts|password_reset_tokens)")


if __name__ == "__main__":
    unittest.main()
