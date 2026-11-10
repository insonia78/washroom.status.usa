export const EARTH_RADIUS_METERS = 6_371_000

// Calculates a latitude/longitude bounding box around a search point.
export function buildBounds(
  latitude: number,
  longitude: number,
  radiusMeters: number,
) {
  const latitudeDelta = radiusMeters / 110_000
  const minLatitude = Math.max(-90, latitude - latitudeDelta)
  const maxLatitude = Math.min(90, latitude + latitudeDelta)
  const longitudeScale = Math.cos(latitude * Math.PI / 180)
  const longitudeDelta = longitudeScale <= 0.000001
    ? 180
    : Math.min(180, radiusMeters / (110_000 * longitudeScale))

  return {
    minLatitude,
    maxLatitude,
    minLongitude: longitude - longitudeDelta,
    maxLongitude: longitude + longitudeDelta,
    allLongitudes: longitudeDelta >= 180,
  }
}

// Creates a REST query for restroom rows within one longitude range.
export function buildRestroomsUrl(
  baseUrl: string,
  bounds: ReturnType<typeof buildBounds>,
  minLongitude: number,
  maxLongitude: number,
): URL {
  const url = new URL("/rest/v1/restrooms", baseUrl)
  url.searchParams.set(
    "select",
    "osm_type,osm_id,name,latitude,longitude,wheelchair,fee,opening_hours,changing_table,unisex",
  )
  url.searchParams.set("order", "id.asc")

  const filters = [
    `latitude.gte.${bounds.minLatitude}`,
    `latitude.lte.${bounds.maxLatitude}`,
  ]
  if (!bounds.allLongitudes) {
    filters.push(
      `longitude.gte.${minLongitude}`,
      `longitude.lte.${maxLongitude}`,
    )
  }
  url.searchParams.set("and", `(${filters.join(",")})`)

  return url
}

// Measures the great-circle distance between two coordinate pairs.
export function distanceMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const toRadians = (degrees: number) => degrees * Math.PI / 180
  const latitudeDelta = toRadians(latitudeB - latitudeA)
  const longitudeDelta = toRadians(longitudeB - longitudeA)
  const haversine = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(latitudeA)) *
      Math.cos(toRadians(latitudeB)) *
      Math.sin(longitudeDelta / 2) ** 2

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine))
}
