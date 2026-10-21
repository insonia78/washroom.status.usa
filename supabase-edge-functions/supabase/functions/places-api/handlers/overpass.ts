import type { PlacesApiRequestInput } from "../models/types.ts"
import { resolveSearchOrigin } from "../services/geocoding.ts"
import { buildOverpassQuery, fetchOverpassData, formatOverpassElement } from "../services/overpass.ts"
import { findNearbyRestrooms } from "../services/restrooms.ts"
import { RequestError } from "../utils/errors.ts"
import { jsonResponse } from "../utils/http.ts"
import { parseFiniteNumber } from "../utils/request.ts"

export async function handleOverpassRequest(input: PlacesApiRequestInput) {
  const radiusValue = input.radius ?? "1000"
  const modeValue = (input.mode ?? "all").toLowerCase()

  if (!["bathrooms", "shops", "all"].includes(modeValue)) {
    throw new RequestError(400, "Invalid 'mode' value. Use one of: bathrooms, shops, all.")
  }

  const searchOrigin = await resolveSearchOrigin(input)
  const searchRadiusMeters = parseFiniteNumber(radiusValue, "radius")

  if (modeValue !== "shops") {
    const storedRestrooms = await findNearbyRestrooms(
      searchOrigin.latitude,
      searchOrigin.longitude,
      searchRadiusMeters,
    )

    if (storedRestrooms.length) {
      return jsonResponse(200, {
        success: true,
        mode: modeValue,
        searchOrigin,
        searchRadiusMeters,
        count: storedRestrooms.length,
        data: storedRestrooms,
      })
    }
  }

  const overpassQuery = buildOverpassQuery(
    searchOrigin.latitude,
    searchOrigin.longitude,
    radiusValue,
    modeValue
  )
  const elements = await fetchOverpassData(overpassQuery)

  return jsonResponse(200, {
    success: true,
    mode: modeValue,
    searchOrigin,
    searchRadiusMeters,
    count: elements.length,
    data: elements.map(formatOverpassElement)
  })
}
