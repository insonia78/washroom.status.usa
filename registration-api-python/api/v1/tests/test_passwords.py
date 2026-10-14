import unittest

from controller.accounts_controller.passwords import create_password_hash, verify_password


class PasswordSecurityTests(unittest.TestCase):
    def test_create_password_hash_generates_hash_and_salt(self) -> None:
        password_hash, password_salt = create_password_hash("password123")

        self.assertNotEqual(password_hash, "password123")
        self.assertTrue(password_salt)
        self.assertNotEqual(password_hash, create_password_hash("password123")[0])

    def test_verify_password_accepts_matching_salted_password(self) -> None:
        password_hash, password_salt = create_password_hash("password123")

        self.assertTrue(verify_password("password123", password_hash, password_salt))
        self.assertFalse(verify_password("wrong-password", password_hash, password_salt))

    def test_verify_password_supports_legacy_unsalted_passwords(self) -> None:
        self.assertTrue(verify_password("password123", "password123", None))
        self.assertFalse(verify_password("wrong-password", "password123", None))


if __name__ == "__main__":
    unittest.main()
