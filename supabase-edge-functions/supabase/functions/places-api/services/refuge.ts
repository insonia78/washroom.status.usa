import { RequestError } from "../utils/errors.ts"
import { logError } from "../utils/logger.ts"
import { fetchAndArchiveProviderResponse } from "../../_shared/third-party-data-lake.ts"
import { SOURCE_CANDIDATE_LIMIT } from "./search-limits.ts"
import { distanceMeters } from "./distance.ts"

const REFUGE_API_URL = "https://www.refugerestrooms.org/api/v1/restrooms/by_location"
const PAGE_SIZE = 100
const REQUEST_TIMEOUT_MS = 15_000

type RefugeRestroom = {
  id: number
  name: string
  latitude: number
  longitude: number
  accessible: boolean
  unisex: boolean
  changing_table: boolean
  created_at: string
  updated_at: string
  directions: string | null
  distance: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeRefugeRestroom(value: unknown): RefugeRestroom {
  if (!isRecord(value) ||
    !Number.isSafeInteger(value.id) || Number(value.id) <= 0 ||
    typeof value.name !== "string" ||
    typeof value.latitude !== "number" || !Number.isFinite(value.latitude) ||
    Math.abs(value.latitude) > 90 ||
    typeof value.longitude !== "number" || !Number.isFinite(value.longitude) ||
    Math.abs(value.longitude) > 180 ||
    typeof value.accessible !== "boolean" ||
    typeof value.unisex !== "boolean" ||
    typeof value.changing_table !== "boolean" ||
    typeof value.created_at !== "string" || !Number.isFinite(Date.parse(value.created_at)) ||
    typeof value.updated_at !== "string" || !Number.isFinite(Date.parse(value.updated_at)) ||
    typeof value.distance !== "number" || !Number.isFinite(value.distance) ||
    (value.directions !== null && typeof value.directions !== "string")) {
    throw new Error("Refuge Restrooms returned an invalid restroom record.")
  }

  return {
    id: Number(value.id),
    name: value.name,
    latitude: value.latitude,
    longitude: value.longitude,
    accessible: value.accessible,
    unisex: value.unisex,
    changing_table: value.changing_table,
    created_at: value.created_at,
    updated_at: value.updated_at,
    directions: value.directions,
    distance: value.distance,
  }
}

// Finds Refuge Restrooms listings within the requested radius and orders them newest first.
export async function findNearbyRefugeRestrooms(
  latitude: number,
  longitude: number,
  radiusMeters: number,
) {
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
    !Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
    !Number.isFinite(radiusMeters) || radiusMeters < 0) {
    throw new RequestError(400, "Invalid Refuge Restrooms search coordinates or radius.")
  }

  const places = []
  try {
    for (let page = 1; page <= Math.ceil(SOURCE_CANDIDATE_LIMIT / PAGE_SIZE); page += 1) {
      const url = new URL(REFUGE_API_URL)
      url.searchParams.set("lat", String(latitude))
      url.searchParams.set("lng", String(longitude))
      url.searchParams.set("per_page", String(PAGE_SIZE))
      url.searchParams.set("page", String(page))

      const response = await fetchAndArchiveProviderResponse("refuge-restrooms", url, {
        headers: { Accept: "application/json", "User-Agent": "WashroomStatusUSA/1.0" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!response.ok) {
        throw new Error(`Refuge Restrooms returned HTTP ${response.status}.`)
      }

      const rows: unknown = await response.json()
      if (!Array.isArray(rows) || rows.length > PAGE_SIZE) {
        throw new Error("Refuge Restrooms returned an invalid search response.")
      }

      let outsideRadius = false
      for (const row of rows) {
        if (places.length === SOURCE_CANDIDATE_LIMIT) break
        const place = normalizeRefugeRestroom(row)
        const distance = distanceMeters(latitude, longitude, place.latitude, place.longitude)
        if (distance > radiusMeters) {
          outsideRadius = true
          break
        }
        places.push({
          id: place.id,
          osmType: "refuge",
          placeType: "bathroom",
          name: place.name.trim() || "Refuge Restroom",
          category: "restroom",
          access: "unknown",
          fee: "unknown",
          wheelchair: place.accessible ? "yes" : "no",
          changingTable: place.changing_table ? "yes" : "no",
          unisex: place.unisex ? "yes" : "no",
          toilets: "yes",
          provider: "refuge-restrooms",
          createdAt: place.created_at,
          updatedAt: place.updated_at,
          directions: place.directions || undefined,
          coordinates: {
            latitude: place.latitude,
            longitude: place.longitude,
          },
        })
      }

      if (outsideRadius || rows.length < PAGE_SIZE || places.length === SOURCE_CANDIDATE_LIMIT) break
    }
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError"
    logError("refuge-restrooms", "Nearby restroom search failed", error instanceof Error ? error.message : String(error))
    throw new RequestError(
      timedOut ? 504 : 502,
      timedOut ? "Refuge Restrooms search timed out." : "Refuge Restrooms could not be loaded.",
    )
  }

  return places.sort((first, second) =>
    Date.parse(second.createdAt) - Date.parse(first.createdAt)
  )
}
