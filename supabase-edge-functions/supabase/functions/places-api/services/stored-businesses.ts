import { RequestError } from "../utils/errors.ts"
import { logError } from "../utils/logger.ts"
import { locationDatabaseHeaders } from "../../_shared/database-schema.ts"
import { DATABASE_TIMEOUT_MS, SOURCE_CANDIDATE_LIMIT } from "./search-limits.ts"

type BusinessKind = "fuel" | "supermarket"

const businessConfig = {
  fuel: {
    label: "Fuel",
    tag: "amenity",
    fallbackName: "Gas Station",
    invalidCategory: "Stored fuel location is not a gas station.",
    unavailable: "Stored gas stations could not be loaded.",
  },
  supermarket: {
    label: "Supermarket",
    tag: "shop",
    fallbackName: "Supermarket",
    invalidCategory: "Stored supermarket location is not a supermarket.",
    unavailable: "Stored supermarkets could not be loaded.",
  },
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function normalizeStoredBusiness(value: unknown, kind: BusinessKind) {
  const config = businessConfig[kind]
  if (!isRecord(value) || typeof value.osm_identity !== "string" ||
    typeof value.latitude !== "number" || !Number.isFinite(value.latitude) || Math.abs(value.latitude) > 90 ||
    typeof value.longitude !== "number" || !Number.isFinite(value.longitude) || Math.abs(value.longitude) > 180 ||
    !isRecord(value.tags)) throw new Error(`Invalid stored ${kind} location.`)
  const identity = /^(node|way|relation)\/([1-9]\d*)$/.exec(value.osm_identity.trim())
  if (!identity || !Number.isSafeInteger(Number(identity[2]))) {
    throw new Error(`Invalid stored ${kind} OSM identity.`)
  }
  const tags: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value.tags)) {
    if (raw === null) continue
    if (typeof raw !== "string") throw new Error(`Invalid stored ${kind} tag.`)
    if (raw.trim()) tags[key] = raw.trim()
  }
  const normalizedKeys = ["amenity", "toilets", "toilets:access", "toilets:wheelchair", "toilets:unisex"]
  if (kind === "supermarket") normalizedKeys.push("shop", "toilets:fee", "toilets:changing_table")
  for (const key of normalizedKeys) {
    if (tags[key]) {
      const lower = tags[key].toLowerCase()
      tags[key] = ["true", "1"].includes(lower) ? "yes" : ["false", "0"].includes(lower) ? "no" : lower
    }
  }
  if (tags[config.tag] !== kind) throw new Error(config.invalidCategory)
  const name = tags.name || tags.brand || tags.operator || config.fallbackName
  return {
    id: Number(identity[2]),
    osmType: identity[1],
    placeType: kind === "fuel" ? "gas-station" : "supermarket",
    name,
    category: kind === "fuel" ? tags.shop || "fuel" : "supermarket",
    access: tags["toilets:access"] || "unknown",
    fee: tags["toilets:fee"] || "unknown",
    wheelchair: tags["toilets:wheelchair"] || "unknown",
    openingHours: tags["toilets:opening_hours"] || tags.opening_hours || undefined,
    changingTable: kind === "fuel" ? tags.changing_table || "no" : tags["toilets:changing_table"] || "unknown",
    unisex: tags["toilets:unisex"] || "unknown",
    toilets: tags.toilets || "unknown",
    coordinates: { latitude: value.latitude, longitude: value.longitude },
  }
}

export async function findNearbyStoredBusinesses(
  latitude: number,
  longitude: number,
  radius: number,
  kind: BusinessKind,
) {
  const config = businessConfig[kind]
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
    !Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
    !Number.isFinite(radius) || radius < 0) throw new RequestError(400, `Invalid ${kind} search coordinates or radius.`)
  const baseUrl = Deno.env.get("SUPABASE_URL")
  const apiKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!baseUrl || !apiKey) throw new RequestError(500, `${config.label} database search requires Supabase server configuration.`)
  const places = new Map<string, ReturnType<typeof normalizeStoredBusiness>>()
  try {
    const response = await fetch(new URL("/rest/v1/rpc/find_nearby_businesses", baseUrl), {
      method: "POST",
      headers: { ...locationDatabaseHeaders("POST"), apikey: apiKey, Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        search_latitude: latitude, search_longitude: longitude, radius_meters: radius,
        business_kind: kind, result_limit: SOURCE_CANDIDATE_LIMIT,
      }),
      signal: AbortSignal.timeout(DATABASE_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`${config.label} database returned HTTP ${response.status}. Apply the bounded-search migration before deploying.`)
    const rows: unknown = await response.json()
    if (!Array.isArray(rows) || rows.length > SOURCE_CANDIDATE_LIMIT) throw new Error(`Invalid ${kind} database response.`)
    for (const row of rows) {
      const place = normalizeStoredBusiness(row, kind)
      places.set(`${place.osmType}:${place.id}`, place)
    }
    return [...places.values()]
  } catch (error) {
    logError(kind, `Stored ${kind} search failed`, error instanceof Error ? error.message : String(error))
    throw new RequestError(502, config.unavailable)
  }
}
