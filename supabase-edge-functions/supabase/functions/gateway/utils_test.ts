import { assert, assertEquals, assertFalse } from "jsr:@std/assert";

import { isVerifiedToken, jsonResponse } from "./utils.ts";

Deno.test("isVerifiedToken validates supported token shapes", () => {
  assert(isVerifiedToken({
    payload: { sub: "user@example.com" },
    tokenType: "custom",
  }));
  assert(isVerifiedToken({
    payload: { sub: "user@example.com" },
    tokenType: "supabase",
  }));
  assertFalse(isVerifiedToken({
    payload: "not-an-object",
    tokenType: "custom",
  }));
  assertFalse(isVerifiedToken({
    payload: { sub: "user@example.com" },
    tokenType: "invalid",
  }));
});

Deno.test("jsonResponse returns a JSON body with permissive CORS headers", async () => {
  const response = jsonResponse(202, { ok: true });

  assertEquals(response.status, 202);
  assertEquals(response.headers.get("Content-Type"), "application/json");
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(await response.json(), { ok: true });
});
