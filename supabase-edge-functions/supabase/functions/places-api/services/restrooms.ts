import { RequestError } from "../utils/errors.ts";
import { RestroomRow } from "./restroom-model.ts";
import { buildBounds } from "./restroom-bounds.ts";
import { buildRestroomsUrl } from "./restroom-bounds.ts";
import { locationDatabaseHeaders } from "../../_shared/database-schema.ts";
import { logError } from "../utils/logger.ts";
import { distanceMeters } from "./restroom-bounds.ts";
import { RestroomPlace } from "./restroom-model.ts";
import { toRestroomPlace } from "./restroom-model.ts";
import { logWithColor } from "../utils/logger.ts";

export type { RestroomPlace } from "./restroom-model.ts";

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
        ...locationDatabaseHeaders(),
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
