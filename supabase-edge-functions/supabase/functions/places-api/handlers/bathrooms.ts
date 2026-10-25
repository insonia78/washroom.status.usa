import type { PlacesApiRequestInput } from "../models/types.ts"
import { resolveSearchOrigin } from "../services/geocoding.ts"
import { searchNearbyPlaces } from "../services/search.ts"
import { jsonResponse } from "../utils/http.ts"
import { parseFiniteNumber } from "../utils/request.ts"

// Resolves the requested location and returns nearby restroom results.
export async function handleBathroomsRequest(input: PlacesApiRequestInput) {
  const radiusValue = input.radius ?? "1000"
  const searchOrigin = await resolveSearchOrigin(input)
  const searchRadiusMeters = parseFiniteNumber(radiusValue, "radius")
  const { data: places, warning } = await searchNearbyPlaces(searchOrigin, radiusValue, "bathrooms")

  return jsonResponse(200, {
    success: true,
    searchOrigin,
    searchRadiusMeters,
    count: places.length,
    data: places,
    ...(warning ? { warning } : {}),
  })
}
