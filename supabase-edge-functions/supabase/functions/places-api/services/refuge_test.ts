import { findNearbyRefugeRestrooms } from "./refuge.ts"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function restroom(id: number, createdAt: string, latitude = 0.001) {
  return {
    id,
    name: `Restroom ${id}`,
    latitude,
    longitude: 0,
    accessible: true,
    unisex: true,
    changing_table: false,
    created_at: createdAt,
    updated_at: createdAt,
    directions: null,
    distance: 0.1,
  }
}

Deno.test("Refuge Restrooms queries nearby records and orders them newest first", async () => {
  const originalFetch = globalThis.fetch
  const requestedUrls: URL[] = []
  globalThis.fetch = async input => {
    requestedUrls.push(new URL(String(input)))
    return Response.json([
      restroom(1, "2020-01-01T00:00:00.000Z"),
      restroom(2, "2024-01-01T00:00:00.000Z"),
      restroom(3, "2025-01-01T00:00:00.000Z", 0.02),
    ])
  }

  try {
    const places = await findNearbyRefugeRestrooms(0, 0, 1_000)
    assert(requestedUrls.length === 1, "Fetch one page when it covers the requested radius")
    const requestUrl = requestedUrls[0]
    assert(requestUrl.pathname === "/api/v1/restrooms/by_location", "Use the official location endpoint")
    assert(requestUrl.searchParams.get("lat") === "0", "Pass the search latitude")
    assert(requestUrl.searchParams.get("lng") === "0", "Pass the search longitude")
    assert(requestUrl.searchParams.get("per_page") === "100", "Request a full page")
    assert(places.length === 2, "Filter records to the requested radius")
    assert(places[0].id === 2 && places[1].id === 1, "Sort listings by creation date descending")
    assert(places[0].osmType === "refuge", "Keep Refuge IDs distinct from OpenStreetMap IDs")
    assert(places[0].wheelchair === "yes" && places[0].unisex === "yes", "Map Refuge facility fields")
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test("Refuge Restrooms pagination continues until the requested radius is covered", async () => {
  const originalFetch = globalThis.fetch
  const requestedPages: string[] = []
  globalThis.fetch = async input => {
    const url = new URL(String(input))
    requestedPages.push(url.searchParams.get("page") ?? "")
    return Response.json(url.searchParams.get("page") === "1"
      ? Array.from({ length: 100 }, (_, index) => restroom(index + 1, "2024-01-01T00:00:00.000Z"))
      : [restroom(101, "2024-01-01T00:00:00.000Z", 0.02)])
  }

  try {
    const places = await findNearbyRefugeRestrooms(0, 0, 1_000)
    assert(requestedPages.join(",") === "1,2", "Fetch subsequent pages when the first page is full")
    assert(places.length === 100, "Do not include records outside the requested radius")
  } finally {
    globalThis.fetch = originalFetch
  }
})
