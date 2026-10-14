import os
import smtplib
from email.message import EmailMessage


class PasswordResetDeliveryResult:
    def __init__(self, preview_url: str | None = None):
        self.preview_url = preview_url


def build_password_reset_url(token: str) -> str:
    base_url = (os.getenv("PASSWORD_RESET_URL_BASE") or "").strip()
    if not base_url:
        raise RuntimeError("Missing PASSWORD_RESET_URL_BASE environment variable.")

    separator = "&" if "?" in base_url else "?"
    return f"{base_url}{separator}token={token}"


def is_password_reset_debug_links_enabled() -> bool:
    raw_value = (os.getenv("PASSWORD_RESET_DEBUG_LINKS_ENABLED") or "").strip().lower()
    return raw_value in {"1", "true", "yes", "on"}


def smtp_password_reset_is_configured() -> bool:
    required_values = [
        os.getenv("PASSWORD_RESET_SMTP_HOST"),
        os.getenv("PASSWORD_RESET_SMTP_FROM_EMAIL"),
    ]
    return all(value and value.strip() for value in required_values)


def deliver_password_reset_email(recipient_email: str, reset_url: str) -> PasswordResetDeliveryResult:
    if smtp_password_reset_is_configured():
        send_password_reset_email(recipient_email, reset_url)

    if is_password_reset_debug_links_enabled():
        return PasswordResetDeliveryResult(preview_url=reset_url)

    return PasswordResetDeliveryResult()


def assert_password_reset_delivery_available() -> None:
    if smtp_password_reset_is_configured() or is_password_reset_debug_links_enabled():
        return

    raise RuntimeError(
        "Password reset delivery is not configured. Set PASSWORD_RESET_SMTP_HOST and PASSWORD_RESET_SMTP_FROM_EMAIL, "
        "or enable PASSWORD_RESET_DEBUG_LINKS_ENABLED for non-production testing.",
    )


def send_password_reset_email(recipient_email: str, reset_url: str) -> None:
    smtp_host = (os.getenv("PASSWORD_RESET_SMTP_HOST") or "").strip()
    smtp_from_email = (os.getenv("PASSWORD_RESET_SMTP_FROM_EMAIL") or "").strip()
    smtp_port = int((os.getenv("PASSWORD_RESET_SMTP_PORT") or "587").strip())
    smtp_username = (os.getenv("PASSWORD_RESET_SMTP_USERNAME") or "").strip()
    smtp_password = (os.getenv("PASSWORD_RESET_SMTP_PASSWORD") or "").strip()
    smtp_from_name = (os.getenv("PASSWORD_RESET_SMTP_FROM_NAME") or "Codyza Weather").strip()
    use_tls = (os.getenv("PASSWORD_RESET_SMTP_USE_TLS") or "true").strip().lower() not in {"0", "false", "no", "off"}

    if not smtp_host or not smtp_from_email:
        raise RuntimeError("Password reset SMTP delivery is missing PASSWORD_RESET_SMTP_HOST or PASSWORD_RESET_SMTP_FROM_EMAIL.")

    message = EmailMessage()
    message["Subject"] = "Reset your Codyza Weather password"
    message["From"] = f"{smtp_from_name} <{smtp_from_email}>"
    message["To"] = recipient_email
    message.set_content(
        "\n".join([
            "A password reset was requested for your Codyza Weather account.",
            "",
            "Open the link below to choose a new password:",
            reset_url,
            "",
            "If you did not request this change, you can ignore this email.",
        ])
    )

    with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as smtp:
        if use_tls:
            smtp.starttls()

        if smtp_username:
            smtp.login(smtp_username, smtp_password)

        smtp.send_message(message)
