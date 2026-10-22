import { ANSI_COLORS, OVERPASS_CACHE_TTL_MS, OVERPASS_HEADERS, OVERPASS_QUERY_TIMEOUT_SECONDS, OVERPASS_REQUEST_TIMEOUT_MS, OVERPASS_URLS } from "../config/constants.ts"
import type { OverpassElement } from "../models/types.ts"
import { getCachedValue, setCachedValue } from "../utils/cache.ts"
import { RequestError } from "../utils/errors.ts"
import { logError, logWithColor } from "../utils/logger.ts"

export async function fetchOverpassData(query: string): Promise<OverpassElement[]> {
  logWithColor("overpass", ANSI_COLORS.cyan, "Requesting data from Overpass API")
  const cachedResponse = getCachedValue<OverpassElement[]>("overpass", query)
  if (cachedResponse.found) {
    return cachedResponse.value
  }

  let lastErrorMessage = "Unknown Overpass error"
  let lastRequestTimedOut = false

  for (const overpassBaseUrl of OVERPASS_URLS) {
    const overpassUrl = new URL(overpassBaseUrl)
    lastRequestTimedOut = false
    const signal = AbortSignal.timeout(OVERPASS_REQUEST_TIMEOUT_MS)

    try {
      logWithColor("overpass", ANSI_COLORS.cyan, `Trying endpoint: ${overpassBaseUrl}`)
      logWithColor("overpass", ANSI_COLORS.cyan, `Query: ${query}`)
      const response = await fetch(overpassUrl, {
        method: "POST",
        headers: OVERPASS_HEADERS,
        body: new URLSearchParams({ data: query }),
        signal
      })

      logWithColor("overpass", ANSI_COLORS.cyan, `Response status: ${response.status}`)

      if (!response.ok) {
        const errorText = await response.text()
        lastErrorMessage = `Overpass API error ${response.status} from ${overpassBaseUrl}: ${errorText}`
        logError("overpass", "Endpoint returned an error response", lastErrorMessage)
        continue
      }

      const data: unknown = await response.json()
      if (typeof data !== "object" || data === null ||
        !("elements" in data) || !Array.isArray(data.elements) || "remark" in data) {
        throw new Error("Overpass returned an incomplete or invalid result.")
      }
      const elements = data.elements as OverpassElement[]
      logWithColor("overpass", ANSI_COLORS.cyan, `Elements returned: ${elements.length}`)
      setCachedValue("overpass", query, elements, OVERPASS_CACHE_TTL_MS)
      return elements
    } catch (error) {
      lastRequestTimedOut = signal.aborted
      lastErrorMessage = error instanceof Error ? error.message : "Unknown Overpass fetch error"
      logError("overpass", `Endpoint request failed: ${overpassBaseUrl}`, {
        query,
        error: lastErrorMessage
      })
    }
  }

  throw new RequestError(
    lastRequestTimedOut ? 504 : 502,
    `All Overpass endpoints failed. Last error: ${lastErrorMessage}`,
  )
}

export function buildOverpassQuery(latitude: number, longitude: number, radiusValue: string, modeValue: string) {
  const querySegments: string[] = []

  if (modeValue === "bathrooms" || modeValue === "all") {
    querySegments.push(`nwr["amenity"="toilets"](around:${radiusValue}, ${latitude}, ${longitude});`)
  }

  if (modeValue === "shops" || modeValue === "all") {
    querySegments.push(`nwr["shop"]["toilets"="yes"](around:${radiusValue}, ${latitude}, ${longitude});`)
  }

  querySegments.push(`nwr["amenity"="fuel"](around:${radiusValue}, ${latitude}, ${longitude});`)
  querySegments.push(`nwr["shop"="supermarket"](around:${radiusValue}, ${latitude}, ${longitude});`)

  return `[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_SECONDS}];(${querySegments.join("")});out center tags;`
}

export function formatOverpassElement(element: OverpassElement) {
  const tags = element.tags || {}
  const hasShopTag = typeof tags.shop === "string" && tags.shop.length > 0
  const isGasStation = tags.amenity === "fuel"
  const isSupermarket = tags.shop === "supermarket"
  const isBusiness = isGasStation || isSupermarket
  const toilets = tags.toilets || (tags.amenity === "toilets" || hasShopTag && !isBusiness ? "yes" : "unknown")

  return {
    id: element.id,
    osmType: element.type || "unknown",
    placeType: isGasStation ? "gas-station" : isSupermarket ? "supermarket" : hasShopTag ? "shop-with-bathroom" : "bathroom",
    name: tags.name || (isGasStation ? "Gas Station" : isSupermarket ? "Supermarket" : hasShopTag ? "Shop With Bathroom" : "Public Restroom"),
    category: hasShopTag ? tags.shop : tags.amenity || "toilets",
    access: tags["toilets:access"] || (isBusiness ? "unknown" : tags.access || "public"),
    fee: tags["toilets:fee"] || (isBusiness ? "unknown" : tags.fee || "no"),
    wheelchair: tags["toilets:wheelchair"] || (isBusiness ? "unknown" : tags.wheelchair || "unknown"),
    openingHours: tags.opening_hours || undefined,
    changingTable: tags.changing_table || "no",
    unisex: tags.unisex || "unknown",
    toilets,
    coordinates: {
      latitude: element.lat ?? element.center?.lat ?? null,
      longitude: element.lon ?? element.center?.lon ?? null
    }
  }
}
