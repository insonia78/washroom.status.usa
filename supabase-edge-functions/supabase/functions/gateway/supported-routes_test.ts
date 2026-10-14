import { assert, assertEquals } from "jsr:@std/assert";

import { supportedRoutes } from "./supported-routes.ts";

function findRoute(pathname: string) {
  return supportedRoutes.find((route) => route.pattern.test(pathname));
}

Deno.test("supportedRoutes allow weather profile and search history operations", () => {
  const profileRoute = findRoute("/weather/profile");
  const searchHistoryRoute = findRoute("/weather/search-history");
  const deactivateRoute = findRoute("/accounts/deactivate");

  assert(profileRoute);
  assert(searchHistoryRoute);
  assert(deactivateRoute);
  assertEquals(profileRoute.methods.sort(), ["DELETE", "GET", "PUT"]);
  assertEquals(searchHistoryRoute.methods.sort(), ["DELETE", "GET", "POST"]);
  assertEquals(deactivateRoute.methods, ["POST"]);
});

Deno.test("supportedRoutes allow administrator authentication and dashboard routes", () => {
  const accessRoute = findRoute("/admin/access");
  const loginRoute = findRoute("/admin/login");
  const dashboardRoute = findRoute("/admin/dashboard");

  assert(accessRoute);
  assert(loginRoute);
  assert(dashboardRoute);
  assertEquals(accessRoute.methods, ["POST"]);
  assertEquals(loginRoute.methods, ["POST"]);
  assertEquals(dashboardRoute.methods, ["POST"]);
});
