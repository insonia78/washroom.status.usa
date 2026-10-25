// Describes the resolved point and source used for a nearby search.
export type SearchOrigin = {
  latitude: number
  longitude: number
  source: "coordinates" | "zip"
  zipCode?: string
  countryCode?: string
}

// Lists the optional query or JSON fields accepted by the Places API.
export type PlacesApiRequestInput = {
  lat?: string
  lon?: string
  zip?: string
  countryCode?: string
  radius?: string
}
