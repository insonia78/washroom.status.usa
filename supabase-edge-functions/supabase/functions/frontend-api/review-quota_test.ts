import api from "./index.ts";
import { buildGatewayHeaders } from "../_shared/gateway-auth.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("database-enforced daily review quota returns an explicit 429", async () => {
  const config = {
    GATEWAY_INTERNAL_SECRET: "test-secret", SUPABASE_URL: "https://project.example",
    SUPABASE_SERVICE_ROLE_KEY: "test-service", SUPABASE_ANON_KEY: "test-anon",
  };
  const previous = new Map(Object.keys(config).map(key => [key, Deno.env.get(key)]));
  const originalFetch = globalThis.fetch;
  for (const [key, value] of Object.entries(config)) Deno.env.set(key, value);
  let insertAttempted = false;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/user") {
      return Response.json({ id: "10000000-0000-4000-8000-000000000001", email_confirmed_at: "2026-01-01" });
    }
    if (url.pathname === "/rest/v1/review_locations") return Response.json([{ osm_id: 42 }]);
    if (url.pathname === "/rest/v1/reviews" && init?.method === "POST") {
      insertAttempted = true;
      return Response.json({ code: "P0001", message: "Daily review submission limit reached (3 per UTC day)" }, { status: 400 });
    }
    throw new Error(`Unexpected upstream request: ${url.pathname}`);
  };
  try {
    const response = await api.fetch(new Request("https://project.example/functions/v1/frontend-api/reviews", {
      method: "POST",
      headers: {
        ...buildGatewayHeaders(config.GATEWAY_INTERNAL_SECRET),
        "Content-Type": "application/json", Authorization: "Bearer user-token",
      },
      body: JSON.stringify({
        current_location: true, osm_type: "refuge", osm_id: 42, rating: 4,
        availability: "open", cleanliness_status: "clean", issues: [], comment: "Fine",
        user_latitude: 40.71, user_longitude: -74.0, restroom_latitude: 40.711, restroom_longitude: -74.001,
      }),
    }));
    assert(insertAttempted, "Reach the database-enforced quota");
    assert(response.status === 429, "Do not disguise quota denial as success or database outage");
    assert((await response.json()).error.includes("3 reviews per UTC day"), "Explain threshold and reset");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
});
