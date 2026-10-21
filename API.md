# Places API

## Application gateway boundary

Next.js proxies all application API calls through `gateway`; database queries
run only in edge backends. `/places/*` routes forward to `places-api`.
The gateway also exposes `/frontend/reviews` (GET/POST), `/frontend/geocode`
(GET, `q` query), `/frontend/map-boundary` (GET), and allowlisted
`/frontend/auth/v1/*` routes for magic-link Supabase Auth. These forward to the
internal `frontend-api` function using `GATEWAY_INTERNAL_SECRET`.
Configure `FRONTEND_API_URL` or let the gateway derive it from `PLACES_API_URL`.
Deploy both the updated gateway and `frontend-api` before using these routes.
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

The bathroom and overpass gateway routes are public; an application JWT is not
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

Searches for **public bathrooms only** near coordinates or a ZIP code.

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

---

## 2) POST /overpass

Searches for:

- bathrooms only
- shops with bathrooms only
- or both

### Body fields

| Field | Type | Required | Notes |
|---|---|---:|---|
| `lat` | string \| number | with `lon` | Latitude |
| `lon` | string \| number | with `lat` | Longitude |
| `zip` | string | alternative | Five-digit US ZIP code; preserve leading zeros |
| `countryCode` | string | no | Only `us` (case-insensitive); defaults to `us`. Other values return HTTP 400 |
| `radius` | string \| number | no | Search radius in meters, default `1000` |
| `mode` | string | no | `bathrooms`, `shops`, or `all`; default `all` |

### Example: bathrooms + shops

```http
POST /functions/v1/gateway/places/overpass
Content-Type: application/json
```

```json
{
  "zip": "10001",
  "radius": "1500",
  "mode": "all"
}
```

### Example: shops only

```json
{
  "lat": "40.7128",
  "lon": "-74.0060",
  "radius": "1500",
  "mode": "shops"
}
```

### Allowed mode values

| Value | Meaning |
|---|---|
| `bathrooms` | Returns public bathrooms only |
| `shops` | Returns shops that offer bathrooms |
| `all` | Returns both bathrooms and shops with bathrooms |

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

### POST /overpass

```json
{
  "success": true,
  "mode": "all",
  "searchOrigin": {
    "latitude": 40.7484,
    "longitude": -73.9967,
    "source": "zip",
    "zipCode": "10001",
    "countryCode": "us"
  },
  "searchRadiusMeters": 1500,
  "count": 37,
  "data": [
    {
      "id": 2555136010,
      "osmType": "node",
      "placeType": "shop-with-bathroom",
      "name": "Paragon Sports",
      "category": "sports",
      "access": "public",
      "fee": "no",
      "wheelchair": "unknown",
      "changingTable": "no",
      "unisex": "unknown",
      "toilets": "yes",
      "coordinates": {
        "latitude": 40.7376777,
        "longitude": -73.9903329
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
| `mode` | string | Present on `/overpass` responses |
| `searchOrigin` | object | Final coordinates used in the search |
| `searchRadiusMeters` | number | Effective search radius |
| `count` | number | Number of results returned |
| `data` | array | Places returned by the search |

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
| `id` | number | OpenStreetMap element id |
| `osmType` | string | Usually `node`, `way`, or `relation` |
| `placeType` | `bathroom` \| `shop-with-bathroom` | Safe frontend discriminator |
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

## Invalid mode

```json
{
  "success": false,
  "error": "Invalid 'mode' value. Use one of: bathrooms, shops, all."
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
  "error": "All Overpass endpoints failed. Last error: ..."
}
```

## Frontend integration notes

- Use `POST /bathrooms` when you want restroom-only results.
- Use `POST /overpass` when you want mixed results or shops-only results.
- Restroom searches check `public.restrooms` in Supabase first; if no nearby rows match, the API searches Overpass. Database errors are returned instead of being treated as cache misses.
- Overpass tries the main service, then the independent `overpass.private.coffee` service. Each request (including response-body reading) has an 18-second network deadline and a 15-second server query timeout, for at most 36 seconds of Overpass attempts. Provider errors and partial results are not cached or reported as no matches; exhausted timeouts return HTTP 504, other exhausted failures HTTP 502. A complete successful empty result means no mapped restrooms within the requested radius (1 mile / 1,609.344 meters in the frontend). Direct Places API callers retain the default 1,000-meter radius unless they specify `radius`.
- Queries use form-encoded POST requests with an application-specific User-Agent. The public fallback remains enabled, but availability is not guaranteed: an outage displays a retryable error, not an empty list or stale results from the previous location.
- Database matches are returned as the source result without an Overpass request. For `/overpass` with `mode: "all"`, a database match contains restroom rows only; shops are searched from Overpass when there are no nearby database restrooms. `mode: "shops"` goes directly to Overpass because `public.restrooms` stores restrooms, not shops.
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
  placeType: "bathroom" | "shop-with-bathroom";
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
  searchOrigin: SearchOrigin;
  searchRadiusMeters: number;
  count: number;
  data: PlaceResult[];
};

type OverpassResponse = {
  success: true;
  mode: "bathrooms" | "shops" | "all";
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
