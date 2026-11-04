import api from "./index.ts";
import { buildGatewayHeaders } from "../_shared/gateway-auth.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("owner review cards include verified listing coordinates for a read-only map", async () => {
  const config = {
    GATEWAY_INTERNAL_SECRET: "test-secret",
    SUPABASE_URL: "https://project.example",
    SUPABASE_ANON_KEY: "test-anon",
    SUPABASE_SERVICE_ROLE_KEY: "test-service",
  };
  const previous = new Map(Object.keys(config).map(key => [key, Deno.env.get(key)]));
  const originalFetch = globalThis.fetch;
  for (const [key, value] of Object.entries(config)) Deno.env.set(key, value);
  const ownerId = "10000000-0000-4000-8000-000000000001";
  const inviteId = "20000000-0000-4000-8000-000000000001";
  const reviewId = "30000000-0000-4000-8000-000000000001";
  const headers = { ...buildGatewayHeaders(config.GATEWAY_INTERNAL_SECRET), Authorization: "Bearer owner-token" };
  try {
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      if (url.pathname === "/auth/v1/user") {
        return Response.json({ id: ownerId, email: "owner@example.test", email_confirmed_at: "2026-01-01" });
      }
      if (url.pathname === "/rest/v1/owner_invites") {
        assert(url.searchParams.get("email") === "eq.owner@example.test", "Only use invitations for the verified owner email");
        return Response.json([{ id: inviteId, review_id: reviewId }]);
      }
      if (url.pathname === "/rest/v1/reviews") {
        return Response.json([{
          id: reviewId, osm_type: "node", osm_id: 123, restroom_name: "Business restroom",
          rating: 2, availability: "closed", cleanliness_status: "dirty", issues: ["broken_lock"],
          comment: "The lock is broken.", status: "approved", created_at: "2026-11-03T00:00:00Z",
          photo_paths: [],
        }]);
      }
      if (url.pathname === "/rest/v1/review_locations") {
        assert(url.searchParams.get("osm_id") === "in.(123)", "Look up coordinates for only invited review listings");
        return Response.json([{ osm_type: "node", osm_id: 123, latitude: 40.71, longitude: -74 }]);
      }
      if (url.pathname === "/rest/v1/owner_replies" || url.pathname === "/rest/v1/owner_review_photos") {
        return Response.json([]);
      }
      if (url.pathname === "/rest/v1/restrooms") return Response.json([]);
      throw new Error(`Unexpected upstream request: ${url.pathname}`);
    };
    const response = await api.fetch(new Request("https://project.example/frontend-api/owner/reviews", { headers }));
    const result = await response.json();
    assert(response.status === 200 && result.items.length === 1 &&
      result.items[0].review.latitude === 40.71 && result.items[0].review.longitude === -74,
    "Return verified coordinates with the invited complaint for the owner map");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
});
