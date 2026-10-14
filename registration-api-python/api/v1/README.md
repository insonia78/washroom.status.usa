# Registration API v1

`api/v1` is a FastAPI service for account registration management in the Codyza Weather Project.

## Features

- Health check endpoint
- Create, authenticate, update, partially update, and delete accounts
- Salted and hashed password storage using PBKDF2-HMAC-SHA256
- PostgreSQL connection through SQLModel and SQLAlchemy
- Database existence check during startup
- Table creation during startup

## Requirements

- Python 3.12 or newer
- PostgreSQL
- `uv`

## Project structure

```text
api/v1/
  controller/
    accounts_controller/
      models/
        models.py
      accounts_controller.py
  database/
    postgres.py
  routes/
    accounts.py
  main.py
  pyproject.toml
```

## Configuration

The service reads its configuration from a local `.env` file.

Required environment variables:

- `POSTGRES_URL`: PostgreSQL connection string used by the application
- `POSTGRES_FILE_NAME`: Database name checked and created at startup if missing
- `POSTGRES_POOL_SIZE`: steady-state SQLAlchemy pool size, defaults to `3`
- `POSTGRES_MAX_OVERFLOW`: extra transient connections allowed above the base pool size, defaults to `1`
- `POSTGRES_POOL_TIMEOUT_SECONDS`: how long requests wait for a pooled connection, defaults to `30`
- `POSTGRES_POOL_RECYCLE_SECONDS`: maximum connection age before recycling, defaults to `1800`
- `JWT_SECRET_KEY`: Secret used to validate incoming bearer tokens
- `JWT_ALGORITHM`: JWT signing algorithm, defaults to `HS256`
- `WEATHER_GATEWAY_INTERNAL_SECRET`: shared secret used to trust requests proxied by the Supabase `weather-gateway` edge function
- `ALLOWED_INBOUND_ORIGINS`: comma-separated list of allowed frontend origins, for example `https://app.example.com,https://admin.example.com`

Example shape:

```env
POSTGRES_URL=******localhost:5432/app_database
POSTGRES_FILE_NAME=app_database
POSTGRES_POOL_SIZE=3
POSTGRES_MAX_OVERFLOW=1
POSTGRES_POOL_TIMEOUT_SECONDS=30
POSTGRES_POOL_RECYCLE_SECONDS=1800
JWT_SECRET_KEY=replace-with-a-secure-secret
JWT_ALGORITHM=HS256
WEATHER_GATEWAY_INTERNAL_SECRET=replace-with-the-shared-gateway-secret
ALLOWED_INBOUND_ORIGINS=https://app.example.com,https://admin.example.com
```

## Database pooling

The main SQLModel engine now uses an explicit SQLAlchemy connection pool with:

- `pool_pre_ping=True` so dead PostgreSQL connections are detected before use
- configurable base pool size and overflow capacity
- configurable pool wait timeout
- configurable connection recycling for longer-lived deployments

The startup-only admin connection used to check whether the database exists intentionally uses `NullPool`, so it does not keep an extra idle connection open after startup.

Recommended shared 15-connection budget:

- Python registration API: `3` base connections + `1` overflow = `4`

## Local development

From the `api/v1` folder:

1. Install dependencies:

   ```powershell
   uv sync
   ```

2. Start the development server:

   ```powershell
   uv run uvicorn main:app --reload
   ```

3. Open the API docs:

   - `http://127.0.0.1:8000/docs`
   - `http://127.0.0.1:8000/redoc`

## Startup behavior

When the application starts:

1. It loads values from `.env`
2. It connects to PostgreSQL
3. It checks whether the configured database exists
4. It creates the database if needed
5. It creates the SQLModel tables

## Authentication

Public routes:

- `/health`
- `/docs`
- `/docs/oauth2-redirect`
- `/openapi.json`
- `/redoc`

When `WEATHER_GATEWAY_INTERNAL_SECRET` is configured, account routes only accept requests forwarded by the Supabase `weather-gateway` edge function. Matching requests must send:

```http
X-Weather-Gateway-Caller: weather-gateway
X-Weather-Gateway-Secret: <shared-secret>
```

If either header is missing or invalid, the API returns `403 Forbidden`.
If `WEATHER_GATEWAY_INTERNAL_SECRET` is unset, the middleware allows requests through without enforcing gateway headers.

## Inbound traffic allowlist

When `ALLOWED_INBOUND_ORIGINS` is configured, the API checks inbound `Origin` and `Referer` headers and only accepts requests from the configured origins. Origins are normalized to `scheme://host[:port]`.

- Requests from non-browser clients that do not send `Origin` or `Referer` headers are still allowed.
- Browser preflight requests continue to work through CORS for the configured origins.
- Requests with a non-allowed origin receive `403 Forbidden`.

## Endpoints

### Health

#### `GET /health`

Returns:

```json
{
  "Hello": "World"
}
```

### Accounts

#### `POST /accounts/login`

Authenticates an existing account with email + password.

Example response body:

```json
{
  "email": "user@example.com",
  "role": "user",
  "password_setup_required": false
}
```

Example request body:

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

#### `POST /accounts/access`

Returns whether an existing account already has a password set.

Example request body:

```json
{
  "email": "admin@example.com"
}
```

Example response body:

```json
{
  "email": "admin@example.com",
  "role": "admin",
  "password_setup_required": true
}
```

#### `POST /accounts/password/setup`

Creates the first password for an existing account whose password is currently empty.

Example request body:

```json
{
  "email": "admin@example.com",
  "password": "password123"
}
```

Example response body:

```json
{
  "email": "admin@example.com",
  "role": "admin",
  "password_setup_required": false
}
```

#### `POST /accounts/reset-password`

Starts the password reset flow for a user account and sends a reset link when delivery is configured.

Example request body:

```json
{
  "email": "user@example.com"
}
```

Example response body:

```json
{
  "accepted": true,
  "message": "If an account exists for that email, a password reset link has been sent.",
  "preview_url": null
}
```

Set `PASSWORD_RESET_URL_BASE` to the public React reset-password page URL, for example:

- `https://your-react-app.example.com/reset-password`

For delivery, configure either:

- SMTP via `PASSWORD_RESET_SMTP_HOST`, `PASSWORD_RESET_SMTP_PORT`, `PASSWORD_RESET_SMTP_USERNAME`, `PASSWORD_RESET_SMTP_PASSWORD`, `PASSWORD_RESET_SMTP_FROM_EMAIL`, and optional `PASSWORD_RESET_SMTP_FROM_NAME`
- or `PASSWORD_RESET_DEBUG_LINKS_ENABLED=true` for non-production testing, which returns a `preview_url`

#### `POST /accounts/reset-password/confirm`

Completes the password reset with a valid token and a new password.

Example request body:

```json
{
  "token": "token-from-reset-link",
  "password": "newpassword123"
}
```

Example response body:

```json
{
  "reset": true,
  "message": "Password reset completed successfully."
}
```

#### `POST /accounts/`

Creates an account.

Example request body:

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

Example response body:

```json
{
  "id": 1,
  "email": "user@example.com",
  "role": "user"
}
```

If the email is already registered, the API returns `409 Conflict`.

#### `PUT /accounts/{id}`

Replaces an existing account.

Example request body:

```json
{
  "email": "updated@example.com",
  "password": "updated123"
}
```

#### `PATCH /accounts/{id}`

Partially updates an existing account.

Example request body:

```json
{
  "email": "patched@example.com"
}
```

#### `DELETE /accounts/{id}`

Deletes an account and returns the deleted record.

## Data model

The current account model includes:

- `id: int`
- `email: valid email address`
- `password: nullable string hash; first-time admin bootstrap accounts can exist without a password until they create one`
- `password_salt: stored server-side salt used to derive the password hash`
- `role: either user or admin`

## Notes

- The current implementation returns `404` when an account is not found for update, patch, or delete operations.
- Database errors are surfaced as `500` responses.
- The API currently creates tables automatically on startup.
- Request validation rejects invalid email addresses and passwords shorter than 8 characters.
- Passwords are never stored in plain text and are not returned in API responses.
