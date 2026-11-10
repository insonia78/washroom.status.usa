import { handleBathroomsRequest } from "./bathrooms.ts"
import placesApi from "../index.ts"
import { buildGatewayHeaders } from "../../_shared/gateway-auth.ts"
import { RequestError } from "../utils/errors.ts"

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

Deno.test("nearby searches merge stored restrooms, businesses, and Refuge Restrooms", async () => {
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
  const supermarket = {
    osm_identity: "node/789", latitude: 40.75, longitude: -73.99,
    tags: { shop: "supermarket", name: "Imported supermarket" },
  }
  const refuge = {
    id: 123, name: "Refuge restroom", latitude: 40.75, longitude: -73.99,
    accessible: true, unisex: true, changing_table: false,
    created_at: "2024-01-01T00:00:00.000Z", updated_at: "2024-01-01T00:00:00.000Z",
    directions: null, distance: 0,
  }
  let databaseRows: unknown[] = [stored]
  let fuelRows: unknown[] = [fuel]
  let supermarketRows: unknown[] = [supermarket]
  let refugeRows: unknown[] = [refuge]
  let failRefuge = false
  let failDatabase = false
  let failSupermarket = false
  let failRegistration = false
  let registered: Array<{ osm_type: string; osm_id: number; latitude: number; longitude: number }> = []
  const unexpectedRequests: string[] = []
  Deno.env.set(keys[0], "https://project.example")
  Deno.env.set(keys[1], "test-service-role-key")
  Deno.env.set(keys[2], "test-gateway-secret")
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.origin === "https://project.example") {
      if (url.pathname.startsWith("/storage/v1/object/")) {
        assert(init?.method === "POST", "Provider archives use Storage uploads, not database queries")
        return new Response(null, { status: 201 })
      }
      const profile = init?.method === "POST" ? "Content-Profile" : "Accept-Profile"
      assert(new Headers(init?.headers).get(profile) === "app_locations", "Every database search/RPC/write uses the private location schema")
      if (url.pathname === "/rest/v1/review_locations") {
        assert(init?.method === "POST", "Only server searches register review locations")
        assert(new Headers(init.headers).get("apikey") === "test-service-role-key", "Registration uses backend credentials")
        assert(new Headers(init.headers).get("Prefer") === "resolution=merge-duplicates,return=minimal", "Repeated searches refresh listing coordinates")
        registered = JSON.parse(String(init.body))
        if (failRegistration) return new Response("Unavailable", { status: 503 })
        return new Response(null, { status: 201 })
      }
      if (url.pathname === "/rest/v1/rpc/find_nearby_businesses" &&
        JSON.parse(String(init?.body)).business_kind === "fuel") {
        const body = JSON.parse(String(init?.body))
        assert(body.search_latitude === 40.75 && body.search_longitude === -73.99 &&
          body.radius_meters === 8046.72, "Preserve the requested origin and five-mile radius")
        return Response.json(fuelRows)
      }
      if (url.pathname === "/rest/v1/rpc/find_nearby_businesses") {
        const body = JSON.parse(String(init?.body))
        assert(body.search_latitude === 40.75 && body.search_longitude === -73.99 &&
          body.radius_meters === 8046.72, "Search supermarkets within the same radius")
        if (failSupermarket) return new Response("Database unavailable", { status: 503 })
        return Response.json(supermarketRows)
      }
      if (url.pathname === "/rest/v1/rpc/find_nearby_restrooms") {
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
    data: Array<{
      id: number; name: string; osmType: string; toilets: string; category?: string; provider?: string;
      coordinates: { latitude: number; longitude: number };
    }>
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
    assert(complete.count === 4 && !complete.warning, "Merge stored restrooms, imported businesses, and Refuge")
    assert(complete.data[0].osmType === "node", "Use deterministic source/ID tie breaking at equal distances")
    assert(complete.data.filter(place => place.id === 123).length === 2, "Keep distinct source identities")
    assert(complete.data.find(place => place.id === 456)?.toilets === "unknown",
      "Imported business presence must not imply restroom availability")
    assert(complete.data.find(place => place.id === 789)?.category === "supermarket" &&
      complete.data.find(place => place.id === 789)?.toilets === "unknown",
      "Include supermarkets without claiming restroom availability")
    assert(JSON.stringify(registered) === JSON.stringify(complete.data.map(place => ({
      osm_type: place.osmType, osm_id: place.id,
      latitude: place.coordinates.latitude, longitude: place.coordinates.longitude,
    }))), "Register each reviewable listing with its verified coordinates")

    failRegistration = true
    let registrationError: unknown
    try { await search() } catch (error) { registrationError = error }
    assert(registrationError instanceof RequestError && registrationError.status === 502 &&
      registrationError.message.includes("prepared for reviews"), "Do not silently return listings that cannot accept reviews")
    failRegistration = false

    databaseRows = [stored, { ...stored, osm_id: 456 }]
    const deduplicated = await search()
    assert(deduplicated.count === 4 &&
      deduplicated.data.find(place => place.id === 456)?.name === stored.name,
      "Stored restrooms take precedence over fuel with the same OSM identity")

    databaseRows = [stored]
    supermarketRows = [supermarket, { ...supermarket, osm_identity: "node/456" }]
    const businessOverlap = await search()
    assert(businessOverlap.count === 4 &&
      businessOverlap.data.find(place => place.id === 456)?.name === fuel.tags.name,
      "Existing fuel results take precedence over matching supermarkets")
    supermarketRows = [supermarket]

    failRefuge = true
    databaseRows = [stored]
    const partial = await search()
    assert(partial.count === 3 && partial.warning?.includes("Refuge Restrooms API"),
      "Preserve stored results and identify the unavailable provider")
    assert(registered.length === 3 && registered.every(place => place.osm_type === "node"),
      "Partial search results also support reviews")
    databaseRows = []
    const businessesOnly = await search()
    assert(businessesOnly.count === 2 && businessesOnly.warning, "Preserve imported businesses during Refuge outages")
    fuelRows = []
    const supermarketOnly = await search()
    assert(supermarketOnly.count === 1 && supermarketOnly.warning,
      "Supermarkets remain available during Refuge outages even without other results")
    supermarketRows = []
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
    failSupermarket = true
    caught = undefined
    try { await search() } catch (error) { caught = error }
    assert(caught instanceof RequestError && caught.status === 502 &&
      caught.message === "Stored supermarkets could not be loaded.", "Do not hide supermarket database failures")
    failSupermarket = false
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
