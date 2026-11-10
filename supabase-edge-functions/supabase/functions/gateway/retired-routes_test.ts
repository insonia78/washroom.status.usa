import { assertEquals, assertFalse } from "jsr:@std/assert";
import { testIpSecret, withTestClientIp } from "./test-ip-helpers.ts";

const retiredPaths = [
  "/health", "/accounts", "/accounts/login", "/accounts/access",
  "/accounts/password/setup", "/accounts/reset-password",
  "/accounts/reset-password/confirm", "/accounts/deactivate", "/accounts/123",
  "/admin/access", "/admin/login", "/admin/create-password",
];

Deno.test("retired registration routes return 404 without backend calls", async () => {
  const config = {
    WASHROOM_REGISTRATION_API_URL: "https://retired.example",
    PLACES_API_URL: "https://project.example/functions/v1/places-api",
    FRONTEND_API_URL: "https://project.example/functions/v1/frontend-api",
    GATEWAY_IP_SIGNING_SECRET: testIpSecret,
    UPSTASH_REDIS_REST_URL: "https://redis.example",
    UPSTASH_REDIS_REST_TOKEN: "test-token",
  };
  const previous = new Map(Object.keys(config).map(key => [key, Deno.env.get(key)]));
  const originalFetch = globalThis.fetch;
  for (const [key, value] of Object.entries(config)) Deno.env.set(key, value);
  let quotaCalls = 0;
  globalThis.fetch = (input, init) => {
    const request = new Request(input, init);
    assertEquals(new URL(request.url).hostname, "redis.example", "Never call a retired backend");
    quotaCalls++;
    return Promise.resolve(Response.json({ result: [1, 199, 60] }));
  };
  try {
    const { default: rawGateway } = await import("./index.ts");
    const { inferService, matchRoute, resolveBackendUrl } = await import("./routing.ts");
    const { getConfiguredBackendsSummary } = await import("./logging.ts");
    const gateway = withTestClientIp(rawGateway);
    assertEquals(resolveBackendUrl(null), null, "Unknown services have no fallback backend");
    assertFalse("registrationBackend" in getConfiguredBackendsSummary());
    for (const path of retiredPaths) {
      assertEquals(inferService(path), null);
      for (const suffix of ["", "/"]) {
        assertEquals(matchRoute(`${path}${suffix}`), undefined);
        for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
          const response = await gateway.fetch(new Request(
            `https://project.example/functions/v1/gateway${path}${suffix}`,
            { method },
          ));
          assertEquals(response.status, 404, `${method} ${path}${suffix}`);
          assertEquals((await response.json()).error, "Endpoint not exposed by gateway");
          assertEquals(response.headers.get("RateLimit-Limit"), "200");
        }
      }
    }
    assertEquals(quotaCalls, retiredPaths.length * 2 * 5);
    const preflight = await gateway.fetch(new Request(
      "https://project.example/functions/v1/gateway/accounts/login", { method: "OPTIONS" },
    ));
    assertEquals(preflight.status, 200);
    assertEquals(quotaCalls, retiredPaths.length * 2 * 5, "Preflight does not consume quota");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
});
