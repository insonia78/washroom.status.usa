import type { SearchOrigin } from "../models/types.ts"
import { findNearbyRestrooms, type RestroomPlace } from "./restrooms.ts"
import { RequestError } from "../utils/errors.ts"
import { logError } from "../utils/logger.ts"
import { findNearbyFuel, type normalizeFuelPlace } from "./fuel.ts"
import { findNearbyRefugeRestrooms } from "./refuge.ts"

export async function searchNearbyPlaces(origin: SearchOrigin, radius: string) {
  const restrooms = await findNearbyRestrooms(
    origin.latitude, origin.longitude, Number(radius),
  )
  const fuel = await findNearbyFuel(origin.latitude, origin.longitude, Number(radius))
  const stored = [...fuel, ...restrooms]

  // Fetch restroom listings from Refuge Restrooms while keeping stored data available on outages.
  let refugeRestrooms: Awaited<ReturnType<typeof findNearbyRefugeRestrooms>> = []
  let refugeError: RequestError | null = null
  try {
    refugeRestrooms = await findNearbyRefugeRestrooms(
      origin.latitude, origin.longitude, Number(radius),
    )
  } catch (error) {
    if (!(error instanceof RequestError) || ![502, 504].includes(error.status)) throw error
    refugeError = error
    logError("places", "Refuge Restrooms search failed", error.message)
  }

  const data = mergePlaces(refugeRestrooms, stored)

  if (refugeError) {
    if (!data.length) throw new RequestError(
      refugeError.status,
      "Refuge Restrooms API request failed. Please try again.",
    )
    return {
      data,
      warning: "Refuge Restrooms API could not be checked, so results may be incomplete. Please retry shortly.",
    }
  }

  return { data }
}

function mergePlaces(
  refugePlaces: Awaited<ReturnType<typeof findNearbyRefugeRestrooms>>,
  storedPlaces: (ReturnType<typeof normalizeFuelPlace> | RestroomPlace)[],
) {
  // Keep Refuge listings newest first and put them before sources without timestamps.
  const places = new Map<string, ReturnType<typeof normalizeFuelPlace> | RestroomPlace | typeof refugePlaces[number]>(
    refugePlaces.map(place => [`${place.osmType}:${place.id}`, place]),
  )
  for (const place of storedPlaces) places.set(`${place.osmType}:${place.id}`, place)
  return [...places.values()]
}
