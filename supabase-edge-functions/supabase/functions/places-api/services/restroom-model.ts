export type RestroomRow = {
  osm_type: "node" | "way" | "relation" | "refuge"
  osm_id: number
  name: string | null
  latitude: number
  longitude: number
  wheelchair: string | null
  fee: string | null
  opening_hours: string | null
  changing_table: string | null
  unisex: string | null
}

export type RestroomPlace = {
  id: number
  osmType: string
  placeType: "bathroom"
  name: string
  category: string
  access: string
  fee: string
  wheelchair: string
  openingHours?: string
  changingTable: string
  unisex: string
  toilets: string
  provider?: string
  createdAt?: string
  updatedAt?: string
  directions?: string
  coordinates: {
    latitude: number
    longitude: number
  }
}

// Maps a database restroom row into the shared API response shape.
export function toRestroomPlace(row: RestroomRow): RestroomPlace {
  return {
    id: row.osm_id,
    osmType: row.osm_type,
    placeType: "bathroom",
    name: row.name || "Public Restroom",
    category: "toilets",
    access: "public",
    fee: row.fee || "no",
    wheelchair: row.wheelchair || "unknown",
    openingHours: row.opening_hours || undefined,
    changingTable: row.changing_table || "no",
    unisex: row.unisex || "unknown",
    toilets: "unknown",
    ...(row.osm_type === "refuge" ? { provider: "refuge-restrooms" } : {}),
    coordinates: {
      latitude: row.latitude,
      longitude: row.longitude,
    },
  }
}
