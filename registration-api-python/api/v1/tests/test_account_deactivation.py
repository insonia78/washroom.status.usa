import unittest
from unittest.mock import Mock

from controller.accounts_controller.accounts_controller import deactivate_account
from controller.accounts_controller.models.models import (
    Account,
    AccountDeactivatedPublic,
    AccountDeactivationRequest,
)

class AccountDeactivationTests(unittest.TestCase):

    def test_deactivate_account_deletes_password_resets_and_account(self) -> None:
        existing_account = Account(
            id=13,
            email="user@example.com",
            password="stored-password-hash",
            password_salt="stored-salt",
            role="user",
        )
        exec_result = Mock()
        exec_result.first.return_value = existing_account

        session = Mock()
        session.exec.side_effect = [exec_result, Mock()]

        response = deactivate_account(
            AccountDeactivationRequest(email="user@example.com"),
            session,
        )

        self.assertIsInstance(response, AccountDeactivatedPublic)
        self.assertTrue(response.deleted)
        self.assertEqual(response.email, "user@example.com")
        self.assertEqual(session.exec.call_count, 2)
        session.delete.assert_called_once_with(existing_account)
        session.commit.assert_called_once()
