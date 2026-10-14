from collections.abc import Iterable
from urllib.parse import urlparse

from fastapi import status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


def normalize_origin_url(value: str) -> str | None:
    normalized_value = value.strip()
    if not normalized_value:
        return None

    parsed_url = urlparse(normalized_value)
    if not parsed_url.scheme or not parsed_url.netloc:
        return None

    return f"{parsed_url.scheme.lower()}://{parsed_url.netloc.lower()}"


def parse_allowed_inbound_origins(raw_value: str | None) -> tuple[str, ...]:
    if not raw_value:
        return ()

    allowed_origins: list[str] = []
    for value in raw_value.replace("\n", ",").split(","):
        normalized_value = normalize_origin_url(value)
        if normalized_value and normalized_value not in allowed_origins:
            allowed_origins.append(normalized_value)

    return tuple(allowed_origins)


def get_request_origin_candidates(request: Request) -> tuple[str, ...]:
    candidates: list[str] = []
    for header_name in ("origin", "referer"):
        header_value = request.headers.get(header_name)
        normalized_value = normalize_origin_url(header_value) if header_value else None
        if normalized_value and normalized_value not in candidates:
            candidates.append(normalized_value)

    return tuple(candidates)


def is_request_origin_allowed(request: Request, allowed_origins: Iterable[str]) -> bool:
    normalized_allowed_origins = {
        normalized_value
        for origin in allowed_origins
        if (normalized_value := normalize_origin_url(origin))
    }
    if not normalized_allowed_origins:
        return True

    request_candidates = get_request_origin_candidates(request)
    if not request_candidates:
        return True

    return all(candidate in normalized_allowed_origins for candidate in request_candidates)


class InboundTrafficWhitelistMiddleware(BaseHTTPMiddleware):
    def __init__(
        self,
        app,
        *,
        public_paths: Iterable[str] | None = None,
        allowed_origins: Iterable[str] | None = None,
    ) -> None:
        super().__init__(app)
        self.public_paths = set(public_paths or [])
        self.allowed_origins = tuple(allowed_origins or ())

    async def dispatch(self, request: Request, call_next) -> Response:
        if request.method == "OPTIONS" or request.url.path in self.public_paths:
            return await call_next(request)

        if is_request_origin_allowed(request, self.allowed_origins):
            return await call_next(request)

        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={
                "detail": "Inbound traffic is blocked for this origin",
            },
        )
