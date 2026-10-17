import type { PlacesApiRequestInput } from "../models/types.ts"
import { resolveSearchOrigin } from "../services/geocoding.ts"
import { buildOverpassQuery, fetchOverpassData, formatOverpassElement } from "../services/overpass.ts"
import { jsonResponse } from "../utils/http.ts"
import { parseFiniteNumber } from "../utils/request.ts"

export async function handleBathroomsRequest(input: PlacesApiRequestInput) {
  const radiusValue = input.radius ?? "1000"
  const searchOrigin = await resolveSearchOrigin(input)
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
    searchRadiusMeters: parseFiniteNumber(radiusValue, "radius"),
    count: elements.length,
    data: elements.map(formatOverpassElement)
  })
}
