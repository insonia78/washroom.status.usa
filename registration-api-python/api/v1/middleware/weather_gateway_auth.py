import os
from collections.abc import Iterable

from fastapi import status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

WEATHER_GATEWAY_CALLER_HEADER = "x-weather-gateway-caller"
WEATHER_GATEWAY_SECRET_HEADER = "x-weather-gateway-secret"
WEATHER_GATEWAY_CALLER_VALUE = "weather-gateway"


class WeatherGatewayAuthMiddleware(BaseHTTPMiddleware):
    def __init__(
        self,
        app,
        *,
        public_paths: Iterable[str] | None = None,
        protected_path_prefixes: Iterable[str] | None = None,
    ) -> None:
        super().__init__(app)
        self.public_paths = set(public_paths or [])
        self.protected_path_prefixes = tuple(protected_path_prefixes or ())
        self.internal_secret = os.getenv("WEATHER_GATEWAY_INTERNAL_SECRET")

    async def dispatch(self, request: Request, call_next) -> Response:
        if request.method == "OPTIONS" or request.url.path in self.public_paths:
            return await call_next(request)

        if not self._is_protected_path(request.url.path) or not self.internal_secret:
            return await call_next(request)

        if request.headers.get(WEATHER_GATEWAY_CALLER_HEADER) != WEATHER_GATEWAY_CALLER_VALUE:
            return self._forbidden_response("Only weather-gateway may call this endpoint")

        if request.headers.get(WEATHER_GATEWAY_SECRET_HEADER) != self.internal_secret:
            return self._forbidden_response("Invalid weather-gateway authorization")

        return await call_next(request)

    def _is_protected_path(self, path: str) -> bool:
        return any(path.startswith(prefix) for prefix in self.protected_path_prefixes)

    @staticmethod
    def _forbidden_response(detail: str) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={"detail": detail},
        )
