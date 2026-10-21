import type { PlacesApiRequestInput } from "../models/types.ts"
import { resolveSearchOrigin } from "../services/geocoding.ts"
import { buildOverpassQuery, fetchOverpassData, formatOverpassElement } from "../services/overpass.ts"
import { findNearbyRestrooms } from "../services/restrooms.ts"
import { jsonResponse } from "../utils/http.ts"
import { parseFiniteNumber } from "../utils/request.ts"

export async function handleBathroomsRequest(input: PlacesApiRequestInput) {
  const radiusValue = input.radius ?? "1000"
  const searchOrigin = await resolveSearchOrigin(input)
  const searchRadiusMeters = parseFiniteNumber(radiusValue, "radius")
  const storedRestrooms = await findNearbyRestrooms(
    searchOrigin.latitude,
    searchOrigin.longitude,
    searchRadiusMeters,
  )

  if (storedRestrooms.length) {
    return jsonResponse(200, {
      success: true,
      searchOrigin,
      searchRadiusMeters,
      count: storedRestrooms.length,
      data: storedRestrooms,
    })
  }

  const overpassQuery = buildOverpassQuery(
    searchOrigin.latitude,
    searchOrigin.longitude,
    radiusValue,
    "bathrooms"
  )
  const elements = await fetchOverpassData(overpassQuery)

  return jsonResponse(200, {
    success: true,
    searchOrigin,
    searchRadiusMeters,
    count: elements.length,
    data: elements.map(formatOverpassElement)
  })
}
