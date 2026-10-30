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

Deno.test("supportedRoutes allow washroom places lookups and account deactivation", () => {
  const bathroomsRoute = findRoute("/places/bathrooms");
  const deactivateRoute = findRoute("/accounts/deactivate");

  assert(bathroomsRoute);
  assert(deactivateRoute);
  assertEquals(bathroomsRoute.methods.sort(), ["GET", "POST"]);
  assertEquals(deactivateRoute.methods, ["POST"]);
});

Deno.test("supportedRoutes allow administrator authentication routes", () => {
  const accessRoute = findRoute("/admin/access");
  const loginRoute = findRoute("/admin/login");
  const createPasswordRoute = findRoute("/admin/create-password");

  assert(accessRoute);
  assert(loginRoute);
  assert(createPasswordRoute);
  assertEquals(accessRoute.methods, ["POST"]);
  assertEquals(loginRoute.methods, ["POST"]);
  assertEquals(createPasswordRoute.methods, ["POST"]);
});

Deno.test("supportedRoutes no longer expose removed provider or legacy routes", () => {
  assertFalse(findRoute("/places/overpass"));
  assertFalse(findRoute("/weather/profile"));
  assertFalse(findRoute("/weather/search"));
  assertFalse(findRoute("/admin/dashboard"));
  assertFalse(findRoute("/admin/dashboard/stream"));
});