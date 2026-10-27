import api from "./index.ts";
import { buildGatewayHeaders } from "../_shared/gateway-auth.ts";
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

Deno.test("owner responses require separate admin access and explicit publication", async t => {
  const env = { GATEWAY_INTERNAL_SECRET: "test-secret", SUPABASE_URL: "https://project.example", SUPABASE_ANON_KEY: "anon-test", SUPABASE_SERVICE_ROLE_KEY: "service-test" };
  const previous = new Map(Object.keys(env).map(key => [key, Deno.env.get(key)]));
  const originalFetch = globalThis.fetch;
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  const adminId = "11111111-1111-4111-8111-111111111111";
  const responseId = "22222222-2222-4222-8222-222222222222";
  const reviewId = "33333333-3333-4333-8333-333333333333";
  const fields = { osm_type: "refuge", osm_id: 123, review_id: null, business_name: " Test business ", body: " Cleaned and restocked ",
    completed_on: "2026-01-01", evidence_url: "https://business.example/improvements", verification_note: " Verified owner offline " };
  const request = (body?: unknown, token = true, path = "/admin/owner-responses") => new Request(`https://project.example/frontend-api${path}`, {
    method: body === undefined ? "GET" : "POST", headers: { ...buildGatewayHeaders(env.GATEWAY_INTERNAL_SECRET),
      "Content-Type": "application/json", ...(token ? { Authorization: "Bearer user-test" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const authorized = (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/user") return Response.json({ id: adminId, email_confirmed_at: "2026-01-01T00:00:00Z" });
    if (url.pathname === "/rest/v1/owner_response_admins") {
      assert(url.searchParams.get("user_id") === `eq.${adminId}`, "Use verified session identity");
      return Response.json([{ user_id: adminId }]);
    }
    return null;
  };
  try {
    await t.step("missing, expired, unverified and moderator-only sessions cannot enter", async () => {
      for (const body of [undefined, { action: "publish", id: responseId, version: 1 }]) {
        globalThis.fetch = async () => { throw new Error("Missing session must not call upstream"); };
        assert((await api.fetch(request(body, false))).status === 401, "Require a session on reads and writes");
        globalThis.fetch = async () => Response.json({}, { status: 401 });
        assert((await api.fetch(request(body))).status === 401, "Reject expired sessions");
        globalThis.fetch = async () => Response.json({ id: adminId });
        assert((await api.fetch(request(body))).status === 403, "Require verified email");
        globalThis.fetch = async input => {
          const path = new URL(String(input)).pathname;
          if (path === "/auth/v1/user") return Response.json({ id: adminId, email_confirmed_at: "2026-01-01" });
          assert(path === "/rest/v1/owner_response_admins", "Moderator membership must not grant admin access");
          return Response.json([]);
        };
        assert((await api.fetch(request(body))).status === 403, "Reject accounts outside the separate allowlist");
      }
    });
    await t.step("admin lists are bounded and use explicit private columns", async () => {
      globalThis.fetch = async input => {
        const auth = authorized(input); if (auth) return auth;
        const url = new URL(String(input));
        assert(url.pathname === "/rest/v1/owner_responses", "Only query owner responses after authorization");
        assert(url.searchParams.get("select")?.includes("verification_note"), "Admins can inspect verification notes");
        assert(url.searchParams.get("limit") === "50" && url.searchParams.get("offset") === "50", "Bound and paginate dashboard");
        assert(!url.searchParams.has("status"), "Include drafts and published responses");
        return Response.json([]);
      };
      assert((await api.fetch(request(undefined, true, "/admin/owner-responses?offset=50"))).status === 200, "Admin list works");
    });
    await t.step("drafts preserve all details and ignore forged actor/status", async () => {
      globalThis.fetch = async (input, init) => {
        const auth = authorized(input); if (auth) return auth;
        assert(new URL(String(input)).pathname === "/rest/v1/rpc/save_owner_response", "Use transactional response RPC");
        const payload = JSON.parse(String(init?.body));
        assert(payload.p_admin_id === adminId && payload.p_action === "save" && payload.p_id === null, "Use verified admin identity and draft action");
        assert(payload.p_fields.business_name === "Test business" && payload.p_fields.verification_note === "Verified owner offline", "Trim fields");
        assert(payload.p_fields.osm_type === "refuge" && payload.p_fields.completed_on === "2026-01-01", "Preserve listing and completion date");
        assert(!("status" in payload.p_fields) && !("created_by" in payload.p_fields), "Never accept client publication or actor fields");
        return Response.json([{ id: responseId, status: "draft" }]);
      };
      const result = await api.fetch(request({ action: "save", id: null, version: null,
        fields: { ...fields, status: "published", created_by: "forged" }, admin_id: "forged" }));
      assert(result.status === 200, "Save draft");
    });
    await t.step("publish only the saved draft and pass its version", async () => {
      globalThis.fetch = async (input, init) => {
        const auth = authorized(input); if (auth) return auth;
        const payload = JSON.parse(String(init?.body));
        assert(payload.p_action === "publish" && payload.p_id === responseId && payload.p_version === 2, "Publish saved version");
        assert(payload.p_fields === null, "Unsaved edits cannot be smuggled into publication");
        return Response.json([{ id: responseId, status: "published" }]);
      };
      assert((await api.fetch(request({ action: "publish", id: responseId, version: 2, fields: { body: "forged" } }))).status === 200, "Publish draft");
    });
    await t.step("invalid actions, URLs, dates and private verification fail before RPC", async () => {
      globalThis.fetch = async input => {
        const auth = authorized(input); if (auth) return auth;
        throw new Error("Invalid input must never invoke RPC");
      };
      for (const changes of [{ body: "" }, { body: "x".repeat(4001) }, { verification_note: " " }, { osm_type: "bad" }, { osm_id: 0 },
        { review_id: "bad" }, { evidence_url: "javascript:alert(1)" }, { evidence_url: "http://example.com" },
        { evidence_url: "https://user:pass@example.com" }, { completed_on: "2026-02-30" }, { completed_on: "2999-01-01" }]) {
        assert((await api.fetch(request({ action: "save", id: null, version: null, fields: { ...fields, ...changes } }))).status === 400, "Reject invalid fields");
      }
      for (const body of [{ action: "publish", id: null, version: null }, { action: "delete", id: responseId, version: 1 }, { action: "save", id: responseId, version: 0, fields }]) {
        assert((await api.fetch(request(body))).status === 400, "Reject invalid action/version");
      }
    });
    await t.step("stale drafts, invalid targets, and revoked admin access are explicit failures", async () => {
      for (const [payload, status] of [[[], 409], [{ code: "22023", message: "Reply must refer to an approved review for this restroom" }, 422],
        [{ code: "42501" }, 403], [{ code: "other" }, 503]] as const) {
        globalThis.fetch = async input => {
          const auth = authorized(input); if (auth) return auth;
          return Response.json(payload, { status: Array.isArray(payload) ? 200 : 400 });
        };
        assert((await api.fetch(request({ action: "save", id: responseId, version: 1, fields }))).status === status, "Preserve mutation failure status");
      }
    });
    await t.step("public reads require a listing and never fetch draft/private data", async () => {
      for (const type of ["node", "way", "relation", "refuge"]) {
        globalThis.fetch = async input => {
          const url = new URL(String(input));
          assert(url.pathname === "/rest/v1/owner_responses", "Public reads need no auth or private-table lookup");
          assert(url.searchParams.get("status") === "eq.published", "Exclude drafts");
          assert(url.searchParams.get("osm_type") === `eq.${type}` && url.searchParams.get("osm_id") === "eq.123", "Scope by source and ID");
          const select = url.searchParams.get("select")!;
          assert(!select.includes("*") && !select.includes("verification") && !select.includes("created_by") && !select.includes("updated_by"), "Never request private metadata");
          return Response.json([{ id: responseId, review_id: null, body: "Owner update" }]);
        };
        assert((await api.fetch(request(undefined, false, `/owner-responses?osm_type=${type}&osm_id=123`))).status === 200, "All listing sources supported");
      }
      globalThis.fetch = async () => { throw new Error("Invalid public requests must not access the database"); };
      assert((await api.fetch(request(undefined, false, "/owner-responses"))).status === 400, "No unscoped public reads");
      assert((await api.fetch(request({}, false, "/owner-responses"))).status === 405, "No public writes");
    });
    await t.step("public replies disappear when their target review is no longer approved", async () => {
      globalThis.fetch = async input => {
        const url = new URL(String(input));
        if (url.pathname === "/rest/v1/owner_responses") return Response.json([
          { id: responseId, review_id: null }, { id: "reply", review_id: reviewId },
        ]);
        assert(url.pathname === "/rest/v1/reviews" && url.searchParams.get("status") === "eq.approved", "Validate linked review is still approved");
        assert(url.searchParams.get("osm_type") === "eq.refuge", "Never link reviews across listing namespaces");
        return Response.json([]);
      };
      const response = await api.fetch(request(undefined, false, "/owner-responses?osm_type=refuge&osm_id=123"));
      const result = await response.json();
      assert(response.status === 200 && result.responses.length === 1 && result.responses[0].review_id === null, "Hide orphaned replies without hiding improvement updates");
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value);
    }
  }
});
