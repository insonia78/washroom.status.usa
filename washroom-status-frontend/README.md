# Washroom Status USA — Philadelphia launch (phase 2)

Next.js 15 + TypeScript + Tailwind 4 + MapLibre + genuine OpenStreetMap/Overpass locations + Supabase Auth and moderated reviews. **No fabricated locations or ratings.** Default search center: Philadelphia, PA.

## Run locally

```bash
npm install
cp .env.example .env.local
# Edit .env.local with your own Supabase project values
npm run dev
```

1. Create/open your Supabase project. Run `supabase/schema.sql` in SQL Editor.
2. In Supabase Authentication, enable Email OTP/magic links. Set Site URL `http://localhost:3000` and add `http://localhost:3000/**` to allowed redirect URLs; add the deployed Vercel URL before production.
3. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable/anon key) in `.env.local` and Vercel Environment Variables.
   Restroom searches follow `browser -> /api/restrooms -> gateway/places/bathrooms -> places-api/bathrooms`.
   The server derives the gateway URL from the Supabase project URL. Optionally set server-only `WASHROOM_GATEWAY_URL` to a different gateway base URL, such as `http://127.0.0.1:55321/functions/v1/gateway`.
   Public restroom searches do not require an API key when gateway JWT verification is disabled; an API key is forwarded when configured. Supabase sign-in and reviews still require the public key.
   Deploy `gateway`, `places-api`, and `frontend-api`. Set `PLACES_API_URL` and `FRONTEND_API_URL` to the respective function base URLs, and the same `GATEWAY_INTERNAL_SECRET` for all three functions. Never send that internal secret from the frontend. All three use `verify_jwt = false` in the checked-in Supabase config; backend functions enforce the internal gateway headers.
   Searches use a 1,000-meter radius. Places API searches stored restrooms first, then Overpass when there are no stored matches, so searches are no longer blocked outside Philadelphia.
4. Keep `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, and `SUPABASE_ANON_KEY` in the edge-function environment. Next.js does not need database credentials or a service-role key. Never put service-role keys in browser code, Git, or any `NEXT_PUBLIC_` variable.
5. Visit localhost:3000, select a real restroom, sign in with a magic link, submit a review. It will be saved as **pending**. In Supabase Table Editor, manually change `status` to `approved` after moderation. Only approved reviews are displayed.

## What is included

- Restroom details, OSM attribution, accessibility and fee tags, unverified availability
- Approved review feed with rating, review date, count (up to 50 recent reviews) and average over displayed reviews
- Email OTP authentication, server-side session validation, strict payload checks
- OSM ID/type verification against imported restroom records before accepting reviews
- One review per user/restroom; pending-by-default moderation; RLS restricts public reads
- Philadelphia as default city, map search and filters, Codyza branding on every page

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
This moves the map even if the restroom database/Overpass lookup is slow or fails.
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
| US boundary overlay | `/api/backend/map-boundary` -> `gateway/frontend/map-boundary` -> `frontend-api` -> boundary provider |

The only approved direct external requests are public OpenStreetMap tiles.
A `connect-src` Content Security Policy enforces same-origin browser connections
plus `https://tile.openstreetmap.org`. External attribution links are ordinary
navigation links, not application API calls. Browser geolocation uses the
browser API, not a Next.js outbound request.

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
- The map uses public OSM tiles and gateway-backed Photon geocoding. Photon's [public demo](https://photon.komoot.io/) is for reasonable development traffic with no availability guarantee; heavy use may be throttled or blocked. Add shared geocoding caching/rate limiting and use a production provider or self-host at scale. Nominatim rejected requests from the edge runtime with HTTP 403, so it is not used for city searches.
- The UI has no owner/admin dashboard, public ranking, photo uploads, edit-review workflow, or automated moderation yet. Reviews are manually approved in Supabase.
- A single reviewer can submit only one review per restroom. This is a first-pass anti-duplication control, not proof of a visit.
- Add accessibility audits, integration tests, privacy/terms pages, monitoring and deployment hardening.

**Security:** Rotate any password or credential that has been shared in chat. Never reuse it as a database secret.


## Map and location reliability update

- On mobile and tablet widths below 1024px, available restroom results appear in a swipeable, scroll-snapping carousel above the map, showing the filtered result count and previous/next buttons. Select a card to open its details. The carousel resets when the search center or filter changes. The map remains above the search controls. Search and location errors appear above the map; loading and empty results remain below search controls. Completed searches return keyboard focus to the map, and mobile scrolls to the map area with any errors visible above it. Desktop retains search controls above the side-by-side map and vertical results list.

- MapLibre uses OpenStreetMap public street tiles without an API key. CARTO returned "API KEY REQUIRED" placeholder images even though tile requests succeeded. Public OSM tiles are for light development use: follow the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/), retain attribution, and use a suitable hosted provider or self-hosted tiles before scaling. Do not bulk-download or prefetch public tiles.
- Map view is constrained to a US-focused bounding rectangle; this is **not a geographic US-only mask** and may show adjacent Canada/Mexico or ocean. For strict US-only cartography, use a clipped US boundary layer and tiles, including Alaska/Hawaii.
- On opening the site, the browser requests location permission. A successful US location lookup centers the map at zoom 15, adds a blue current-location point, and loads nearby restrooms. Location requires HTTPS (or localhost). Denied, unavailable, timed-out, or unsupported location displays a message and keeps the Philadelphia fallback and manual search usable. **Use my location** retries the lookup. A manual search takes precedence over a pending location lookup. City search is restricted to US via Photon's country filter and response validation.
- Restroom API queries genuine OSM features via multiple Overpass endpoints, with timeouts and graceful error messages. It does not invent fallback restroom data. Public Overpass services can still be unavailable/rate limited.
- For production reliability, periodically ingest OSM extracts into Supabase PostGIS and serve local indexed location queries rather than depending on public Overpass at request time. Observe ODbL attribution and share-alike requirements where applicable.


## CSS import TypeScript fix
`global.d.ts` declares CSS modules for TypeScript side-effect imports. Keep `maplibre-gl/dist/maplibre-gl.css` and `./globals.css` imported from `app/layout.tsx`. Run `npm install`, `npm run build`, and then `npm run dev`. If VS Code still displays stale errors, run **TypeScript: Restart TS Server**.
