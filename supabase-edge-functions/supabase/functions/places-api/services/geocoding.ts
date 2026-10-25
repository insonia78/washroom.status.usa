import { ANSI_COLORS, GEOCODE_CACHE_TTL_MS, ZIPPOTAM_URL } from "../config/constants.ts"
import type { PlacesApiRequestInput, SearchOrigin } from "../models/types.ts"
import { getCachedValue, setCachedValue } from "../utils/cache.ts"
import { RequestError } from "../utils/errors.ts"
import { logWithColor } from "../utils/logger.ts"
import { parseFiniteNumber } from "../utils/request.ts"

// Restricts geocoding requests to the supported US country code.
function validateCountryCode(countryCode: string): void {
  if (countryCode.toLowerCase() !== "us") {
    throw new RequestError(400, "Only US searches are supported. Use countryCode 'us' or omit it.")
  }
}

// Calls the ZIP provider and validates its response before returning coordinates.
async function geocodeUsZipCode(url: URL, zipCode: string): Promise<SearchOrigin | null> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  logWithColor("geocode", ANSI_COLORS.magenta, `Zippopotam response status: ${response.status}`)

  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    const errorText = await response.text()
    throw new RequestError(502, `Zippopotam geocoding error ${response.status}: ${errorText}`)
  }

  const result: unknown = await response.json()
  if (
    typeof result !== "object" ||
    result === null ||
    !("places" in result) ||
    !Array.isArray(result.places)
  ) {
    throw new RequestError(502, "Zippopotam geocoding returned an invalid response.")
  }

  if (result.places.length === 0) {
    return null
  }
  const place: unknown = result.places[0]
  if (
    typeof place !== "object" ||
    place === null ||
    !("latitude" in place) ||
    !("longitude" in place) ||
    typeof place.latitude !== "string" ||
    typeof place.longitude !== "string"
  ) {
    throw new RequestError(502, "Zippopotam geocoding returned invalid coordinates.")
  }

  const latitude = Number(place.latitude)
  const longitude = Number(place.longitude)
  if (
    !place.latitude.trim() ||
    !place.longitude.trim() ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    throw new RequestError(502, "Zippopotam geocoding returned invalid coordinates.")
  }

  return { latitude, longitude, source: "zip", zipCode, countryCode: "us" }
}

// Validates and caches a US ZIP-code lookup.
export async function geocodeZipCode(zipCode: string, countryCode = "us"): Promise<SearchOrigin | null> {
  validateCountryCode(countryCode)
  if (!/^[0-9]{5}$/.test(zipCode)) {
    throw new RequestError(400, "Invalid 'zip' value. Expected a five-digit US ZIP code.")
  }
  const url = new URL(`${ZIPPOTAM_URL}/us/${zipCode}`)
  const cacheKey = `${url.href}:us:${zipCode}`
  const cachedOrigin = getCachedValue<SearchOrigin | null>("geocode", cacheKey)
  if (cachedOrigin.found) {
    return cachedOrigin.value
  }

  const origin = await geocodeUsZipCode(url, zipCode)

  setCachedValue("geocode", cacheKey, origin, GEOCODE_CACHE_TTL_MS)
  return origin
}

// Chooses ZIP geocoding or validated coordinates as the search origin.
export async function resolveSearchOrigin(input: PlacesApiRequestInput): Promise<SearchOrigin> {
  const latValue = input.lat
  const lonValue = input.lon
  const zipValue = input.zip
  const countryCodeValue = (input.countryCode ?? "us").toLowerCase()
  validateCountryCode(countryCodeValue)

  if (zipValue) {
    const origin = await geocodeZipCode(zipValue, countryCodeValue)

    if (!origin) {
      throw new RequestError(400, `ZIP code '${zipValue}' could not be geocoded.`)
    }

    logWithColor("search-origin", ANSI_COLORS.yellow, "Resolved ZIP search origin", origin)
    return origin
  }

  if (!latValue || !lonValue) {
    throw new RequestError(400, "Missing required query parameters. Provide either 'zip' or both 'lat' and 'lon'.")
  }

  const origin: SearchOrigin = {
    latitude: parseFiniteNumber(latValue, "lat"),
    longitude: parseFiniteNumber(lonValue, "lon"),
    source: "coordinates"
  }

  logWithColor("search-origin", ANSI_COLORS.yellow, "Using coordinate search origin", origin)
  return origin
}
