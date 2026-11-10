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
  const review = { osm_type: "node", osm_id: 123, rating: 4, availability: "open", cleanliness_status: "clean", issues: ["odor"], comment: " Needs cleaning ",
    current_location: true, user_latitude: 42.36, user_longitude: -71.06, restroom_latitude: 42.36, restroom_longitude: -71.06 };
  try {
    await t.step("direct callers and bad internal secrets cannot reach upstreams", async () => {
      globalThis.fetch = async () => { throw new Error("Must not call upstream"); };
      assert((await api.fetch(new Request("https://project.example/frontend-api/reviews"))).status === 403, "Direct access must be denied");
      assert((await api.fetch(request("/reviews", { headers: { "x-washroom-gateway-secret": "wrong" } }))).status === 403, "Bad secret must be denied");
    });
    await t.step("reviews return only approved rows, limited to fifty with an all-review average", async () => {
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === "/rest/v1/rpc/approved_review_summary") return Response.json([{ review_count: 2, average: 3 }]);
        assert(url.pathname === "/rest/v1/reviews", "Expected reviews database");
        assert(url.searchParams.get("status") === "eq.approved" && url.searchParams.get("limit") === "50", "Preserve moderation and result limit");
        assert(new Headers(init?.headers).get("apikey") === values.SUPABASE_SERVICE_ROLE_KEY, "Service role stays in backend");
        return Response.json([{ id: "a", rating: 4, photo_paths: [] }, { id: "b", rating: 2, photo_paths: [] }]);
      };
      const response = await api.fetch(request("/reviews?osm_type=node&osm_id=123"));
      const result = await response.json();
      assert(response.status === 200 && result.count === 2 && result.average === 3 && result.limited_to === 50, "Reviews shape must be preserved");
    });
    await t.step("writes validate verified ownership, imported location and moderation", async () => {
      const calls: string[] = [];
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        calls.push(url.pathname);
        if (url.pathname === "/auth/v1/user") {
          assert(new Headers(init?.headers).get("authorization") === "Bearer user-token", "Validate original user's session");
          return Response.json({ id: "user-id", email_confirmed_at: "2026-01-01" });
        }
        if (url.pathname === "/rest/v1/restrooms") return Response.json([{ osm_id: 123, latitude: 42.36, longitude: -71.06 }]);
        assert(url.pathname === "/rest/v1/reviews" && init?.method === "POST", "Expected review insert");
        const payload = JSON.parse(String(init?.body));
        assert(payload.user_id === "user-id" && payload.status === "pending" && payload.comment === "Needs cleaning", "Verified reviews retain moderation and trimming");
        assert(payload.availability === "open" && payload.cleanliness_status === "clean", "Persist radio answers");
        return new Response(null, { status: 201 });
      };
      const response = await api.fetch(request("/reviews", {
        method: "POST", headers: { Authorization: "Bearer user-token" }, body: JSON.stringify(review),
      }));
      assert(response.status === 201 && calls.join(",") === "/auth/v1/user,/rest/v1/restrooms,/rest/v1/restrooms,/rest/v1/reviews",
        "Authenticate, verify proximity and listing, then insert");
    });
    await t.step("invalid input fails before network calls", async () => {
      globalThis.fetch = async () => { throw new Error("No network calls expected"); };
      assert((await api.fetch(request("/reviews?osm_type=bad&osm_id=1"))).status === 400, "Invalid restroom");
      assert((await api.fetch(request("/reviews", { method: "POST", body: "{}" }))).status === 400, "Missing fields");
      for (const body of ["not JSON", JSON.stringify({ ...review, rating: 9 }), JSON.stringify({ ...review, issues: ["bad"] })]) {
        assert((await api.fetch(request("/reviews", { method: "POST", headers: { Authorization: "Bearer user-token" }, body }))).status === 400, "Reject invalid payload");
      }
    });
    await t.step("unavailable database, unknown locations and duplicates keep error status", async () => {
      for (const expected of [503, 422, 409]) {
        globalThis.fetch = async input => {
          const url = new URL(String(input));
          if (url.pathname === "/auth/v1/user") {
            return Response.json({ id: "user-id", email_confirmed_at: "2026-01-01" });
          }
          if (url.pathname === "/rest/v1/restrooms") {
            return Response.json(expected === 422 ? [] : [{ osm_id: 123, latitude: 42.36, longitude: -71.06 }], { status: expected === 503 ? 500 : 200 });
          }
          if (url.pathname === "/rest/v1/review_locations") return Response.json([]);
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
    await t.step("address suggestions provide bounded labeled US results and explicit failures", async () => {
      globalThis.fetch = async input => {
        const url = new URL(String(input));
        assert(url.hostname === "photon.komoot.io" && url.searchParams.get("limit") === "5", "Suggestion provider and limit");
        assert(url.searchParams.get("countrycode") === "US" && url.searchParams.get("q") === "123 Main Boston", "US address query");
        return Response.json({ features: [
          { geometry: { type: "Point", coordinates: [-71.06, 42.36] },
            properties: { countrycode: "US", housenumber: "123", street: "Main Street", city: "Boston", state: "Massachusetts", postcode: "02108" } },
          { geometry: { type: "Point", coordinates: [-71.07, 42.37] },
            properties: { countrycode: "US", name: "Boston", city: "Boston", state: "Massachusetts" } },
        ] });
      };
      const response = await api.fetch(request("/geocode?q=123%20Main%20Boston&suggest=1"));
      const body = await response.json();
      assert(response.status === 200 && body.suggestions.length === 2, "Multiple address suggestions");
      assert(body.suggestions[0].label === "123 Main Street, Boston, Massachusetts, 02108, USA", "Complete address label");
      assert(body.suggestions[0].latitude === 42.36 && body.suggestions[1].longitude === -71.07, "Selectable coordinates");
      assert(body.suggestions[1].label === "Boston, Massachusetts, USA", "Deduplicate label parts");
      globalThis.fetch = async () => Response.json({ features: [] });
      const empty = await api.fetch(request("/geocode?q=Unknown&suggest=1"));
      assert(empty.status === 200 && (await empty.json()).suggestions.length === 0, "Confirmed no suggestions");
      globalThis.fetch = async () => new Response("Unavailable", { status: 503 });
      assert((await api.fetch(request("/geocode?q=Boston&suggest=1"))).status === 502, "Provider failure is not an empty success");
      globalThis.fetch = async () => Response.json({ features: [
        { geometry: { type: "Point", coordinates: [-71, 42] }, properties: { countrycode: "CA" } },
      ] });
      assert((await api.fetch(request("/geocode?q=Boston&suggest=1"))).status === 502, "Reject non-US suggestions");
    });
    await t.step("ZIP 43085 resolves without database or Overpass requests", async () => {
      let calls = 0, archives = 0;
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        if (url.hostname === "project.example" && url.pathname.startsWith("/storage/v1/object/third-party-api-data-lake/zippopotam/")) {
          const exchange = JSON.parse(String(init?.body));
          assert(init?.method === "POST" && exchange.request.url === "https://api.zippopotam.us/us/43085" &&
            exchange.response.status === 200, "Archive only the ZIP provider exchange");
          archives++;
          return Response.json({ Key: "stored" });
        }
        calls++;
        assert(url.hostname === "api.zippopotam.us" && url.pathname === "/us/43085", "ZIP lookup must call only geocoder");
        return Response.json({ places: [{ latitude: "40.0999", longitude: "-83.0157" }] });
      };
      const response = await api.fetch(request("/geocode?zip=43085"));
      const result = await response.json();
      assert(response.status === 200 && result.latitude === 40.0999 && result.longitude === -83.0157, "ZIP coordinates");
      assert(calls === 1 && archives === 1, "ZIP resolution calls only the geocoder and its archive, never restroom discovery");
      const suggestions = await api.fetch(request("/geocode?zip=43085&suggest=1"));
      const suggestionBody = await suggestions.json();
      assert(suggestions.status === 200 && suggestionBody.suggestions[0].label === "ZIP 43085, USA" &&
        suggestionBody.suggestions[0].latitude === 40.0999, "ZIP suggestions reuse cached ZIP origin");
      const invalid = await api.fetch(request("/geocode?zip=1234"));
      assert(invalid.status === 400 && calls === 1 && archives === 1, "Cached and malformed ZIPs make no upstream calls");
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
