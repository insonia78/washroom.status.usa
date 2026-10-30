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

The JWT creator, validator, and revoker share direct PostgreSQL persistence in
`app_accounts.jwt_tokens`, explicitly qualified independently of `search_path`.
Their existing `JWT_TOKEN_DATABASE_URL` must connect to this same Supabase project
using a trusted backend database role with access to `app_accounts`. No separate
project or browser credentials are required. Token persistence responses identify
the qualified table name. These functions do not use PostgREST profile headers.

## Prerequisites

- A Supabase project and its project reference.
- The [Supabase CLI](https://supabase.com/docs/guides/cli) installed and
  authenticated with an account that can deploy functions and manage secrets.
- The project database schema required by the frontend and places APIs. See
  [the frontend Supabase setup](../washroom-status-frontend/SUPABASE_SETUP.md).

## Deploy

### Data-preserving private schema migration

This is **one PostgreSQL database**, not two databases/projects. Application
accounts/session/token data live in `app_accounts`; restrooms, imported fuel,
reviews, moderation allowlists/logs, owner responses, toilet submissions and
daily quotas live in `app_locations`. Supabase-managed identities remain in
`auth.users`. Foreign keys across schemas stay valid. Both application schemas
are accessible only to backend database roles, not `anon`/`authenticated`.
Service-role credentials can access both schemas: this is organizational and
browser-access separation, not independent database/credential isolation.
The account inventory is `accounts`, `password_reset_tokens`, and `jwt_tokens`.
The migration retains their existing table grants, ownership and RLS state,
adding schema USAGE for existing trusted direct-connection grantees/owners.
`POSTGRES_URL` and `JWT_TOKEN_DATABASE_URL` still need a backend role with the
necessary table/sequence privileges. Registration startup schema/table changes
require an owner/migration-capable role; DML-only access is not sufficient.

The additive migration
[`20261030230000_private_application_schemas.sql`](./supabase/migrations/20261030230000_private_application_schemas.sql)
moves existing relations in place, preserving rows, IDs, foreign keys, indexes,
owned sequences and trigger links, and rewrites the installed application RPCs.
It does not move Auth/PostGIS internals or drop/recreate production data. Historical
migrations remain unchanged: **do not rerun old setup SQL after this migration**.
All future application SQL must explicitly target its owning schema.

Use a staging project first. Inventory any custom tables, views or RPCs added
outside this repository; they are not automatically classified or migrated.
Missing required base tables or conflicting old/new names fail rather than merge
or discard data. Existing migrations assume the original restroom/imported-fuel
and registration tables have been set up; this is not a blank-database bootstrap.

From this directory, in PowerShell:

```powershell
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase migration list
supabase db push --dry-run
```

Back up the hosted database before applying. CLI dumps require Docker; use
Supabase backups or a trusted `pg_dump` installation if Docker is unavailable.
Store backups outside the repository; account data and tokens are sensitive.
Do not change migration history just to bypass mismatches.

There is a coordinated cutover: the old functions expect `public`, whereas the
new functions explicitly select their owning schema. Pause application traffic
and account writes (including the registration service) during migration.

1. In hosted **Project Settings > Data API > Exposed schemas**, add `app_accounts`
   and `app_locations` **after the migration creates them**, then remove `public`
   and `graphql_public` if no other application needs them. These schemas must be
   exposed to PostgREST for backend REST calls, but their schema/table/function
   privileges still deny browser roles. The checked-in `config.toml` sets the
   same exposed-schema list for local development. `db push` does not apply
   hosted API settings. Do not blindly run `config push`: the full local config
   also contains development Auth URLs and other settings.
2. With traffic paused, run:

   ```powershell
   supabase db push
   supabase migration list
   ```

   Then apply the hosted Data API setting above before enabling the updated functions.
3. Deploy all updated database consumers, including the registration API:

   ```powershell
   supabase functions deploy frontend-api
   supabase functions deploy places-api
   supabase functions deploy jwt-creator
   supabase functions deploy jwt-validator
   supabase functions deploy jwt-revoke
   supabase functions deploy gateway
   ```

   Redeploy the Python registration service and Next.js frontend using their
   existing deployment process. No new Supabase project URL or browser key is needed.
4. Verify account registration/login/token revocation, stored restroom/fuel search,
   anonymous reviews, moderator/admin allowlists, owner responses, exact-coordinate
   toilet moderation and the three-per-account UTC quota before resuming traffic.

For private SQL checks, select schema explicitly, for example
`select count(*) from app_locations.toilet_submissions;`. Moderator grants now use
`insert into app_locations.review_moderators(user_id) values ('AUTH-USER-UUID') on conflict do nothing;`.
Do not grant either application schema to browser roles to fix profile errors.

Rollback is a coordinated schema/function/application rollback or a tested
backup restore, not rerunning old migrations. Retain the backup and deployable
pre-cutover application until verification completes.

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
