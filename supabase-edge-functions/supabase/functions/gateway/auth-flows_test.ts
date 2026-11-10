import { testIpSecret, withTestClientIp } from "./test-ip-helpers.ts";

Deno.test("gateway preserves account and admin authentication flows behind IP consumption", async () => {
  const config = {
    WASHROOM_REGISTRATION_API_URL: "https://accounts.example",
    JWT_CREATOR_URL: "https://project.example/functions/v1/jwt-creator",
    GATEWAY_INTERNAL_SECRET: "test-internal-secret",
    GATEWAY_IP_SIGNING_SECRET: testIpSecret,
    UPSTASH_REDIS_REST_URL: "https://redis.example",
    UPSTASH_REDIS_REST_TOKEN: "test-token",
    SUPABASE_URL: "https://project.example",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
  };
  const previous = new Map(Object.keys(config).map((key) => [key, Deno.env.get(key)]));
  const originalFetch = globalThis.fetch;
  for (const [key, value] of Object.entries(config)) Deno.env.set(key, value);
  let role = "admin";
  let passwordSetupRequired = false;
  let jwtCalls = 0;
  let deviceCalls = 0;
  let accessCalls = 0;
  let failAccess = false;
  const calls: string[] = [];
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
  }
  globalThis.fetch = (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname === "redis.example") {
      deviceCalls++;
      return Promise.resolve(Response.json({ result: [1, 39, 60] }));
    }
    assert(request.headers.get("x-washroom-gateway-secret") === config.GATEWAY_INTERNAL_SECRET,
      "Authentication backends require internal authorization");
    assert(!request.headers.has("x-washroom-client-ip"), "Do not forward IP assertions");
    calls.push(url.pathname);
    if (url.pathname === "/functions/v1/jwt-creator") {
      jwtCalls++;
      return Promise.resolve(Response.json({ token: "custom-jwt", tokenRecord: { id: "record" } }));
    }
    if (url.pathname === "/accounts/access") {
      accessCalls++;
      if (failAccess && accessCalls < 3) {
        return Promise.resolve(Response.json({ error: "Transient" }, { status: 503 }));
      }
    }
    return Promise.resolve(Response.json({
      email: "admin@example.com", role, password_setup_required: passwordSetupRequired,
    }));
  };
  try {
    const { default: rawGateway } = await import("./index.ts");
    const gateway = withTestClientIp(rawGateway);
    const send = (path: string, body: unknown, method = "POST") => gateway.fetch(
      new Request(`https://project.example/functions/v1/gateway${path}`, {
        method, headers: { "content-type": "application/json" },
        body: method === "POST" ? JSON.stringify(body) : undefined,
      }),
    );
    const credentials = { email: "admin@example.com", password: "example-password" };
    const invalid = await send("/admin/login", { email: "admin@example.com" });
    assert(invalid.status === 400 && calls.length === 0, "Reject missing passwords before forwarding");
    const invalidJson = await gateway.fetch(new Request(
      "https://project.example/functions/v1/gateway/accounts/login", {
        method: "POST", body: "{invalid", headers: { "content-type": "application/json" },
      },
    ));
    assert(invalidJson.status === 400, "Reject invalid JSON");
    failAccess = true;
    const access = await send("/admin/access", { email: " admin@example.com " });
    const accessBody = await access.json();
    assert(access.status === 200 && accessCalls === 3 && accessBody.passwordSetupRequired === false,
      "Retry transient access failures and preserve setup state");
    role = "user";
    const denied = await send("/admin/login", credentials);
    assert(denied.status === 403 && jwtCalls === 0, "Reject non-admin accounts without JWT creation");
    role = "admin";
    passwordSetupRequired = true;
    const setup = await send("/admin/login", credentials);
    assert(setup.status === 401 && jwtCalls === 0, "Require password setup before issuing admin JWT");
    passwordSetupRequired = false;
    const admin = await send("/admin/login", credentials);
    const adminBody = await admin.json();
    assert(admin.status === 200 && adminBody.token === "custom-jwt" && adminBody.tokenRecord.id === "record",
      "Issue admin token with persistence record");
    const password = await send("/admin/create-password", credentials);
    assert(password.status === 200 && (await password.json()).token === "custom-jwt",
      "Issue token after successful password setup");
    role = "user";
    const account = await send("/accounts/login", credentials);
    assert(account.status === 200 && (await account.json()).token === "custom-jwt",
      "Append custom tokens to ordinary account login responses");
    const unknown = await send("/not-exposed", undefined, "GET");
    const unsupported = await send("/accounts/login", undefined, "GET");
    assert(unknown.status === 404 && unsupported.status === 405, "Preserve route validation");
    const beforePreflight = deviceCalls;
    const preflight = await gateway.fetch(new Request("https://project.example/functions/v1/gateway/not-exposed", {
      method: "OPTIONS",
    }));
    assert(preflight.status === 200 && deviceCalls === beforePreflight && deviceCalls === 10,
      "Consume every non-OPTIONS request, including rejected routes, and bypass preflights");
    assert(calls.includes("/accounts/password/setup"), "Use registration password setup endpoint");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
});
