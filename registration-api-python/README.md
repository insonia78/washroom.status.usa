# Codyza Weather Project

This repository contains the Python registration API for the Codyza Weather Project.

At the moment, the repository is focused on the `api/v1` service, which exposes a small FastAPI application for managing accounts, checking service health, and accepting trusted inbound traffic from the Supabase `weather-gateway` edge function.

## Repository contents

```text
api/
  v1/
    controller/
    database/
    routes/
    main.py
    pyproject.toml
```

## Project in this repository

- [`api/v1`](./api/v1/README.md) - FastAPI-based registration API backed by PostgreSQL

## What the API currently provides

- Health endpoint
- Account CRUD endpoints
- Password reset request + confirmation endpoints
- Weather-gateway caller authentication for account routes
- Automatic database and table creation on startup
- Explicit SQLAlchemy connection pooling for the main PostgreSQL engine
- SQLModel-based database models

When `WEATHER_GATEWAY_INTERNAL_SECRET` is configured, the account routes only accept trusted requests forwarded by the Supabase `weather-gateway` edge function.

## Tech stack

- Python 3.12+
- FastAPI
- SQLModel
- SQLAlchemy
- PostgreSQL
- `uv` for dependency management

## Quick start

1. Go to the API project folder:

   ```powershell
   cd api\v1
   ```

2. Configure environment variables in a local `.env` file:

   - `POSTGRES_URL`
   - `POSTGRES_FILE_NAME`
   - `POSTGRES_POOL_SIZE` (optional, defaults to `3`)
   - `POSTGRES_MAX_OVERFLOW` (optional, defaults to `1`)
   - `POSTGRES_POOL_TIMEOUT_SECONDS` (optional, defaults to `30`)
   - `POSTGRES_POOL_RECYCLE_SECONDS` (optional, defaults to `1800`)
   - `JWT_SECRET_KEY`
   - `JWT_ALGORITHM` (optional, defaults to `HS256`)
   - `WEATHER_GATEWAY_INTERNAL_SECRET` (shared with the `weather-gateway` edge function)

3. Install dependencies:

   ```powershell
   uv sync
   ```

4. Start the API:

   ```powershell
   uv run uvicorn main:app --reload
   ```

5. Open the interactive API docs:

   - Swagger UI: `http://127.0.0.1:8000/docs`
   - ReDoc: `http://127.0.0.1:8000/redoc`

## API overview

### Health

- `GET /health`

### Accounts

- `POST /accounts/login`
- `POST /accounts/reset-password`
- `POST /accounts/reset-password/confirm`
- `POST /accounts/`
- `PUT /accounts/{id}`
- `PATCH /accounts/{id}`
- `DELETE /accounts/{id}`

For setup details, request and response examples, and implementation notes, see [`api/v1/README.md`](./api/v1/README.md).
