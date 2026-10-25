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
   Public restroom searches do not require an API key when gateway JWT verification is disabled; an API key is forwarded when configured. Supabase sign-in and reviews still require the public key.
   Deploy `gateway`, `places-api`, and `frontend-api`. Set `PLACES_API_URL` and `FRONTEND_API_URL` to the respective function base URLs, and the same `GATEWAY_INTERNAL_SECRET` for all three functions. Never send that internal secret from the frontend. All three use `verify_jwt = false` in the checked-in Supabase config; backend functions enforce the internal gateway headers.
   Searches default to a 5-mile radius (8,046.72 meters). The Search radius selector offers 1, 2, 5, and 10 miles and immediately reloads all place types through the gateway without requiring Search. Changing radius retains the current origin and cancels obsolete frontend requests; it does not geocode again. Places API combines stored restrooms and imported gas stations with Refuge Restrooms listings; Refuge entries are filtered to the selected radius and ordered newest first by the backend, while the UI sorts all results nearest first. No live Overpass business searches or shop/supermarket discovery remain; the `/places/overpass` route has been removed. Refuge entries are clearly identified and do not use the app's OpenStreetMap review system. Before deploying Places API, apply `supabase-edge-functions/supabase/migrations/20261022153000_search_fuel_locations.sql` to enable the server-only spatial search RPC. Fuel rows are normalized into the existing place format, including parsed OSM IDs, geometry coordinates, trimmed names and restroom-specific metadata. Cards and details mark restroom availability unconfirmed unless explicitly tagged; `toilets=no` remains visible. Business presence and opening hours do not confirm restroom access. Stored and upstream results are deduplicated by source identity. If Refuge fails, stored results remain visible with a warning about incomplete coverage; if no locations can be returned, the error remains explicit. Partial responses are not cached. Deploy both `places-api` and `gateway` to activate the provider removal.
5. Keep `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, and `SUPABASE_ANON_KEY` in the edge-function environment. Next.js does not need database credentials or a service-role key. Never put service-role keys in browser code, Git, or any `NEXT_PUBLIC_` variable.
6. Visit localhost:3000, select a real restroom, sign in with a magic link, submit a review. It will be saved as **pending**. In Supabase Table Editor, manually change `status` to `approved` after moderation. Only approved reviews are displayed.

## What is included

- OpenFreeMap display with multiple clickable location markers, restroom details, accessibility and fee tags, unverified availability
- Each result card and listing's details include **Google Maps directions** to the location's coordinates. These are external navigation links with no API key requirement, not embedded Google Maps API calls. OpenFreeMap remains the map display. Navigation does not confirm restroom access. Cards and navigation links appear after a location search returns results.
- Approved review feed with rating, review date, count (up to 50 recent reviews) and average over displayed reviews
- Email OTP authentication, server-side session validation, strict payload checks
- OSM ID/type verification against imported restroom records before accepting reviews
- One review per user/restroom; pending-by-default moderation; RLS restricts public reads
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
Review submissions still validate the Supabase user, verify the imported OSM
record, enforce one review per user/restroom, and save reviews as pending.
Auth proxy routes are allowlisted; arbitrary Supabase REST/admin access is not exposed.
These new routes require deployment of both the updated gateway and `frontend-api`;
an older gateway will return 404 rather than falling back to a direct provider call.

## Validation

With Node.js 22.18+ or 24+, run `npm test` for the HTTP adapter and gateway-only boundary tests. Run `npm run build` with the development server stopped to avoid overwriting its generated output. The tests mock HTTP boundaries; a deployed smoke check still requires your Supabase environment. Backend tests live with `frontend-api` and the gateway.

## Not yet production ready

- **Photos intentionally disabled** until EXIF removal, private upload buckets, consent and moderator approval are implemented.
- The review GET endpoint currently returns the **50 most recent approved reviews** and the average of those 50 only. Build database-side aggregates for accurate lifetime ratings before publishing rankings.
- Review submission requires an imported restroom record. Keep the database current with verified OSM locations; add anti-spam/rate limits, CAPTCHA and automated abuse detection.
- The map uses OpenFreeMap and gateway-backed Photon geocoding. Photon's [public demo](https://photon.komoot.io/) is for reasonable development traffic with no availability guarantee; heavy use may be throttled or blocked. Add shared geocoding caching/rate limiting and use a production provider or self-host at scale. Nominatim rejected requests from the edge runtime with HTTP 403, so it is not used for city searches.
- The UI has no owner/admin dashboard, public ranking, photo uploads, edit-review workflow, or automated moderation yet. Reviews are manually approved in Supabase.
- A single reviewer can submit only one review per restroom. This is a first-pass anti-duplication control, not proof of a visit.
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
