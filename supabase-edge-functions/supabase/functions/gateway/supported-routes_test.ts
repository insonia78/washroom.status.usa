import { assert, assertEquals, assertFalse } from "jsr:@std/assert";

import { supportedRoutes } from "./supported-routes.ts";

function findRoute(pathname: string) {
  return supportedRoutes.find((route) => route.pattern.test(pathname));
}

Deno.test("toilet submissions expose only POST to the private moderation inbox", () => {
  assertEquals(findRoute("/frontend/toilet-submissions")?.methods, ["POST"]);
  assertEquals(findRoute("/frontend/moderation/toilets")?.methods, ["GET", "POST"]);
});

Deno.test("owner responses expose public reads and separately protected admin actions", () => {
  assertEquals(findRoute("/frontend/owner-responses")?.methods, ["GET"]);
  assertEquals(findRoute("/frontend/admin/owner-responses")?.methods, ["GET", "POST"]);
  assertFalse(findRoute("/frontend/admin/users"));
});

Deno.test("moderation exposes only review listing and decisions", () => {
  const route = findRoute("/frontend/moderation/reviews");
  assert(route);
  assertEquals(route.methods, ["GET", "POST"]);
  assertFalse(findRoute("/frontend/moderation/users"));
});

Deno.test("private review replies expose admin reads and saved reply actions but no user directory", () => {
  assertEquals(findRoute("/frontend/admin/reviews")?.methods, ["GET", "POST"]);
  assertEquals(findRoute("/frontend/admin/toilets")?.methods, ["GET", "POST"]);
  assertEquals(findRoute("/frontend/admin/owner-invites")?.methods, ["GET", "POST"]);
  assertEquals(findRoute("/frontend/owner/reviews")?.methods, ["GET"]);
  assertEquals(findRoute("/frontend/owner/review-photos")?.methods, ["POST"]);
  assertEquals(findRoute("/frontend/admin/review-replies")?.methods, ["GET", "POST"]);
  assertFalse(findRoute("/frontend/admin/users"));
  assertFalse(findRoute("/frontend/review-replies"));
});

Deno.test("supportedRoutes allow washroom places lookups", () => {
  const bathroomsRoute = findRoute("/places/bathrooms");

  assert(bathroomsRoute);
  assertEquals(bathroomsRoute.methods.sort(), ["GET", "POST"]);
});

Deno.test("supportedRoutes keep Supabase authentication and legacy JWT logout", () => {
  for (const action of ["otp", "verify", "token", "logout"]) {
    assertEquals(findRoute(`/frontend/auth/v1/${action}`)?.methods, ["POST"]);
  }
  assertEquals(findRoute("/frontend/auth/v1/user")?.methods, ["GET", "PUT"]);
  assertEquals(findRoute("/auth/logout")?.methods, ["POST"]);
});

Deno.test("supportedRoutes no longer expose removed provider or legacy routes", () => {
  assertFalse(findRoute("/places/overpass"));
  assertFalse(findRoute("/weather/profile"));
  assertFalse(findRoute("/weather/search"));
  assertFalse(findRoute("/admin/dashboard"));
  assertFalse(findRoute("/admin/dashboard/stream"));
});