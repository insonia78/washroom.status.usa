export const locationSchema = "app_locations";

export function locationDatabaseHeaders(method = "GET"): Record<string, string> {
  return { [method === "GET" || method === "HEAD" ? "Accept-Profile" : "Content-Profile"]: locationSchema };
}
