import { authorizeGatewayRequest } from "../_shared/gateway-auth.ts";
import { geocodeZipCode } from "../places-api/services/geocoding.ts";
import { RequestError } from "../places-api/utils/errors.ts";
import { locationDatabaseHeaders } from "../_shared/database-schema.ts";

// Carries an HTTP status alongside a frontend API error message.
class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Creates a no-store JSON response for frontend API routes.
const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

// Narrows unknown values to plain object records before field access.
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Reads a required environment variable or reports a configuration error.
function config(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new ApiError(503, `Missing ${name} in frontend-api.`);
  return value;
}

// Sends a bounded upstream request and avoids following redirects.
async function upstream(url: URL | string, init: RequestInit = {}) {
  return await fetch(url, { ...init, signal: AbortSignal.timeout(20_000), redirect: "manual" });
}

// Makes an authenticated Supabase REST request and maps database failures to API errors.
async function database(table: string, params: URLSearchParams, init: RequestInit = {}) {
  const key = config("SUPABASE_SERVICE_ROLE_KEY");
  const url = new URL(`/rest/v1/${table}`, config("SUPABASE_URL"));
  url.search = params.toString();
  const response = await upstream(url, {
    ...init,
    headers: {
      ...locationDatabaseHeaders(init.method),
      apikey: key, Authorization: `Bearer ${key}`,
      "Content-Type": "application/json", Prefer: "return=minimal",
    },
  });
  if (!response.ok) {
    const error: unknown = await response.json();
    if (table === "toilet_submissions") {
      if (isRecord(error) && error.code === "P0001") {
        throw new ApiError(429, "You have reached the limit of 3 toilet submissions per UTC day. Try again after midnight UTC.");
      }
      console.error("frontend-api toilet submission failed", { status: response.status });
      throw new ApiError(503, "Toilet could not be saved. Please try again.");
    }
    if (table === "rpc/moderate_toilet_submission") {
      if (isRecord(error) && error.code === "42501") throw new ApiError(403, "Moderator access required");
      console.error("frontend-api toilet moderation failed", { status: response.status });
      throw new ApiError(503, "Toilet moderation is temporarily unavailable");
    }
    if (isRecord(error) && error.code === "23505") {
      throw new ApiError(409, "You have already reviewed this restroom");
    }
    if (table === "rpc/save_owner_response" && isRecord(error)) {
      if (error.code === "42501") throw new ApiError(403, "Administrator access required");
      if (["22023", "23514", "23503", "22P02"].includes(String(error.code))) {
        throw new ApiError(422, error.code === "22023" && typeof error.message === "string" ?
          error.message : "Invalid owner response. Check the listing, approved review, and response fields.");
      }
    }
    console.error("frontend-api database request failed", { table, status: response.status });
    throw new ApiError(503, "Reviews are temporarily unavailable");
  }
  return response;
}

// Source type keeps Refuge IDs distinct from OpenStreetMap IDs.
function validRestroom(type: unknown, id: unknown): boolean {
  return typeof type === "string" && ["node", "way", "relation", "refuge"].includes(type) &&
    typeof id === "number" && Number.isSafeInteger(id) && id > 0;
}

async function toiletSubmissions(req: Request): Promise<Response> {
  if (req.method !== "POST") throw new ApiError(405, "Method not allowed");
  const userId = await requireAuthenticatedUser(req);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, "Invalid JSON");
  }
  if (!isRecord(body)) throw new ApiError(400, "Invalid toilet fields");
  const { name, latitude, longitude, wheelchair, fee, notes } = body;
  const validAnswer = (value: unknown) =>
    typeof value === "string" && ["yes", "no", "unknown"].includes(value);
  if (typeof name !== "string" || !name.trim() || name.trim().length > 120 ||
    typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < 17 || latitude > 72 ||
    typeof longitude !== "number" || !Number.isFinite(longitude) || longitude < -179 || longitude > -65 ||
    !validAnswer(wheelchair) || !validAnswer(fee) ||
    typeof notes !== "string" || notes.length > 1000) {
    throw new ApiError(400, "Enter a toilet name (up to 120 characters), valid US coordinates, accessibility, fee, and notes (up to 1000 characters).");
  }
  await database("toilet_submissions", new URLSearchParams(), {
    method: "POST",
    body: JSON.stringify({ name: name.trim(), latitude, longitude, wheelchair, fee, notes: notes.trim(), status: "pending", user_id: userId }),
  });
  return json(201, { message: "Toilet saved for moderation", status: "pending" });
}

// Lists approved reviews or validates and submits a new review for moderation.
async function reviews(req: Request): Promise<Response> {
  if (req.method === "GET") {
    const query = new URL(req.url).searchParams;
    const type = query.get("osm_type");
    const id = Number(query.get("osm_id"));
    if (!validRestroom(type, id)) throw new ApiError(400, "Invalid restroom");
    const latest = query.get("latest");
    if (latest !== null && latest !== "1") throw new ApiError(400, "Invalid latest comment query");
    const params = new URLSearchParams({
      select: "id,rating,availability,cleanliness_status,issues,comment,created_at", osm_type: `eq.${type}`,
      osm_id: `eq.${id}`, status: "eq.approved", order: "created_at.desc,id.desc", limit: latest ? "1" : "50",
    });
    if (latest) params.set("comment", "neq.");
    const data: unknown = await (await database("reviews", params)).json();
    if (!Array.isArray(data) || !data.every(row => isRecord(row) && typeof row.rating === "number")) {
      throw new ApiError(502, "Invalid reviews database response");
    }
    const summary: unknown = await (await database("rpc/approved_review_summary", new URLSearchParams(), {
      method: "POST", body: JSON.stringify({ p_osm_type: type, p_osm_id: id }),
    })).json();
    if (!Array.isArray(summary) || summary.length !== 1 || !isRecord(summary[0]) ||
      typeof summary[0].review_count !== "number" || !Number.isSafeInteger(summary[0].review_count) || summary[0].review_count < 0 ||
      (summary[0].review_count === 0 ? summary[0].average !== null :
        typeof summary[0].average !== "number" || !Number.isFinite(summary[0].average) || summary[0].average < 1 || summary[0].average > 5)) {
      throw new ApiError(502, "Invalid review summary database response");
    }
    return json(200, { reviews: data, count: data.length, average: summary[0].average, review_count: summary[0].review_count, limited_to: latest ? 1 : 50 });
  }
  if (req.method !== "POST") throw new ApiError(405, "Method not allowed");
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, "Invalid JSON");
  }
  if (!isRecord(body)) throw new ApiError(400, "Invalid review fields");
  const { osm_type, osm_id, rating, availability, cleanliness_status, issues, comment } = body;
  const allowedIssues = ["dirty_floor", "broken_fixture", "odor", "missing_supplies", "other"];
  if (!validRestroom(osm_type, osm_id) || typeof rating !== "number" ||
    !Number.isInteger(rating) || rating < 1 || rating > 5 ||
    typeof availability !== "string" || !["open", "closed", "temporarily_unavailable", "unverified"].includes(availability) ||
    typeof cleanliness_status !== "string" || !["excellent", "clean", "average", "poor", "very_dirty"].includes(cleanliness_status) ||
    !Array.isArray(issues) || issues.length > 6 ||
    issues.some(value => typeof value !== "string" || !allowedIssues.includes(value)) ||
    typeof comment !== "string" || comment.length > 1000) {
    throw new ApiError(400, "Invalid review fields");
  }
  const userId = await requireAuthenticatedUser(req);
  const locationParams = new URLSearchParams({
    select: "osm_id", osm_type: `eq.${osm_type}`, osm_id: `eq.${osm_id}`, limit: "1",
  });
  let locations: unknown = await (await database(osm_type === "refuge" ? "review_locations" : "restrooms", locationParams)).json();
  if (!Array.isArray(locations)) throw new ApiError(502, "Invalid restroom database response");
  if (!locations.length && osm_type !== "refuge") {
    locations = await (await database("review_locations", locationParams)).json();
    if (!Array.isArray(locations)) throw new ApiError(502, "Invalid restroom database response");
  }
  if (!locations.length) throw new ApiError(422, "Restroom is not in the verified location list. Refresh the search and try again.");
  await database("reviews", new URLSearchParams(), {
    method: "POST",
    body: JSON.stringify({ osm_type, osm_id, rating, availability, cleanliness_status, issues, comment: comment.trim(), user_id: userId, status: "pending" }),
  });
  return json(201, { message: "Review submitted for moderation", status: "pending" });
}

// Proxies supported Supabase Auth routes while forwarding only required headers.
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

async function requireAuthenticatedUser(req: Request): Promise<string> {
  const authorization = req.headers.get("authorization");
  if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) throw new ApiError(401, "Sign in to continue");
  const response = await upstream(new URL("/auth/v1/user", config("SUPABASE_URL")), {
    headers: { apikey: config("SUPABASE_ANON_KEY"), Authorization: authorization },
  });
  if (!response.ok) {
    if ([401, 403].includes(response.status)) throw new ApiError(401, "Your session has expired. Sign in again.");
    throw new ApiError(503, "Session validation is temporarily unavailable");
  }
  const user: unknown = await response.json();
  if (!isRecord(user) || typeof user.id !== "string" || !user.email_confirmed_at || user.is_anonymous === true) throw new ApiError(403, "A verified account is required");
  return user.id;
}

async function requireAllowlistedUser(req: Request, role: "moderator" | "admin"): Promise<string> {
  const userId = await requireAuthenticatedUser(req);
  const moderators: unknown = await (await database(role === "admin" ? "owner_response_admins" : "review_moderators", new URLSearchParams({
    select: "user_id", user_id: `eq.${userId}`, limit: "1",
  }))).json();
  if (!Array.isArray(moderators)) throw new ApiError(502, `Invalid ${role} lookup response`);
  if (!moderators.length) throw new ApiError(403, `Your account is not on the ${role} allowlist`);
  return userId;
}

async function moderateToilets(req: Request): Promise<Response> {
  if (!["GET", "POST"].includes(req.method)) throw new ApiError(405, "Method not allowed");
  const moderatorId = await requireAllowlistedUser(req, "moderator");
  if (req.method === "GET") {
    const rows: unknown = await (await database("toilet_submissions", new URLSearchParams({
      select: "id,name,latitude,longitude,wheelchair,fee,notes,status,created_at",
      status: "eq.pending", order: "created_at.asc,id.asc", limit: "50",
    }))).json();
    if (!Array.isArray(rows)) throw new ApiError(502, "Invalid toilet moderation queue response");
    return json(200, { submissions: rows, limited_to: 50 });
  }
  let body: unknown;
  try { body = await req.json(); } catch { throw new ApiError(400, "Invalid JSON"); }
  if (!isRecord(body) || typeof body.id !== "string" || !uuidPattern.test(body.id) ||
    typeof body.decision !== "string" || !["approved", "rejected"].includes(body.decision)) {
    throw new ApiError(400, "Invalid toilet moderation decision");
  }
  const rows: unknown = await (await database("rpc/moderate_toilet_submission", new URLSearchParams(), {
    method: "POST", body: JSON.stringify({ p_id: body.id, p_moderator_id: moderatorId, p_decision: body.decision }),
  })).json();
  if (!Array.isArray(rows)) throw new ApiError(502, "Invalid toilet moderation response");
  if (!rows.length) throw new ApiError(409, "This toilet is no longer pending. Refresh the queue.");
  if (rows.length !== 1 || !isRecord(rows[0]) || rows[0].id !== body.id || rows[0].status !== body.decision) {
    throw new ApiError(502, "Invalid toilet moderation response");
  }
  return json(200, { submission: rows[0] });
}

async function moderation(req: Request): Promise<Response> {
  if (!["GET", "POST"].includes(req.method)) throw new ApiError(405, "Method not allowed");
  const userId = await requireAllowlistedUser(req, "moderator");
  if (req.method === "GET") {
    const pending: unknown = await (await database("reviews", new URLSearchParams({
      select: "id,osm_type,osm_id,rating,availability,cleanliness_status,issues,comment,created_at,status",
      status: "eq.pending", order: "created_at.asc,id.asc", limit: "50",
    }))).json();
    if (!Array.isArray(pending)) throw new ApiError(502, "Invalid moderation queue response");
    return json(200, { reviews: pending, limited_to: 50 });
  }
  let body: unknown;
  try { body = await req.json(); } catch { throw new ApiError(400, "Invalid JSON"); }
  if (!isRecord(body) || typeof body.review_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.review_id) ||
    typeof body.decision !== "string" || !["approved", "rejected"].includes(body.decision) ||
    typeof body.note !== "string" || body.note.length > 2000) throw new ApiError(400, "Invalid moderation decision");
  const result: unknown = await (await database("rpc/moderate_review", new URLSearchParams(), {
    method: "POST",
    body: JSON.stringify({ p_review_id: body.review_id, p_moderator_id: userId, p_decision: body.decision, p_note: body.note.trim() }),
  })).json();
  if (!Array.isArray(result)) throw new ApiError(502, "Invalid moderation decision response");
  if (!result.length) throw new ApiError(409, "This review is no longer pending. Refresh the queue.");
  if (result.length !== 1 || !isRecord(result[0]) || result[0].id !== body.review_id || result[0].status !== body.decision) {
    throw new ApiError(502, "Invalid moderation decision response");
  }
  return json(200, { review: result[0] });
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const publicOwnerColumns = "id,osm_type,osm_id,review_id,business_name,body,completed_on,evidence_url,published_at";
const adminOwnerColumns = `${publicOwnerColumns},verification_note,status,version,updated_at`;

function ownerTarget(query: URLSearchParams, required: boolean): URLSearchParams {
  const params = new URLSearchParams();
  if (required || query.has("osm_type") || query.has("osm_id")) {
    const type = query.get("osm_type");
    const id = Number(query.get("osm_id"));
    if (!validRestroom(type, id)) throw new ApiError(400, "Invalid restroom");
    params.set("osm_type", `eq.${type}`);
    params.set("osm_id", `eq.${id}`);
  }
  return params;
}

async function ownerResponses(req: Request, admin: boolean): Promise<Response> {
  if (!(admin ? ["GET", "POST"] : ["GET"]).includes(req.method)) throw new ApiError(405, "Method not allowed");
  const adminId = admin ? await requireAllowlistedUser(req, "admin") : null;
  if (req.method === "GET") {
    const query = new URL(req.url).searchParams;
    const params = ownerTarget(query, !admin);
    params.set("select", admin ? adminOwnerColumns : publicOwnerColumns);
    params.set("order", admin ? "updated_at.desc,id.desc" : "published_at.desc,id.desc");
    params.set("limit", "50");
    const offsetText = query.get("offset") ?? "0";
    if (!/^\d{1,8}$/.test(offsetText)) throw new ApiError(400, "Invalid response offset");
    params.set("offset", offsetText);
    if (!admin) params.set("status", "eq.published");
    const rows: unknown = await (await database("owner_responses", params)).json();
    if (!Array.isArray(rows)) throw new ApiError(502, "Invalid owner response list");
    // Hide replies if their review is no longer approved, even after publication.
    let responses = rows;
    if (!admin) {
      const ids = rows.filter(isRecord).map(row => row.review_id).filter(id => typeof id === "string");
      if (ids.length) {
        if (!ids.every(id => uuidPattern.test(id))) throw new ApiError(502, "Invalid owner response review identity");
        const approved: unknown = await (await database("reviews", new URLSearchParams({
          select: "id", id: `in.(${ids.join(",")})`, status: "eq.approved",
          osm_type: params.get("osm_type")!, osm_id: params.get("osm_id")!,
        }))).json();
        if (!Array.isArray(approved) || !approved.every(isRecord)) throw new ApiError(502, "Invalid approved review lookup");
        const visible = new Set(approved.map(row => row.id));
        responses = rows.filter(row => isRecord(row) && (row.review_id === null || visible.has(row.review_id)));
      }
    }
    return json(200, { responses, next_offset: rows.length === 50 ? Number(offsetText) + 50 : null });
  }
  let body: unknown;
  try { body = await req.json(); } catch { throw new ApiError(400, "Invalid JSON"); }
  if (!isRecord(body) || typeof body.action !== "string" || !["save", "publish"].includes(body.action) ||
    (body.id !== null && (typeof body.id !== "string" || !uuidPattern.test(body.id))) ||
    (body.id === null ? body.version !== null : typeof body.version !== "number" || !Number.isSafeInteger(body.version) || body.version < 1) ||
    (body.action === "publish" && body.id === null)) throw new ApiError(400, "Invalid owner response action");
  let fields: Record<string, unknown> | null = null;
  if (body.action === "save") {
    const value = body.fields;
    if (!isRecord(value) || !validRestroom(value.osm_type, value.osm_id) ||
      (value.review_id !== null && (typeof value.review_id !== "string" || !uuidPattern.test(value.review_id))) ||
      typeof value.business_name !== "string" || !value.business_name.trim() || value.business_name.length > 200 ||
      typeof value.body !== "string" || !value.body.trim() || value.body.length > 4000 ||
      typeof value.verification_note !== "string" || !value.verification_note.trim() || value.verification_note.length > 2000 ||
      (value.evidence_url !== null && (typeof value.evidence_url !== "string" || value.evidence_url.length > 2000)) ||
      (value.completed_on !== null && (typeof value.completed_on !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value.completed_on) || !Number.isFinite(Date.parse(value.completed_on)) ||
        new Date(value.completed_on).toISOString().slice(0, 10) !== value.completed_on ||
        value.completed_on > new Date().toISOString().slice(0, 10)))) throw new ApiError(400, "Invalid owner response fields");
    if (value.evidence_url !== null) {
      let url: URL;
      try { url = new URL(value.evidence_url); } catch { throw new ApiError(400, "Evidence link must be a valid HTTPS URL"); }
      if (url.protocol !== "https:" || !url.hostname || url.username || url.password) throw new ApiError(400, "Evidence link must be HTTPS without credentials");
    }
    fields = {
      osm_type: value.osm_type, osm_id: value.osm_id, review_id: value.review_id,
      business_name: value.business_name.trim(), body: value.body.trim(), verification_note: value.verification_note.trim(),
      completed_on: value.completed_on, evidence_url: value.evidence_url,
    };
  }
  const result: unknown = await (await database("rpc/save_owner_response", new URLSearchParams(), {
    method: "POST", body: JSON.stringify({ p_admin_id: adminId, p_action: body.action, p_id: body.id, p_version: body.version, p_fields: fields }),
  })).json();
  if (!Array.isArray(result)) throw new ApiError(502, "Invalid owner response result");
  if (!result.length) throw new ApiError(409, "This draft has changed or was already published. Refresh before trying again.");
  if (result.length !== 1 || !isRecord(result[0]) || typeof result[0].id !== "string" ||
    result[0].status !== (body.action === "publish" ? "published" : "draft")) throw new ApiError(502, "Invalid owner response result");
  return json(200, { response: result[0] });
}

export default {
  // Authorizes gateway traffic and dispatches review, auth, geocoding, and map requests.
  async fetch(req: Request): Promise<Response> {
    const denied = authorizeGatewayRequest(req, json, "frontend-api");
    if (denied) return denied;
    const path = new URL(req.url).pathname.replace(/^\/(?:functions\/v1\/)?frontend-api(?=\/|$)/, "").replace(/\/$/, "") || "/";
    try {
      if (path === "/toilet-submissions") return await toiletSubmissions(req);
      if (path === "/moderation/toilets") return await moderateToilets(req);
      if (path === "/reviews") return await reviews(req);
      if (path === "/moderation/reviews") return await moderation(req);
      if (path === "/admin/owner-responses") return await ownerResponses(req, true);
      if (path === "/owner-responses") return await ownerResponses(req, false);
      if (path.startsWith("/auth/")) return await auth(req, path);
      if (req.method !== "GET") throw new ApiError(405, "Method not allowed");
      // Resolves ZIP codes or geocodes a US address, returning coordinates or suggestions.
      if (path === "/geocode") {
        const suggest = new URL(req.url).searchParams.get("suggest") === "1";
        const zip = new URL(req.url).searchParams.get("zip");
        if (zip !== null) {
          const origin = await geocodeZipCode(zip.trim());
          if (!origin) throw new ApiError(404, "No matching US ZIP code found.");
          if (suggest) return json(200, { suggestions: [{
            label: `ZIP ${origin.zipCode}, USA`, latitude: origin.latitude, longitude: origin.longitude,
          }] });
          return json(200, { latitude: origin.latitude, longitude: origin.longitude, zipCode: origin.zipCode });
        }
        const query = new URL(req.url).searchParams.get("q")?.trim();
        if (!query || query.length > 200) throw new ApiError(400, "Provide a US city or address (up to 200 characters).");
        const url = new URL("https://photon.komoot.io/api/");
        url.search = new URLSearchParams({ limit: suggest ? "5" : "1", countrycode: "US", lang: "en", q: query }).toString();
        const response = await upstream(url, { headers: { "User-Agent": "WashroomStatusUSA/1.0" } });
        if (!response.ok) {
          console.error("City geocoder failed", { status: response.status });
          throw new ApiError(502, `City or address lookup is unavailable (provider HTTP ${response.status})`);
        }
        const results: unknown = await response.json();
        if (!isRecord(results) || !Array.isArray(results.features)) throw new ApiError(502, "Invalid geocoding response");
        if (!results.features.length && !suggest) throw new ApiError(404, "No matching US city or address found.");
        const suggestions = results.features.slice(0, suggest ? 5 : 1).map((first: unknown) => {
          if (!isRecord(first) || !isRecord(first.geometry) ||
            first.geometry.type !== "Point" || !Array.isArray(first.geometry.coordinates) ||
            !isRecord(first.properties) || String(first.properties.countrycode).toUpperCase() !== "US") {
            throw new ApiError(502, "Invalid US geocoding result");
          }
          const [longitude, latitude] = first.geometry.coordinates;
          if (typeof latitude !== "number" || typeof longitude !== "number" ||
            !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
            Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new ApiError(502, "Invalid geocoding coordinates");
          const properties = first.properties;
          const street = [properties.housenumber, properties.street]
            .filter(value => typeof value === "string" && value.trim()).join(" ");
          const parts = [properties.name, street, properties.city || properties.town || properties.village,
            properties.state, properties.postcode, "USA"]
            .filter((value): value is string => typeof value === "string" && !!value.trim());
          return { latitude, longitude, label: [...new Set(parts)].join(", ") };
        });
        if (suggest) return json(200, { suggestions });
        const { latitude, longitude } = suggestions[0];
        return json(200, { latitude, longitude });
      }
      // Retrieves and validates the US boundary feature used to frame the map.
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
