import { logError, logWithColor } from "../utils/logger.ts"
import { RequestError } from "../utils/errors.ts"

type RestroomRow = {
  osm_type: "node" | "way" | "relation"
  osm_id: number
  name: string | null
  latitude: number
  longitude: number
  wheelchair: string | null
  fee: string | null
  opening_hours: string | null
  changing_table: string | null
  unisex: string | null
}

export type RestroomPlace = {
  id: number
  osmType: string
  placeType: "bathroom"
  name: string
  category: string
  access: string
  fee: string
  wheelchair: string
  openingHours?: string
  changingTable: string
  unisex: string
  toilets: string
  provider?: string
  createdAt?: string
  updatedAt?: string
  directions?: string
  coordinates: {
    latitude: number
    longitude: number
  }
}

const EARTH_RADIUS_METERS = 6_371_000
const PAGE_SIZE = 500

// Loads the Supabase URL and service key required for database requests.
function getRestroomsRequestConfig(): { baseUrl: string; apiKey: string } {
  const baseUrl = Deno.env.get("SUPABASE_URL")
  const apiKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

  if (!baseUrl || !apiKey) {
    throw new RequestError(
      500,
      "Restroom database search requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    )
  }

  return { baseUrl, apiKey }
}

// Calculates a latitude/longitude bounding box around a search point.
function buildBounds(
  latitude: number,
  longitude: number,
  radiusMeters: number,
) {
  const latitudeDelta = radiusMeters / 110_000
  const minLatitude = Math.max(-90, latitude - latitudeDelta)
  const maxLatitude = Math.min(90, latitude + latitudeDelta)
  const longitudeScale = Math.cos(latitude * Math.PI / 180)
  const longitudeDelta = longitudeScale <= 0.000001
    ? 180
    : Math.min(180, radiusMeters / (110_000 * longitudeScale))

  return {
    minLatitude,
    maxLatitude,
    minLongitude: longitude - longitudeDelta,
    maxLongitude: longitude + longitudeDelta,
    allLongitudes: longitudeDelta >= 180,
  }
}

// Creates a REST query for restroom rows within one longitude range.
function buildRestroomsUrl(
  baseUrl: string,
  bounds: ReturnType<typeof buildBounds>,
  minLongitude: number,
  maxLongitude: number,
): URL {
  const url = new URL("/rest/v1/restrooms", baseUrl)
  url.searchParams.set(
    "select",
    "osm_type,osm_id,name,latitude,longitude,wheelchair,fee,opening_hours,changing_table,unisex",
  )
  url.searchParams.set("order", "id.asc")

  const filters = [
    `latitude.gte.${bounds.minLatitude}`,
    `latitude.lte.${bounds.maxLatitude}`,
  ]
  if (!bounds.allLongitudes) {
    filters.push(
      `longitude.gte.${minLongitude}`,
      `longitude.lte.${maxLongitude}`,
    )
  }
  url.searchParams.set("and", `(${filters.join(",")})`)

  return url
}

// Measures the great-circle distance between two coordinate pairs.
function distanceMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const toRadians = (degrees: number) => degrees * Math.PI / 180
  const latitudeDelta = toRadians(latitudeB - latitudeA)
  const longitudeDelta = toRadians(longitudeB - longitudeA)
  const haversine = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(latitudeA)) *
      Math.cos(toRadians(latitudeB)) *
      Math.sin(longitudeDelta / 2) ** 2

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine))
}

// Maps a database restroom row into the shared API response shape.
function toRestroomPlace(row: RestroomRow): RestroomPlace {
  return {
    id: row.osm_id,
    osmType: row.osm_type,
    placeType: "bathroom",
    name: row.name || "Public Restroom",
    category: "toilets",
    access: "public",
    fee: row.fee || "no",
    wheelchair: row.wheelchair || "unknown",
    openingHours: row.opening_hours || undefined,
    changingTable: row.changing_table || "no",
    unisex: row.unisex || "unknown",
    toilets: "unknown",
    coordinates: {
      latitude: row.latitude,
      longitude: row.longitude,
    },
  }
}

// Fetches paginated restroom rows, handling longitude wrap and exact-radius filtering.
async function fetchRestroomRows(
  baseUrl: string,
  apiKey: string,
  latitude: number,
  longitude: number,
  radiusMeters: number,
): Promise<RestroomRow[]> {
  const bounds = buildBounds(latitude, longitude, radiusMeters)
  const longitudeRanges = bounds.allLongitudes
    ? [[-180, 180]]
    : bounds.minLongitude < -180
    ? [[bounds.minLongitude + 360, 180], [-180, bounds.maxLongitude]]
    : bounds.maxLongitude > 180
    ? [[bounds.minLongitude, 180], [-180, bounds.maxLongitude - 360]]
    : [[bounds.minLongitude, bounds.maxLongitude]]
  const uniqueRows = new Map<string, RestroomRow>()

  for (const [minLongitude, maxLongitude] of longitudeRanges) {
    const url = buildRestroomsUrl(baseUrl, bounds, minLongitude, maxLongitude)
    let offset = 0

    while (true) {
      const headers = new Headers({
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        Range: `${offset}-${offset + PAGE_SIZE - 1}`,
        "Range-Unit": "items",
      })
      const response = await fetch(url, { headers })

      if (!response.ok) {
        const errorText = await response.text()
        logError("restrooms", "Database search failed", {
          status: response.status,
          error: errorText,
        })
        throw new RequestError(502, "Restroom database search failed.")
      }

      const rows = await response.json() as RestroomRow[]
      for (const row of rows) {
        uniqueRows.set(`${row.osm_type}:${row.osm_id}`, row)
      }

      if (rows.length < PAGE_SIZE) {
        break
      }

      offset += PAGE_SIZE
    }
  }

  return [...uniqueRows.values()].filter((row) =>
    distanceMeters(latitude, longitude, row.latitude, row.longitude) <=
      radiusMeters
  )
}

// Validates the search radius and returns nearby database restrooms.
export async function findNearbyRestrooms(
  latitude: number,
  longitude: number,
  radiusMeters: number,
): Promise<RestroomPlace[]> {
  if (!Number.isFinite(radiusMeters) || radiusMeters < 0) {
    throw new RequestError(
      400,
      "Invalid 'radius' value. Expected a non-negative number.",
    )
  }

  const { baseUrl, apiKey } = getRestroomsRequestConfig()
  const rows = await fetchRestroomRows(
    baseUrl,
    apiKey,
    latitude,
    longitude,
    radiusMeters,
  )
  const places = rows.map(toRestroomPlace)

  logWithColor("restrooms", "\x1b[36m", `Database matches: ${places.length}`, {
    latitude,
    longitude,
    radiusMeters,
  })

  return places
}
