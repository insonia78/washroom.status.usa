import { handleBathroomsRequest } from "./bathrooms.ts"
import { handleOverpassRequest } from "./overpass.ts"

Deno.test("place searches prefer stored restrooms and fall back to Overpass", async () => {
  const originalFetch = globalThis.fetch
  const originalSupabaseUrl = Deno.env.get("SUPABASE_URL")
  const originalServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  let databaseRows: unknown[] = [{
    osm_type: "node",
    osm_id: 123,
    name: "Stored restroom",
    latitude: 40.75,
    longitude: -73.99,
    wheelchair: "yes",
    fee: "no",
    opening_hours: "24/7",
    changing_table: null,
    unisex: null,
  }]
  let databaseCalls = 0
  let overpassCalls = 0
  const getCallCounts = () => ({ databaseCalls, overpassCalls })

  Deno.env.set("SUPABASE_URL", "https://project.example")
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === "/rest/v1/restrooms") {
      databaseCalls += 1
      return Response.json(databaseRows)
    }

    overpassCalls += 1
    return Response.json({
      elements: [{
        id: 456,
        type: "node",
        lat: 40.75,
        lon: -73.99,
        tags: { amenity: "toilets", opening_hours: "Mo-Fr 09:00-17:00" },
      }],
    })
  }

  try {
    const input = { lat: "40.75", lon: "-73.99", radius: "1000" }
    const storedResponse = await handleBathroomsRequest(input)
    const storedResult = await storedResponse.json() as {
      count: number
      data: Array<{ id: number; name: string; openingHours?: string }>
    }

    if (
      storedResult.count !== 1 ||
      storedResult.data[0]?.id !== 123 ||
      storedResult.data[0]?.name !== "Stored restroom" ||
      storedResult.data[0]?.openingHours !== "24/7" ||
      databaseCalls !== 1 ||
      overpassCalls !== 0
    ) {
      throw new Error(
        "Expected stored restroom results without an Overpass request.",
      )
    }

    databaseRows = []
    const fallbackResponse = await handleBathroomsRequest(input)
    const fallbackResult = await fallbackResponse.json() as {
      count: number
      data: Array<{ id: number; openingHours?: string }>
    }
    const fallbackCallCounts = getCallCounts()

    if (
      fallbackResult.count !== 1 ||
      fallbackResult.data[0]?.id !== 456 ||
      fallbackResult.data[0]?.openingHours !== "Mo-Fr 09:00-17:00" ||
      fallbackCallCounts.databaseCalls !== 2 ||
      fallbackCallCounts.overpassCalls !== 1
    ) {
      throw new Error(
        "Expected an Overpass request after the database search found no rows.",
      )
    }

    databaseRows = [{
      osm_type: "way",
      osm_id: 789,
      name: "Stored restroom for overpass route",
      latitude: 40.75,
      longitude: -73.99,
      wheelchair: null,
      fee: null,
      changing_table: null,
      unisex: null,
    }]
    const allModeResponse = await handleOverpassRequest({
      ...input,
      mode: "all",
    })
    const allModeResult = await allModeResponse.json() as {
      mode: string
      count: number
      data: Array<{ id: number }>
    }

    if (
      allModeResult.mode !== "all" ||
      allModeResult.count !== 1 ||
      allModeResult.data[0]?.id !== 789 ||
      getCallCounts().databaseCalls !== 3 ||
      getCallCounts().overpassCalls !== 1
    ) {
      throw new Error(
        "Expected the all-mode route to return a stored restroom without Overpass.",
      )
    }

    const shopsResponse = await handleOverpassRequest({
      ...input,
      mode: "shops",
    })
    const shopsResult = await shopsResponse.json() as {
      mode: string
      count: number
      data: Array<{ id: number }>
    }

    if (
      shopsResult.mode !== "shops" ||
      shopsResult.count !== 1 ||
      shopsResult.data[0]?.id !== 456 ||
      getCallCounts().databaseCalls !== 3 ||
      getCallCounts().overpassCalls !== 2
    ) {
      throw new Error(
        "Expected shops-only mode to use Overpass without searching the restroom table.",
      )
    }
  } finally {
    globalThis.fetch = originalFetch
    if (originalSupabaseUrl === undefined) {
      Deno.env.delete("SUPABASE_URL")
    } else {
      Deno.env.set("SUPABASE_URL", originalSupabaseUrl)
    }
    if (originalServiceRoleKey === undefined) {
      Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY")
    } else {
      Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", originalServiceRoleKey)
    }
  }
})
