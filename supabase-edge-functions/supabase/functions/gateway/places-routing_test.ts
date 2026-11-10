import placesApi from "../places-api/index.ts";
import { testIpSecret, withTestClientIp } from "./test-ip-helpers.ts";

Deno.test("gateway forwards public place requests with internal authorization to Places API", async () => {
  const config = {
    PLACES_API_URL: "https://project.example/functions/v1/places-api",
    GATEWAY_INTERNAL_SECRET: "test-gateway-secret",
    GATEWAY_IP_SIGNING_SECRET: testIpSecret,
    UPSTASH_REDIS_REST_URL: "https://redis.example",
    UPSTASH_REDIS_REST_TOKEN: "test-token",
    SUPABASE_URL: "https://project.example",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  };
  const originalEnv = new Map(
    Object.keys(config).map((key) => [key, Deno.env.get(key)]),
  );
  const originalFetch = globalThis.fetch;
  let placesCalls = 0;
  let databaseCalls = 0;

  for (const [key, value] of Object.entries(config)) {
    Deno.env.set(key, value);
  }

  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname === "redis.example") {
      return Response.json({ result: [1, 199, 60] });
    }
    if (["/rest/v1/rpc/find_nearby_fuel", "/rest/v1/rpc/find_nearby_supermarkets"].includes(url.pathname)) {
      return Response.json([]);
    }
    if (url.pathname === "/rest/v1/review_locations" || url.pathname.startsWith("/storage/v1/object/")) {
      return new Response(null, { status: 201 });
    }
    if (url.hostname === "www.refugerestrooms.org") return Response.json([]);
    if (url.pathname === "/functions/v1/places-api/bathrooms") {
      placesCalls += 1;
      if (
        request.headers.get("x-washroom-gateway-caller") !== "washroom-gateway" ||
        request.headers.get("x-washroom-gateway-secret") !== config.GATEWAY_INTERNAL_SECRET ||
        request.headers.get("apikey") !== "test-publishable-key"
      ) {
        throw new Error("Gateway must forward the API key and internal authorization.");
      }
      if (request.method === "GET" && url.searchParams.get("lat") !== "39.9526") {
        throw new Error("Gateway must preserve search query parameters.");
      }
      return await placesApi.fetch(request);
    }
    if (url.pathname === "/rest/v1/restrooms") {
      databaseCalls += 1;
      if (!url.searchParams.get("select")?.split(",").includes("opening_hours")) {
        throw new Error("Places API must load opening hours for the map filters.");
      }
      return Response.json([{
        osm_type: "way",
        osm_id: 123,
        name: "Gateway restroom",
        latitude: 39.9526,
        longitude: -75.1652,
        wheelchair: "yes",
        fee: "no",
        opening_hours: "24/7",
        changing_table: null,
        unisex: null,
      }]);
    }
    throw new Error(`Unexpected upstream request: ${url.pathname}`);
  };

  try {
    const { default: rawGateway } = await import("./index.ts");
    const gateway = withTestClientIp(rawGateway);
    for (const method of ["GET", "POST"]) {
      const url = new URL("https://project.example/functions/v1/gateway/places/bathrooms");
      const input = { lat: "39.9526", lon: "-75.1652", radius: "1000" };
      if (method === "GET") url.search = new URLSearchParams(input).toString();
      const response = await gateway.fetch(new Request(url, {
        method,
        headers: { apikey: "test-publishable-key", "Content-Type": "application/json" },
        body: method === "POST" ? JSON.stringify(input) : undefined,
      }));
      const result = await response.json();
      if (
        response.status !== 200 || result.success !== true ||
        result.count !== 1 || result.data[0]?.osmType !== "way" ||
        result.data[0]?.openingHours !== "24/7"
      ) {
        throw new Error("Expected Places API results to pass back through the gateway.");
      }
    }
    const directResponse = await placesApi.fetch(
      new Request(config.PLACES_API_URL + "/bathrooms?lat=39.9526&lon=-75.1652"),
    );
    if (directResponse.status !== 403 || placesCalls !== 2 || databaseCalls !== 2) {
      throw new Error("Only gateway requests should reach the Places API database search.");
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of originalEnv) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
});
