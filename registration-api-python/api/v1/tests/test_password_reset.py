import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch

from controller.accounts_controller.accounts_controller import request_password_reset, reset_account_password
from controller.accounts_controller.models.models import (
    Account,
    AccountPasswordResetConfirm,
    AccountPasswordResetRequest,
    PasswordResetToken,
)

class PasswordResetTests(unittest.TestCase):

    @patch("controller.accounts_controller.accounts_controller.deliver_password_reset_email")
    @patch("controller.accounts_controller.accounts_controller.build_password_reset_url")
    @patch("controller.accounts_controller.accounts_controller.assert_password_reset_delivery_available")
    def test_request_password_reset_creates_token_for_existing_user(
        self,
        assert_delivery_available: Mock,
        build_reset_url: Mock,
        deliver_password_reset_email: Mock,
    ) -> None:
        existing_account = Account(
            id=11,
            email="user@example.com",
            password="stored-password-hash",
            password_salt="stored-salt",
            role="user",
        )
        first_exec_result = Mock()
        first_exec_result.first.return_value = existing_account
        second_exec_result = Mock()
        second_exec_result.all.return_value = []

        session = Mock()
        session.exec.side_effect = [first_exec_result, second_exec_result]
        build_reset_url.return_value = "https://example.com/reset-password?token=test-token"
        deliver_password_reset_email.return_value = Mock(preview_url=None)

        response = request_password_reset(
            AccountPasswordResetRequest(email="user@example.com"),
            session,
        )

        self.assertTrue(response.accepted)
        self.assertIn("password reset link has been sent", response.message.lower())
        reset_token_record = session.add.call_args_list[-1].args[0]
        self.assertIsInstance(reset_token_record, PasswordResetToken)
        self.assertEqual(reset_token_record.account_id, 11)
        session.commit.assert_called_once()
        assert_delivery_available.assert_called_once()
        build_reset_url.assert_called_once()
        deliver_password_reset_email.assert_called_once_with(
            "user@example.com",
            "https://example.com/reset-password?token=test-token",
        )

    def test_reset_account_password_updates_password_and_marks_token_used(self) -> None:
        existing_account = Account(
            id=12,
            email="user@example.com",
            password="stored-password-hash",
            password_salt="stored-salt",
            role="user",
        )
        reset_token = PasswordResetToken(
            account_id=12,
            token_hash="matched-token-hash",
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
        )
        exec_result = Mock()
        exec_result.first.return_value = reset_token

        session = Mock()
        session.exec.return_value = exec_result
        session.get.return_value = existing_account

        with patch("controller.accounts_controller.accounts_controller.hash_password_reset_token", return_value="matched-token-hash"):
            response = reset_account_password(
                AccountPasswordResetConfirm(token="a" * 32, password="password456"),
                session,
            )

        self.assertTrue(response.reset)
        self.assertNotEqual(existing_account.password, "stored-password-hash")
        self.assertTrue(existing_account.password_salt)
        self.assertIsNotNone(reset_token.used_at)
        session.commit.assert_called_once()
