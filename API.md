# Places API

Frontend integration guide for the Supabase Edge Function [places-api](<C:/Users/default.LAPTOP-J5GV1TT8/OneDrive/Documenti/a_csc training/codyza/washroom.status.usa/supabase-edge-functions/supabase/functions/places-api>).

This documentation is intentionally limited to the **POST** endpoints a frontend should call.

## Base URLs

### Hosted

```text
https://fpgjugfmkjznfowbxirs.supabase.co/functions/v1/places-api/
```

### Local

```text
http://127.0.0.1:55321/functions/v1/places-api/
```

## Authentication

Hosted Supabase function requests should include:

```http
apikey: <supabase publishable key>
Authorization: Bearer <supabase access token or anon token>
Content-Type: application/json
Accept: application/json
```

Local requests typically only need:

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
| `zip` | string | alternative | US ZIP or other postal code |
| `countryCode` | string | no | Defaults to `us` |
| `radius` | string \| number | no | Search radius in meters, default `1000` |

### Example: coordinates

```http
POST /functions/v1/places-api/bathrooms
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
| `zip` | string | alternative | US ZIP or other postal code |
| `countryCode` | string | no | Defaults to `us` |
| `radius` | string \| number | no | Search radius in meters, default `1000` |
| `mode` | string | no | `bathrooms`, `shops`, or `all`; default `all` |

### Example: bathrooms + shops

```http
POST /functions/v1/places-api/overpass
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
- Use `searchOrigin` as the map center after ZIP-based searches.
- Use `placeType` to switch markers/icons in the UI.
- Treat `wheelchair`, `changingTable`, `unisex`, and `toilets` as best-effort metadata.
- For US ZIP codes, the function tries a US ZIP geocoder before falling back to Nominatim.
- The Supabase function supports both `GET` and `POST`, but this contract is intentionally documented as **POST-only** for frontend consistency.

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
