# Washroom Status USA — deployment checklist

**Private-schema cutover:** after the legacy setup/migrations, apply
`../supabase-edge-functions/supabase/migrations/20261030230000_private_application_schemas.sql`.
It moves existing data, rather than copying/deleting it. Accounts/connections use
`app_accounts`; all location-related data use `app_locations`; managed Supabase
Auth stays in `auth`. Follow the coordinated backup, traffic pause, hosted
Data API schema configuration, backend/registration-service deployment and
verification steps in [the edge deployment guide](../supabase-edge-functions/README.md#data-preserving-private-schema-migration).
Do not rerun the historical `public.*` setup SQL below after cutover. Moderator
and administrator allowlist inserts must then target `app_locations`, not `public`.

1. Run `npm ci` and `npm run build`.
2. In Vercel, import this Next.js project. Configure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` using your existing Supabase project. Do not configure `SUPABASE_SERVICE_ROLE_KEY` in Next.js: database access now belongs to the edge backend only.
3. Do not upload `.env.local` to GitHub or the ZIP. For local testing, create your own `.env.local` from `.env.example`.
4. Deploy `frontend-api`, `places-api`, then the updated `gateway` using the checked-in Supabase config. Set `PLACES_API_URL` to `https://<project>.supabase.co/functions/v1/places-api`, `FRONTEND_API_URL` to `https://<project>.supabase.co/functions/v1/frontend-api`, and configure the same `GATEWAY_INTERNAL_SECRET` for all three functions. Backend functions need `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in their edge-function environment. Keep internal/database secrets out of Next.js. `FRONTEND_API_URL` can also be derived as a sibling of the configured Places API URL.
5. Restroom requests follow `browser -> /api/restrooms -> gateway/places/bathrooms -> places-api/bathrooms`. The gateway URL defaults to `NEXT_PUBLIC_SUPABASE_URL/functions/v1/gateway`; set server-only `WASHROOM_GATEWAY_URL` to override it. Confirm `/api/restrooms?lat=39.9526&lon=-75.1652` returns locations and that map pins, accessible/free filters and opening hours work. Searches default to five miles and combine stored restrooms/imported gas stations with Refuge Restrooms. Deploy both `places-api` and `gateway` to remove Overpass calls and the old `/places/overpass` route.
6. OpenFreeMap requires no map API key or billing setup. Verify the Liberty basemap and visible attribution load, that multiple markers and filters work, and that selecting a result recenters the map and offers Google Maps directions. Verify reviews, city searches and magic-link sign-in through `/gateway/frontend/*`. No direct-provider fallback exists. A missing deployment returns 404. Application data calls stay same-origin through the gateway; MapLibre loads map resources from `https://tiles.openfreemap.org`. The frontend CSP permits this host and the bundled same-origin map worker. Obsolete Google/HERE map environment variables can be removed from deployment settings.
7. Production launch blockers: verify tile-provider traffic terms and switch providers at scale; cache/rate-limit gateway-backed Photon searches and replace its public demo at scale; implement review rate limiting and moderation controls; add privacy/terms and operational monitoring.

Before deploying anonymous review questions, apply `../supabase-edge-functions/supabase/migrations/20261026143000_anonymous_review_questions.sql` to an existing database (or the updated `supabase/schema.sql` for a new database), then redeploy `frontend-api` and the frontend. Confirm POST reviews work without Authorization, all three radio answers persist, new rows remain pending, and only the latest approved non-empty comment and its timestamp appear below each card's Add review button. Existing review rows keep unknown availability/condition rather than fabricated answers. Availability reports describe a visit, not verified live status.

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
search coordinates or ZIP codes) and raw response bodies indefinitely. It does
not archive internal Supabase queries or store outbound authorization headers.
Archive upload errors are logged and do not fail restroom searches. Review
storage access and backup policies as the archive grows.

Run the focused edge-function tests from the repository root:

```powershell
npx deno test --allow-env --allow-net supabase-edge-functions\supabase\functions\_shared\third-party-data-lake_test.ts
```
