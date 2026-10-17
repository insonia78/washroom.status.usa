import { ANSI_COLORS, GEOCODE_CACHE_TTL_MS, NOMINATIM_HEADERS, NOMINATIM_URL, ZIPPOTAM_URL } from "../config/constants.ts"
import type { PlacesApiRequestInput, SearchOrigin } from "../models/types.ts"
import { getCachedValue, setCachedValue } from "../utils/cache.ts"
import { RequestError } from "../utils/errors.ts"
import { logError, logWithColor } from "../utils/logger.ts"
import { parseFiniteNumber } from "../utils/request.ts"

async function geocodeUsZipCode(zipCode: string): Promise<SearchOrigin | null> {
  const response = await fetch(`${ZIPPOTAM_URL}/us/${encodeURIComponent(zipCode)}`)

  logWithColor("geocode", ANSI_COLORS.magenta, `Zippopotam response status: ${response.status}`)

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    const errorText = await response.text()
    throw new RequestError(502, `Zippopotam geocoding error ${response.status}: ${errorText}`)
  }

  const result = await response.json() as {
    places?: Array<{ latitude: string; longitude: string }>
  }

  const firstPlace = result.places?.[0]
  if (!firstPlace) {
    return null
  }

  return {
    latitude: Number.parseFloat(firstPlace.latitude),
    longitude: Number.parseFloat(firstPlace.longitude),
    source: "zip",
    zipCode,
    countryCode: "us"
  }
}

async function geocodeZipCodeWithNominatim(zipCode: string, countryCode: string): Promise<SearchOrigin | null> {
  const params = new URLSearchParams({
    format: "jsonv2",
    limit: "1",
    postalcode: zipCode,
    countrycodes: countryCode,
    email: "washroom.status.usa@gmail.com"
  })

  logWithColor("geocode", ANSI_COLORS.magenta, `Looking up ZIP ${zipCode} (${countryCode})`)

  const response = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
    headers: NOMINATIM_HEADERS
  })

  logWithColor("geocode", ANSI_COLORS.magenta, `Response status: ${response.status}`)

  if (!response.ok) {
    const errorText = await response.text()
    throw new RequestError(502, `Nominatim geocoding error ${response.status}: ${errorText}`)
  }

  const results = await response.json() as Array<{ lat: string; lon: string }>
  logWithColor("geocode", ANSI_COLORS.magenta, `Results returned: ${results.length}`)

  if (!results.length) {
    return null
  }

  const origin: SearchOrigin = {
    latitude: Number.parseFloat(results[0].lat),
    longitude: Number.parseFloat(results[0].lon),
    source: "zip",
    zipCode,
    countryCode
  }

  return origin
}

export async function geocodeZipCode(zipCode: string, countryCode: string): Promise<SearchOrigin | null> {
  const cacheKey = `${countryCode}:${zipCode}`
  const cachedOrigin = getCachedValue<SearchOrigin | null>("geocode", cacheKey)
  if (cachedOrigin.found) {
    return cachedOrigin.value
  }

  let origin: SearchOrigin | null = null

  if (countryCode === "us") {
    logWithColor("geocode", ANSI_COLORS.magenta, `Trying US ZIP geocoder for ${zipCode}`)
    try {
      origin = await geocodeUsZipCode(zipCode)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logError("geocode", "US ZIP geocoder failed", { zipCode, error: message })
    }
  }

  if (!origin) {
    origin = await geocodeZipCodeWithNominatim(zipCode, countryCode)
  }

  setCachedValue("geocode", cacheKey, origin, GEOCODE_CACHE_TTL_MS)
  return origin
}

export async function resolveSearchOrigin(input: PlacesApiRequestInput): Promise<SearchOrigin> {
  const latValue = input.lat
  const lonValue = input.lon
  const zipValue = input.zip
  const countryCodeValue = (input.countryCode ?? "us").toLowerCase()

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
