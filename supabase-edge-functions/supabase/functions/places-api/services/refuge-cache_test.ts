import { searchNearbyPlaces } from "./search.ts";
import { toRestroomPlace } from "./restroom-model.ts";

Deno.test("ETL Refuge rows preserve source identity, deduplicate live results and survive provider outages", async () => {
  const originalFetch = globalThis.fetch;
  const keys = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const previous = keys.map(key => Deno.env.get(key));
  Deno.env.set(keys[0], "https://project.example");
  Deno.env.set(keys[1], "test-only");
  const row = {
    osm_type: "refuge" as const, osm_id: 123, name: "Archived name",
    latitude: 39.95, longitude: -75.16, wheelchair: "yes", fee: "unknown",
    opening_hours: null, changing_table: "no", unisex: "yes",
  };
  let outage = false;
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "www.refugerestrooms.org") {
      if (outage) return new Response("Unavailable", { status: 503 });
      return Response.json([{
        id: 123, name: "Live name", latitude: 39.95, longitude: -75.16,
        accessible: true, unisex: true, changing_table: false,
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-02-01T00:00:00Z",
        directions: null, distance: 0,
      }]);
    }
    if (url.hostname === "project.example") {
      if (url.pathname === "/rest/v1/rpc/find_nearby_restrooms") return Response.json([row]);
      if (url.pathname.startsWith("/rest/v1/rpc/")) return Response.json([]);
      if (url.pathname === "/rest/v1/review_locations" || url.pathname.startsWith("/storage/v1/object/")) {
        return new Response(null, { status: 201 });
      }
    }
    throw new Error(`Unexpected test request: ${url.pathname}`);
  };
  try {
    if (toRestroomPlace(row).provider !== "refuge-restrooms") throw new Error("Missing provider provenance");
    const origin = { latitude: 39.95, longitude: -75.16, source: "coordinates" as const };
    const live = await searchNearbyPlaces(origin, "8046.72");
    if (live.data.length !== 1 || live.data[0].name !== "Live name") throw new Error("Archive replaced live data");
    outage = true;
    const cached = await searchNearbyPlaces(origin, "8046.72");
    if (cached.data.length !== 1 || cached.data[0].name !== "Archived name" || !cached.warning) {
      throw new Error("Archived Refuge listing unavailable during outage");
    }
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => {
      const value = previous[index];
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    });
  }
});
