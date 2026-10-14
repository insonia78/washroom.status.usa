import unittest
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient

from controller.accounts_controller.models.models import (
    AccountDeactivatedPublic,
    AccountLoginPublic,
    AccountPasswordResetCompletedPublic,
    AccountPasswordResetRequestedPublic,
)
from database.postgres import get_session
from main import app


class AccountsRoutesE2ETests(unittest.TestCase):
    def setUp(self) -> None:
        self.session = Mock()
        self.startup_patch = patch("main.create_db_and_tables")
        self.startup_patch.start()
        app.dependency_overrides[get_session] = lambda: self.session
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self.client.close()
        app.dependency_overrides.clear()
        self.startup_patch.stop()

    def test_health_endpoint_returns_hello_world(self) -> None:
        response = self.client.get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"Hello": "World"})

    @patch("routes.accounts.get_account_access")
    def test_access_endpoint_returns_admin_access_state(self, get_account_access: Mock) -> None:
        get_account_access.return_value = AccountLoginPublic(
            email="admin@example.com",
            role="admin",
            password_setup_required=False,
        )

        response = self.client.post("/accounts/access", json={"email": "admin@example.com"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "email": "admin@example.com",
            "role": "admin",
            "password_setup_required": False,
        })
        get_account_access.assert_called_once()

    @patch("routes.accounts.request_password_reset")
    def test_password_reset_request_endpoint_returns_preview_url(
        self,
        request_password_reset: Mock,
    ) -> None:
        request_password_reset.return_value = AccountPasswordResetRequestedPublic(
            message="If an account exists for that email, a password reset link has been sent.",
            preview_url="https://mail.example.com/preview",
        )

        response = self.client.post("/accounts/reset-password", json={"email": "admin@example.com"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "accepted": True,
            "message": "If an account exists for that email, a password reset link has been sent.",
            "preview_url": "https://mail.example.com/preview",
        })
        request_password_reset.assert_called_once()

    @patch("routes.accounts.reset_account_password")
    def test_password_reset_confirm_endpoint_returns_completion_state(
        self,
        reset_account_password: Mock,
    ) -> None:
        reset_account_password.return_value = AccountPasswordResetCompletedPublic(
            message="Password reset complete.",
        )

        response = self.client.post("/accounts/reset-password/confirm", json={
            "token": "abc123abc123abc123abc123abc123ab",
            "password": "new-password-123",
        })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "reset": True,
            "message": "Password reset complete.",
        })
        reset_account_password.assert_called_once()

    @patch("routes.accounts.deactivate_account")
    def test_account_deactivation_endpoint_returns_deleted_state(
        self,
        deactivate_account: Mock,
    ) -> None:
        deactivate_account.return_value = AccountDeactivatedPublic(email="weather.user@example.com")

        response = self.client.post("/accounts/deactivate", json={"email": "weather.user@example.com"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "deleted": True,
            "email": "weather.user@example.com",
        })
        deactivate_account.assert_called_once()


if __name__ == "__main__":
    unittest.main()
