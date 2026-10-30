import { locationDatabaseHeaders } from "./database-schema.ts";

Deno.test("location reads and writes explicitly select the private location schema", () => {
  for (const method of ["GET", "HEAD", "POST", "PATCH", "DELETE"]) {
    const headers = new Headers(locationDatabaseHeaders(method));
    const name = ["GET", "HEAD"].includes(method) ? "Accept-Profile" : "Content-Profile";
    if (headers.get(name) !== "app_locations") throw new Error(`Missing schema profile for ${method}`);
  }
});
