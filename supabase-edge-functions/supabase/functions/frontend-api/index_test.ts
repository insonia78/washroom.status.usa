import api from "./index.ts";
import { buildGatewayHeaders } from "../_shared/gateway-auth.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("internal frontend API preserves reviews, magic-link auth and location lookups", async (t) => {
  const values = {
    GATEWAY_INTERNAL_SECRET: "test-secret",
    SUPABASE_URL: "https://project.example",
    SUPABASE_ANON_KEY: "test-anon",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
  };
  const previous = new Map(Object.keys(values).map(key => [key, Deno.env.get(key)]));
  const originalFetch = globalThis.fetch;
  for (const [key, value] of Object.entries(values)) Deno.env.set(key, value);
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers({ ...buildGatewayHeaders(values.GATEWAY_INTERNAL_SECRET), "Content-Type": "application/json" });
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    return new Request(`https://project.example/functions/v1/frontend-api${path}`, { ...init, headers });
  };
  const review = { osm_type: "node", osm_id: 123, rating: 4, issues: ["odor"], comment: " Needs cleaning " };

  try {
    await t.step("direct callers and bad internal secrets cannot reach upstreams", async () => {
      globalThis.fetch = async () => { throw new Error("Must not call upstream"); };
      assert((await api.fetch(new Request("https://project.example/frontend-api/reviews"))).status === 403, "Direct access must be denied");
      assert((await api.fetch(request("/reviews", { headers: { "x-washroom-gateway-secret": "wrong" } }))).status === 403, "Bad secret must be denied");
    });

    await t.step("reviews return only approved rows, limited to fifty with the same average", async () => {
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        assert(url.pathname === "/rest/v1/reviews", "Expected reviews database");
        assert(url.searchParams.get("status") === "eq.approved" && url.searchParams.get("limit") === "50", "Preserve moderation and result limit");
        assert(new Headers(init?.headers).get("apikey") === values.SUPABASE_SERVICE_ROLE_KEY, "Service role stays in backend");
        return Response.json([{ id: "a", rating: 4 }, { id: "b", rating: 2 }]);
      };
      const response = await api.fetch(request("/reviews?osm_type=node&osm_id=123"));
      const result = await response.json();
      assert(response.status === 200 && result.count === 2 && result.average === 3 && result.limited_to === 50, "Reviews shape must be preserved");
    });

    await t.step("writes validate session, imported location and moderation before insertion", async () => {
      const calls: string[] = [];
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        calls.push(url.pathname);
        if (url.pathname === "/auth/v1/user") {
          assert(new Headers(init?.headers).get("authorization") === "Bearer user-token", "Validate original user's session");
          return Response.json({ id: "user-id" });
        }
        if (url.pathname === "/rest/v1/restrooms") return Response.json([{ osm_id: 123 }]);
        assert(url.pathname === "/rest/v1/reviews" && init?.method === "POST", "Expected review insert");
        const payload = JSON.parse(String(init?.body));
        assert(payload.user_id === "user-id" && payload.status === "pending" && payload.comment === "Needs cleaning", "Preserve ownership, moderation and trimming");
        return new Response(null, { status: 201 });
      };
      const response = await api.fetch(request("/reviews", {
        method: "POST", headers: { Authorization: "Bearer user-token" }, body: JSON.stringify(review),
      }));
      assert(response.status === 201 && calls.length === 3, "Expected verified review submission");
    });

    await t.step("invalid input and missing authentication fail before network calls", async () => {
      globalThis.fetch = async () => { throw new Error("No network calls expected"); };
      assert((await api.fetch(request("/reviews?osm_type=bad&osm_id=1"))).status === 400, "Invalid restroom");
      assert((await api.fetch(request("/reviews", { method: "POST", body: "{}" }))).status === 401, "Missing session");
      for (const body of ["not JSON", JSON.stringify({ ...review, rating: 9 }), JSON.stringify({ ...review, issues: ["bad"] })]) {
        assert((await api.fetch(request("/reviews", { method: "POST", headers: { Authorization: "Bearer user-token" }, body }))).status === 400, "Reject invalid payload");
      }
    });

    await t.step("invalid sessions, unavailable database, unknown locations and duplicates keep error status", async () => {
      for (const expected of [401, 503, 422, 409]) {
        globalThis.fetch = async input => {
          const url = new URL(String(input));
          if (url.pathname === "/auth/v1/user") {
            return Response.json(expected === 401 ? { error: "invalid" } : { id: "user-id" }, { status: expected === 401 ? 401 : 200 });
          }
          if (url.pathname === "/rest/v1/restrooms") {
            return Response.json(expected === 422 ? [] : [{ osm_id: 123 }], { status: expected === 503 ? 500 : 200 });
          }
          return Response.json({ code: "23505" }, { status: 409 });
        };
        const response = await api.fetch(request("/reviews", {
          method: "POST", headers: { Authorization: "Bearer user-token" }, body: JSON.stringify(review),
        }));
        assert(response.status === expected, `Expected ${expected}, got ${response.status}`);
      }
    });

    await t.step("auth proxies OTP, verification, refresh and user calls without service role", async () => {
      for (const [endpoint, method] of [["otp", "POST"], ["verify", "POST"], ["token", "POST"], ["logout", "POST"], ["user", "GET"]]) {
        globalThis.fetch = async (input, init) => {
          const url = new URL(String(input));
          const headers = new Headers(init?.headers);
          assert(url.pathname === `/auth/v1/${endpoint}` && url.search === "?grant_type=refresh_token", "Preserve auth path and query");
          assert(headers.get("apikey") === values.SUPABASE_ANON_KEY, "Use anon key, never service role");
          assert(headers.get("authorization") === "Bearer user-token", "Forward user bearer token");
          assert(!headers.has("x-washroom-gateway-secret"), "Do not leak gateway secret upstream");
          assert(init?.redirect === "manual", "Do not follow upstream redirects");
          return Response.json({ access_token: "result" }, { status: 200 });
        };
        const response = await api.fetch(request(`/auth/v1/${endpoint}?grant_type=refresh_token`, {
          method, headers: { Authorization: "Bearer user-token" },
          body: method === "POST" ? JSON.stringify({ email: "test@example.com" }) : undefined,
        }));
        assert(response.status === 200 && (await response.json()).access_token === "result", "Auth response must be intact");
      }
      assert((await api.fetch(request("/auth/v1/admin", { method: "POST" }))).status === 404, "No admin auth proxy");
    });

    await t.step("geocoding is US-only and returns validated coordinates", async () => {
      globalThis.fetch = async input => {
        const url = new URL(String(input));
        assert(url.hostname === "photon.komoot.io" && url.searchParams.get("countrycode") === "US" &&
          url.searchParams.get("q") === "Boston", "Constrain city geocoding");
        return Response.json({ features: [{ geometry: { type: "Point", coordinates: [-71.06, 42.36] }, properties: { countrycode: "US" } }] });
      };
      const response = await api.fetch(request("/geocode?q=Boston"));
      const result = await response.json();
      assert(response.status === 200 && result.latitude === 42.36 && result.longitude === -71.06, "Coordinate result");
      globalThis.fetch = async () => Response.json({ features: [] });
      assert((await api.fetch(request("/geocode?q=Unknown"))).status === 404, "No matches must be explicit");
      globalThis.fetch = async () => Response.json({ features: [{ geometry: { type: "Point", coordinates: ["", 0] }, properties: { countrycode: "US" } }] });
      assert((await api.fetch(request("/geocode?q=Unknown"))).status === 502, "Malformed coordinates must fail");
      globalThis.fetch = async () => Response.json({ features: [{ geometry: { type: "Point", coordinates: [-71.06, 42.36] }, properties: { countrycode: "CA" } }] });
      assert((await api.fetch(request("/geocode?q=Unknown"))).status === 502, "Non-US results must fail");
    });

    await t.step("ZIP 43085 resolves without database or Overpass requests", async () => {
      let calls = 0;
      globalThis.fetch = async input => {
        calls++;
        const url = new URL(String(input));
        assert(url.hostname === "api.zippopotam.us" && url.pathname === "/us/43085", "ZIP lookup must call only geocoder");
        return Response.json({ places: [{ latitude: "40.0999", longitude: "-83.0157" }] });
      };
      const response = await api.fetch(request("/geocode?zip=43085"));
      const result = await response.json();
      assert(response.status === 200 && result.latitude === 40.0999 && result.longitude === -83.0157, "ZIP coordinates");
      assert(calls === 1, "ZIP resolution must not wait for restroom discovery");
      const invalid = await api.fetch(request("/geocode?zip=1234"));
      assert(invalid.status === 400 && calls === 1, "Reject malformed ZIP before upstream calls");
      globalThis.fetch = async () => new Response(null, { status: 404 });
      assert((await api.fetch(request("/geocode?zip=00000"))).status === 404, "Unknown ZIP must remain an explicit error");
    });

    await t.step("boundary collections normalize to the feature expected by the map", async () => {
      const feature = { type: "Feature", geometry: { type: "MultiPolygon", coordinates: [] }, properties: {} };
      globalThis.fetch = async () => Response.json({ type: "FeatureCollection", features: [feature] });
      const response = await api.fetch(request("/map-boundary"));
      assert(response.status === 200 && (await response.json()).geometry.type === "MultiPolygon", "Normalize boundary shape");
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
});
