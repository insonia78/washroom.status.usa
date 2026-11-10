import api from "../frontend-api/index.ts";
import { testIpSecret, withTestClientIp } from "./test-ip-helpers.ts";

Deno.test("gateway routes frontend API calls with internal authorization and strips the service prefix", async () => {
  const config = {
    FRONTEND_API_URL: "https://project.example/functions/v1/frontend-api",
    GATEWAY_INTERNAL_SECRET: "test-gateway-secret",
    GATEWAY_IP_SIGNING_SECRET: testIpSecret,
    UPSTASH_REDIS_REST_URL: "https://redis.example",
    UPSTASH_REDIS_REST_TOKEN: "test-token",
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
    if (url.hostname === "redis.example") {
      return Response.json({ result: [1, 39, 60] });
    }
    if (url.pathname.startsWith("/functions/v1/frontend-api/")) {
      forwarded++;
      if (req.headers.get("x-washroom-gateway-secret") !== config.GATEWAY_INTERNAL_SECRET) {
        throw new Error("Missing internal authorization");
      }
      return await api.fetch(req);
    }
    if (url.pathname === "/rest/v1/reviews") return Response.json([]);
    if (url.pathname === "/rest/v1/owner_response_admins") return Response.json([{ user_id: "10000000-0000-4000-8000-000000000001" }]);
    if (url.pathname === "/rest/v1/review_replies") return Response.json([]);
    if (url.pathname === "/auth/v1/user") return Response.json({ id: "10000000-0000-4000-8000-000000000001", email_confirmed_at: "2026-01-01" });
    if (url.pathname === "/rest/v1/toilet_submissions") {
      const body = await req.json();
      if (body.status !== "pending" || body.latitude !== 40.71 || body.longitude !== -74) {
        throw new Error("Submission fields must reach database insertion");
      }
      return new Response(null, { status: 201 });
    }
    if (url.pathname === "/rest/v1/rpc/approved_review_summary") return Response.json([{ review_count: 0, average: null }]);
    if (url.pathname === "/auth/v1/otp") return Response.json({ sent: true });
    if (url.hostname === "photon.komoot.io") return Response.json({ features: [{ geometry: { type: "Point", coordinates: [-71.06, 42.36] }, properties: { countrycode: "US" } }] });
    throw new Error(`Unexpected URL ${url}`);
  };
  try {
    const { default: rawGateway } = await import("./index.ts");
    const gateway = withTestClientIp(rawGateway);
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
    const uploadForm = new FormData();
    uploadForm.set("invite_id", "30000000-0000-4000-8000-000000000001");
    const deniedOwnerUpload = await gateway.fetch(new Request("https://project.example/functions/v1/gateway/frontend/owner/review-photos", {
      method: "POST", body: uploadForm,
    }));
    if (deniedOwnerUpload.status !== 401 || Number(forwarded) !== 4) {
      throw new Error(`Owner photo uploads must reach backend authorization, not fail at the gateway: ${deniedOwnerUpload.status}`);
    }
    const submission = await gateway.fetch(new Request("https://project.example/functions/v1/gateway/frontend/toilet-submissions", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer test-user-token" },
      body: JSON.stringify({ name: "Park toilet", latitude: 40.71, longitude: -74, wheelchair: "unknown", fee: "no", notes: "",
        current_location: true, user_latitude: 40.71, user_longitude: -74 }),
    }));
    if (submission.status !== 201 || Number(forwarded) !== 5) throw new Error("Toilet submission must forward and insert");
    const unauthorized = await gateway.fetch(new Request("https://project.example/functions/v1/gateway/frontend/moderation/reviews"));
    if (unauthorized.status !== 401 || Number(forwarded) !== 6) throw new Error("Moderation routes must forward to backend authorization");
    const blocked = await gateway.fetch(new Request("https://project.example/functions/v1/gateway/frontend/auth/v1/admin"));
    if (blocked.status !== 404 || Number(forwarded) !== 6) throw new Error("Unlisted auth endpoints must not forward");
    for (const path of ["/admin/reviews", "/admin/review-replies?review_id=20000000-0000-4000-8000-000000000001"]) {
      const url = `https://project.example/functions/v1/gateway/frontend${path}`;
      const denied = await gateway.fetch(new Request(url));
      if (denied.status !== 401) throw new Error("Private reply reads must enforce backend authentication");
      const allowed = await gateway.fetch(new Request(url, { headers: { Authorization: "Bearer admin-test" } }));
      if (allowed.status !== 200 || allowed.headers.get("cache-control") !== "no-store") throw new Error("Private admin read failed through gateway");
    }
    const deniedSend = await gateway.fetch(new Request("https://project.example/functions/v1/gateway/frontend/admin/review-replies", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send", id: "30000000-0000-4000-8000-000000000001" }),
    }));
    if (deniedSend.status !== 401 || Number(forwarded) !== 11) throw new Error("Private reply writes must reach backend authorization");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
});
