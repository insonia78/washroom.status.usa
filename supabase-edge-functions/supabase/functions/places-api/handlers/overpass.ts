import type { PlacesApiRequestInput } from "../models/types.ts"
import { resolveSearchOrigin } from "../services/geocoding.ts"
import { searchNearbyPlaces } from "../services/search.ts"
import { RequestError } from "../utils/errors.ts"
import { jsonResponse } from "../utils/http.ts"
import { parseFiniteNumber } from "../utils/request.ts"

// Validates the requested search mode and returns matching nearby places.
export async function handleOverpassRequest(input: PlacesApiRequestInput) {
  const radiusValue = input.radius ?? "1000"
  const modeValue = (input.mode ?? "all").toLowerCase()

  if (!["bathrooms", "shops", "all"].includes(modeValue)) {
    throw new RequestError(400, "Invalid 'mode' value. Use one of: bathrooms, shops, all.")
  }

  const searchOrigin = await resolveSearchOrigin(input)
  const searchRadiusMeters = parseFiniteNumber(radiusValue, "radius")

  const { data: places, warning } = await searchNearbyPlaces(searchOrigin, radiusValue, modeValue)

  return jsonResponse(200, {
    success: true,
    mode: modeValue,
    searchOrigin,
    searchRadiusMeters,
    count: places.length,
    data: places,
    ...(warning ? { warning } : {}),
  })
}
