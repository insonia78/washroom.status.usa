# Supabase Edge Functions

This folder contains the Washroom Status USA Supabase Edge Functions and their
configuration. Deploy from this folder so the Supabase CLI finds
`supabase/config.toml`.

## Functions

| Function | Purpose |
| --- | --- |
| `gateway` | Public API entry point. Routes place, account, review, and authentication requests to the appropriate backend. |
| `places-api` | Handles restroom searches and related place data. Requests are authorized by the gateway. |
| `frontend-api` | Handles frontend-facing account and review operations. Requests are authorized by the gateway. |
| `jwt-creator` | Creates application JWTs for gateway authentication flows. |
| `jwt-validator` | Validates application or Supabase JWTs. |
| `jwt-revoke` | Revokes application JWTs. |

The gateway and its backend functions communicate using `GATEWAY_INTERNAL_SECRET`.
Do not call the internal functions directly from the browser.

## Prerequisites

- A Supabase project and its project reference.
- The [Supabase CLI](https://supabase.com/docs/guides/cli) installed and
  authenticated with an account that can deploy functions and manage secrets.
- The project database schema required by the frontend and places APIs. See
  [the frontend Supabase setup](../washroom-status-frontend/SUPABASE_SETUP.md).

## Deploy

Run these commands in PowerShell from the repository root:

```powershell
Set-Location .\supabase-edge-functions
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Configure the function secrets described below in the Supabase Dashboard under
**Edge Functions > Secrets** (or with `supabase secrets set`), then deploy all
six functions:

```powershell
supabase functions deploy gateway
supabase functions deploy places-api
supabase functions deploy frontend-api
supabase functions deploy jwt-creator
supabase functions deploy jwt-validator
supabase functions deploy jwt-revoke
```

The checked-in [config.toml](./supabase/config.toml) disables Supabase's built-in
JWT check for `gateway`, `places-api`, and `frontend-api`. The gateway performs
its own authentication, and the backend APIs check the shared gateway secret.
Keep these checks in place; do not make internal APIs public by removing their
application-level authorization.

### Optional fuel-search migration

If you have imported the fuel data into `public.export_fuel`, apply
`supabase/migrations/20261022153000_search_fuel_locations.sql` to the linked
project after that table exists:

```powershell
supabase db push
```

This migration adds the spatial search RPC used by Places API fuel searches. It
is not a prerequisite for deploying the functions when fuel data has not been
imported. See [the fuel import instructions](./scripts/README.md).

## Function secrets and configuration

Set secrets in the Supabase project, not in frontend or Vercel environment
variables. Values such as API keys, signing secrets, database connection strings,
and `GATEWAY_INTERNAL_SECRET` must never be committed or exposed to the browser.

| Name | Used by | Notes |
| --- | --- | --- |
| `GATEWAY_INTERNAL_SECRET` | `gateway`, `places-api`, `frontend-api`, `jwt-creator`, `jwt-validator`, `jwt-revoke` | Use the same strong, unpredictable value for all functions. The gateway sends it when calling internal functions. |
| `SUPABASE_URL` | `places-api`, `frontend-api` | Supabase project URL. Supabase normally provides this to Edge Functions. |
| `SUPABASE_SERVICE_ROLE_KEY` | `places-api`, `frontend-api` | Used for server-side database access. Keep it only in the Edge Functions environment; never use a `NEXT_PUBLIC_` variable. |
| `SUPABASE_ANON_KEY` | `frontend-api` | Used to validate a user's Supabase session. Supabase normally provides this to Edge Functions. |
| `MY_JWT_SECRET` | `jwt-creator`, `jwt-validator`, `jwt-revoke` | Use the same private signing secret for creating and validating custom JWTs. `CUSTOM_JWT_SECRET` is accepted as a fallback name by validator and revoker. |
| `SUPABASE_JWT_SECRET` | `jwt-validator` | Optional signing secret for validating Supabase JWTs, if that validation path is used. |
| `PLACES_API_URL` | `gateway` | URL of the deployed `places-api`; for example, `https://YOUR_PROJECT_REF.supabase.co/functions/v1/places-api`. |
| `FRONTEND_API_URL` | `gateway` | URL of the deployed `frontend-api`; for example, `https://YOUR_PROJECT_REF.supabase.co/functions/v1/frontend-api`. |
| `JWT_CREATOR_URL` | `gateway` | URL of `jwt-creator`. |
| `JWT_VALIDATOR_URL` | `gateway` | URL of `jwt-validator`. |
| `JWT_REVOKE_URL` | `gateway` | URL of `jwt-revoke`. |

`JWT_REVOKE_URL` can be derived from the configured JWT creator or validator
URL, and `FRONTEND_API_URL` can be derived from `PLACES_API_URL`; setting all
backend URLs explicitly makes the deployment configuration easier to verify.
Other optional settings and local placeholders are listed in
[`supabase/functions/.env.example`](./supabase/functions/.env.example).
Only configure additional settings when their related service or feature is in
use.

## Verify the deployment

Use your project's function base URL:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1
```

Check that the gateway responds:

```text
GET https://YOUR_PROJECT_REF.supabase.co/functions/v1/gateway/health
```

The live REST Client examples in
[`supabase/functions/gateway.http`](./supabase/functions/gateway.http) cover
the health route and public restroom searches. To run them, install the VS Code
REST Client extension and provide `SUPABASE_ANON_KEY`, `TEST_EMAIL`, and
`TEST_PASSWORD` in a local `.env` file as described at the top of that file.
Never commit those values.

For a frontend smoke test, follow the deployment and verification steps in
[`washroom-status-frontend/DEPLOYMENT.md`](../washroom-status-frontend/DEPLOYMENT.md).
If a request fails, check the function logs in the Supabase Dashboard and verify
the project URLs, required secrets, shared gateway secret, and database schema.
