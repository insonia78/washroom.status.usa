import { authorizeGatewayRequest } from "../_shared/gateway-auth.ts";
import { geocodeZipCode } from "../places-api/services/geocoding.ts";
import { RequestError } from "../places-api/utils/errors.ts";

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function config(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new ApiError(503, `Missing ${name} in frontend-api.`);
  return value;
}

async function upstream(url: URL | string, init: RequestInit = {}) {
  return await fetch(url, { ...init, signal: AbortSignal.timeout(20_000), redirect: "manual" });
}

async function database(table: string, params: URLSearchParams, init: RequestInit = {}) {
  const key = config("SUPABASE_SERVICE_ROLE_KEY");
  const url = new URL(`/rest/v1/${table}`, config("SUPABASE_URL"));
  url.search = params.toString();
  const response = await upstream(url, {
    ...init,
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      "Content-Type": "application/json", Prefer: "return=minimal",
    },
  });
  if (!response.ok) {
    const error: unknown = await response.json();
    if (isRecord(error) && error.code === "23505") {
      throw new ApiError(409, "You have already reviewed this restroom");
    }
    console.error("frontend-api database request failed", { table, status: response.status });
    throw new ApiError(503, "Reviews are temporarily unavailable");
  }
  return response;
}

function validRestroom(type: unknown, id: unknown): boolean {
  return typeof type === "string" && ["node", "way", "relation"].includes(type) &&
    typeof id === "number" && Number.isSafeInteger(id) && id > 0;
}

async function reviews(req: Request): Promise<Response> {
  if (req.method === "GET") {
    const query = new URL(req.url).searchParams;
    const type = query.get("osm_type");
    const id = Number(query.get("osm_id"));
    if (!validRestroom(type, id)) throw new ApiError(400, "Invalid restroom");
    const params = new URLSearchParams({
      select: "id,rating,issues,comment,created_at", osm_type: `eq.${type}`,
      osm_id: `eq.${id}`, status: "eq.approved", order: "created_at.desc", limit: "50",
    });
    const data: unknown = await (await database("reviews", params)).json();
    if (!Array.isArray(data) || !data.every(row => isRecord(row) && typeof row.rating === "number")) {
      throw new ApiError(502, "Invalid reviews database response");
    }
    const sum = data.reduce((total, row) => total + row.rating, 0);
    return json(200, { reviews: data, count: data.length, average: data.length ? sum / data.length : null, limited_to: 50 });
  }
  if (req.method !== "POST") throw new ApiError(405, "Method not allowed");
  const authorization = req.headers.get("authorization");
  if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) {
    throw new ApiError(401, "Sign in to submit a review");
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, "Invalid JSON");
  }
  if (!isRecord(body)) throw new ApiError(400, "Invalid review fields");
  const { osm_type, osm_id, rating, issues, comment } = body;
  const allowedIssues = ["dirty_floor", "broken_fixture", "odor", "missing_supplies", "other"];
  if (!validRestroom(osm_type, osm_id) || typeof rating !== "number" ||
    !Number.isInteger(rating) || rating < 1 || rating > 5 ||
    !Array.isArray(issues) || issues.length > 6 ||
    issues.some(value => typeof value !== "string" || !allowedIssues.includes(value)) ||
    typeof comment !== "string" || comment.length > 1000) {
    throw new ApiError(400, "Invalid review fields");
  }
  const userResponse = await upstream(new URL("/auth/v1/user", config("SUPABASE_URL")), {
    headers: { apikey: config("SUPABASE_ANON_KEY"), Authorization: authorization },
  });
  if (!userResponse.ok) {
    if ([401, 403].includes(userResponse.status)) throw new ApiError(401, "Invalid session");
    throw new ApiError(502, "Session validation is temporarily unavailable");
  }
  const user: unknown = await userResponse.json();
  if (!isRecord(user) || typeof user.id !== "string") throw new ApiError(502, "Invalid authentication response");
  const locations: unknown = await (await database("restrooms", new URLSearchParams({
    select: "osm_id", osm_type: `eq.${osm_type}`, osm_id: `eq.${osm_id}`, limit: "1",
  }))).json();
  if (!Array.isArray(locations)) throw new ApiError(502, "Invalid restroom database response");
  if (!locations.length) throw new ApiError(422, "Restroom is not in the verified imported location list");
  await database("reviews", new URLSearchParams(), {
    method: "POST",
    body: JSON.stringify({ osm_type, osm_id, rating, issues, comment: comment.trim(), user_id: user.id, status: "pending" }),
  });
  return json(201, { message: "Review submitted for moderation", status: "pending" });
}

async function auth(req: Request, path: string): Promise<Response> {
  const allowed = path === "/auth/v1/user" ? ["GET", "PUT"] :
    /^\/auth\/v1\/(otp|verify|token|logout)$/.test(path) ? ["POST"] : [];
  if (!allowed.length) throw new ApiError(404, "Route not found");
  if (!allowed.includes(req.method)) throw new ApiError(405, "Method not allowed");
  const url = new URL(path, config("SUPABASE_URL"));
  url.search = new URL(req.url).search;
  const headers = new Headers({ apikey: config("SUPABASE_ANON_KEY") });
  for (const name of ["authorization", "content-type", "x-client-info", "x-supabase-api-version"]) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  const response = await upstream(url, {
    method: req.method, headers,
    body: req.method === "GET" ? undefined : await req.arrayBuffer(),
  });
  const responseHeaders = new Headers({ "Cache-Control": "no-store" });
  for (const name of ["content-type", "retry-after"]) {
    const value = response.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new Response(response.body, { status: response.status, headers: responseHeaders });
}

export default {
  async fetch(req: Request): Promise<Response> {
    const denied = authorizeGatewayRequest(req, json, "frontend-api");
    if (denied) return denied;
    const path = new URL(req.url).pathname.replace(/^\/(?:functions\/v1\/)?frontend-api(?=\/|$)/, "").replace(/\/$/, "") || "/";
    try {
      if (path === "/reviews") return await reviews(req);
      if (path.startsWith("/auth/")) return await auth(req, path);
      if (req.method !== "GET") throw new ApiError(405, "Method not allowed");
      if (path === "/geocode") {
        const zip = new URL(req.url).searchParams.get("zip");
        if (zip !== null) {
          const origin = await geocodeZipCode(zip.trim());
          if (!origin) throw new ApiError(404, "No matching US ZIP code found.");
          return json(200, { latitude: origin.latitude, longitude: origin.longitude, zipCode: origin.zipCode });
        }
        const query = new URL(req.url).searchParams.get("q")?.trim();
        if (!query || query.length > 200) throw new ApiError(400, "Provide a US city or address (up to 200 characters).");
        const url = new URL("https://photon.komoot.io/api/");
        url.search = new URLSearchParams({ limit: "1", countrycode: "US", lang: "en", q: query }).toString();
        const response = await upstream(url, { headers: { "User-Agent": "WashroomStatusUSA/1.0" } });
        if (!response.ok) {
          console.error("City geocoder failed", { status: response.status });
          throw new ApiError(502, `City or address lookup is unavailable (provider HTTP ${response.status})`);
        }
        const results: unknown = await response.json();
        if (!isRecord(results) || !Array.isArray(results.features)) throw new ApiError(502, "Invalid geocoding response");
        if (!results.features.length) throw new ApiError(404, "No matching US city or address found.");
        const first: unknown = results.features[0];
        if (!isRecord(first) || !isRecord(first.geometry) ||
          first.geometry.type !== "Point" || !Array.isArray(first.geometry.coordinates) ||
          !isRecord(first.properties) || String(first.properties.countrycode).toUpperCase() !== "US") {
          throw new ApiError(502, "Invalid US geocoding result");
        }
        const [longitude, latitude] = first.geometry.coordinates;
        if (typeof latitude !== "number" || typeof longitude !== "number" ||
          !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
          Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new ApiError(502, "Invalid geocoding coordinates");
        return json(200, { latitude, longitude });
      }
      if (path === "/map-boundary") {
        const response = await upstream("https://raw.githubusercontent.com/johan/world.geo.json/master/countries/USA.geo.json");
        if (!response.ok) throw new ApiError(502, "US boundary unavailable");
        const data: unknown = await response.json();
        const feature: unknown = isRecord(data) && data.type === "FeatureCollection" &&
          Array.isArray(data.features) ? data.features[0] : data;
        if (!isRecord(feature) || !isRecord(feature.geometry) ||
          !["Polygon", "MultiPolygon"].includes(String(feature.geometry.type)) ||
          !Array.isArray(feature.geometry.coordinates)) throw new ApiError(502, "Invalid US boundary response");
        return json(200, feature);
      }
      throw new ApiError(404, "Route not found");
    } catch (error) {
      console.error("frontend-api request failed", { path, error: error instanceof Error ? error.message : String(error) });
      const status = error instanceof ApiError || error instanceof RequestError ? error.status :
        error instanceof Error && error.name === "TimeoutError" ? 504 : 502;
      return json(status, { error: error instanceof ApiError || error instanceof RequestError ? error.message : "Application backend is temporarily unavailable" });
    }
  },
};
