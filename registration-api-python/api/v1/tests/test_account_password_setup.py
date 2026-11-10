import unittest
from unittest.mock import Mock

from fastapi import HTTPException, status

from controller.accounts_controller.accounts_controller import create_account_password
from controller.accounts_controller.models.models import Account, AccountPasswordSetup

class AccountPasswordSetupTests(unittest.TestCase):

    def test_create_account_password_rejects_existing_password(self) -> None:
        existing_account = Account(
            id=7,
            email="admin@example.com",
            password="stored-hash",
            password_salt="stored-salt",
            role="admin",
        )
        exec_result = Mock()
        exec_result.first.return_value = existing_account

        session = Mock()
        session.exec.return_value = exec_result

        with self.assertRaises(HTTPException) as context:
            create_account_password(
                AccountPasswordSetup(email="admin@example.com", password="password123"),
                session,
            )

        self.assertEqual(context.exception.status_code, status.HTTP_409_CONFLICT)

    def test_create_account_password_persists_hash_for_bootstrap_user(self) -> None:
        existing_account = Account(
            id=7,
            email="admin@example.com",
            password=None,
            password_salt=None,
            role="admin",
        )
        exec_result = Mock()
        exec_result.first.return_value = existing_account

        session = Mock()
        session.exec.return_value = exec_result

        account = create_account_password(
            AccountPasswordSetup(email="admin@example.com", password="password123"),
            session,
        )

        self.assertEqual(account.email, "admin@example.com")
        self.assertEqual(account.role, "admin")
        self.assertFalse(account.password_setup_required)
        self.assertNotEqual(session.add.call_args.args[0].password, "password123")
        self.assertTrue(session.add.call_args.args[0].password_salt)
        session.commit.assert_called_once()
