import { searchNearbyPlaces } from "./search.ts"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

Deno.test("nearby search uses Refuge for restrooms and Overpass for businesses", async () => {
  const originalFetch = globalThis.fetch
  const originalEnvGet = Deno.env.get
  const overpassQueries: string[] = []

  Deno.env.get = name => ({
    SUPABASE_URL: "https://supabase.example",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
  }[name] ?? null)

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname === "/rest/v1/restrooms") return Response.json([])
    if (url.pathname === "/rest/v1/rpc/find_nearby_fuel") return Response.json([])
    if (url.hostname === "www.refugerestrooms.org") {
      return Response.json([{
        id: 45333,
        name: "Refuge restroom",
        latitude: 0.01,
        longitude: 0,
        accessible: true,
        unisex: true,
        changing_table: false,
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
        directions: null,
        distance: 0.1,
      }])
    }
    if (url.hostname === "overpass-api.de") {
      const body = init?.body
      assert(body instanceof URLSearchParams, "Overpass query must be form encoded")
      const query = body.get("data") ?? ""
      overpassQueries.push(query)
      assert(!query.includes('nwr["amenity"="toilets"]'), "Do not query Overpass for restroom listings")
      return Response.json({
        elements: [{ id: 12, type: "node", lat: 0.02, lon: 0, tags: { amenity: "fuel" } }],
      })
    }
    throw new Error(`Unexpected provider request: ${url}`)
  }

  try {
    const result = await searchNearbyPlaces(
      { latitude: 0, longitude: 0, source: "coordinates" },
      "8046.72",
      "bathrooms",
    )
    assert(result.data.length === 2, "Return Refuge restrooms and provider businesses")
    assert(result.data[0].provider === "refuge-restrooms", "Place timestamped Refuge listings first")
    assert(result.data[1].placeType === "gas-station", "Retain Overpass business results")
    assert(overpassQueries.length === 1, "Run the Overpass business query")
  } finally {
    globalThis.fetch = originalFetch
    Deno.env.get = originalEnvGet
  }
})
