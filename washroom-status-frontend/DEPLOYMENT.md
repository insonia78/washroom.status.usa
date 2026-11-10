# Washroom Status USA — deployment checklist

**IP rate limiting:** set a dedicated random `GATEWAY_IP_SIGNING_SECRET`
(at least 32 characters) in both the Vercel server environment and the gateway's
Edge Function secrets. Do not reuse `GATEWAY_INTERNAL_SECRET` or prefix it with
`NEXT_PUBLIC_`. Configure gateway-only `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN`, then deploy Next.js and the gateway together.
Next.js reads Vercel's overwritten `x-vercel-forwarded-for`, signs a hash of the
IP, and forwards it to the gateway. All browsers behind one IP share 200 requests
per 60 seconds; clearing cookies does not reset quota. Direct unsigned gateway
requests return 403; clients must use the Next.js adapters. Production outside
Vercel fails closed until a trusted proxy integration is implemented.
Non-production loopback requests share `127.0.0.1`; set the signing secret locally
too. See [the complete quota contract](../API.md#per-ip-request-limit).

**Private-schema cutover:** after the legacy setup/migrations, apply
`../supabase-edge-functions/supabase/migrations/20261030230000_private_application_schemas.sql`.
It moves existing data, rather than copying/deleting it. Accounts/connections use
`app_accounts`; all location-related data use `app_locations`; managed Supabase
Auth stays in `auth`. Follow the coordinated backup, traffic pause, hosted
Data API schema configuration, backend deployment and
verification steps in [the edge deployment guide](../supabase-edge-functions/README.md#data-preserving-private-schema-migration).
Do not rerun the historical `public.*` setup SQL below after cutover. Moderator
and administrator allowlist inserts must then target `app_locations`, not `public`.

1. Run `npm ci` and `npm run build`.
2. In Vercel, import this Next.js project. Configure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` using your existing Supabase project. Do not configure `SUPABASE_SERVICE_ROLE_KEY` in Next.js: database access now belongs to the edge backend only.
3. Do not upload `.env.local` to GitHub or the ZIP. For local testing, create your own `.env.local` from `.env.example`.
4. Deploy `frontend-api`, `places-api`, then the updated `gateway` using the checked-in Supabase config. Set `PLACES_API_URL` to `https://<project>.supabase.co/functions/v1/places-api`, `FRONTEND_API_URL` to `https://<project>.supabase.co/functions/v1/frontend-api`, and configure the same `GATEWAY_INTERNAL_SECRET` for all three functions. Backend functions need `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in their edge-function environment. Keep internal/database secrets out of Next.js. `FRONTEND_API_URL` can also be derived as a sibling of the configured Places API URL.
5. Restroom requests follow `browser -> /api/restrooms -> gateway/places/bathrooms -> places-api/bathrooms`. The gateway URL defaults to `NEXT_PUBLIC_SUPABASE_URL/functions/v1/gateway`; set server-only `WASHROOM_GATEWAY_URL` to override it. Confirm `/api/restrooms?lat=39.9526&lon=-75.1652` returns locations and that map pins, accessible/free filters and opening hours work. Searches default to five miles and combine stored restrooms, imported gas stations and supermarkets with live Refuge Restrooms. Imported Refuge copies preserve their provider identity and are deduplicated against live results. The `/places/overpass` route is removed; there is no live Overpass fallback.
6. OpenFreeMap requires no map API key or billing setup. Verify the Liberty basemap and visible attribution load, that multiple markers and filters work, and that selecting a result recenters the map and offers Google Maps directions. Verify reviews, city searches and magic-link sign-in through `/gateway/frontend/*`. No direct-provider fallback exists. A missing deployment returns 404. Application data calls stay same-origin through the gateway; MapLibre loads map resources from `https://tiles.openfreemap.org`. The frontend CSP permits this host and the bundled same-origin map worker. Obsolete Google/HERE map environment variables can be removed from deployment settings.
7. Production readiness: verify tile-provider traffic terms and replace public demo geocoding at scale; consider shared geocoding caching; configure privacy/terms, retention, monitoring and recovery procedures. Gateway IP quotas, account daily submission caps and moderation controls are implemented, but require their secrets, migrations and allowlists. Verify them in the target environment rather than treating source code or CI success as proof of deployment.

## Review authentication and historical migrations

The migration `20261026143000_anonymous_review_questions.sql` is a historical
schema prerequisite; its filename does not describe current authentication.
Apply outstanding migrations in order, not this migration alone as a complete
new-database setup. Do not rerun public-schema bootstrap SQL after cutover.

POST reviews and toilet submissions require a verified, non-anonymous Supabase
bearer session. Confirm valid submissions persist all questionnaire answers and
remain pending; otherwise-valid unsigned submissions return 401 and anonymous
or unverified sessions return 403. Test duplicate account/listing reviews (409)
and both daily caps (429). Enable Email, configure SMTP and exact callback URLs
using [the sign-in setup](./README.md#email-magic-link-sign-in-for-contributions).
Searches and approved review reads remain public through the signed-IP adapters.

Cards display the newest approved review, including its timestamp and a
"No written comment." fallback when empty; pending/rejected reviews are excluded.
Existing rows retain unknown availability/condition rather than fabricated
answers. Availability reports describe a visit, not verified live status.

For five-star card grades, also apply `../supabase-edge-functions/supabase/migrations/20261026150000_approved_review_summary.sql` before redeploying `frontend-api`. Its service-role-only aggregate counts all approved ratings for the selected restroom; pending/rejected reviews do not affect the score. Confirm fractional averages, total counts, unrated states, and that latest-comment timestamps remain visible.

For reviews on **every** listed toilet, apply
`../supabase-edge-functions/supabase/migrations/20261026193000_all_listing_reviews.sql`
before deploying the updated `places-api`, `frontend-api`, and frontend. It extends
the review source constraint to `refuge` and creates a private `review_locations`
registry. Places API registers all returned listings, including imported fuel and
Refuge results, before returning a successful search. Refresh any pre-deployment
search results. Existing gateway routes do not change. Verify submissions for OSM
nodes/ways/relations, gas stations, and Refuge listings; all must remain pending.
Approve test reviews and confirm cards, map previews, details, and moderation keep
identical numeric IDs from different sources separate.

Moderation is local/test-first and is **not automatically deployed**. When approved
for production, apply `../supabase-edge-functions/supabase/migrations/20261026160000_review_moderation.sql`,
explicitly add intended existing Auth users to `review_moderators`, allowlist the
`/moderation` magic-link redirect, then deploy `frontend-api`, `gateway`, and the
frontend. Validate unauthenticated requests return 401, signed-in non-moderators
return 403, and approval/rejection records private audit notes without exposing
them through public review reads. Keep RLS enabled on both moderation tables.

This package contains source code only. It does not include any credentials or imported database records.

## Owner response administration

This feature is **not automatically deployed**. Apply
`../supabase-edge-functions/supabase/migrations/20261026230000_owner_responses.sql`
after the previous review/all-listing migrations, then deploy `frontend-api`,
`gateway`, and the frontend. Add `/admin` to Supabase Auth's allowed magic-link
redirects. Explicitly add only intended existing, email-confirmed Auth users to
`owner_response_admins` using the setup SQL in [README.md](./README.md).
The moderator allowlist does not grant admin access.

Verify unauthenticated admin GET/POST requests return 401 and moderator-only users
return 403. Confirm an admin can save an owner-verified draft, edit it and explicitly
publish it. Drafts, verification notes and actor IDs must never appear in the public
response feed. Check invalid/mismatched review targets, future completion dates,
non-HTTPS evidence links and stale versions fail explicitly. Confirm published
responses appear in restroom details for all source types, without affecting review
grades, and private dashboard state disappears after sign-out.

To let invited owners submit review photos, apply
`../supabase-edge-functions/supabase/migrations/20261031140000_owner_review_photos.sql`
after the owner-replies and private-schema migrations, then deploy `frontend-api`,
`gateway`, and the frontend. Photos are stored privately and remain pending until
an administrator selects **Add to review** in Step 2 of the admin review panel.
An approved review can contain at most three photos total; owner-submitted photos
are labeled separately from reviewer photos when displayed publicly.
Verify owner uploads are private before approval, only the invited verified account
can upload, non-admins cannot add photos, and an admin cannot exceed the review photo
limit. Run the API test from the repository root:

```powershell
npx deno test --allow-env --allow-net supabase-edge-functions\supabase\functions\frontend-api\owner-review-photos_test.ts
```

Run the database test against an isolated local database with the required
migrations already applied, from `supabase-edge-functions`:

```powershell
supabase test db supabase\tests\owner_review_photos.sql --local
```

To show invited business owners a read-only map for each complaint, apply
`../supabase-edge-functions/supabase/migrations/20261103220000_review_location_coordinates.sql`,
then deploy `places-api`, `frontend-api`, and the frontend. The migration backfills
stored OpenStreetMap restrooms; a Refuge listing's coordinates are filled when its
location is included in a successful places search after deployment. Refresh the
restroom search for older Refuge invitations before opening the owner dashboard.
Map interaction remains disabled.

To let owners archive completed responses and attach up to three photos to a reply,
apply `../supabase-edge-functions/supabase/migrations/20261103230000_owner_reply_owner_archive.sql`
and `../supabase-edge-functions/supabase/migrations/20261104010000_owner_reply_photos.sql`,
then deploy `frontend-api` and the frontend. Reply photos remain private through
moderation and administrator review; the moderator and administrator queues display
the attached photos and their review status. Photos appear publicly only with a
published owner response. Pending replies cannot be archived.

Owners now attach photos only through the reply form (one uploader, up to three
photos). The separate review-photo uploader was removed from the owner dashboard;
previously submitted owner review photos remain visible read-only and can still be
added by an administrator. Private reply emails attach up to three owner photos:
photos from owner replies that a moderator approved or an administrator published
(archived replies included; published first, newest first), then administrator-added
owner review photos. Owners' improvement photos are therefore emailed as soon as the
moderator approves the reply, without waiting for admin publication. Admin review cards show reviewer photos, owner reply photos (all
statuses), owner-submitted photos, and a read-only **Review steps taken** timeline
(submission, moderator decisions, owner invites and replies, private reply emails,
archiving). Admin toilet cards show a **Toilet steps taken** timeline (submission,
moderator decision, final approval, archiving). No migration is required; deploy
`frontend-api` and the frontend, then run:

```powershell
npx deno test --allow-env --allow-net supabase-edge-functions\supabase\functions\frontend-api\workflow-history_test.ts supabase-edge-functions\supabase\functions\frontend-api\owner-reviews_test.ts
```

The **Reviews & submitted toilets** tab opens on a **Board** view (switch to **List**
for the paginated cards). The board places every review and submitted toilet as a
ticket in a horizontal column for its current step: reviews move through Moderation,
Administration review, Waiting for owner, Owner reply in review, Completed and
Archived; toilets through Moderation, Final approval, Published on map, Rejected and
Archived. Selecting a ticket opens a modal with its details, photos, steps taken and
actions. The board loads the newest 25 active and 25 archived items of each kind
(`limit=25&moderation=all` on the admin review and toilet endpoints; the server
computes each item's `stage`). The administration and moderation tab ribbons both
have a **Refresh** button that reloads the open section and the notification bell.

The admin review panel's **All history** filter combines active and archived
approved/rejected reviews; Step 1 remains the moderator-pending queue. The admin
toilets panel provides the separate final-approval and map-publication step for
moderator-approved toilet submissions.

## Daily submission caps

Apply `../supabase-edge-functions/supabase/migrations/20261105020000_daily_submission_caps.sql`,
then deploy `frontend-api` and the frontend. Each signed-in account can add at most
3 toilets and submit at most 3 reviews per UTC day (resets at midnight UTC). The
database enforces both caps with never-refunded counters, so rejected or deleted
submissions still count. A blocked submission returns HTTP 429 with a clear message.
Verify with `supabase test db supabase\tests\review_submission_quota.sql --local`
from `supabase-edge-functions` on a database with all migrations applied.

## Third-party restroom search archive

Apply
`../supabase-edge-functions/supabase/migrations/20261105010000_third_party_api_data_lake.sql`
and deploy the updated `places-api` before enabling the archive. Successful and
failed calls to Refuge Restrooms and Zippopotam.us are written as individual JSON
objects under the private `third-party-api-data-lake` bucket, partitioned by
provider and UTC date. The archive retains full request URLs (including exact
search coordinates or ZIP codes) and raw response bodies. There is no general
automatic retention policy: objects remain until explicitly removed or cleaned
by the configured Refuge ETL. It does
not archive internal Supabase queries or store outbound authorization headers.
Archive upload errors are logged and do not fail restroom searches. Review
storage access and backup policies as the archive grows. The monthly
[Python ETL](../registration-api-python/etl/README.md) imports Refuge records and
deletes only successfully committed Refuge archive files; ZIP archives and failed
files remain. Apply its migration and configure its dedicated workflow secrets.
The checked-in workflow schedules a real import on day 1 at 03:00 UTC; only
manual dispatch defaults to dry-run. See the ETL setup before enabling Actions.

Run the focused edge-function tests from the repository root:

```powershell
npx deno test --allow-env --allow-net supabase-edge-functions\supabase\functions\_shared\third-party-data-lake_test.ts
```

## CI and vertical E2E

The [CI workflow](../.github/workflows/ci.yml) runs frontend typechecking, the
repository-wide 200-line source cap, Node tests, a production build, all Deno
tests, and Python ETL tests against a dedicated PostgreSQL database. Its final
job waits for all three check jobs and runs Chromium journeys
through the production Next.js server, gateway and actual edge handlers to a
fresh local Supabase stack (PostgreSQL/PostGIS, Auth, REST and Storage) and Redis.
No hosted project credentials or production secrets are needed.

The three [E2E specs](./e2e/specs) cover geolocation/search with registry and
private archive persistence; verified sign-in, browser review submission and
moderation; and 400 concurrent requests with exactly 200 permitted, cookie/header
spoofing resistance, independent IPs, real 60-second expiry and direct-call denial.
Only external search providers and map resources are substituted. The local
HTTPS Upstash protocol bridge executes the production Lua against real Redis.
The test ingress replaces Vercel's trusted header boundary, not the gateway.

Local prerequisites: Node 24, Deno, Supabase CLI, a running Docker daemon,
OpenSSL, and an **empty dedicated** Redis database on loopback. Reserve ports
55320-55322, 56300-56303 and 56443. In this directory:

```powershell
npm ci
npx playwright install chromium
$env:E2E_REDIS_URL = 'redis://127.0.0.1:56379/15'
npm run test:ci
```

Set `OPENSSL_BIN` if OpenSSL is not on PATH. The runner creates a uniquely named
temporary Supabase project, applies the historical prerequisite tables followed
by the checked-in schema and **all** real migrations, seeds one restroom, and
cleans up its own services on exit. Existing runtime directories or non-empty
Redis databases fail explicitly rather than being overwritten.

Failure screenshots, videos and the HTML report are uploaded for seven days.
Traces are disabled because authenticated network traces can contain tokens.
Never upload `e2e/.runtime` (ephemeral credentials/certificates), local environment
files or database dumps. A stopped Docker daemon is a startup failure, not a
skipped/passing E2E result. Real Vercel ingress, hosted Upstash connectivity,
third-party provider availability, map rendering and the separate Python service
are outside these browser journeys; Python is tested in its own CI job.
