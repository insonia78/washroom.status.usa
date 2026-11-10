import { assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert";
import { searchNearbyPlaces } from "./search.ts";
import { findNearbyRefugeRestrooms } from "./refuge.ts";
import { findNearbyRestrooms } from "./restrooms.ts";

Deno.test("search starts all four sources together and registers only nearest 200 results", async () => {
  const originalFetch = globalThis.fetch;
  const keys = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const previous = keys.map(key => Deno.env.get(key));
  Deno.env.set(keys[0], "https://project.example");
  Deno.env.set(keys[1], "test-key");
  const releases: Array<() => void> = [];
  let registered: unknown[] = [];
  let sourceCalls = 0;
  let dense = true;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/rest/v1/review_locations") {
      registered = JSON.parse(String(init?.body));
      return new Response(null, {status: 201});
    }
    if (url.pathname.startsWith("/storage/")) return new Response(null, {status: 201});
    sourceCalls++;
    await new Promise<void>(resolve => releases.push(resolve));
    if (url.pathname.endsWith("/find_nearby_restrooms")) {
      const body = JSON.parse(String(init?.body));
      assertEquals(body.result_limit, 201);
      return Response.json(Array.from({length: dense ? 201 : 2}, (_, i) => ({
        osm_type: "node", osm_id: i + 1, name: `Restroom ${i}`,
        latitude: (201 - i) / 100_000, longitude: 0,
      })));
    }
    return Response.json([]);
  };
  try {
    const run = searchNearbyPlaces({latitude: 0, longitude: 0, source: "coordinates"}, "1000");
    assertEquals(sourceCalls, 4, "Sources start without waiting for one another");
    releases.splice(0).forEach(release => release());
    const result = await run;
    assertEquals(result.data.length, 200);
    assertEquals(result.data[0].id, 201, "Nearest, not first database ID");
    assertEquals(result.data.at(-1)?.id, 2);
    assertEquals(registered.length, 200, "Do not register discarded rows");
    assertStringIncludes(result.warning ?? "", "nearest 200");
    dense = false;
    const small = searchNearbyPlaces({latitude: 0, longitude: 0, source: "coordinates"}, "1000");
    releases.splice(0).forEach(release => release());
    assertEquals((await small).warning, undefined, "No truncation warning for a complete search");
    globalThis.fetch = async () => Response.json(Array.from({length: 202}, () => ({})));
    await assertRejects(() => findNearbyRestrooms(0, 0, 1000), Error, "database search failed");
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, i) => {
      if (previous[i] === undefined) Deno.env.delete(key);
      else Deno.env.set(key, previous[i]!);
    });
  }
});

Deno.test("Refuge pagination stops after at most three pages and 201 candidates", async () => {
  const originalFetch = globalThis.fetch;
  let pages = 0;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.hostname !== "www.refugerestrooms.org") return new Response(null, {status: 201});
    pages++;
    return Response.json(Array.from({length: 100}, (_, i) => ({
      id: pages * 100 + i, name: "Refuge", latitude: 0, longitude: 0,
      accessible: true, unisex: true, changing_table: false,
      created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
      directions: null, distance: 0,
    })));
  };
  try {
    assertEquals((await findNearbyRefugeRestrooms(0, 0, 1000)).length, 201);
    assertEquals(pages, 3, "Full pages cannot cause unlimited provider requests");
  } finally {globalThis.fetch = originalFetch;}
});
