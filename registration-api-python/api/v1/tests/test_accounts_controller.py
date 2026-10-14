import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock
from unittest.mock import patch

from fastapi import HTTPException, status

from controller.accounts_controller.accounts_controller import (
    create_account,
    create_account_password,
    deactivate_account,
    get_account_access,
    request_password_reset,
    reset_account_password,
)
from controller.accounts_controller.models.models import (
    Account,
    AccountBase,
    AccountDeactivatedPublic,
    AccountDeactivationRequest,
    AccountEmailLookup,
    AccountPasswordResetConfirm,
    AccountPasswordResetRequest,
    AccountPasswordSetup,
    PasswordResetToken,
)


class CreateAccountTests(unittest.IsolatedAsyncioTestCase):
    async def test_create_account_rejects_duplicate_email(self) -> None:
        existing_account = Account(
            id=1,
            email="user@example.com",
            password="stored-password-hash",
            password_salt="stored-password-salt",
            role="user",
        )
        exec_result = Mock()
        exec_result.first.return_value = existing_account

        session = Mock()
        session.exec.return_value = exec_result

        with self.assertRaises(HTTPException) as context:
            await create_account(
                AccountBase(email="user@example.com", password="password123"),
                session,
            )

        self.assertEqual(context.exception.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(context.exception.detail, "An account with this email already exists")
        session.add.assert_not_called()
        session.commit.assert_not_called()

    async def test_create_account_persists_new_account(self) -> None:
        exec_result = Mock()
        exec_result.first.return_value = None

        session = Mock()
        session.exec.return_value = exec_result

        def refresh_account(account: Account) -> None:
            account.id = 1

        session.refresh.side_effect = refresh_account

        account = await create_account(
            AccountBase(email="user@example.com", password="password123"),
            session,
        )

        self.assertEqual(account.id, 1)
        self.assertEqual(account.email, "user@example.com")
        self.assertEqual(account.role, "user")
        self.assertNotEqual(session.add.call_args.args[0].password, "password123")
        self.assertTrue(session.add.call_args.args[0].password_salt)
        session.commit.assert_called_once()

    async def test_create_account_normalizes_email_before_persisting(self) -> None:
        exec_result = Mock()
        exec_result.first.return_value = None

        session = Mock()
        session.exec.return_value = exec_result

        def refresh_account(account: Account) -> None:
            account.id = 2

        session.refresh.side_effect = refresh_account

        account = await create_account(
            AccountBase(email="Admin.User@Example.com", password="password123"),
            session,
        )

        self.assertEqual(account.email, "admin.user@example.com")
        self.assertEqual(session.add.call_args.args[0].email, "admin.user@example.com")

    def test_get_account_access_requires_password_setup_when_password_missing(self) -> None:
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

        account = get_account_access(
            AccountEmailLookup(email="admin@example.com"),
            session,
        )

        self.assertEqual(account.email, "admin@example.com")
        self.assertEqual(account.role, "admin")
        self.assertTrue(account.password_setup_required)

    def test_get_account_access_defaults_legacy_missing_role_to_user(self) -> None:
        existing_account = Account(
            id=8,
            email="legacy@example.com",
            password="stored-hash",
            password_salt="stored-salt",
            role="",
        )
        exec_result = Mock()
        exec_result.first.return_value = existing_account

        session = Mock()
        session.exec.return_value = exec_result

        account = get_account_access(
            AccountEmailLookup(email="legacy@example.com"),
            session,
        )

        self.assertEqual(account.role, "user")
        self.assertEqual(session.add.call_args.args[0].role, "user")
        session.commit.assert_called_once()

    def test_get_account_access_looks_up_email_case_insensitively(self) -> None:
        existing_account = Account(
            id=9,
            email="Admin.User@Example.com",
            password=None,
            password_salt=None,
            role="admin",
        )
        exec_result = Mock()
        exec_result.first.return_value = existing_account

        session = Mock()
        session.exec.return_value = exec_result

        account = get_account_access(
            AccountEmailLookup(email="admin.user@example.com"),
            session,
        )

        self.assertEqual(account.email, "Admin.User@example.com")
        executed_statement = session.exec.call_args.args[0]
        self.assertIn("lower(accounts.email)", str(executed_statement))

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


if __name__ == "__main__":
    unittest.main()
