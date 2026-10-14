import hashlib
import secrets


PASSWORD_HASH_ALGORITHM = "sha256"
PASSWORD_HASH_ITERATIONS = 600_000
PASSWORD_SALT_BYTES = 16


def hash_password(password: str, password_salt: str) -> str:
    return hashlib.pbkdf2_hmac(
        PASSWORD_HASH_ALGORITHM,
        password.encode("utf-8"),
        password_salt.encode("utf-8"),
        PASSWORD_HASH_ITERATIONS,
    ).hex()


def create_password_hash(password: str) -> tuple[str, str]:
    password_salt = secrets.token_hex(PASSWORD_SALT_BYTES)
    return hash_password(password, password_salt), password_salt


def verify_password(password: str, stored_password: str | None, password_salt: str | None) -> bool:
    if not stored_password:
        return False

    if not password_salt:
        return secrets.compare_digest(stored_password, password)

    return secrets.compare_digest(hash_password(password, password_salt), stored_password)
