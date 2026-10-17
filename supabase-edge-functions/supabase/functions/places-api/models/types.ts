export type OverpassElement = {
  id: number
  type?: string
  lat?: number
  lon?: number
  center?: {
    lat: number
    lon: number
  }
  tags?: Record<string, string>
}

export type SearchOrigin = {
  latitude: number
  longitude: number
  source: "coordinates" | "zip"
  zipCode?: string
  countryCode?: string
}

export type PlacesApiRequestInput = {
  lat?: string
  lon?: string
  zip?: string
  countryCode?: string
  radius?: string
  mode?: string
}
