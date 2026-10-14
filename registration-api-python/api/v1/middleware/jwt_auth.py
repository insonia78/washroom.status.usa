import os
from collections.abc import Iterable

import jwt
from dotenv import load_dotenv
from fastapi import status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

load_dotenv()


class JWTAuthMiddleware(BaseHTTPMiddleware):
    def __init__(
        self,
        app,
        *,
        public_paths: Iterable[str] | None = None,
        algorithm: str | None = None,
    ) -> None:
        super().__init__(app)
        self.public_paths = set(public_paths or [])
        self.algorithm = algorithm or os.getenv("JWT_ALGORITHM", "HS256")

    async def dispatch(self, request: Request, call_next) -> Response:
        if request.method == "OPTIONS" or request.url.path in self.public_paths:
            return await call_next(request)

       
        # try:
        #     # payload = 
        # except jwt.ExpiredSignatureError:
        #     return self._unauthorized_response("JWT token has expired")
        # except jwt.InvalidTokenError:
        #     return self._unauthorized_response("Invalid JWT token")

        # request.state.jwt_payload = payload
        # request.state.jwt_token = token
        # return await call_next(request)

    @staticmethod
    def _unauthorized_response(detail: str) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"detail": detail},
            headers={"WWW-Authenticate": "Bearer"},
        )
