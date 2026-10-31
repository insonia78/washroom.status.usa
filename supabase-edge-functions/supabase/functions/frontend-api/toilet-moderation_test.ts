import api from "./index.ts";
import { buildGatewayHeaders } from "../_shared/gateway-auth.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
Deno.test("toilet moderation protects exact coordinates and decisions with the moderator allowlist", async () => {
  const config = { GATEWAY_INTERNAL_SECRET: "test-secret", SUPABASE_URL: "https://project.example", SUPABASE_SERVICE_ROLE_KEY: "service", SUPABASE_ANON_KEY: "anon" };
  const previous = new Map(Object.keys(config).map(key => [key, Deno.env.get(key)]));
  const originalFetch = globalThis.fetch;
  for (const [key, value] of Object.entries(config)) Deno.env.set(key, value);
  const id = "20000000-0000-4000-8000-000000000001";
  const userId = "10000000-0000-4000-8000-000000000001";
  const request = (body?: unknown) => new Request("https://project.example/frontend-api/moderation/toilets", {
    method: body === undefined ? "GET" : "POST",
    headers: { ...buildGatewayHeaders(config.GATEWAY_INTERNAL_SECRET), Authorization: "Bearer moderator-token" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let allowed = true;
  let conflict = false;
  try {
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith("/rest/v1/")) {
        const name = init?.method === "POST" ? "Content-Profile" : "Accept-Profile";
        assert(new Headers(init?.headers).get(name) === "app_locations", "Moderation and RPCs use location schema");
      }
      if (url.pathname === "/auth/v1/user") return Response.json({ id: userId, email_confirmed_at: "2026-01-01" });
      if (url.pathname === "/rest/v1/review_moderators") return Response.json(allowed ? [{ user_id: userId }] : []);
      if (url.pathname === "/rest/v1/toilet_submissions") {
        assert(url.searchParams.get("status") === "eq.pending", "Only pending");
        assert(!url.searchParams.get("select")?.includes("user_id"), "Do not expose contributor identity");
        return Response.json([{ id, latitude: 40.7128123, longitude: -74.0060123, photo_paths: [] }]);
      }
      assert(url.pathname === "/rest/v1/rpc/moderate_toilet_submission", "Only approved moderation RPC");
      const payload = JSON.parse(String(init?.body));
      assert(payload.p_moderator_id === userId && payload.p_id === id, "Use verified moderator, not client identity");
      return Response.json(conflict ? [] : [{ id, status: payload.p_decision }]);
    };
    const listing = await api.fetch(request());
    const data = await listing.json();
    assert(listing.status === 200 && data.submissions[0].latitude === 40.7128123 && data.submissions[0].longitude === -74.0060123, "Preserve exact GPS precision");
    for (const decision of ["approved", "rejected"]) {
      const response = await api.fetch(request({ id, decision, moderator_id: "forged" }));
      assert(response.status === 200 && (await response.json()).submission.status === decision, "Confirm saved decisions");
    }
    conflict = true;
    assert((await api.fetch(request({ id, decision: "approved" }))).status === 409, "Protect concurrent moderator decisions");
    assert((await api.fetch(request({ id, decision: "pending" }))).status === 400, "Reject invalid decisions");
    allowed = false;
    assert((await api.fetch(request())).status === 403, "Hide locations from non-moderators");
    assert((await api.fetch(request({ id, decision: "approved" }))).status === 403, "Block non-moderator decisions");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
});
