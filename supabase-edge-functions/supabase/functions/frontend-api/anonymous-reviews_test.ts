import api from "./index.ts";
import { buildGatewayHeaders } from "../_shared/gateway-auth.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("signed-in reviews validate radio questions and expose only approved latest comments", async (t) => {
  const values = { GATEWAY_INTERNAL_SECRET: "test-secret", SUPABASE_URL: "https://project.example", SUPABASE_SERVICE_ROLE_KEY: "test-service", SUPABASE_ANON_KEY: "test-anon" };
  const previous = new Map(Object.keys(values).map(key => [key, Deno.env.get(key)]));
  const originalFetch = globalThis.fetch;
  for (const [key, value] of Object.entries(values)) Deno.env.set(key, value);
  const request = (query: string, body?: unknown) => new Request(`https://project.example/frontend-api/reviews${query}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...buildGatewayHeaders(values.GATEWAY_INTERNAL_SECRET), "Content-Type": "application/json", ...(body === undefined ? {} : { Authorization: "Bearer user-token" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const review = { osm_type: "way", osm_id: 456, rating: 4, availability: "open", cleanliness_status: "clean", issues: [], comment: " Clean today " };
  try {
    await t.step("unsigned, expired, anonymous and unverified callers cannot submit reviews", async () => {
      const unsigned=request("",review);
      unsigned.headers.delete("authorization");
      globalThis.fetch=async()=>{throw new Error("Unsigned request must not reach upstream")};
      assert((await api.fetch(unsigned)).status===401,"Require sign-in");
      for(const identity of [
        {status:401,body:{error:"expired"}},
        {status:200,body:{id:"unverified"}},
        {status:200,body:{id:"anonymous",email_confirmed_at:"2026-01-01",is_anonymous:true}},
      ]){
        globalThis.fetch=async input=>{
          assert(new URL(String(input)).pathname==="/auth/v1/user","Unauthorized users cannot reach database");
          return Response.json(identity.body,{status:identity.status});
        };
        assert((await api.fetch(request("",review))).status===(identity.status===401?401:403),"Reject invalid identity");
      }
    });
    await t.step("signed-in submissions ignore client ownership and publication fields", async () => {
      let calls = 0;
      globalThis.fetch = async (input, init) => {
        calls++;
        const url = new URL(String(input));
        if (url.pathname === "/auth/v1/user") return Response.json({ id: "verified-user", email_confirmed_at: "2026-01-01" });
        if (url.pathname === "/rest/v1/restrooms") return Response.json([{ osm_id: 456 }]);
        assert(url.pathname === "/rest/v1/reviews" && init?.method === "POST", "Only database insertion follows location validation");
        const payload = JSON.parse(String(init?.body));
        assert(payload.user_id === "verified-user" && payload.status === "pending", "Do not trust client identity or status");
        assert(payload.availability === "open" && payload.cleanliness_status === "clean" && payload.rating === 4, "Save all radio answers");
        assert(payload.comment === "Clean today", "Trim comments");
        return new Response(null, { status: 201 });
      };
      const response = await api.fetch(request("", { ...review, status: "approved", user_id: "forged" }));
      assert(response.status === 201 && calls === 3, "Verify authentication before inserting");
    });
    await t.step("all three questions and permitted radio values are required", async () => {
      globalThis.fetch = async () => { throw new Error("Invalid payload must not reach upstream"); };
      for (const fields of [
        { availability: null }, { availability: "unknown" }, { cleanliness_status: null },
        { cleanliness_status: "dirty" }, { rating: 0 }, { rating: 6 }, { rating: 2.5 },
        { osm_type: "unknown" }, { osm_id: 0 }, { osm_id: 1.5 }, { osm_id: Number.MAX_SAFE_INTEGER + 1 },
        { comment: "x".repeat(1001) },
      ]) {
        assert((await api.fetch(request("", { ...review, ...fields }))).status === 400, "Reject invalid review");
      }
    });
    await t.step("all listed source types accept reviews without trusting client publication fields", async () => {
      for (const type of ["node", "way", "relation", "refuge"]) {
        const calls: string[] = [];
        globalThis.fetch = async (input, init) => {
          const url = new URL(String(input));
          calls.push(url.pathname);
          if (url.pathname === "/auth/v1/user") return Response.json({ id: "verified-user", email_confirmed_at: "2026-01-01" });
          if (url.pathname === "/rest/v1/restrooms") return Response.json([]);
          if (url.pathname === "/rest/v1/review_locations") {
            assert(url.searchParams.get("osm_type") === `eq.${type}` && url.searchParams.get("osm_id") === "eq.456", "Validate both source and ID");
            return Response.json([{ osm_id: 456 }]);
          }
          assert(url.pathname === "/rest/v1/reviews" && init?.method === "POST", "Insert only after listing verification");
          const payload = JSON.parse(String(init?.body));
          assert(payload.osm_type === type && payload.osm_id === 456, "Preserve source identity");
          assert(payload.status === "pending" && payload.user_id === "verified-user", "Preserve verified ownership and moderation");
          return new Response(null, { status: 201 });
        };
        assert((await api.fetch(request("", { ...review, osm_type: type, status: "approved" }))).status === 201, `Accept listed ${type}`);
        assert(type !== "refuge" || !calls.includes("/rest/v1/restrooms"), "Never confuse Refuge IDs with OSM IDs");
      }
    });
    await t.step("unknown, malformed and unavailable listing checks never create reviews", async () => {
      for (const type of ["node", "refuge"]) {
        for (const expected of [422, 502, 503]) {
          globalThis.fetch = async input => {
            const url = new URL(String(input));
            if (url.pathname === "/auth/v1/user") return Response.json({ id: "verified-user", email_confirmed_at: "2026-01-01" });
            if (url.pathname === "/rest/v1/restrooms") return Response.json([]);
            assert(url.pathname === "/rest/v1/review_locations", "Do not insert unverified reviews");
            if (expected === 503) return Response.json({ error: "unavailable" }, { status: 500 });
            return Response.json(expected === 502 ? {} : []);
          };
          assert((await api.fetch(request("", { ...review, osm_type: type }))).status === expected, `Preserve listing failure ${expected}`);
        }
      }
    });
    await t.step("identical Refuge and OSM IDs have separate approved feeds and grades", async () => {
      for (const type of ["node", "way", "relation", "refuge"]) {
        for (const suffix of ["", "&latest=1"]) {
          globalThis.fetch = async (input, init) => {
            const url = new URL(String(input));
            if (url.pathname === "/rest/v1/rpc/approved_review_summary") {
              const payload = JSON.parse(String(init?.body));
              assert(payload.p_osm_type === type && payload.p_osm_id === 456, "Keep aggregate isolated by source");
              return Response.json([{ review_count: 1, average: 4 }]);
            }
            assert(url.searchParams.get("osm_type") === `eq.${type}` && url.searchParams.get("osm_id") === "eq.456", "Keep feed isolated by source");
            assert(url.searchParams.get("status") === "eq.approved", "Only approved reviews");
            return Response.json([{ id: type, rating: 4, comment: type }]);
          };
          const response = await api.fetch(request(`?osm_type=${type}&osm_id=456${suffix}`));
          const body = await response.json();
          assert(response.status === 200 && body.reviews[0].id === type && body.average === 4, "Read reviews for every listing source");
        }
      }
    });
    await t.step("an existing OSM ID cannot authorize an unlisted Refuge ID", async () => {
      globalThis.fetch = async input => {
        const url = new URL(String(input));
        if (url.pathname === "/auth/v1/user") return Response.json({ id: "verified-user", email_confirmed_at: "2026-01-01" });
        assert(url.pathname === "/rest/v1/review_locations" && url.searchParams.get("osm_type") === "eq.refuge",
          "Refuge validation must not consult the OSM table or insert a review");
        return Response.json([]);
      };
      assert((await api.fetch(request("", { ...review, osm_type: "refuge" }))).status === 422, "Reject source collisions");
    });
    await t.step("latest comment query sorts by timestamp and excludes empty and unapproved comments", async () => {
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === "/rest/v1/rpc/approved_review_summary") {
          const parameters = JSON.parse(String(init?.body));
          assert(parameters.p_osm_type === "way" && parameters.p_osm_id === 456, "Scope grade to selected restroom");
          return Response.json([{ review_count: 102, average: 3.5 }]);
        }
        assert(url.searchParams.get("osm_type") === "eq.way" && url.searchParams.get("osm_id") === "eq.456", "Keep restroom identity");
        assert(url.searchParams.get("status") === "eq.approved", "Never expose pending comments");
        assert(url.searchParams.get("limit") === "1" && url.searchParams.get("comment") === "neq.", "Only latest non-empty comment");
        assert(url.searchParams.get("order") === "created_at.desc,id.desc", "Newest first, stable tie-breaker");
        return Response.json([{ id: "latest", rating: 4, comment: "Clean today", created_at: "2026-10-26T18:00:00Z" }]);
      };
      const response = await api.fetch(request("?osm_type=way&osm_id=456&latest=1"));
      const result = await response.json();
      assert(response.status === 200 && result.reviews[0].id === "latest" && result.limited_to === 1, "Return newest comment");
      assert(result.review_count === 102 && result.average === 3.5, "Grade uses all approved reviews, not only the newest comment or latest fifty");
      globalThis.fetch = async input => new URL(String(input)).pathname.includes("/rpc/") ?
        Response.json([{ review_count: 0, average: null }]) : Response.json([]);
      const empty = await api.fetch(request("?osm_type=way&osm_id=456&latest=1"));
      assert((await empty.json()).reviews.length === 0, "No comments stays an empty result");
      assert((await api.fetch(request("?osm_type=way&osm_id=456&latest=bad"))).status === 400, "Reject invalid latest query");
    });
    await t.step("invalid grade summaries remain explicit errors", async () => {
      for (const summary of [[], [{ review_count: -1, average: null }], [{ review_count: 0, average: 0 }], [{ review_count: 2, average: 6 }]]) {
        globalThis.fetch = async input => Response.json(new URL(String(input)).pathname.includes("/rpc/") ? summary : []);
        assert((await api.fetch(request("?osm_type=way&osm_id=456&latest=1"))).status === 502, "Reject malformed grade summary");
      }
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
});
