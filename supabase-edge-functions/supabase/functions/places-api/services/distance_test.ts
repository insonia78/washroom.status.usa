import { assertAlmostEquals } from "jsr:@std/assert";
import { distanceMeters, EARTH_RADIUS_METERS } from "./distance.ts";

Deno.test("shared search distance handles zero, wrapping and antipodal points", () => {
  assertAlmostEquals(distanceMeters(0, 0, 0, 0), 0);
  assertAlmostEquals(distanceMeters(0, 179, 0, -179), EARTH_RADIUS_METERS * Math.PI / 90);
  assertAlmostEquals(distanceMeters(0, 0, 0, 180), EARTH_RADIUS_METERS * Math.PI);
  assertAlmostEquals(distanceMeters(40, -75, 41, -74), distanceMeters(41, -74, 40, -75));
});
