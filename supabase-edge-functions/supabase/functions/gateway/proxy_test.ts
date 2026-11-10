import { buildProxyHeaders, fetchBackendResponse } from "./proxy.ts";
import { gatewayAuthorizationHeader } from "../_shared/gateway-auth.ts";
import {
  buildCorsHeaders,
  buildProxiedResponse,
  buildResponseHeaders,
  canResponseHaveBody,
  parseBackendBody,
  shouldProxyRawResponseBody,
} from "./http.ts";
import { SERVICES } from "./models.ts";
import { buildTargetUrl, extractProxyPath } from "./routing.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("proxy strips IP assertions and legacy device credentials for every backend service", () => {
  for (const service of Object.values(SERVICES)) {
    const request = new Request("https://gateway.example/test", {
      headers: {
        authorization: "Bearer user-token",
        "x-washroom-device-token": "signed-device",
        "x-washroom-client-ip": "signed-ip",
        cookie: "session=abc; washroom_device=signed-device; preference=dark",
        host: "gateway.example",
        "content-length": "123",
      },
    });
    const headers = buildProxyHeaders(request, service, null);
    assert(!headers.has("x-washroom-device-token"), "Do not forward device headers");
    assert(!headers.has("x-washroom-client-ip"), "Do not leak signed IP assertions");
    assert(headers.get("cookie") === "session=abc; preference=dark", "Keep other cookies");
    assert(!headers.has("host") && !headers.has("content-length"), "Strip transport headers");
    if (service === SERVICES.AUTH) {
      assert(!headers.has("authorization"), "Logout moves client authorization");
      assert(headers.get(gatewayAuthorizationHeader) === "Bearer user-token", "Keep logout identity");
    } else {
      assert(headers.get("authorization") === "Bearer user-token", "Keep user authorization");
    }
    assert(request.headers.has("x-washroom-device-token"), "Do not mutate the incoming request");
  }
  const headers = buildProxyHeaders(new Request("https://gateway.example", {
    headers: { cookie: "washroom_device=first; washroom_device=second" },
  }), SERVICES.FRONTEND, null);
  assert(!headers.has("cookie"), "Remove empty device-only cookie headers");
});

Deno.test("gateway CORS supports IP headers and keeps requested preflight headers", () => {
  assert(buildCorsHeaders()["Access-Control-Allow-Headers"].includes("x-washroom-client-ip"),
    "Default CORS must allow IP assertions");
  const request = new Request("https://gateway.example", {
    headers: { origin: "https://app.example", "access-control-request-headers": "x-custom" },
  });
  const headers = buildResponseHeaders(new Headers({ "x-backend": "kept" }), request);
  assert(headers.get("access-control-allow-origin") === "https://app.example", "Reflect origin");
  assert(headers.get("access-control-allow-headers") === "x-custom", "Preserve requested headers");
  assert(headers.get("x-backend") === "kept", "Keep backend headers");
});

Deno.test("proxy preserves JSON, text, binary, streams and no-body responses", async () => {
  const request = new Request("https://gateway.example");
  for (const body of ["plain text", { success: true }, new Uint8Array([0, 255, 17])]) {
    const response = buildProxiedResponse(request, 200, new Headers(), body);
    if (body instanceof Uint8Array) {
      assert(new Uint8Array(await response.arrayBuffer())[1] === 255, "Keep binary bytes");
    } else {
      const expected = typeof body === "string" ? body : JSON.stringify(body);
      assert(await response.text() === expected, "Keep text and JSON payloads");
    }
  }
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("data: hello\n\n"));
      controller.close();
    },
  });
  const response = buildProxiedResponse(request, 200, new Headers(), stream);
  assert(await response.text() === "data: hello\n\n", "Keep event streams");
  for (const [method, status] of [["HEAD", 200], ["GET", 204], ["GET", 205], ["GET", 304]] as const) {
    const headers = new Headers({ "content-type": "application/json", "content-length": "10" });
    const empty = buildProxiedResponse(new Request(request.url, { method }), status, headers, {});
    assert(!canResponseHaveBody(method, status) && empty.body === null, "Respect no-body semantics");
    assert(!empty.headers.has("content-type") && !empty.headers.has("content-length"), "Remove body headers");
  }
  assert(shouldProxyRawResponseBody("text/event-stream"), "Stream SSE without parsing");
  assert(shouldProxyRawResponseBody("image/png"), "Keep images binary");
  assert(shouldProxyRawResponseBody("application/octet-stream"), "Keep downloads binary");
  assert(!shouldProxyRawResponseBody("application/json"), "Parse ordinary JSON");
  assert((await parseBackendBody(Response.json({ ok: true }))).ok === true, "Parse JSON");
  assert(await parseBackendBody(new Response("text")) === "text", "Parse text");
});

Deno.test("proxy URL construction preserves service routing and local fallback", async () => {
  assert(extractProxyPath("/functions/v1/gateway/places/bathrooms") === "/places/bathrooms",
    "Remove deployed gateway prefix");
  assert(extractProxyPath("/gateway/frontend/reviews") === "/frontend/reviews", "Remove local gateway prefix");
  const target = buildTargetUrl("http://localhost:8000/functions/v1/places-api",
    "/places/bathrooms", "?lat=40", SERVICES.PLACES);
  assert(target.pathname === "/functions/v1/places-api/bathrooms", "Strip places prefix");
  const auth = buildTargetUrl("https://backend.example/jwt-revoke",
    "/auth/logout", "?all=true", SERVICES.AUTH);
  assert(auth.pathname === "/jwt-revoke" && auth.search === "?all=true", "Use logout endpoint");
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (input, init) => {
    const req = new Request(input, init);
    urls.push(req.url);
    assert(!req.headers.has("x-washroom-device-token") && !req.headers.has("cookie"),
      "Fallback must not leak device credentials");
    return urls.length === 1
      ? Promise.reject(new Error("Local backend unavailable"))
      : Promise.resolve(Response.json({ ok: true }));
  };
  try {
    const request = new Request("https://gateway.example/gateway/places/bathrooms?lat=40", {
      headers: { "x-washroom-device-token": "signed", cookie: "washroom_device=signed" },
    });
    const result = await fetchBackendResponse(request, SERVICES.PLACES, null, target, null,
      "http://localhost:8000/functions/v1/places-api", "test-request");
    assert(result.status === 200 && urls.length === 2, "Retry local failures once");
    assert(urls[1] === "http://host.docker.internal:8000/functions/v1/places-api/bathrooms?lat=40",
      "Keep backend path and query when retrying through Docker host");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
