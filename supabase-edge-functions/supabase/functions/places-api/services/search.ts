import type { OverpassElement, SearchOrigin } from "../models/types.ts"
import { buildOverpassQuery, fetchOverpassData, formatOverpassElement } from "./overpass.ts"
import { findNearbyRestrooms, type RestroomPlace } from "./restrooms.ts"
import { RequestError } from "../utils/errors.ts"
import { logError } from "../utils/logger.ts"
import { findNearbyFuel } from "./fuel.ts"

export async function searchNearbyPlaces(origin: SearchOrigin, radius: string, mode: string) {
  const restrooms = mode === "shops" ? [] : await findNearbyRestrooms(
    origin.latitude, origin.longitude, Number(radius),
  )
  const fuel = await findNearbyFuel(origin.latitude, origin.longitude, Number(radius))
  const stored = [...fuel, ...restrooms]
  // Stored restrooms do not contain businesses; always search those upstream.
  const upstreamMode = restrooms.length ? (mode === "all" ? "shops" : "businesses") : mode
  let elements: OverpassElement[]
  try {
    elements = await fetchOverpassData(buildOverpassQuery(
      origin.latitude, origin.longitude, radius, upstreamMode,
    ))
  } catch (error) {
    if (!stored.length || !(error instanceof RequestError) ||
      ![502, 504].includes(error.status)) throw error
    logError("places", "Returning stored locations with incomplete upstream coverage", error.message)
    return {
      data: stored,
      warning: fuel.length
        ? `Showing stored locations only, including imported gas stations. Additional restrooms, gas stations, supermarkets${mode === "all" || mode === "shops" ? ", and other shops" : ""} could not be checked because the map data provider is unavailable. Please retry shortly.`
        : `Showing stored restrooms only. Gas stations, supermarkets${mode === "all" ? ", and other shops" : ""} could not be loaded because the map data provider is unavailable. Please retry shortly.`,
    }
  }
  const places = new Map<string, ReturnType<typeof formatOverpassElement> | RestroomPlace>(
    elements.map(formatOverpassElement).map(place => [`${place.osmType}:${place.id}`, place]),
  )
  for (const place of stored) places.set(`${place.osmType}:${place.id}`, place)
  return { data: [...places.values()] }
}
