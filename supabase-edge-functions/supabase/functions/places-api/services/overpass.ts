import { ANSI_COLORS, OVERPASS_CACHE_TTL_MS, OVERPASS_HEADERS, OVERPASS_URLS } from "../config/constants.ts"
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

  for (const overpassBaseUrl of OVERPASS_URLS) {
    const overpassUrl = new URL(overpassBaseUrl)
    overpassUrl.searchParams.set("data", query)

    try {
      logWithColor("overpass", ANSI_COLORS.cyan, `Trying endpoint: ${overpassBaseUrl}`)
      logWithColor("overpass", ANSI_COLORS.cyan, `Query: ${query}`)
      const response = await fetch(overpassUrl, {
        method: "GET",
        headers: OVERPASS_HEADERS
      })

      logWithColor("overpass", ANSI_COLORS.cyan, `Response status: ${response.status}`)

      if (!response.ok) {
        const errorText = await response.text()
        lastErrorMessage = `Overpass API error ${response.status} from ${overpassBaseUrl}: ${errorText}`
        logError("overpass", "Endpoint returned an error response", lastErrorMessage)
        continue
      }

      const data = await response.json() as { elements?: OverpassElement[] }
      logWithColor("overpass", ANSI_COLORS.cyan, `Elements returned: ${data.elements?.length || 0}`)
      const elements = data.elements || []
      setCachedValue("overpass", query, elements, OVERPASS_CACHE_TTL_MS)
      return elements
    } catch (error) {
      lastErrorMessage = error instanceof Error ? error.message : "Unknown Overpass fetch error"
      logError("overpass", `Endpoint request failed: ${overpassBaseUrl}`, {
        query,
        error: lastErrorMessage
      })
    }
  }

  throw new RequestError(502, `All Overpass endpoints failed. Last error: ${lastErrorMessage}`)
}

export function buildOverpassQuery(latitude: number, longitude: number, radiusValue: string, modeValue: string) {
  const querySegments: string[] = []

  if (modeValue === "bathrooms" || modeValue === "all") {
    querySegments.push(`nwr["amenity"="toilets"](around:${radiusValue}, ${latitude}, ${longitude});`)
  }

  if (modeValue === "shops" || modeValue === "all") {
    querySegments.push(`nwr["shop"]["toilets"="yes"](around:${radiusValue}, ${latitude}, ${longitude});`)
  }

  return `[out:json][timeout:30];(${querySegments.join("")});out center tags;`
}

export function formatOverpassElement(element: OverpassElement) {
  const tags = element.tags || {}
  const hasShopTag = typeof tags.shop === "string" && tags.shop.length > 0

  return {
    id: element.id,
    osmType: element.type || "unknown",
    placeType: hasShopTag ? "shop-with-bathroom" : "bathroom",
    name: tags.name || (hasShopTag ? "Shop With Bathroom" : "Public Restroom"),
    category: hasShopTag ? tags.shop : tags.amenity || "toilets",
    access: tags.access || "public",
    fee: tags.fee || "no",
    wheelchair: tags.wheelchair || tags["toilets:wheelchair"] || "unknown",
    changingTable: tags.changing_table || "no",
    unisex: tags.unisex || "unknown",
    toilets: tags.toilets || (hasShopTag ? "yes" : "unknown"),
    coordinates: {
      latitude: element.lat || (element.center ? element.center.lat : null),
      longitude: element.lon || (element.center ? element.center.lon : null)
    }
  }
}
