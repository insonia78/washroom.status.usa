import { RequestError } from "../utils/errors.ts"
import { type RestroomRow, toRestroomPlace } from "./restroom-model.ts"
import { locationDatabaseHeaders } from "../../_shared/database-schema.ts"
import { logError } from "../utils/logger.ts"
import { DATABASE_TIMEOUT_MS, SOURCE_CANDIDATE_LIMIT } from "./search-limits.ts"

export type { RestroomPlace } from "./restroom-model.ts"

export async function findNearbyRestrooms(
  latitude: number,
  longitude: number,
  radiusMeters: number,
) {
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
    !Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
    !Number.isFinite(radiusMeters) || radiusMeters < 0) {
    throw new RequestError(400, "Invalid restroom search coordinates or radius.")
  }
  const baseUrl = Deno.env.get("SUPABASE_URL")
  const apiKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!baseUrl || !apiKey) {
    throw new RequestError(500, "Restroom database search requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")
  }
  try {
    const response = await fetch(new URL("/rest/v1/rpc/find_nearby_restrooms", baseUrl), {
      method: "POST",
      headers: {
        ...locationDatabaseHeaders("POST"), apikey: apiKey,
        Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json",
      },
      body: JSON.stringify({
        search_latitude: latitude, search_longitude: longitude,
        radius_meters: radiusMeters, result_limit: SOURCE_CANDIDATE_LIMIT,
      }),
      signal: AbortSignal.timeout(DATABASE_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`Restroom database returned HTTP ${response.status}.`)
    const rows: unknown = await response.json()
    if (!Array.isArray(rows) || rows.length > SOURCE_CANDIDATE_LIMIT ||
      !rows.every(isRestroomRow)) throw new Error("Invalid restroom database response.")
    return rows.map(toRestroomPlace)
  } catch (error) {
    logError("restrooms", "Database search failed", error instanceof Error ? error.message : String(error))
    throw new RequestError(502, "Restroom database search failed.")
  }
}

function isRestroomRow(value: unknown): value is RestroomRow {
  if (typeof value !== "object" || value === null) return false
  const row = value as Record<string, unknown>
  return ["node", "way", "relation", "refuge"].includes(String(row.osm_type)) &&
    Number.isSafeInteger(row.osm_id) && Number(row.osm_id) > 0 &&
    typeof row.latitude === "number" && Number.isFinite(row.latitude) && Math.abs(row.latitude) <= 90 &&
    typeof row.longitude === "number" && Number.isFinite(row.longitude) && Math.abs(row.longitude) <= 180 &&
    ["name", "wheelchair", "fee", "opening_hours", "changing_table", "unisex"]
      .every(key => row[key] == null || typeof row[key] === "string")
}
