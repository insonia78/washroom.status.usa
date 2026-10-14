import unittest

from middleware.inbound_traffic import (
    get_request_origin_candidates,
    is_request_origin_allowed,
    parse_allowed_inbound_origins,
)
from starlette.requests import Request


def create_request(headers: dict[str, str] | None = None) -> Request:
    raw_headers = [
        (key.lower().encode("latin-1"), value.encode("latin-1"))
        for key, value in (headers or {}).items()
    ]
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/accounts",
            "headers": raw_headers,
        }
    )


class InboundTrafficTests(unittest.TestCase):
    def test_parse_allowed_inbound_origins_normalizes_and_deduplicates(self) -> None:
        self.assertEqual(
            parse_allowed_inbound_origins(
                "https://app.example.com/path, https://APP.example.com, invalid-value"
            ),
            ("https://app.example.com",),
        )

    def test_get_request_origin_candidates_uses_origin_and_referer(self) -> None:
        request = create_request(
            {
                "origin": "https://app.example.com",
                "referer": "https://admin.example.com/dashboard",
            }
        )

        self.assertEqual(
            get_request_origin_candidates(request),
            ("https://app.example.com", "https://admin.example.com"),
        )

    def test_is_request_origin_allowed_accepts_allowed_origin(self) -> None:
        request = create_request({"origin": "https://app.example.com"})

        self.assertTrue(
            is_request_origin_allowed(
                request,
                ("https://app.example.com", "https://admin.example.com"),
            )
        )

    def test_is_request_origin_allowed_rejects_disallowed_origin(self) -> None:
        request = create_request({"origin": "https://evil.example.com"})

        self.assertFalse(
            is_request_origin_allowed(
                request,
                ("https://app.example.com", "https://admin.example.com"),
            )
        )

    def test_is_request_origin_allowed_allows_requests_without_browser_headers(self) -> None:
        request = create_request()

        self.assertTrue(
            is_request_origin_allowed(
                request,
                ("https://app.example.com",),
            )
        )


if __name__ == "__main__":
    unittest.main()
