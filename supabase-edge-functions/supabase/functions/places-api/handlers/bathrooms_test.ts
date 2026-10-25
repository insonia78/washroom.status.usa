import { handleBathroomsRequest } from "./bathrooms.ts"
import placesApi from "../index.ts"
import { buildGatewayHeaders } from "../../_shared/gateway-auth.ts"
import { RequestError } from "../utils/errors.ts"

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

Deno.test("nearby searches use only stored locations and Refuge Restrooms", async () => {
  const originalFetch = globalThis.fetch
  const keys = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "GATEWAY_INTERNAL_SECRET"]
  const originalEnv = keys.map(key => Deno.env.get(key))
  const stored = {
    osm_type: "node", osm_id: 123, name: "Stored restroom",
    latitude: 40.75, longitude: -73.99, opening_hours: "24/7",
  }
  const fuel = {
    osm_identity: "node/456", latitude: 40.75, longitude: -73.99,
    tags: { amenity: "fuel", name: "Imported station" },
  }
  const refuge = {
    id: 123, name: "Refuge restroom", latitude: 40.75, longitude: -73.99,
    accessible: true, unisex: true, changing_table: false,
    created_at: "2024-01-01T00:00:00.000Z", updated_at: "2024-01-01T00:00:00.000Z",
    directions: null, distance: 0,
  }
  let databaseRows: unknown[] = [stored]
  let fuelRows: unknown[] = [fuel]
  let refugeRows: unknown[] = [refuge]
  let failRefuge = false
  let failDatabase = false
  const unexpectedRequests: string[] = []
  Deno.env.set(keys[0], "https://project.example")
  Deno.env.set(keys[1], "test-service-role-key")
  Deno.env.set(keys[2], "test-gateway-secret")
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.origin === "https://project.example") {
      if (url.pathname === "/rest/v1/rpc/find_nearby_fuel") {
        const body = JSON.parse(String(init?.body))
        assert(body.search_latitude === 40.75 && body.search_longitude === -73.99 &&
          body.radius_meters === 8046.72, "Preserve the requested origin and five-mile radius")
        return Response.json(fuelRows)
      }
      if (url.pathname === "/rest/v1/restrooms") {
        if (failDatabase) return new Response("Database unavailable", { status: 503 })
        return Response.json(databaseRows)
      }
    }
    if (url.hostname === "www.refugerestrooms.org") {
      assert(url.searchParams.get("lat") === "40.75" && url.searchParams.get("lng") === "-73.99",
        "Search Refuge at the selected origin")
      if (failRefuge) return new Response("Unavailable", { status: 503 })
      return Response.json(refugeRows)
    }
    unexpectedRequests.push(url.href)
    throw new Error(`Unexpected provider request: ${url}`)
  }
  type Result = {
    count: number; warning?: string;
    data: Array<{ id: number; name: string; osmType: string; toilets: string; provider?: string }>
  }
  const input = { lat: "40.75", lon: "-73.99", radius: "8046.72" }
  const search = async (): Promise<Result> => {
    const response = await handleBathroomsRequest(input)
    assert(response.status === 200, "Return successful searches")
    const result = await response.json()
    assert(result.searchRadiusMeters === 8046.72, "Keep the response radius")
    return result
  }
  try {
    const complete = await search()
    assert(complete.count === 3 && !complete.warning, "Merge stored restrooms, imported fuel, and Refuge")
    assert(complete.data[0].provider === "refuge-restrooms", "Keep timestamped Refuge listings first")
    assert(complete.data.filter(place => place.id === 123).length === 2, "Keep distinct source identities")
    assert(complete.data.find(place => place.id === 456)?.toilets === "unknown",
      "Imported business presence must not imply restroom availability")

    databaseRows = [stored, { ...stored, osm_id: 456 }]
    const deduplicated = await search()
    assert(deduplicated.count === 3 &&
      deduplicated.data.find(place => place.id === 456)?.name === stored.name,
      "Stored restrooms take precedence over fuel with the same OSM identity")

    failRefuge = true
    databaseRows = [stored]
    const partial = await search()
    assert(partial.count === 2 && partial.warning?.includes("Refuge Restrooms API"),
      "Preserve stored results and identify the unavailable provider")
    databaseRows = []
    const fuelOnly = await search()
    assert(fuelOnly.count === 1 && fuelOnly.warning, "Preserve imported fuel during Refuge outages")
    fuelRows = []
    let caught: unknown
    try { await search() } catch (error) { caught = error }
    assert(caught instanceof RequestError && caught.status === 502 &&
      caught.message === "Refuge Restrooms API request failed. Please try again.",
      "Total upstream failure must not become empty success")

    failRefuge = false
    const recovered = await search()
    assert(recovered.count === 1 && !recovered.warning, "Retry Refuge and clear warnings on recovery")
    refugeRows = []
    const empty = await search()
    assert(empty.count === 0 && !empty.warning, "Successful empty searches remain valid")
    failDatabase = true
    caught = undefined
    try { await search() } catch (error) { caught = error }
    assert(caught instanceof RequestError && caught.message === "Restroom database search failed.",
      "Do not hide database failures")

    const removedRoute = await placesApi.fetch(new Request("https://project.example/places-api/overpass", {
      headers: buildGatewayHeaders("test-gateway-secret"),
    }))
    assert(removedRoute.status === 404, "The removed provider route must not execute searches")
    const removedBody = await removedRoute.json()
    assert(JSON.stringify(removedBody.supportedRoutes) === '["/bathrooms"]', "Advertise only the supported route")
    assert(unexpectedRequests.length === 0, "Never call a removed provider, including on failure or empty results")
  } finally {
    globalThis.fetch = originalFetch
    keys.forEach((key, index) => {
      const value = originalEnv[index]
      if (value === undefined) Deno.env.delete(key)
      else Deno.env.set(key, value)
    })
  }
})
