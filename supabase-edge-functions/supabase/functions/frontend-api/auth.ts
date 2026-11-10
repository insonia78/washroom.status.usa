import { ApiError, isRecord } from "./api-utils.ts";
import { config, upstream, database } from "./database.ts";

// Proxies supported Supabase Auth routes while forwarding only required headers.
export async function auth(req: Request, path: string): Promise<Response> {
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

export async function requireAuthenticatedUser(req: Request): Promise<string> {
  return (await requireVerifiedAccount(req)).id;
}

export async function requireVerifiedAccount(req: Request): Promise<{ id: string; email: string }> {
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
    return { id: user.id, email: typeof user.email === "string" ? user.email.toLowerCase() : "" };
}

export async function requireAllowlistedUser(req: Request, role: "moderator" | "admin"): Promise<string> {
  const userId = await requireAuthenticatedUser(req);
  const moderators: unknown = await (await database(role === "admin" ? "owner_response_admins" : "review_moderators", new URLSearchParams({
    select: "user_id", user_id: `eq.${userId}`, limit: "1",
  }))).json();
  if (!Array.isArray(moderators)) throw new ApiError(502, `Invalid ${role} lookup response`);
  if (!moderators.length) throw new ApiError(403, `Your account is not on the ${role} allowlist`);
  return userId;
}
