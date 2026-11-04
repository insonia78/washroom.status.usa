import api from "./index.ts";
import { buildGatewayHeaders } from "../_shared/gateway-auth.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("administrator notification queues count pending actionable work", async () => {
  const config = {
    GATEWAY_INTERNAL_SECRET: "test-secret",
    SUPABASE_URL: "https://project.example",
    SUPABASE_ANON_KEY: "test-anon",
    SUPABASE_SERVICE_ROLE_KEY: "test-service",
  };
  const previous = new Map(Object.keys(config).map(key => [key, Deno.env.get(key)]));
  const originalFetch = globalThis.fetch;
  for (const [key, value] of Object.entries(config)) Deno.env.set(key, value);
  const adminId = "10000000-0000-4000-8000-000000000001";
  const headers = { ...buildGatewayHeaders(config.GATEWAY_INTERNAL_SECRET), Authorization: "Bearer test-user-token" };
  try {
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      if (url.pathname === "/auth/v1/user") return Response.json({ id: adminId, email_confirmed_at: "2026-01-01" });
      if (url.pathname === "/rest/v1/owner_response_admins") return Response.json([{ user_id: adminId }]);
      if (url.pathname === "/rest/v1/reviews") {
        assert(url.searchParams.get("status") === "eq.pending" && url.searchParams.get("archived_at") === "is.null",
          "Count only active reviews awaiting moderation");
        return Response.json([], { headers: { "content-range": "*/4" } });
      }
      if (url.pathname === "/rest/v1/owner_replies") {
        assert(url.searchParams.get("status") === "eq.moderated" && url.searchParams.get("archived_at") === "is.null",
          "Count only active owner replies awaiting final admin review");
        return Response.json([], { headers: { "content-range": "*/3" } });
      }
      if (url.pathname === "/rest/v1/toilet_submissions") {
        assert(url.searchParams.get("status") === "eq.approved" &&
          url.searchParams.get("published_at") === "is.null" && url.searchParams.get("archived_at") === "is.null",
        "Count active approved toilet submissions awaiting publication");
        return Response.json([], { headers: { "content-range": "*/2" } });
      }
      throw new Error(`Unexpected upstream request: ${url.pathname}`);
    };

    const reviews = await api.fetch(new Request("https://project.example/frontend-api/admin/reviews?moderation=pending", { headers }));
    const reviewResult = await reviews.json();
    assert(reviews.status === 200 && reviewResult.total === 4, "Return the pending review count");

    const replies = await api.fetch(new Request("https://project.example/frontend-api/admin/owner-replies?awaiting_admin=1", { headers }));
    const replyResult = await replies.json();
    assert(replies.status === 200 && replyResult.total === 3, "Return the owner reply count");

    const toilets = await api.fetch(new Request("https://project.example/frontend-api/admin/toilets?moderation=awaiting_admin", { headers }));
    const toiletResult = await toilets.json();
    assert(toilets.status === 200 && toiletResult.total === 2, "Return the toilet publication count");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
});
