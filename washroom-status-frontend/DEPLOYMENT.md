# Washroom Status USA — deployment checklist

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
