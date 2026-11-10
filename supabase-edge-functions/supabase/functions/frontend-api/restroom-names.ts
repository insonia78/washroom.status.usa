import { isRecord } from "./api-utils.ts";
import { database } from "./database.ts";

// Adds restroom_name to reviews from the restrooms table; Refuge listings have no local name.
export async function withRestroomNames(rows: unknown[]): Promise<Record<string, unknown>[]> {
  const ids = [...new Set(rows.flatMap(row => isRecord(row) && row.osm_type !== "refuge" &&
    Number.isSafeInteger(row.osm_id) ? [Number(row.osm_id)] : []))];
  const names = new Map<string, string>();
  if (ids.length) {
    const found: unknown = await (await database("restrooms", new URLSearchParams({
      select: "osm_type,osm_id,name", osm_id: `in.(${ids.join(",")})`, limit: "1000",
    }))).json();
    if (Array.isArray(found)) {
      for (const item of found) {
        if (isRecord(item) && typeof item.name === "string" && item.name) names.set(`${item.osm_type}:${item.osm_id}`, item.name);
      }
    }
  }
  return rows.map(row => {
    const review = row as Record<string, unknown>;
    const stored = typeof review.restroom_name === "string" && review.restroom_name ? review.restroom_name : null;
    return { ...review, restroom_name: stored ?? names.get(`${review.osm_type}:${review.osm_id}`) ?? null };
  });
}
