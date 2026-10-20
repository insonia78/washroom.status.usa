import { assertEquals, assertFalse } from "jsr:@std/assert";

import { buildForwardHeaders } from "./build-forward-headers.ts";

Deno.test("buildForwardHeaders forwards gateway context and user metadata", () => {
  const request = new Request("https://example.com/functions/v1/gateway/places/bathrooms", {
    headers: {
      apikey: "public-key",
      authorization: "Bearer custom-token",
      host: "example.com",
      "content-length": "123",
      "x-washroom-gateway-caller": "washroom-gateway",
      "x-washroom-gateway-secret": "shared-secret",
    },
  });

  const headers = buildForwardHeaders(request, { sub: "admin@example.com", role: "admin" }, "custom");

  assertEquals(headers.get("X-User-Id"), "admin@example.com");
  assertEquals(headers.get("X-User-Type"), "custom");
  assertEquals(headers.get("x-washroom-gateway-caller"), "washroom-gateway");
  assertEquals(headers.get("x-washroom-gateway-secret"), "shared-secret");
  assertEquals(headers.get("X-User-Payload"), JSON.stringify({ sub: "admin@example.com", role: "admin" }));
  assertFalse(headers.has("host"));
  assertFalse(headers.has("content-length"));
});
