import api from "../frontend-api/index.ts";

Deno.test("gateway routes frontend API calls with internal authorization and strips the service prefix", async () => {
  const config = {
    FRONTEND_API_URL: "https://project.example/functions/v1/frontend-api",
    GATEWAY_INTERNAL_SECRET: "test-gateway-secret",
    SUPABASE_URL: "https://project.example",
    SUPABASE_ANON_KEY: "test-anon",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
  };
  const previous = new Map(Object.keys(config).map(key => [key, Deno.env.get(key)]));
  const originalFetch = globalThis.fetch;
  let forwarded = 0;
  for (const [key, value] of Object.entries(config)) Deno.env.set(key, value);
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    if (url.pathname.startsWith("/functions/v1/frontend-api/")) {
      forwarded++;
      if (req.headers.get("x-washroom-gateway-secret") !== config.GATEWAY_INTERNAL_SECRET) {
        throw new Error("Missing internal authorization");
      }
      return await api.fetch(req);
    }
    if (url.pathname === "/rest/v1/reviews") return Response.json([]);
    if (url.pathname === "/auth/v1/otp") return Response.json({ sent: true });
    if (url.hostname === "photon.komoot.io") return Response.json({ features: [{ geometry: { type: "Point", coordinates: [-71.06, 42.36] }, properties: { countrycode: "US" } }] });
    throw new Error(`Unexpected URL ${url}`);
  };
  try {
    const { default: gateway } = await import("./index.ts");
    for (const [path, method] of [
      ["/reviews?osm_type=node&osm_id=123", "GET"], ["/auth/v1/otp", "POST"], ["/geocode?q=Boston", "GET"],
    ]) {
      const response = await gateway.fetch(new Request(`https://project.example/functions/v1/gateway/frontend${path}`, {
        method, headers: { "Content-Type": "application/json" },
        body: method === "POST" ? JSON.stringify({ email: "test@example.com" }) : undefined,
      }));
      if (response.status !== 200) throw new Error(`Gateway failed ${path}: ${await response.text()}`);
    }
    if (forwarded !== 3) throw new Error("All three calls must pass through the gateway");
    const blocked = await gateway.fetch(new Request("https://project.example/functions/v1/gateway/frontend/auth/v1/admin"));
    if (blocked.status !== 404 || forwarded !== 3) throw new Error("Unlisted auth endpoints must not forward");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
});
