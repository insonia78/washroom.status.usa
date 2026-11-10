// Admin lists use 3 per page; the workflow board loads up to 25 per request.
export function adminPageLimit(query: URLSearchParams): number {
  const limit = query.get("limit") ?? "3";
  if (limit !== "3" && limit !== "25") throw new ApiError(400, "Invalid page size");
  return Number(limit);
}

// Carries an HTTP status alongside a frontend API error message.
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Creates a no-store JSON response for frontend API routes.
export const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

// Narrows unknown values to plain object records before field access.
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Source type keeps Refuge IDs distinct from OpenStreetMap IDs.
export function validRestroom(type: unknown, id: unknown): boolean {
  return typeof type === "string" && ["node", "way", "relation", "refuge"].includes(type) &&
    typeof id === "number" && Number.isSafeInteger(id) && id > 0;
}

export const maxContributionMiles = 11;
export function milesBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (v: number) => v * Math.PI / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
export function usCoordinates(lat: unknown, lon: unknown): [number, number] | null {
  return typeof lat === "number" && typeof lon === "number" && Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= 17 && lat <= 72 && lon >= -179 && lon <= -65 ? [lat, lon] : null;
}

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try { body = await req.json(); } catch { throw new ApiError(400, "Invalid JSON"); }
  if (!isRecord(body)) throw new ApiError(400, "Invalid request");
  return body;
}
