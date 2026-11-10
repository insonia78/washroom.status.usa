# Supabase Edge Functions

This folder contains the Washroom Status USA Supabase Edge Functions and their
configuration. Deploy from this folder so the Supabase CLI finds
`supabase/config.toml`.

## Functions

Gateway IP quota: configure Upstash Redis before deploying the gateway and
frontend. All non-OPTIONS requests share an atomic
200-request / 60-second window per IP across edge instances.
The gateway uses `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, and the
dedicated `GATEWAY_IP_SIGNING_SECRET` (32+ random characters). Set that signing
secret in the Next.js server environment too; never share backend credentials
or use `NEXT_PUBLIC_*`. Next.js on Vercel signs a hash of the platform-provided
client IP, and the gateway rejects missing/invalid assertions with 403.
Use the Next.js adapters for all clients; unsigned direct gateway calls no
longer work. Keep `GATEWAY_INTERNAL_SECRET` backend-only and distinct.
Use the HTTPS REST URL and a read/write REST token from the Upstash console.
Store Redis credentials only in Supabase Edge Function secrets.
No PostgreSQL quota migration is required. Redis Lua `EVAL` atomically enforces
the quota and gives each counter a 60-second TTL; use a dedicated database
without eviction of active counters. Storage/configuration failures fail closed with 503.
HTTP 429 includes `Retry-After`; quota headers are exposed for clients. No request
counts or identity values are stored in localStorage or browser cookies. See
[IP quota and proxy trust requirements](../API.md#per-ip-request-limit).
Run `npx deno test --allow-env supabase\functions\gateway\ip-rate-limit_test.ts supabase\functions\gateway\ip-rate-store_test.ts`
to verify enforcement and Redis REST error handling.

Contribution authentication: `POST /frontend/reviews` and
`POST /frontend/toilet-submissions` require verified, non-anonymous Supabase
sessions. Public approved review reads and place searches do not require a user
bearer session, but all gateway calls still require the server-signed IP assertion.
Deploy the updated `frontend-api` with the frontend's email magic-link forms;
enable the Email provider, configure SMTP and allow application callback URLs
using [the frontend setup](../washroom-status-frontend/README.md#email-magic-link-sign-in-for-contributions).
Old anonymous review rows remain intact. Apply
`20261031020000_review_photos.sql` to add the private `review-photos` bucket and
review photo paths, then `20261031030000_toilet_submission_photos.sql` to add
photo paths to the private toilet moderation inbox. Both forms accept up to
three JPEG, PNG, or WebP images, each up to 5 MB. Only approved-review endpoints
and authorized moderation/admin queues return short-lived signed photo URLs.
Private admin email replies require the migration below.

## Private admin review replies

The application `/admin` panel lists review IDs and reviewer user IDs, never
reviewer email addresses. Only accounts in `app_locations.owner_response_admins`
can list these reviews, save private replies or send them. Moderator membership
alone is insufficient. The backend derives the recipient from the saved review,
resolves the verified address through the Supabase Auth admin API, and sends via
Resend. Client-supplied recipient/actor/email fields are ignored. Replies are not
public owner responses and are not returned by public review endpoints.

### Deploy and configure

After the existing private-schema migration is applied, deploy from this folder:

```powershell
supabase db push --dry-run
supabase db push
supabase secrets set RESEND_API_KEY="YOUR_RESEND_API_KEY" REVIEW_REPLY_FROM="Washroom Status USA <replies@YOUR_VERIFIED_DOMAIN>"
supabase functions deploy frontend-api
supabase functions deploy gateway
```

This applies `20261031010000_private_review_replies.sql`, creating the RLS-protected
`app_locations.review_replies` table and service-role-only admin RPC. Review IDs,
recipient user IDs, immutable reply text, author/sender IDs, timestamps, delivery
state and provider confirmation ID are stored, not recipient email addresses.
Configure a verified sending domain in Resend and use a send-capable API key.
Keep both settings in Edge Function secrets, never `NEXT_PUBLIC_*` variables.
Configure a monitored sender mailbox if users should be able to reply by email.
Deploy the updated frontend as well. Supabase Auth SMTP settings are separate;
the built-in magic-link sender cannot deliver these arbitrary reply messages.

In `/admin`, select **Open private replies**, write **Private reply**, choose
**Save private reply**, review the saved text, then **Email saved reply**. History
is paginated. Anonymous/deleted-account reviews cannot receive replies. Email
delivery uses the current verified account email; it is never returned to the
browser or included in application error logs. Database/platform administrators
and authorized Resend dashboard users can still access identities/provider logs;
this is privacy in the application admin panel, not secrecy from infrastructure operators.

`sent` means Resend accepted the email, not confirmed inbox delivery. There is no
webhook delivery/bounce tracking or automatic background resend. `failed` means
the send was rejected or recipient lookup failed; `unknown` means delivery could
not be confirmed. Refresh history after any error; a lost final database response
may leave `sending` even if Resend accepted the email. Retry the **same saved
reply**, not a new copy. Concurrent attempts are claimed atomically with a
60-second lease and the fixed reply ID is the Resend idempotency key.
Retries stop 23 hours after the first attempt, before Resend's 24-hour key expiry.
If that window expires, an infrastructure operator must check provider delivery
logs before anyone creates a replacement reply. Changing sender configuration or
the user's address between attempts can cause a provider idempotency conflict;
do not bypass it by blindly creating another reply.

Tests: `npx deno test --allow-env --allow-net supabase\functions\frontend-api`
and `supabase\tests\review_replies.sql` against an isolated migrated test database.

| Function | Purpose |
| --- | --- |
| `gateway` | Public API entry point. Routes place, review, application dashboard and Supabase authentication requests, plus legacy JWT logout. |
| `places-api` | Handles restroom searches and related place data. Requests are authorized by the gateway. |
| `frontend-api` | Handles Supabase Auth proxying, reviews, contributions and dashboard operations. Requests are authorized by the gateway. |
| `jwt-creator` | Creates application JWTs for gateway authentication flows. |
| `jwt-validator` | Validates application or Supabase JWTs. |
| `jwt-revoke` | Revokes application JWTs. |

The gateway and its backend functions communicate using `GATEWAY_INTERNAL_SECRET`.
Do not call the internal functions directly from the browser.

### Retired registration API

The gateway no longer calls the Python registration service. `/accounts/*`,
`/accounts`, `/admin/access`, `/admin/login`, `/admin/create-password` and its
`/health` proxy are removed. A trusted signed-IP request to these paths returns
404; unsigned direct requests still return 403 at the IP boundary.
Deploy the updated gateway, then remove `WASHROOM_REGISTRATION_API_URL` and any
unused legacy `TURNSTILE_SECRET_KEY`/`TURNSTILE_VERIFY_URL` settings. They are no
longer read. There is no password-login replacement at these paths: current
contribution, admin, moderator and owner sign-in uses Supabase Auth.

Current `/frontend/*` routes, `/places/bathrooms` and legacy `/auth/logout`
remain supported. JWT functions and historical account/token database records
are unchanged; do not drop those tables as part of this routing cleanup.
The [monthly Python ETL](../registration-api-python/etl/README.md) is independent
and remains supported.

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
and database writes (including scheduled ETL) during migration. Ensure any older
registration service still deployed is stopped before the historical cutover.

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
3. Deploy all updated database consumers:

   ```powershell
   supabase functions deploy frontend-api
   supabase functions deploy places-api
   supabase functions deploy jwt-creator
   supabase functions deploy jwt-validator
   supabase functions deploy jwt-revoke
   supabase functions deploy gateway
   ```

   Redeploy the Next.js frontend using its existing deployment process. The
   retired registration service is not required. No new Supabase project URL
   or browser key is needed.
4. Verify Supabase magic-link sign-in and, if used, legacy token revocation, stored restroom/business
   search, public approved review reads, verified-account submissions,
   moderator/admin allowlists, owner responses and exact-coordinate toilet
   moderation before resuming traffic. Confirm both three-per-account UTC
   submission caps and the signed-IP gateway quota.

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

### Supermarket searches

Apply the supermarkets, schema-move, and supermarket-search migrations in
order before deploying `places-api`. The private `app_locations.supermarkets`
table is queried through the service-role-only `find_nearby_supermarkets`
PostGIS RPC, which uses a geography index and paginates results. Existing rows,
indexes, and the identity sequence are preserved when the table moves from
`public`. The API merges supermarkets with the existing sources by OSM identity;
stored restrooms and fuel take precedence. A supermarket listing does not
confirm restroom availability or accessibility.

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
| `JWT_CREATOR_URL` | `gateway` | Legacy base for deriving sibling function URLs; no account routes call the creator after retirement. Prefer explicit backend URLs. |
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

Use the deployed Next.js adapter to verify the complete signed-IP gateway path:

```text
GET https://YOUR_APP/api/restrooms?lat=39.9526&lon=-75.1652
```

The live REST Client examples in
[`supabase/functions/gateway.http`](./supabase/functions/gateway.http) cover
public adapter searches, unsigned gateway denial and preflight handling.
Install the VS Code REST Client extension and set the example application and
project URLs. No test-account credentials are required. The former Python-backed
gateway `/health` route is retired, not a readiness probe.

For a frontend smoke test, follow the deployment and verification steps in
[`washroom-status-frontend/DEPLOYMENT.md`](../washroom-status-frontend/DEPLOYMENT.md).
If a request fails, check the function logs in the Supabase Dashboard and verify
the project URLs, required secrets, shared gateway secret, and database schema.
