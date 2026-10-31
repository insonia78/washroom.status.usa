# Places API

## Private administrator replies

These gateway routes require a verified account on the separate
`app_locations.owner_response_admins` allowlist, not merely a review moderator:

- `GET /frontend/admin/reviews?offset=0`: up to 50 reviews (all moderation states)
  with `user_id` or null for anonymous/deleted accounts, plus `next_offset`.
- `GET /frontend/admin/review-replies?review_id=UUID&offset=0`: up to 50 private
  replies for that review, plus `next_offset`.
- `POST /frontend/admin/review-replies`: save with
  `{"action":"save","id":"CLIENT_GENERATED_UUID","review_id":"UUID","body":"Reply"}`.
  Returns `{ "reply": ... }`. Reusing the ID with the same author/review/text is
  safe after a lost response; changing saved text is rejected.
- Send a saved reply using `{"action":"send","id":"SAVED_REPLY_UUID"}`.
  Recipient and content come from the stored review/reply, never client email,
  user ID or replacement body fields. Returns `{ "reply": ... }` only after
  provider acceptance has been persisted, or if already accepted.

Next.js proxies these as `/api/backend/admin/reviews` and
`/api/backend/admin/review-replies`. Reviewer email is resolved only on the backend
via Supabase Auth and passed to Resend, never returned by these endpoints.
States are `draft`, `sending`, `sent` (provider accepted, not guaranteed inbox
delivery), `failed`, and `unknown`. A concurrent/in-progress send returns 409;
unavailable recipients/expired retry windows return 422; missing email
configuration/provider failures return 503. Retry only the same saved reply:
there is a 60-second send lease and a 23-hour retry window with a stable Resend
idempotency key. A failed final storage write may leave `sending` despite
acceptance. Refresh history rather than assuming failure means no email was sent.

## Contribution authentication

POST `/frontend/reviews` and `/frontend/toilet-submissions` require a verified,
non-anonymous Supabase bearer session. The frontend offers email magic links;
existing verified email sessions are also accepted. Backend Auth validation,
not the request body, determines `user_id`. Reviews are saved pending and
duplicate account/listing reviews return 409. Missing/expired sessions return
401; unverified/anonymous identities return 403. GET approved reviews and place
searches remain public. Historical anonymous-submission references below are
superseded by this requirement.

## Database schema ownership

The project remains a single Supabase database. After
`20261030230000_private_application_schemas.sql`, backend PostgREST reads use
`Accept-Profile: app_locations` and writes/RPCs use
`Content-Profile: app_locations`; account/token consumers select `app_accounts`.
No browser contract, project URL or browser key changes. The gateway does not
trust client-supplied profile headers; backend services choose their schema.
Managed authentication remains in `auth`; no application tables remain in
`public` for the migrated inventory. Historical `public.*` references below
describe pre-cutover setup; operational queries must use the owning schema.
Hosted Data API must list both application schemas, but schema/table/function
grants deny `anon`/`authenticated`. Service-role credentials remain server-only.

## Application gateway boundary

Next.js proxies all application API calls through `gateway`; database queries
run only in edge backends. `/places/*` routes forward to `places-api`.
The gateway also exposes `/frontend/reviews` (GET/POST), `/frontend/geocode`
(GET, `q` query), `/frontend/map-boundary` (GET), and allowlisted
`/frontend/auth/v1/*` routes for magic-link Supabase Auth. These forward to the
internal `frontend-api` function using `GATEWAY_INTERNAL_SECRET`.
Configure `FRONTEND_API_URL` or let the gateway derive it from `PLACES_API_URL`.
Deploy both the updated gateway and `frontend-api` before using these routes.

### POST /frontend/toilet-submissions

The Next.js adapter is `POST /api/backend/toilet-submissions`. A verified,
non-anonymous Supabase account is required; send its `Authorization: Bearer`
access token. Send JSON with `name` (trimmed, 1-120 characters), numeric `latitude`
(17-72) and `longitude` (-179 to -65), `wheelchair` and `fee` (each `yes`, `no`,
or `unknown`), and `notes` (string, at most 1000 characters; may be empty).
The coordinate envelope matches browser location eligibility; it is not proof
of a US address or GPS provenance. Moderators must verify the public location.
The backend inserts only these fields plus forced `status: pending` into the
private `public.toilet_submissions` table, with `user_id` from the server-verified
session (client identity/status are ignored). An atomic database counter permits
at most **3 successful insertions per account per UTC calendar day**. It resets
at midnight UTC; rejected/deleted submissions still count; failed inserts roll
back the counter. Returns HTTP 201 with
`{"message":"Toilet saved for moderation","status":"pending"}` only after a
successful insert. Invalid payloads return 400, missing/expired sessions 401,
unverified accounts 403, unsupported methods 405, quota exhaustion 429, and
database failures 503. Apply migrations `20261030220000_toilet_submissions.sql`
and `20261030223000_toilet_submission_accounts.sql` (after the existing review
moderation migration) before deployment. Pending submissions are not search results; publication is
not automatic even when the moderation status is changed.

### GET/POST /frontend/moderation/toilets

The Next.js adapter is `/api/backend/moderation/toilets`. Both methods require a
verified account on `review_moderators`, using the existing moderator session.
GET returns `{submissions: [...], limited_to: 50}` with pending submissions,
oldest first. Rows include ID, name, full-precision latitude/longitude, wheelchair,
fee, notes, status, and timestamp, but not contributor identity. The dashboard's
Google Maps location and directions links use these exact coordinates.
POST accepts `{id: "<submission UUID>", decision: "approved" | "rejected"}` and
returns `{submission: {id, status}}` after saving moderator ID/time. A
no-longer-pending submission returns 409 without overwriting a prior decision.

OpenStreetMap tile requests are the only permitted direct external browser
connections; map boundaries and city geocoding are gateway-backed.

Frontend integration guide for Places API through the Supabase gateway.

Request flow: `frontend -> gateway -> places-api`. The Next.js frontend uses
`/api/restrooms` as a server-side adapter to `/gateway/places/bathrooms`; it does
not read the restrooms table directly. The gateway removes the `/places` prefix
and adds internal authorization headers before forwarding to Places API.

This documentation is intentionally limited to the **POST** endpoints a frontend should call.

## Base URLs

### Hosted

```text
https://fpgjugfmkjznfowbxirs.supabase.co/functions/v1/gateway/places/
```

### Local

```text
http://127.0.0.1:55321/functions/v1/gateway/places/
```

## Authentication

The bathroom gateway route is public; an application JWT is not
required. The frontend adapter sends the project publishable/anon key in `apikey`.
When using a publishable (`sb_publishable_...`) key, do not use it as a Bearer JWT.
Direct Places API calls are internal-only: the gateway supplies the shared
`GATEWAY_INTERNAL_SECRET` headers. Never expose that secret to the browser.
Configure `PLACES_API_URL` on the gateway to the Places API function base URL.

For hosted gateway requests, send `apikey`, `Content-Type`, and `Accept`.
If using a JWT anon key or a valid access token, the optional Authorization header
can also be included:

```http
apikey: <supabase publishable key>
Authorization: Bearer <supabase access token or anon token>
Content-Type: application/json
Accept: application/json
```

Local gateway requests use the same API key header in addition to:

```http
Content-Type: application/json
Accept: application/json
```

## Content type

All documented endpoints below are:

- `POST`
- `Content-Type: application/json`
- JSON response

## Endpoints

## 1) POST /bathrooms

Searches stored bathrooms, imported gas stations, and Refuge Restrooms listings near
coordinates or a ZIP code. Imported gas stations are included even without a
toilets tag. Their `toilets` value is `unknown` unless explicitly tagged; `no` is
preserved. Business presence is not confirmation of restroom access.
Overpass business searches and the `/places/overpass` route have been removed.
Deploy both `places-api` and `gateway` to activate this change.

### Request body

Send **either**:

- `lat` + `lon`
- or `zip`

### Body fields

| Field | Type | Required | Notes |
|---|---|---:|---|
| `lat` | string \| number | with `lon` | Latitude |
| `lon` | string \| number | with `lat` | Longitude |
| `zip` | string | alternative | Five-digit US ZIP code; preserve leading zeros |
| `countryCode` | string | no | Only `us` (case-insensitive); defaults to `us`. Other values return HTTP 400 |
| `radius` | string \| number | no | Search radius in meters, default `1000` |

### Example: coordinates

```http
POST /functions/v1/gateway/places/bathrooms
Content-Type: application/json
```

```json
{
  "lat": "40.7128",
  "lon": "-74.0060",
  "radius": "1500"
}
```

### Example: ZIP code

```json
{
  "zip": "10001",
  "radius": "1500"
}
```

## Response shape

## Success response

### POST /bathrooms

```json
{
  "success": true,
  "searchOrigin": {
    "latitude": 40.7484,
    "longitude": -73.9967,
    "source": "zip",
    "zipCode": "10001",
    "countryCode": "us"
  },
  "searchRadiusMeters": 1500,
  "count": 12,
  "data": [
    {
      "id": 1915655233,
      "osmType": "node",
      "placeType": "bathroom",
      "name": "Public Restroom",
      "category": "toilets",
      "access": "yes",
      "fee": "no",
      "wheelchair": "yes",
      "changingTable": "yes",
      "unisex": "unknown",
      "toilets": "unknown",
      "coordinates": {
        "latitude": 40.743513,
        "longitude": -74.006871
      }
    }
  ]
}
```

## Response field reference

### Top-level fields

| Field | Type | Notes |
|---|---|---|
| `success` | boolean | `true` for successful responses |
| `searchOrigin` | object | Final coordinates used in the search |
| `searchRadiusMeters` | number | Effective search radius |
| `count` | number | Number of results returned |
| `data` | array | Places returned by the search |
| `warning` | string | Present only for partial results: stored restrooms and/or imported gas stations returned while upstream coverage is unavailable |

### searchOrigin

| Field | Type | Notes |
|---|---|---|
| `latitude` | number | Final latitude used |
| `longitude` | number | Final longitude used |
| `source` | `coordinates` \| `zip` | How the search origin was resolved |
| `zipCode` | string | Present for ZIP-based searches |
| `countryCode` | string | Present for ZIP-based searches |

### Result item

| Field | Type | Notes |
|---|---|---|
| `id` | number | OpenStreetMap element id or Refuge listing id |
| `osmType` | string | `node`, `way`, `relation`, or `refuge` |
| `placeType` | `bathroom` \| `gas-station` | Safe frontend discriminator |
| `provider` | string | `refuge-restrooms` for Refuge listings |
| `createdAt` / `updatedAt` | string | ISO timestamps on Refuge listings |
| `name` | string | Display name with fallback |
| `category` | string | OSM category |
| `access` | string | OSM access value |
| `fee` | string | OSM fee value |
| `wheelchair` | string | Accessibility value |
| `changingTable` | string | Changing table availability |
| `unisex` | string | Unisex availability |
| `toilets` | string | Toilet availability hint |
| `coordinates.latitude` | number \| null | Place latitude |
| `coordinates.longitude` | number \| null | Place longitude |

## Error responses

## Validation error

```json
{
  "success": false,
  "error": "Missing required query parameters. Provide either 'zip' or both 'lat' and 'lon'."
}
```

## ZIP geocoding failure

```json
{
  "success": false,
  "error": "ZIP code '10001' could not be geocoded."
}
```

## Upstream failure

```json
{
  "success": false,
  "error": "Refuge Restrooms API request failed. Please try again."
}
```

## Frontend integration notes

- The Next.js `/api/restrooms` adapter accepts `radiusMiles=1|2|5|10` (default
  `5`) for both coordinate and ZIP searches. It forwards exact meter radii
  `1609.344`, `3218.688`, `8046.72`, and `16093.44` to the gateway. Unsupported
  choices return HTTP 400 before an upstream call. The website refetches on
  selection without bypassing the gateway; the radius applies to every source
  and category, including imported fuel. Larger radii may increase provider latency.
- Imported gas stations are read from `public.export_fuel` through the server-only
  `find_nearby_fuel` PostGIS RPC. Apply
  `supabase-edge-functions/supabase/migrations/20261022153000_search_fuel_locations.sql`
  before deploying this version of Places API. The function uses a geography
  GiST index and exact meter-radius filtering, not a full-table download.
- Fuel results normalize `node/123`, `way/123`, or `relation/123` into the same
  numeric `id` and `osmType` shape as stored restrooms. Coordinates come from the point
  geometry; names use trimmed name, brand, operator, then `Gas Station`.
  Restroom tags are trimmed and categorical values lowercased; boolean aliases
  `true`/`1` and `false`/`0` normalize to `yes` and `no`. Missing toilets remain
  `unknown`, explicit `no` is preserved, and restroom-specific hours take priority.
- Stored fuel is included with complete pagination and OSM-identity
  deduplication. Stored restroom rows take precedence over stored fuel.
  When Refuge fails, stored fuel can be returned even if no standalone
  restrooms match, with a warning explaining that Refuge coverage is missing.
  Failure of the fuel RPC is a database error, not an empty-match fallback.
- Use `POST /bathrooms` for stored bathrooms, imported gas stations, and Refuge listings.
- Searches check `public.restrooms` and `public.export_fuel` in Supabase and supplement them with Refuge Restrooms, filtered to the selected radius. There are no live shop/supermarket searches or Overpass fallbacks, even when no stored locations match.
- Stored and upstream results are merged by source type and ID, with stored rows taking precedence. Refuge listings use `osmType: "refuge"` to avoid collisions with OSM IDs. The frontend orders all results nearest first.
- If Refuge fails with a provider error or timeout and stored restrooms or imported gas stations exist, the response is HTTP 200 with those rows and a `warning` identifying missing Refuge coverage. The frontend displays the warning with a retry button and does not cache partial responses. Without stored rows, provider failures remain HTTP 502/504, not empty success. Database failures always remain errors. A successful empty response means no matches within the selected radius (five miles by default in the frontend). Direct Places API callers retain the default 1,000-meter radius.
- Imported gas stations use `toilets=unknown` when untagged. Their restroom access, fee, and wheelchair values use explicit `toilets:*` tags or `unknown`, not general business facilities.
- The Edge Function uses Supabase's server-side `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` environment variables to read `public.restrooms`; do not expose the service-role key to clients.
- Use `searchOrigin` as the map center after ZIP-based searches.
- Use `placeType` to switch markers/icons in the UI.
- Treat `wheelchair`, `changingTable`, `unisex`, and `toilets` as best-effort metadata.
- ZIP lookup supports only five-digit US ZIP codes and uses Zippopotam (`https://api.zippopotam.us/us/{zip}`), with no API key or geocoder environment variables required. Non-US `countryCode` values and invalid ZIP formats return HTTP 400 before any upstream lookup. Geocoding results are cached in memory for up to 24 hours per function instance; upstream errors are returned explicitly. Coordinate searches retain their existing behavior and do not enforce geographic boundaries.
- The Supabase function supports both `GET` and `POST`, but this contract is intentionally documented as **POST-only** for frontend consistency.

## ZIP geocoder configuration

Keep sending a single ZIP code as a string:

```json
{
  "zip": "10001",
  "countryCode": "us",
  "radius": "1500"
}
```

For US ZIP searches (`countryCode` omitted or `us`), deploy the updated function from the `supabase-edge-functions` directory:

```sh
supabase functions deploy gateway
supabase functions deploy places-api
```

No geocoder secrets are required for US ZIP searches. Restroom database searches still require the existing Supabase environment variables.

Set `PLACES_API_URL` on the gateway and configure the same `GATEWAY_INTERNAL_SECRET`
for both edge functions. Use the checked-in `verify_jwt = false` configuration;
Places API still requires the internal gateway authorization headers.

Non-US postal codes are not supported. Nominatim is no longer used, and any previously configured `NOMINATIM_URL` is ignored.

## Suggested frontend TypeScript types

```ts
type SearchOrigin = {
  latitude: number;
  longitude: number;
  source: "coordinates" | "zip";
  zipCode?: string;
  countryCode?: string;
};

type PlaceResult = {
  id: number;
  osmType: string;
  placeType: "bathroom" | "gas-station";
  provider?: "refuge-restrooms";
  createdAt?: string;
  updatedAt?: string;
  name: string;
  category: string;
  access: string;
  fee: string;
  wheelchair: string;
  openingHours?: string;
  changingTable: string;
  unisex: string;
  toilets: string;
  coordinates: {
    latitude: number | null;
    longitude: number | null;
  };
};

type BathroomsResponse = {
  success: true;
  warning?: string;
  searchOrigin: SearchOrigin;
  searchRadiusMeters: number;
  count: number;
  data: PlaceResult[];
};

type PlacesApiError = {
  success: false;
  error: string;
};
```
