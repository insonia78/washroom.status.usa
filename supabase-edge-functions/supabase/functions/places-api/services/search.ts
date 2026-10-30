import type { SearchOrigin } from "../models/types.ts"
import { findNearbyRestrooms, type RestroomPlace } from "./restrooms.ts"
import { RequestError } from "../utils/errors.ts"
import { logError } from "../utils/logger.ts"
import { findNearbyFuel, type normalizeFuelPlace } from "./fuel.ts"
import { findNearbyRefugeRestrooms } from "./refuge.ts"
import { locationDatabaseHeaders } from "../../_shared/database-schema.ts"

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
    await registerReviewLocations(data)
    return {
      data,
      warning: "Refuge Restrooms API could not be checked, so results may be incomplete. Please retry shortly.",
    }
  }

  await registerReviewLocations(data)
  return { data }
}

async function registerReviewLocations(places: Array<{ id: number; osmType: string }>) {
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
        Prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify(places.slice(offset, offset + 500).map(place => ({ osm_type: place.osmType, osm_id: place.id }))),
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
) {
  // Keep Refuge listings newest first and put them before sources without timestamps.
  const places = new Map<string, ReturnType<typeof normalizeFuelPlace> | RestroomPlace | typeof refugePlaces[number]>(
    refugePlaces.map(place => [`${place.osmType}:${place.id}`, place]),
  )
  for (const place of storedPlaces) places.set(`${place.osmType}:${place.id}`, place)
  return [...places.values()]
}
