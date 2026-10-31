import api from "./index.ts";
import { buildGatewayHeaders } from "../_shared/gateway-auth.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("moderation requires verified allowlisted users and atomic pending decisions", async (t) => {
  const values = { GATEWAY_INTERNAL_SECRET: "test-secret", SUPABASE_URL: "https://project.example", SUPABASE_SERVICE_ROLE_KEY: "service-test", SUPABASE_ANON_KEY: "anon-test" };
  const previous = new Map(Object.keys(values).map(key => [key, Deno.env.get(key)]));
  const originalFetch = globalThis.fetch;
  for (const [key, value] of Object.entries(values)) Deno.env.set(key, value);
  const id = "11111111-1111-4111-8111-111111111111";
  const moderatorId = "22222222-2222-4222-8222-222222222222";
  const request = (body?: unknown, token = true) => new Request("https://project.example/frontend-api/moderation/reviews", {
    method: body === undefined ? "GET" : "POST",
    headers: { ...buildGatewayHeaders(values.GATEWAY_INTERNAL_SECRET), "Content-Type": "application/json", ...(token ? { Authorization: "Bearer test-session" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const authResponse = () => Response.json({ id: moderatorId, email_confirmed_at: "2026-01-01T00:00:00Z" });
  const decision = { review_id: id, decision: "approved", note: " Checked " };
  try {
    await t.step("missing and expired sessions never reach the database", async () => {
      globalThis.fetch = async () => { throw new Error("No network for missing session"); };
      assert((await api.fetch(request(undefined, false))).status === 401, "Require sign-in");
      globalThis.fetch = async input => {
        assert(new URL(String(input)).pathname === "/auth/v1/user", "Do not query database before validating token");
        return Response.json({}, { status: 401 });
      };
      assert((await api.fetch(request())).status === 401, "Reject expired session");
    });
    await t.step("unverified or non-allowlisted users cannot read or decide", async () => {
      for (const body of [undefined, decision]) {
        globalThis.fetch = async input => {
          const path = new URL(String(input)).pathname;
          if (path === "/auth/v1/user") return authResponse();
          assert(path === "/rest/v1/review_moderators", "Unauthorized users never reach reviews");
          return Response.json([]);
        };
        assert((await api.fetch(request(body))).status === 403, "Require allowlist for every request");
      }
      globalThis.fetch = async () => Response.json({ id: moderatorId });
      assert((await api.fetch(request())).status === 403, "Require verified email");
    });
    await t.step("allowlisted moderators see only the oldest pending batch", async () => {
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === "/auth/v1/user") {
          assert(new Headers(init?.headers).get("authorization") === "Bearer test-session", "Verify caller token upstream");
          return authResponse();
        }
        if (url.pathname === "/rest/v1/review_moderators") {
          assert(url.searchParams.get("user_id") === `eq.${moderatorId}`, "Use verified identity");
          return Response.json([{ user_id: moderatorId }]);
        }
        assert(url.pathname === "/rest/v1/reviews", "Expected review queue");
        assert(url.searchParams.get("status") === "eq.pending" && url.searchParams.get("limit") === "50" &&
          url.searchParams.get("order") === "created_at.asc,id.asc", "Bounded pending queue");
        assert(!url.searchParams.get("select")?.includes("*"), "Use explicit columns, never private notes");
        assert(url.searchParams.get("select")?.includes("availability") && url.searchParams.get("select")?.includes("cleanliness_status"),
          "Return every structured review answer to moderators");
        assert(!url.searchParams.has("osm_type"), "Moderation includes every listing source");
        return Response.json([{ id, osm_type: "refuge", osm_id: 123, photo_paths: [] }]);
      };
      const response = await api.fetch(request());
      const result = await response.json();
      assert(response.status === 200 && result.reviews[0].id === id && result.reviews[0].osm_type === "refuge", "Return pending queue for every source");
    });
    await t.step("approve and reject use server identity and atomic audited RPC", async () => {
      for (const value of ["approved", "rejected"]) {
        globalThis.fetch = async (input, init) => {
          const path = new URL(String(input)).pathname;
          if (path === "/auth/v1/user") return authResponse();
          if (path === "/rest/v1/review_moderators") return Response.json([{ user_id: moderatorId }]);
          assert(path === "/rest/v1/rpc/moderate_review" && init?.method === "POST", "Use atomic RPC, not an unaudited table update");
          const body = JSON.parse(String(init?.body));
          assert(body.p_review_id === id && body.p_moderator_id === moderatorId && body.p_decision === value &&
            body.p_note === "Checked", "Use server identity and trim private note");
          return Response.json([{ id, status: value }]);
        };
        const response = await api.fetch(request({ ...decision, decision: value, moderator_id: "forged" }));
        assert(response.status === 200 && (await response.json()).review.status === value, "Decision saved");
      }
    });
    await t.step("invalid actions and notes never invoke moderation RPC", async () => {
      globalThis.fetch = async input => {
        const path = new URL(String(input)).pathname;
        if (path === "/auth/v1/user") return authResponse();
        assert(path === "/rest/v1/review_moderators", "Invalid input must not invoke RPC");
        return Response.json([{ user_id: moderatorId }]);
      };
      for (const changes of [{ decision: "pending" }, { decision: ["approved"] }, { note: "x".repeat(2001) }, { review_id: "bad" }, { note: null }]) {
        assert((await api.fetch(request({ ...decision, ...changes }))).status === 400, "Reject invalid moderation input");
      }
    });
    await t.step("concurrent decisions produce conflict, not a second success", async () => {
      globalThis.fetch = async input => {
        const path = new URL(String(input)).pathname;
        if (path === "/auth/v1/user") return authResponse();
        if (path === "/rest/v1/review_moderators") return Response.json([{ user_id: moderatorId }]);
        return Response.json([]);
      };
      assert((await api.fetch(request(decision))).status === 409, "Already moderated or missing review cannot be overwritten");
    });
    await t.step("private moderator tables are never used by public review reads", async () => {
      globalThis.fetch = async input => {
        const url = new URL(String(input));
        if (url.pathname === "/rest/v1/rpc/approved_review_summary") return Response.json([{ review_count: 0, average: null }]);
        assert(url.pathname === "/rest/v1/reviews" && url.searchParams.get("status") === "eq.approved", "Only public approved reviews");
        assert(!url.searchParams.get("select")?.includes("note"), "No private metadata in public select");
        return Response.json([]);
      };
      const response = await api.fetch(new Request("https://project.example/frontend-api/reviews?osm_type=node&osm_id=123", {
        headers: buildGatewayHeaders(values.GATEWAY_INTERNAL_SECRET),
      }));
      assert(response.status === 200, "Public reads do not require a moderator");
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
});
