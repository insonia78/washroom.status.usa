import type { SearchOrigin } from "../models/types.ts"
import { findNearbyRestrooms, type RestroomPlace } from "./restrooms.ts"
import { RequestError } from "../utils/errors.ts"
import { logError } from "../utils/logger.ts"
import { findNearbyFuel, type normalizeFuelPlace } from "./fuel.ts"
import { findNearbySupermarkets, type normalizeSupermarketPlace } from "./supermarkets.ts"
import { findNearbyRefugeRestrooms } from "./refuge.ts"
import { locationDatabaseHeaders } from "../../_shared/database-schema.ts"
import { distanceMeters } from "./distance.ts"
import { SEARCH_RESULT_LIMIT, SOURCE_CANDIDATE_LIMIT } from "./search-limits.ts"

export async function searchNearbyPlaces(origin: SearchOrigin, radius: string) {
  const [restrooms, fuel, supermarkets, refuge] = await Promise.all([
    findNearbyRestrooms(origin.latitude, origin.longitude, Number(radius)),
    findNearbyFuel(origin.latitude, origin.longitude, Number(radius)),
    findNearbySupermarkets(origin.latitude, origin.longitude, Number(radius)),
    loadRefuge(origin, Number(radius)),
  ])
  const stored = [...fuel, ...restrooms]
  const merged = mergePlaces(refuge.data, stored, supermarkets)
  const limited = merged.length > SEARCH_RESULT_LIMIT ||
    [restrooms, fuel, supermarkets, refuge.data].some(rows => rows.length >= SOURCE_CANDIDATE_LIMIT)
  const distance = (place: typeof merged[number]) => distanceMeters(
    origin.latitude, origin.longitude, place.coordinates.latitude, place.coordinates.longitude,
  )
  const data = merged.map(place => ({ place, distance: distance(place) })).sort((first, second) =>
    first.distance - second.distance || first.place.osmType.localeCompare(second.place.osmType) ||
    first.place.id - second.place.id
  ).slice(0, SEARCH_RESULT_LIMIT).map(({ place }) => place)
  if (refuge.error && !data.length) {
    throw new RequestError(refuge.error.status, "Refuge Restrooms API request failed. Please try again.")
  }
  const warnings = [
    ...(refuge.error ? ["Refuge Restrooms API could not be checked, so results may be incomplete. Please retry shortly."] : []),
    ...(limited ? [`Showing up to the nearest ${SEARCH_RESULT_LIMIT} locations. Narrow the radius or move your search to see other locations; filters apply to these results only.`] : []),
  ]
  await registerReviewLocations(data)
  return { data, ...(warnings.length ? { warning: warnings.join(" ") } : {}) }
}

async function loadRefuge(origin: SearchOrigin, radius: number) {
  try {
    return { data: await findNearbyRefugeRestrooms(origin.latitude, origin.longitude, radius), error: null }
  } catch (error) {
    if (!(error instanceof RequestError) || ![502, 504].includes(error.status)) throw error
    logError("places", "Refuge Restrooms search failed", error.message)
    return { data: [], error }
  }
}

async function registerReviewLocations(places: Array<{
  id: number;
  osmType: string;
  coordinates: { latitude: number; longitude: number };
}>) {
  if (!places.length) return
  const baseUrl = Deno.env.get("SUPABASE_URL")
  const apiKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!baseUrl || !apiKey) throw new RequestError(500, "Review location registration requires Supabase server configuration.")
  const url = new URL("/rest/v1/review_locations", baseUrl)
  url.searchParams.set("on_conflict", "osm_type,osm_id")
  for (let offset = 0; offset < places.length; offset += 500) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...locationDatabaseHeaders("POST"),
        apikey: apiKey, Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(places.slice(offset, offset + 500).map(place => ({
        osm_type: place.osmType,
        osm_id: place.id,
        latitude: place.coordinates.latitude,
        longitude: place.coordinates.longitude,
      }))),
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) {
      logError("places", "Review location registration failed", { status: response.status })
      throw new RequestError(502, "Locations could not be prepared for reviews. Please retry the search.")
    }
  }
}

function mergePlaces(
  refugePlaces: Awaited<ReturnType<typeof findNearbyRefugeRestrooms>>,
  storedPlaces: (ReturnType<typeof normalizeFuelPlace> | RestroomPlace)[],
  supermarkets: ReturnType<typeof normalizeSupermarketPlace>[],
) {
  // Live Refuge wins over its archived copy; stored restrooms win over businesses.
  const places = new Map<string, ReturnType<typeof normalizeFuelPlace> | RestroomPlace | typeof refugePlaces[number]>(
    refugePlaces.map(place => [`${place.osmType}:${place.id}`, place]),
  )
  for (const place of storedPlaces) {
    const key = `${place.osmType}:${place.id}`
    if (place.osmType !== "refuge" || !places.has(key)) places.set(key, place)
  }
  for (const place of supermarkets) {
    const key = `${place.osmType}:${place.id}`
    if (!places.has(key)) places.set(key, place)
  }
  return [...places.values()]
}
