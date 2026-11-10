import { findNearbySupermarkets, normalizeSupermarketPlace } from "./supermarkets.ts"
import { RequestError } from "../utils/errors.ts"

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

const row = {
  osm_identity: " way/123 ", latitude: 0, longitude: 0,
  tags: {
    shop: " SUPERMARKET ", name: " ", brand: " Market ",
    toilets: " TRUE ", "toilets:wheelchair": " YES ",
    "toilets:access": " CUSTOMERS ", "toilets:fee": " 0 ",
    "toilets:opening_hours": " 08:00-18:00 ", opening_hours: "24/7",
  },
}

Deno.test("supermarket normalization keeps OSM identities and restroom-specific details", () => {
  const place = normalizeSupermarketPlace(row)
  assert(place.id === 123 && place.osmType === "way" && place.placeType === "supermarket", "Normalize OSM identity")
  assert(place.category === "supermarket" && place.name === "Market", "Identify and name the supermarket")
  assert(place.coordinates.latitude === 0 && place.coordinates.longitude === 0, "Keep zero coordinates")
  assert(place.toilets === "yes" && place.wheelchair === "yes" && place.fee === "no", "Normalize explicit restroom tags")
  assert(place.access === "customers" && place.openingHours === "08:00-18:00", "Prefer restroom-specific details")
  const unknown = normalizeSupermarketPlace({
    ...row, tags: { shop: "supermarket", wheelchair: "yes", fee: "no" },
  })
  assert(unknown.name === "Supermarket" && unknown.toilets === "unknown" &&
    unknown.wheelchair === "unknown" && unknown.fee === "unknown", "Business amenities do not prove restroom amenities")
  assert(normalizeSupermarketPlace({ ...row, tags: { shop: "supermarket", toilets: " NO " } }).toilets === "no",
    "Keep explicit absence of toilets")
  for (const invalid of [
    null, { ...row, osm_identity: "123" }, { ...row, osm_identity: "node/9007199254740992" },
    { ...row, latitude: 91 }, { ...row, longitude: "0" },
    { ...row, tags: { shop: "supermarket", toilets: true } }, { ...row, tags: { shop: "convenience" } },
  ]) {
    let failed = false
    try { normalizeSupermarketPlace(invalid) } catch { failed = true }
    assert(failed, "Malformed supermarket data must fail explicitly")
  }
})

Deno.test("supermarket RPC bounds candidates, deduplicates, and surfaces database failures", async () => {
  const originalFetch = globalThis.fetch
  const url = Deno.env.get("SUPABASE_URL")
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  Deno.env.set("SUPABASE_URL", "https://project.example")
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-secret")
  try {
    let calls = 0
    globalThis.fetch = (input, init) => {
      assert(String(input) === "https://project.example/rest/v1/rpc/find_nearby_businesses", "Use bounded business RPC")
      const headers = new Headers(init?.headers)
      assert(init?.method === "POST" && init.signal instanceof AbortSignal, "Bound RPC with a timeout")
      assert(headers.get("Content-Profile") === "app_locations" && headers.get("apikey") === "test-secret",
        "Use private-schema server credentials")
      const body = JSON.parse(String(init.body))
      assert(body.search_latitude === 40 && body.search_longitude === -83 && body.radius_meters === 1609.344,
        "Forward the exact search origin and radius")
      assert(body.result_limit === 201 && body.business_kind === "supermarket", "Bound source candidates")
      calls++
      return Promise.resolve(Response.json([row, row, { ...row, osm_identity: "node/456" }]))
    }
    assert((await findNearbySupermarkets(40, -83, 1609.344)).length === 2 && calls === 1,
      "Deduplicate results with one bounded query")
    for (const response of [
      new Response("missing RPC", { status: 404 }),
      Response.json({}),
      Response.json(Array.from({ length: 202 }, () => row)),
      Response.json([{ ...row, osm_identity: null }]),
    ]) {
      globalThis.fetch = () => Promise.resolve(response)
      let caught: unknown
      try { await findNearbySupermarkets(40, -83, 1609.344) } catch (error) { caught = error }
      assert(caught instanceof RequestError && caught.status === 502 &&
        caught.message === "Stored supermarkets could not be loaded.", "Do not turn database errors into empty results")
    }
    for (const [latitude, longitude, radius] of [[91, 0, 1], [0, -181, 1], [0, 0, -1], [0, 0, Infinity]]) {
      let caught: unknown
      try { await findNearbySupermarkets(latitude, longitude, radius) } catch (error) { caught = error }
      assert(caught instanceof RequestError && caught.status === 400, "Reject invalid search inputs")
    }
  } finally {
    globalThis.fetch = originalFetch
    if (url === undefined) Deno.env.delete("SUPABASE_URL"); else Deno.env.set("SUPABASE_URL", url)
    if (key === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY"); else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", key)
  }
})
