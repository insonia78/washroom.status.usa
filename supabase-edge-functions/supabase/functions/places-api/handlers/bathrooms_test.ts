import { handleBathroomsRequest } from "./bathrooms.ts"
import { handleOverpassRequest } from "./overpass.ts"
import { RequestError } from "../utils/errors.ts"

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

Deno.test("nearby searches include businesses alongside stored or upstream restrooms", async () => {
  const originalFetch = globalThis.fetch
  const keys = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]
  const originalEnv = keys.map(key => Deno.env.get(key))
  const stored = {
    osm_type: "node", osm_id: 123, name: "Stored restroom",
    latitude: 40.75, longitude: -73.99, opening_hours: "24/7",
  }
  let databaseRows: unknown[] = [stored]
  const queries: string[] = []
  let failOverpass = false
  let failDatabase = false
  let fuelRows: unknown[] = []
  let databaseCalls = 0
  Deno.env.set(keys[0], "https://project.example")
  Deno.env.set(keys[1], "test-service-role-key")
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === "/rest/v1/rpc/find_nearby_fuel") return Response.json(fuelRows)
    if (url.pathname === "/rest/v1/restrooms") {
      databaseCalls++
      if (failDatabase) return new Response("Database unavailable", { status: 503 })
      return Response.json(databaseRows)
    }
    assert(init?.body instanceof URLSearchParams, "Expected form POST")
    const query = init.body.get("data") || ""
    queries.push(query)
    if (failOverpass) return new Response("Unavailable", { status: 503 })
    const elements = [
      { id: 456, type: "node", lat: 40.75, lon: -73.99, tags: { amenity: "fuel" } },
      { id: 789, type: "way", center: { lat: 40.75, lon: -73.99 }, tags: { shop: "supermarket", toilets: "no" } },
    ]
    if (query.includes('["amenity"="toilets"]')) {
      elements.push({ id: 123, type: "node", lat: 40.75, lon: -73.99, tags: { amenity: "toilets" } })
    }
    return Response.json({ elements })
  }
  type Result = { count: number; warning?: string; data: Array<{ id: number; name: string; toilets: string; placeType: string }> }
  try {
    const input = { lat: "40.75", lon: "-73.99", radius: "1609.344" }
    const storedResult: Result = await (await handleBathroomsRequest(input)).json()
    assert(storedResult.count === 3, "Include both businesses even when stored restrooms exist")
    assert(storedResult.warning === undefined, "Complete results need no warning")
    assert(storedResult.data.find(place => place.id === 123)?.name === stored.name, "Preserve stored restroom")
    assert(storedResult.data.find(place => place.id === 456)?.toilets === "unknown", "Do not invent toilets at gas stations")
    assert(storedResult.data.find(place => place.id === 789)?.toilets === "no", "Preserve explicit absence of toilets")
    assert(!queries[0].includes('["amenity"="toilets"]'), "Avoid fetching restrooms when stored ones exist")
    assert(queries[0].includes('["amenity"="fuel"]') && queries[0].includes('["shop"="supermarket"]'), "Fetch both categories")
    assert(queries[0].includes("(around:1609.344, 40.75, -73.99)"), "Preserve one-mile radius and origin")

    databaseRows = [stored, { ...stored, osm_id: 456 }, { ...stored, osm_id: 789 }]
    const merged: Result = await (await handleBathroomsRequest(input)).json()
    assert(merged.count === 4, "Deduplicate identical OSM identities but retain different element types")
    assert(merged.data.find(place => place.id === 456)?.name === stored.name, "Stored fields take precedence on duplicate identities")

    databaseRows = []
    const fallback: Result = await (await handleBathroomsRequest(input)).json()
    assert(fallback.count === 3 && fallback.data.some(place => place.id === 123), "Fetch upstream restrooms when storage is empty")
    assert(queries[1].includes('["amenity"="toilets"]'), "Include toilets in fallback query")

    databaseRows = [stored]
    const all: Result = await (await handleOverpassRequest({ ...input, mode: "all" })).json()
    assert(all.count === 3 && queries[2].includes('["shop"]["toilets"="yes"]'), "All mode supplements stored results with shops and businesses")
    const callsBeforeShops = databaseCalls
    const shops: Result = await (await handleOverpassRequest({ ...input, mode: "shops" })).json()
    assert(shops.count === 2 && databaseCalls === callsBeforeShops, "Shops mode skips stored restrooms")

    // Use a distinct query to avoid the success cache.
    failOverpass = true
    const partial: Result = await (await handleBathroomsRequest({ ...input, lon: "-73.98" })).json()
    assert(partial.count === 1 && partial.data[0].id === 123, "Return real stored restrooms on provider failure")
    assert(partial.warning?.includes("Gas stations, supermarkets"), "Partial results must identify missing categories")
    const partialAll: Result = await (await handleOverpassRequest({ ...input, lon: "-73.98", mode: "all" })).json()
    assert(partialAll.count === 1 && partialAll.warning?.includes("other shops"), "All-mode warning includes unavailable shops")
    databaseRows = []
    try {
      await handleBathroomsRequest({ ...input, lon: "-73.98" })
      throw new Error("Expected provider failure")
    } catch (error) {
      assert(error instanceof RequestError && error.status === 502, "No stored rows means provider failure, not empty success")
    }
    databaseRows = [stored]
    const timeout = AbortSignal.timeout
    const providerFetch = globalThis.fetch
    try {
      AbortSignal.timeout = () => timeout(5)
      globalThis.fetch = (input, init) => {
        if (String(input).includes("/rest/v1/")) return providerFetch(input, init)
        return new Promise<Response>((_, reject) => {
          const signal = init?.signal
          assert(signal, "Provider requests need a timeout")
          signal.addEventListener("abort", () => reject(signal.reason), { once: true })
        })
      }
      const timedOut: Result = await (await handleBathroomsRequest({ ...input, lon: "-73.985" })).json()
      assert(timedOut.count === 1 && timedOut.warning, "Provider timeout must also preserve stored restrooms with a warning")
      databaseRows = []
      try {
        await handleBathroomsRequest({ ...input, lon: "-73.985" })
        throw new Error("Expected timeout")
      } catch (error) {
        assert(error instanceof RequestError && error.status === 504, "No stored rows must retain the explicit 504")
      }
    } finally {
      AbortSignal.timeout = timeout
      globalThis.fetch = providerFetch
    }
    databaseRows = [stored]
    failDatabase = true
    try {
      await handleBathroomsRequest(input)
      throw new Error("Expected database failure")
    } catch (error) {
      assert(error instanceof RequestError && error.message === "Restroom database search failed.", "Do not hide database errors")
    }
    failDatabase = false
    failOverpass = false
    const recovered: Result = await (await handleBathroomsRequest({ ...input, lon: "-73.98" })).json()
    assert(recovered.count === 3 && recovered.warning === undefined, "Do not cache partial results; retry upstream and clear warning on recovery")
    fuelRows = [{
      osm_identity: "node/456", latitude: 40.75, longitude: -73.99,
      tags: { amenity: "fuel", name: " Imported station ", toilets: " YES " },
    }]
    const withFuel: Result = await (await handleBathroomsRequest(input)).json()
    assert(withFuel.count === 3, "Imported and upstream gas stations must deduplicate by OSM identity")
    assert(withFuel.data.find(place => place.id === 456)?.name === "Imported station", "Use normalized stored fuel fields")
    databaseRows = []
    failOverpass = true
    const fuelOnly: Result = await (await handleBathroomsRequest({ ...input, lon: "-73.986" })).json()
    assert(fuelOnly.count === 1 && fuelOnly.data[0].toilets === "yes", "Imported stations remain available during Overpass outages")
    assert(fuelOnly.warning?.includes("imported gas stations"), "Warning must not claim imported stations failed to load")
    const shopsFuel: Result = await (await handleOverpassRequest({ ...input, lon: "-73.986", mode: "shops" })).json()
    assert(shopsFuel.count === 1 && shopsFuel.data[0].placeType === "gas-station", "Shops mode also includes imported stations")
  } finally {
    globalThis.fetch = originalFetch
    keys.forEach((key, index) => {
      const value = originalEnv[index]
      if (value === undefined) Deno.env.delete(key)
      else Deno.env.set(key, value)
    })
  }
})
