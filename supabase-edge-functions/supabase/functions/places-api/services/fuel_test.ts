import { findNearbyFuel, normalizeFuelPlace } from "./fuel.ts"
import { RequestError } from "../utils/errors.ts"

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

const row = {
  osm_identity: " way/123 ", latitude: 0, longitude: 0,
  tags: { amenity: " FUEL ", name: " ", brand: " Esso ", toilets: " TRUE ",
    "toilets:wheelchair": " YES ", "toilets:access": " CUSTOMERS ",
    "toilets:opening_hours": " 08:00-18:00 ", opening_hours: "24/7",
    "toilets:unisex": " 1 " },
}

Deno.test("fuel normalization preserves identities and honest restroom metadata", () => {
  const place = normalizeFuelPlace(row)
  assert(place.id === 123 && place.osmType === "way" && place.placeType === "gas-station", "Normalize OSM identity")
  assert(place.coordinates.latitude === 0 && place.coordinates.longitude === 0, "Keep valid zero coordinates")
  assert(place.name === "Esso" && place.toilets === "yes" && place.wheelchair === "yes", "Trim values and normalize boolean tags")
  assert(place.access === "customers" && place.openingHours === "08:00-18:00" && place.unisex === "yes", "Prefer restroom-specific metadata")
  assert(place.fee === "unknown", "Do not assume free access")
  const unknown = normalizeFuelPlace({ ...row, tags: { amenity: "fuel", operator: " Operator ", wheelchair: "yes", fee: "no" } })
  assert(unknown.name === "Operator" && unknown.toilets === "unknown" && unknown.wheelchair === "unknown", "Do not imply toilets from business facilities")
  assert(normalizeFuelPlace({ ...row, tags: { amenity: "fuel", toilets: " NO " } }).toilets === "no", "Preserve absence of toilets")
  for (const invalid of [
    null, { ...row, osm_identity: "123" }, { ...row, osm_identity: "node/9007199254740992" },
    { ...row, latitude: 91 }, { ...row, longitude: "0" }, { ...row, tags: { amenity: "fuel", toilets: true } },
    { ...row, tags: { amenity: "parking" } },
  ]) {
    let failed = false
    try { normalizeFuelPlace(invalid) } catch { failed = true }
    assert(failed, "Malformed stored data must fail explicitly")
  }
})

Deno.test("fuel RPC bounds candidates, deduplicates, and fails explicitly on malformed results", async () => {
  const originalFetch = globalThis.fetch
  const url = Deno.env.get("SUPABASE_URL")
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  Deno.env.set("SUPABASE_URL", "https://project.example")
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-secret")
  try {
    let calls = 0
    globalThis.fetch = (input, init) => {
      assert(String(input) === "https://project.example/rest/v1/rpc/find_nearby_businesses", "Use bounded internal database RPC")
      assert(init?.method === "POST" && init.signal instanceof AbortSignal, "Bound RPC with timeout")
      const body = JSON.parse(String(init.body))
      assert(body.search_latitude === 40 && body.search_longitude === -83 && body.radius_meters === 1609.344, "Use requested origin and exact radius")
      assert(body.result_limit === 201 && body.business_kind === "fuel", "Bound source candidates")
      calls++
      return Promise.resolve(Response.json([row, row, { ...row, osm_identity: "node/456" }]))
    }
    assert((await findNearbyFuel(40, -83, 1609.344)).length === 2 && calls === 1, "Deduplicate with one bounded query")
    for (const response of [
      new Response("missing RPC", { status: 404 }),
      Response.json({}),
      Response.json(Array.from({ length: 202 }, () => row)),
      Response.json([{ ...row, osm_identity: null }]),
    ]) {
      globalThis.fetch = () => Promise.resolve(response)
      let caught: unknown
      try { await findNearbyFuel(40, -83, 1609.344) } catch (error) { caught = error }
      assert(caught instanceof RequestError && caught.status === 502, "Database failures must not become empty matches")
    }
  } finally {
    globalThis.fetch = originalFetch
    if (url === undefined) Deno.env.delete("SUPABASE_URL"); else Deno.env.set("SUPABASE_URL", url)
    if (key === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY"); else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", key)
  }
})
