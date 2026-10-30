import { RequestError } from "../utils/errors.ts"
import { logError } from "../utils/logger.ts"
import { locationDatabaseHeaders } from "../../_shared/database-schema.ts"

// Narrows an unknown value to a plain object before reading database fields.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// Validates a stored fuel row and maps it into the shared place response shape.
export function normalizeFuelPlace(value: unknown) {
  if (!isRecord(value) || typeof value.osm_identity !== "string" ||
    typeof value.latitude !== "number" || !Number.isFinite(value.latitude) || Math.abs(value.latitude) > 90 ||
    typeof value.longitude !== "number" || !Number.isFinite(value.longitude) || Math.abs(value.longitude) > 180 ||
    !isRecord(value.tags)) throw new Error("Invalid stored fuel location.")
  const identity = /^(node|way|relation)\/([1-9]\d*)$/.exec(value.osm_identity.trim())
  if (!identity || !Number.isSafeInteger(Number(identity[2]))) {
    throw new Error("Invalid stored fuel OSM identity.")
  }
  const tags: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value.tags)) {
    if (raw === null) continue
    if (typeof raw !== "string") throw new Error("Invalid stored fuel tag.")
    if (raw.trim()) tags[key] = raw.trim()
  }
  for (const key of ["amenity", "toilets", "toilets:access", "toilets:wheelchair", "toilets:unisex"]) {
    if (tags[key]) {
      const lower = tags[key].toLowerCase()
      tags[key] = ["true", "1"].includes(lower) ? "yes" : ["false", "0"].includes(lower) ? "no" : lower
    }
  }
  if (tags.amenity !== "fuel") throw new Error("Stored fuel location is not a gas station.")
  tags.name = tags.name || tags.brand || tags.operator || "Gas Station"
  return {
    id: Number(identity[2]),
    osmType: identity[1],
    placeType: "gas-station",
    name: tags.name,
    category: tags.shop || "fuel",
    access: tags["toilets:access"] || "unknown",
    fee: tags["toilets:fee"] || "unknown",
    wheelchair: tags["toilets:wheelchair"] || "unknown",
    openingHours: tags["toilets:opening_hours"] || tags.opening_hours || undefined,
    changingTable: tags.changing_table || "no",
    unisex: tags["toilets:unisex"] || "unknown",
    toilets: tags.toilets || "unknown",
    coordinates: { latitude: value.latitude, longitude: value.longitude },
  }
}

// Pages through the nearby-fuel database RPC and deduplicates its results.
export async function findNearbyFuel(latitude: number, longitude: number, radius: number) {
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
    !Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
    !Number.isFinite(radius) || radius < 0) throw new RequestError(400, "Invalid fuel search coordinates or radius.")
  const baseUrl = Deno.env.get("SUPABASE_URL")
  const apiKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!baseUrl || !apiKey) throw new RequestError(500, "Fuel database search requires Supabase server configuration.")
  const places = new Map<string, ReturnType<typeof normalizeFuelPlace>>()
  const pageSize = 500
  try {
    for (let offset = 0; ; offset += pageSize) {
      const response = await fetch(new URL("/rest/v1/rpc/find_nearby_fuel", baseUrl), {
        method: "POST",
        headers: { ...locationDatabaseHeaders("POST"), apikey: apiKey, Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          search_latitude: latitude, search_longitude: longitude, radius_meters: radius,
          page_offset: offset, page_size: pageSize,
        }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) throw new Error(`Fuel database returned HTTP ${response.status}. Apply the nearby fuel migration before deploying.`)
      const rows: unknown = await response.json()
      if (!Array.isArray(rows) || rows.length > pageSize) throw new Error("Invalid fuel database response.")
      for (const row of rows) {
        const place = normalizeFuelPlace(row)
        places.set(`${place.osmType}:${place.id}`, place)
      }
      if (rows.length < pageSize) return [...places.values()]
    }
  } catch (error) {
    logError("fuel", "Stored fuel search failed", error instanceof Error ? error.message : String(error))
    throw new RequestError(502, "Stored gas stations could not be loaded.")
  }
}
