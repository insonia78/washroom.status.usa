import api from "./index.ts";
import { buildGatewayHeaders } from "../_shared/gateway-auth.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("current-location toilet submissions are validated and saved privately", async (t) => {
  const config = {
    GATEWAY_INTERNAL_SECRET: "test-secret", SUPABASE_URL: "https://project.example",
    SUPABASE_SERVICE_ROLE_KEY: "test-service",
    SUPABASE_ANON_KEY: "test-anon",
  };
  const previous = new Map(Object.keys(config).map(key => [key, Deno.env.get(key)]));
  const originalFetch = globalThis.fetch;
  for (const [key, value] of Object.entries(config)) Deno.env.set(key, value);
  const fields = { name: " Park toilet ", latitude: 40.71, longitude: -74.0, wheelchair: "unknown", fee: "no", notes: " Near entrance " };
  const request = (body: unknown = fields, method = "POST", authorized = true) =>
    new Request("https://project.example/functions/v1/frontend-api/toilet-submissions", {
      method,
      headers: { ...(authorized ? buildGatewayHeaders(config.GATEWAY_INTERNAL_SECRET) : {}), "Content-Type": "application/json", Authorization: "Bearer test-user-token" },
      body: method === "GET" ? undefined : JSON.stringify(body),
    });
  try {
    await t.step("inserts only validated fields with server-controlled pending status", async () => {
      let calls = 0;
      globalThis.fetch = async (input, init) => {
        calls++;
        const url = new URL(String(input));
        if (url.pathname === "/auth/v1/user") return Response.json({ id: "10000000-0000-4000-8000-000000000001", email_confirmed_at: "2026-01-01" });
        assert(url.pathname === "/rest/v1/toilet_submissions" && init?.method === "POST", "Insert into the private inbox");
        const headers = new Headers(init.headers);
        assert(headers.get("apikey") === config.SUPABASE_SERVICE_ROLE_KEY, "Use only the server credential");
        const payload = JSON.parse(String(init.body));
        assert(payload.name === "Park toilet" && payload.notes === "Near entrance", "Trim text");
        assert(payload.latitude === fields.latitude && payload.longitude === fields.longitude, "Preserve exact GPS coordinates");
        assert(payload.wheelchair === "unknown" && payload.fee === "no", "Preserve answers");
        assert(payload.status === "pending" && payload.user_id === "10000000-0000-4000-8000-000000000001" &&
          Array.isArray(payload.photo_paths) && payload.photo_paths.length === 0 && !("id" in payload),
          "Use verified account and private photo path list, ignoring forged fields");
        return new Response(null, { status: 201 });
      };
      const response = await api.fetch(request({ ...fields, status: "approved", user_id: "forged", id: "forged" }));
      assert(response.status === 201 && calls === 2, "Verify identity before insertion");
      assert((await response.json()).status === "pending", "Confirm moderation");
    });
    await t.step("uploads toilet photos privately and stores their paths for moderation", async () => {
      const form = new FormData();
      form.set("submission", JSON.stringify(fields));
      form.append("photos", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "sign.png", { type: "image/png" }));
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === "/auth/v1/user") return Response.json({ id: "10000000-0000-4000-8000-000000000001", email_confirmed_at: "2026-01-01" });
        if (url.pathname.startsWith("/storage/v1/object/review-photos/")) {
          assert(init?.method === "POST", "Upload photo to the private bucket");
          return Response.json({ Key: "stored" });
        }
        assert(url.pathname === "/rest/v1/toilet_submissions" && init?.method === "POST", "Insert toilet into moderation queue");
        const payload = JSON.parse(String(init.body));
        assert(payload.photo_paths.length === 1 && /^10000000-0000-4000-8000-000000000001\/[0-9a-f-]+\.png$/i.test(payload.photo_paths[0]),
          "Associate the generated private photo path");
        return new Response(null, { status: 201 });
      };
      const response = await api.fetch(new Request("https://project.example/frontend-api/toilet-submissions", {
        method: "POST",
        headers: { ...buildGatewayHeaders(config.GATEWAY_INTERNAL_SECRET), Authorization: "Bearer user-token" },
        body: form,
      }));
      assert(response.status === 201, "Accept toilet submission with evidence photo");
    });
    await t.step("rejects invalid input without database requests", async () => {
      globalThis.fetch = async input => {
        if (new URL(String(input)).pathname === "/auth/v1/user") return Response.json({ id: "10000000-0000-4000-8000-000000000001", email_confirmed_at: "2026-01-01" });
        throw new Error("Invalid input reached database");
      };
      for (const invalid of [
        null, [], {}, ...[
          { name: " " }, { name: "x".repeat(121) }, { name: 12 },
          { latitude: "40.71" }, { latitude: null }, { latitude: 16.9 }, { latitude: 72.1 },
          { longitude: -179.1 }, { longitude: -64.9 }, { longitude: null },
          { wheelchair: "maybe" }, { fee: true }, { notes: null }, { notes: "x".repeat(1001) },
        ].map(value => ({ ...fields, ...value })),
      ]) assert((await api.fetch(request(invalid))).status === 400, "Reject invalid fields");
      const malformed = new Request("https://project.example/frontend-api/toilet-submissions", {
        method: "POST", headers: { ...buildGatewayHeaders(config.GATEWAY_INTERNAL_SECRET), Authorization: "Bearer test-user-token" }, body: "{",
      });
      assert((await api.fetch(malformed)).status === 400, "Reject malformed JSON");
      assert((await api.fetch(request(fields, "GET"))).status === 405, "Reject unsupported methods");
      assert((await api.fetch(request(fields, "POST", false))).status === 403, "Require gateway authentication");
    });
    await t.step("database errors never report success", async () => {
      globalThis.fetch = async input => new URL(String(input)).pathname === "/auth/v1/user"
        ? Response.json({ id: "10000000-0000-4000-8000-000000000001", email_confirmed_at: "2026-01-01" })
        : Response.json({ code: "42P01" }, { status: 404 });
      const response = await api.fetch(request());
      assert(response.status === 503, "Report missing migration or unavailable database");
      assert((await response.json()).error.includes("could not be saved"), "Return actionable submission error");
    });
    await t.step("requires a verified account and never trusts a client user ID", async () => {
      const unsigned = request();
      unsigned.headers.delete("authorization");
      globalThis.fetch = async () => { throw new Error("Unsigned request reached upstream"); };
      assert((await api.fetch(unsigned)).status === 401, "Require a session");
      for (const user of [{ id: "unverified" }, { id: "anonymous", email_confirmed_at: "2026-01-01", is_anonymous: true }]) {
        globalThis.fetch = async input => {
          assert(new URL(String(input)).pathname === "/auth/v1/user", "Unverified users cannot insert");
          return Response.json(user);
        };
        assert((await api.fetch(request())).status === 403, "Reject unverified or anonymous identities");
      }
      globalThis.fetch = async () => Response.json({ error: "expired" }, { status: 401 });
      assert((await api.fetch(request())).status === 401, "Reject expired tokens");
    });
    await t.step("database-enforced daily quota returns an explicit 429", async () => {
      globalThis.fetch = async input => new URL(String(input)).pathname === "/auth/v1/user"
        ? Response.json({ id: "10000000-0000-4000-8000-000000000001", email_confirmed_at: "2026-01-01" })
        : Response.json({ code: "P0001" }, { status: 400 });
      const response = await api.fetch(request());
      assert(response.status === 429, "Do not disguise quota denial as success or database outage");
      assert((await response.json()).error.includes("3 toilet submissions per UTC day"), "Explain threshold and reset");
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
});
