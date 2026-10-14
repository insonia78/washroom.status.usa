import os

from fastapi import FastAPI, status
from fastapi.middleware.cors import CORSMiddleware
from database.postgres import create_db_and_tables
from middleware.inbound_traffic import (
    InboundTrafficWhitelistMiddleware,
    parse_allowed_inbound_origins,
)
from middleware.weather_gateway_auth import WeatherGatewayAuthMiddleware
from routes.accounts import accounts_router


app = FastAPI()
allowed_inbound_origins = parse_allowed_inbound_origins(
    os.getenv("ALLOWED_INBOUND_ORIGINS")
)

if allowed_inbound_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(allowed_inbound_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.add_middleware(
    InboundTrafficWhitelistMiddleware,
    public_paths={"/health", "/docs", "/docs/oauth2-redirect", "/openapi.json", "/redoc"},
    allowed_origins=allowed_inbound_origins,
)

# app.add_middleware(
#     WeatherGatewayAuthMiddleware,
#     public_paths={"/health", "/docs", "/docs/oauth2-redirect", "/openapi.json", "/redoc"},
#     protected_path_prefixes={"https://ywdslwhykwgegkdnhvvi.supabase.co/functions/v1/weather-gateway/*"},
# )

app.include_router(accounts_router)


@app.on_event("startup")
def on_startup():
    # Ensure DB and tables exist before accepting requests
    create_db_and_tables()

@app.get("/health",status_code=status.HTTP_200_OK,tags=["health"])
def read_root():
    return {"Hello": "World"}
