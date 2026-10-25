import type { OverpassElement, SearchOrigin } from "../models/types.ts"
import { buildOverpassQuery, fetchOverpassData, formatOverpassElement } from "./overpass.ts"
import { findNearbyRestrooms, type RestroomPlace } from "./restrooms.ts"
import { RequestError } from "../utils/errors.ts"
import { logError } from "../utils/logger.ts"
import { findNearbyFuel } from "./fuel.ts"
import { findNearbyRefugeRestrooms } from "./refuge.ts"

export async function searchNearbyPlaces(origin: SearchOrigin, radius: string, mode: string) {
  // Load matching places from the database; shop-only searches omit stored restrooms.
  const restrooms = mode === "shops" ? [] : await findNearbyRestrooms(
    origin.latitude, origin.longitude, Number(radius),
  )
  const fuel = await findNearbyFuel(origin.latitude, origin.longitude, Number(radius))
  const stored = [...fuel, ...restrooms]

  // Fetch restroom listings from Refuge Restrooms while keeping stored data available on outages.
  let refugeRestrooms: Awaited<ReturnType<typeof findNearbyRefugeRestrooms>> = []
  let refugeError: RequestError | null = null
  if (mode !== "shops") {
    try {
      refugeRestrooms = await findNearbyRefugeRestrooms(
        origin.latitude, origin.longitude, Number(radius),
      )
    } catch (error) {
      if (!(error instanceof RequestError) || ![502, 504].includes(error.status)) throw error
      refugeError = error
      logError("places", "Refuge Restrooms search failed", error.message)
    }
  }

  // Keep Overpass for shops and businesses; Refuge Restrooms supplies upstream restroom listings.
  const upstreamMode = mode === "shops" ? "shops" : "businesses"
  let overpassPlaces: ReturnType<typeof formatOverpassElement>[] = []
  let overpassError: RequestError | null = null
  try {
    // Fetch business categories without requesting restrooms from Overpass.
    const elements: OverpassElement[] = await fetchOverpassData(buildOverpassQuery(
      origin.latitude, origin.longitude, radius, upstreamMode,
    ))
    overpassPlaces = elements.map(formatOverpassElement)
  } catch (error) {
    if (!(error instanceof RequestError) || ![502, 504].includes(error.status)) throw error
    overpassError = error
    logError("places", "OpenStreetMap business search failed", error.message)
  }

  const data = mergePlaces(overpassPlaces, refugeRestrooms, stored)
  const unavailableSources = [
    refugeError ? "Refuge Restrooms" : null,
    overpassError ? "OpenStreetMap Overpass API" : null,
  ].filter((source): source is string => source !== null)

  if (unavailableSources.length) {
    if (!data.length) throw new RequestError(
      refugeError?.status ?? overpassError?.status ?? 502,
      `${unavailableSources.join(" and ")} request failed. Please try again.`,
    )
    return {
      data,
      warning: `${unavailableSources.join(" and ")} could not be checked, so results may be incomplete. Please retry shortly.`,
    }
  }

  return { data }
}

function mergePlaces(
  overpassPlaces: ReturnType<typeof formatOverpassElement>[],
  refugePlaces: Awaited<ReturnType<typeof findNearbyRefugeRestrooms>>,
  storedPlaces: (ReturnType<typeof formatOverpassElement> | RestroomPlace)[],
) {
  // Keep Refuge listings newest first and put them before sources without timestamps.
  const places = new Map<string, ReturnType<typeof formatOverpassElement> | RestroomPlace>(
    [...refugePlaces, ...overpassPlaces].map(place => [`${place.osmType}:${place.id}`, place]),
  )
  for (const place of storedPlaces) places.set(`${place.osmType}:${place.id}`, place)
  return [...places.values()]
}
