# Washroom Status USA

Next.js 15 + TypeScript + Tailwind 4 + MapLibre/OpenFreeMap + imported OpenStreetMap and Refuge Restrooms locations + Supabase Auth and moderated reviews. **No fabricated locations or ratings.** Requests the visitor's location on opening and uses it for nearby results when permitted. The contiguous United States overview and empty address field remain the fallback. Alaska and Hawaii remain searchable.

## Run locally

Result cards and details show straight-line distance in miles from the active
search origin (browser location or selected city/address/ZIP). Distances use the
Haversine formula, update with each search, and are not walking or driving routes.
On mobile, the search-radius selector sits immediately above the map; on desktop
it remains alongside the address search. Both use the same radius state.

On mobile, choosing an address suggestion or submitting a search blurs the
address input to dismiss the keyboard and immediately focuses the map/results
area, without waiting for nearby results to finish loading. Focus returns there
again when results finish loading.

Automatic location lookup and **Use my location** require HTTPS (localhost is
also allowed), enabled device Location Services, and browser/site permission.
GPS lookup allows 15 seconds; timeout or unavailability retries once with lower
accuracy for up to 15 seconds. Denied permission is not retried automatically.
The UI shows progress and actionable permission/HTTPS errors. Manual searches
take precedence over pending location callbacks. Mobile HTTP LAN URLs such as
`http://192.168.x.x:3000` cannot use browser geolocation; use an HTTPS deployment.

```bash
npm install
cp .env.example .env.local
# Add your Supabase project values to .env.local; no map API key is needed
npm run dev
```

1. Create/open your Supabase project. Run `supabase/schema.sql` in SQL Editor.
2. In Supabase Authentication, enable Email OTP/magic links. Set Site URL `http://localhost:3000` and add `http://localhost:3000/**` to allowed redirect URLs; add the deployed Vercel URL before production.
3. The map uses MapLibre with OpenFreeMap's hosted Liberty style at `https://tiles.openfreemap.org/styles/liberty`. No map account, API key, or billing configuration is required. Keep the built-in OpenFreeMap/OpenMapTiles/OpenStreetMap attribution visible. Public hosting availability depends on OpenFreeMap; review its current usage guidance before scaling.
4. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable/anon key) in `.env.local` and Vercel Environment Variables.
   Restroom searches follow `browser -> /api/restrooms -> gateway/places/bathrooms -> places-api/bathrooms`.
   The server derives the gateway URL from the Supabase project URL. Optionally set server-only `WASHROOM_GATEWAY_URL` to a different gateway base URL, such as `http://127.0.0.1:55321/functions/v1/gateway`.
   Public restroom searches and anonymous reviews do not require an API key when gateway JWT verification is disabled; an API key is forwarded when configured. Optional Supabase Auth routes still require the public key.
   Deploy `gateway`, `places-api`, and `frontend-api`. Set `PLACES_API_URL` and `FRONTEND_API_URL` to the respective function base URLs, and the same `GATEWAY_INTERNAL_SECRET` for all three functions. Never send that internal secret from the frontend. All three use `verify_jwt = false` in the checked-in Supabase config; backend functions enforce the internal gateway headers.
   Searches default to a 5-mile radius (8,046.72 meters). The Search radius selector offers 1, 2, 5, and 10 miles and immediately reloads all place types through the gateway without requiring Search. Changing radius retains the current origin and cancels obsolete frontend requests; it does not geocode again. Places API combines stored restrooms and imported gas stations with Refuge Restrooms listings; Refuge entries are filtered to the selected radius and ordered newest first by the backend, while the UI sorts all results nearest first. No live Overpass business searches or shop/supermarket discovery remain; the `/places/overpass` route has been removed. Refuge entries are clearly identified and use a separate source identity in the app's moderated review system. Before deploying Places API, apply `supabase-edge-functions/supabase/migrations/20261022153000_search_fuel_locations.sql` to enable the server-only spatial search RPC. Fuel rows are normalized into the existing place format, including parsed OSM IDs, geometry coordinates, trimmed names and restroom-specific metadata. Cards and details mark restroom availability unconfirmed unless explicitly tagged; `toilets=no` remains visible. Business presence and opening hours do not confirm restroom access. Stored and upstream results are deduplicated by source identity. If Refuge fails, stored results remain visible with a warning about incomplete coverage; if no locations can be returned, the error remains explicit. Partial responses are not cached. Deploy both `places-api` and `gateway` to activate the provider removal.
5. Keep `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, and `SUPABASE_ANON_KEY` in the edge-function environment. Next.js does not need database credentials or a service-role key. Never put service-role keys in browser code, Git, or any `NEXT_PUBLIC_` variable.
6. For an existing database, apply `../supabase-edge-functions/supabase/migrations/20261026143000_anonymous_review_questions.sql` before deploying the updated `frontend-api`. New databases use the updated `supabase/schema.sql`. Visit localhost:3000, select a real restroom and choose **Add review**. No sign-in is required. Answer availability, 1-5 cleanliness rating, and Excellent/Clean/Average/Poor/Very Dirty condition, then optionally add issues and a comment. Reviews are saved as **pending**. In Supabase Table Editor, manually change `status` to `approved` after moderation. Only approved reviews are displayed.

## What is included

- OpenFreeMap display with multiple clickable location markers, restroom details, accessibility and fee tags, unverified availability
- Hover over a map marker (or focus it with the keyboard) to preview its name, listing type, distance, accessibility, fee, hours, approved five-star average/count, and latest approved timestamped comment. Move into the scrollable preview to read or retry review errors; it remains open while hovered or focused. Escape or the close button dismisses it. From a focused marker, Arrow Down moves focus into the preview. Clicking/tapping a marker still selects its full details and also opens the preview; **View full details and reviews** selects the same location. Reviews work for every listing source, including Refuge Restrooms. Switching markers, filters, or search results removes the old preview and cancels obsolete review requests.
- Each result card and listing's details include **Google Maps directions** to the location's coordinates. These are external navigation links with no API key requirement, not embedded Google Maps API calls. OpenFreeMap remains the map display. Navigation does not confirm restroom access. Cards and navigation links appear after a location search returns results.
- Approved review feed with rating, review date, up to 50 recent reviews, and a five-star average/count over all approved ratings
- **Add review** on every result card and in the selected restroom's details opens an anonymous review modal for that location, with no listing-source exceptions. Three required radio groups collect Restroom Availability (Open/Closed/Temporarily unavailable/Unverified), Cleanliness Ratings (1-5), and Clean or Dirty Status (Excellent/Clean/Average/Poor/Very Dirty). Optional issue reports/comments and pending moderation remain. Reviews for Refuge listings are collected by this app, not submitted to Refuge Restrooms. Close with Escape, the close button, or the backdrop; keyboard focus returns to the opener.
- Below each card's **Add review** button, the latest approved non-empty comment is shown with a local date/time timestamp. `GET /api/reviews?osm_type=node&osm_id=123&latest=1` returns at most one comment, ordered newest first; pending/rejected and empty comments are excluded. Cards show loading, empty, and retryable error states explicitly.
- Cards show a five-star grade with fractional star fills, the numeric average out of 5, and the total approved review count. This uses **all approved review ratings**, including reviews without a written comment, not just the latest comment or the 50 displayed in details. Unrated restrooms show five empty stars and "Not yet rated", never a fabricated zero rating. Apply `../supabase-edge-functions/supabase/migrations/20261026150000_approved_review_summary.sql` and redeploy `frontend-api` to enable the server-only aggregate. The latest-comment response includes `average` and `review_count`.
- Anonymous review submission with strict server-side payload checks; optional gateway-backed Email OTP Auth routes remain available separately
- Source/ID verification against imported restrooms or the server-only registry of returned search listings before accepting reviews
- Pending-by-default moderation; RLS restricts public reads and prevents direct browser writes. Anonymous submissions have no account-based duplicate limit.
- USA overview on arrival, map search and filters, Codyza branding on every page

## ZIP code searches

Enter a five-digit US ZIP code in the search box to recenter the map.
Address suggestions appear after typing at least three characters (or a complete
five-digit ZIP), with a 400 ms debounce. Select a suggestion with the mouse or
Arrow Up/Down and Enter; Escape closes the list. Selection recenters the map and
loads nearby restrooms without a second geocoding request. Suggestions and their
errors use `/api/backend/geocode?suggest=1` through the gateway; no browser calls
go directly to the geocoder. The frontend-api function must be deployed for this
response format. The Search button still supports ordinary city/address/ZIP queries.
Use the **Clear** button next to **Search** to erase the field's text and return
focus to the input. Clearing does not submit a search or change the current map
and restroom results.
The search box resolves `/api/backend/geocode?zip=43085` through
`gateway/frontend/geocode` before loading restrooms separately by coordinates.
This moves the map even if the restroom database/Refuge lookup is slow or fails.
While a search resolves and restroom results load, a circular spinner is centered
over the map without blocking map controls. The nearby-results panel also displays a circular spinner
and a screen-reader status message. The spinner stops on completion; unsuccessful
requests display an error with a **Retry loading** button instead of a no-results
message. Spinner animation respects reduced-motion preferences.
ZIP resolution reuses the Places API geocoder and makes no restroom/database calls.
`GET /api/restrooms?zip=02108` forwards the ZIP through the gateway to Places API,
which uses its existing Zippopotam geocoder. The response includes
`searchOrigin: { latitude, longitude, zipCode }` and nearby `restrooms`.
ZIP codes stay strings so leading zeros are preserved. Send either `zip` or
`lat` and `lon`, not both. Invalid ZIP formats return 400; upstream failures
remain errors rather than returning fabricated coordinates.

## Gateway-only application requests

Next.js contains no database queries. All application HTTP calls use one server
transport to the configured gateway; external redirects are not followed.

| Feature | Request flow |
| --- | --- |
| Coordinates / ZIP lookup | `/api/restrooms` -> `gateway/places/bathrooms` -> `places-api` |
| Review reads / submissions | `/api/reviews` -> `gateway/frontend/reviews` -> `frontend-api` -> Supabase |
| Magic-link OTP, verification, refresh, user session, logout | Supabase SDK custom fetch -> `/api/backend/auth/v1/*` -> `gateway/frontend/auth/v1/*` -> `frontend-api` -> Supabase Auth |
| City/address search | `/api/backend/geocode` -> `gateway/frontend/geocode` -> `frontend-api` -> Photon |

MapLibre loads OpenFreeMap styles, tiles, fonts, and sprites directly in the browser
from `https://tiles.openfreemap.org`. The Content Security Policy permits that host
and MapLibre's bundled same-origin worker. All application data requests remain same-origin and go
through the gateway. External attribution links are ordinary navigation links,
not application API calls. Browser geolocation uses the browser API, not a
Next.js outbound request.

`frontend-api` rejects requests lacking the shared internal gateway headers.
Review submissions accept anonymous callers, validate all three radio answers,
verify the listing source/ID, and save reviews as pending with no user identity.
Auth proxy routes are allowlisted; arbitrary Supabase REST/admin access is not exposed.

## Reviews for every listed toilet

Apply `../supabase-edge-functions/supabase/migrations/20261026193000_all_listing_reviews.sql`
before deploying the updated `places-api`, `frontend-api`, and frontend. The existing
gateway review routes already handle all listing types; no new route is needed.
Refresh the location search after deployment so previously cached results are registered.

OpenStreetMap nodes, ways, relations, imported gas stations (including unconfirmed
restroom availability), and Refuge Restrooms listings all accept the same anonymous
questionnaire. The backend registers each returned search result in private
`review_locations` using service-role credentials. A failed registration is an explicit
search error, never a silently unreviewable listing. Browser clients cannot register
arbitrary locations. Imported restroom IDs remain reviewable without a new search.

For compatibility, API/database fields remain `osm_type` and `osm_id`;
`osm_type=refuge` denotes the separate Refuge ID namespace. An OSM node and a Refuge
listing with the same numeric ID never share reviews, averages, or counts. Existing
OSM reviews are unchanged. Cards, map previews, details, and moderation support all
four types. Only approved reviews affect public comments and grades.

## Admin-only owner responses and improvements

The footer's **Owner response admin** link opens `/admin`. Business owners do not
sign in or submit through a public form: admins receive responses offline, verify
the owner's connection to the business, then enter them on the owner's behalf.
The new admin allowlist is separate from `review_moderators`; moderator access
alone never grants access to owner verification notes or this dashboard.

Setup:

1. Apply `../supabase-edge-functions/supabase/migrations/20261026230000_owner_responses.sql`
   after the review, moderation, and all-listing migrations. This is also required
   for new databases after running `supabase/schema.sql`.
2. Create/confirm the intended existing Supabase Auth account. Explicitly grant
   admin access in SQL Editor, replacing the example email:

   ```sql
   do $$
   declare admin_id uuid;
   begin
     select id into strict admin_id from auth.users
     where lower(email) = lower('admin@example.com') and email_confirmed_at is not null;
     insert into public.owner_response_admins(user_id) values (admin_id)
     on conflict (user_id) do nothing;
   end;
   $$;
   ```

   No accounts are automatically granted admin rights. To revoke access, delete
   that user's row from `owner_response_admins`; each backend read/write checks
   the allowlist again. The save/publish SQL function checks it too.
3. Allowlist the deployed `/admin` magic-link redirect in Supabase Auth, then
   deploy `frontend-api`, `gateway`, and the frontend. Sign-in intentionally uses
   `shouldCreateUser:false`; this dashboard cannot create new Auth accounts.

Workflow:

- Search for a listing, then use its source and ID from the restroom details.
  All four source types are supported. Copy an approved review's displayed
  **Review ID** to reply specifically to it, or leave Review ID empty for a
  restroom-level improvement update. The server rejects unknown locations,
  pending/rejected reviews, and reviews belonging to a different source/listing.
- Enter a public business name and response, optional completed improvement date
  (not in the future), and an optional HTTPS evidence link. Private verification
  notes are required and never included in the public endpoint. Do not put
  personal information in public fields or link to private documents.
- Confirm offline verification, then **Save draft**. Drafts are not public.
  Review the saved draft and explicitly choose **Publish saved draft**.
  Unsaved changes must be saved first. Version checks reject stale updates and
  double publication. Failed saves preserve the editor contents.
- Published responses are read-only; add a new update for further progress.
  Public restroom details display published replies/improvements, completion
  dates, external evidence links and publication timestamps. Owner claims are
  clearly distinguished from independent inspection. Responses do not change
  community star ratings. A reply is hidden if its target review ceases to be approved.
- Dashboard and public response lists page in batches of 50. Refresh details to
  see newly published updates. Sign-out clears private dashboard state.

Transport: `/api/backend/admin/owner-responses` forwards GET/POST through
`gateway/frontend/admin/owner-responses`; `/api/backend/owner-responses` forwards
public GETs scoped by `osm_type` and `osm_id` through
`gateway/frontend/owner-responses`. Neither route exposes arbitrary database access.
Both owner tables have RLS enabled and no anon/authenticated grants; only the backend
service role can read/write them. Public reads select explicit published fields.

SQL regression checks are in `../supabase-edge-functions/supabase/tests/owner_responses.sql`.
Run them only against an isolated migrated test database, with `psql -v ON_ERROR_STOP=1`;
fixtures and writes are rolled back. API tests cover separate admin authorization,
draft/publication isolation, URL/date validation, target failures and version conflicts.
These new routes require deployment of both the updated gateway and `frontend-api`;
an older gateway will return 404 rather than falling back to a direct provider call.

## Review moderation

The footer's **Review moderation** link opens `/moderation`. Existing Supabase users
sign in with an email magic link; sign-in alone does not grant moderation access.
The server validates the session and confirmed email, then checks the explicit
`public.review_moderators` allowlist on every queue read and decision.

Local setup (not deployed automatically):

1. Apply `../supabase-edge-functions/supabase/migrations/20261026160000_review_moderation.sql`
   to your **local/test** database after the review schema and earlier review migrations.
2. Create the moderator account in Supabase Auth. Add its `/moderation` callback URL
   (for example `http://localhost:3000/moderation`) to the Auth redirect allowlist.
3. Explicitly grant access in the local/test SQL editor, substituting the intended email:

   ```sql
   insert into public.review_moderators(user_id)
   select id from auth.users where lower(email) = lower('moderator@example.com')
   on conflict (user_id) do nothing;
   ```

   Confirm one account was added. Remove access with
   `delete from public.review_moderators where user_id = '<user UUID>';`.
   Roles are never inferred from client data, email domains, or public signup.
4. Run the updated local `frontend-api` and `gateway`; configure the frontend's
   `WASHROOM_GATEWAY_URL` for that local gateway and public Supabase Auth values.

The queue shows the oldest 50 pending reviews with the restroom source identity/link,
timestamp, all questionnaire answers, optional issues and comment. Approve or
reject with an optional private note (maximum 2,000 characters). Decisions and
the acting moderator/time are saved atomically in `review_moderation_log`.
That table has RLS, no public policies, and no anon/authenticated grants; notes
are not stored in publicly readable review rows. Only the backend service role
can call the decision function. Existing moderated reviews cannot be reopened.
If two moderators act on the same review, only the first succeeds; the second
receives a conflict and must refresh. Failed decisions preserve the note.
Refresh after processing a batch to load more pending reviews.

Approval includes the review in public comment lookups and rating aggregates
on their next fetch. Rejection keeps it hidden. Already-open search cards do
not update live; refresh the search/page to retrieve the latest approved data.
Production requires explicit migration and deployment of `frontend-api`,
`gateway`, and the frontend; this flow is implemented for local testing first.

## Validation

With Node.js 22.18+ or 24+, run `npm test` for the HTTP adapter and gateway-only boundary tests. Run `npm run build` with the development server stopped to avoid overwriting its generated output. The tests mock HTTP boundaries; a deployed smoke check still requires your Supabase environment. Backend tests live with `frontend-api` and the gateway.

## Not yet production ready

- **Photos intentionally disabled** until EXIF removal, private upload buckets, consent and moderator approval are implemented.
- The review GET endpoint returns the **50 most recent approved reviews** while the average and `review_count` include all approved ratings. The latest-comment mode returns at most one non-empty comment with the same all-review grade. Public rankings remain out of scope.
- Review submission requires an imported restroom record. Keep the database current with verified OSM locations; add anti-spam/rate limits, CAPTCHA and automated abuse detection.
- The map uses OpenFreeMap and gateway-backed Photon geocoding. Photon's [public demo](https://photon.komoot.io/) is for reasonable development traffic with no availability guarantee; heavy use may be throttled or blocked. Add shared geocoding caching/rate limiting and use a production provider or self-host at scale. Nominatim rejected requests from the edge runtime with HTTP 403, so it is not used for city searches.
- The UI has no owner dashboard, public ranking, photo uploads, edit-review workflow, or automated moderation yet. The protected `/moderation` dashboard supports manual approval/rejection once its migration and moderator allowlist are configured.
- Anonymous reviews are not proof of a visit and cannot enforce one submission per person. Add server-side rate limits and abuse detection before a public launch; all submissions remain pending until manually approved.
- Add accessibility audits, integration tests, privacy/terms pages, monitoring and deployment hardening.

**Security:** Rotate any password or credential that has been shared in chat. Never reuse it as a database secret.


## Map and location reliability update

- On mobile and tablet widths below 1024px, available restroom results appear in a swipeable, scroll-snapping carousel above the map, showing the filtered result count and previous/next buttons. Select a card to open its details. The carousel resets when the search center or filter changes. The map remains above the search controls. Search and location errors appear above the map; loading and empty results remain below search controls. Completed searches return keyboard focus to the map, and mobile scrolls to the map area with any errors visible above it. Desktop retains search controls above the side-by-side map and vertical results list.

- MapLibre renders the OpenFreeMap Liberty basemap, custom bathroom/business markers, and a blue current-location point. Filters update the markers; selecting a result centers the map without changing the search origin or nearest-first result order. Errors identify the failed map, geocoding, gateway, or location API without exposing internal error details. Partial-result warnings identify Refuge Restrooms when unavailable.
- Map searches remain US-focused, but the basemap can be panned outside the US; no geographic US-only mask is applied.
- On opening the site, the app automatically requests the visitor's location. While permission or coordinates are pending, the map shows the contiguous United States and the address field is empty. A successful US location lookup centers the map at zoom 15, adds a blue current-location point, and loads nearby restrooms using the selected radius (5 miles by default). Location requires HTTPS (or localhost) and browser permission; automatic requests cannot bypass blocked permissions. Denied, unavailable, timed-out, or unsupported location displays a message and preserves the USA overview and manual search. **Use my location** retries the lookup. Changing radius or filters before choosing an origin does not fetch nearby results. A manual search takes precedence over a pending location lookup. Alaska and Hawaii remain searchable. City search is restricted to US via Photon's country filter and response validation.
- Restroom searches use Supabase records and Refuge Restrooms only, with timeouts and explicit errors. No Overpass requests or fallback data are generated. OpenFreeMap display and Photon address search are unchanged.
- Periodically refresh imported OSM records in Supabase PostGIS. Observe ODbL attribution and share-alike requirements where applicable.


## CSS import TypeScript fix
`global.d.ts` declares CSS modules for TypeScript side-effect imports. Keep `./globals.css` and `maplibre-gl/dist/maplibre-gl.css` imported from `app/layout.tsx`. Run `npm install`, `npm run build`, and then `npm run dev`. If VS Code still displays stale errors, run **TypeScript: Restart TS Server**.
