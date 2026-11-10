import { ApiError, isRecord } from "./api-utils.ts";
import { locationDatabaseHeaders } from "../_shared/database-schema.ts";

// Reads a required environment variable or reports a configuration error.
export function config(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new ApiError(503, `Missing ${name} in frontend-api.`);
  return value;
}

// Sends a bounded upstream request and avoids following redirects.
export async function upstream(url: URL | string, init: RequestInit = {}) {
  return await fetch(url, { ...init, signal: AbortSignal.timeout(20_000), redirect: "manual" });
}

// Reads one page of rows plus the exact total from the Content-Range header.
export async function databasePage(table: string, params: URLSearchParams): Promise<{ rows: unknown; total: number | null }> {
  const response = await database(table, params, { headers: { Prefer: "count=exact" } });
  const match = /\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
  return { rows: await response.json(), total: match ? Number(match[1]) : null };
}

// Makes an authenticated Supabase REST request and maps database failures to API errors.
export async function database(table: string, params: URLSearchParams, init: RequestInit = {}) {
  const key = config("SUPABASE_SERVICE_ROLE_KEY");
  const url = new URL(`/rest/v1/${table}`, config("SUPABASE_URL"));
  url.search = params.toString();
  const response = await upstream(url, {
    ...init,
    headers: {
      ...locationDatabaseHeaders(init.method),
      apikey: key, Authorization: `Bearer ${key}`,
      "Content-Type": "application/json", Prefer: "return=minimal",
            ...(init.headers as Record<string, string> | undefined),
          },
  });
  if (!response.ok) {
    const error: unknown = await response.json();
    if (table === "rpc/admin_review_reply") {
      if (isRecord(error) && error.code === "42501") throw new ApiError(403, "Administrator access required");
      if (isRecord(error) && error.code === "22023") throw new ApiError(422,
        typeof error.message === "string" ? error.message : "Invalid review reply");
      console.error("frontend-api reply storage failed", { status: response.status });
      throw new ApiError(503, "Reply storage is unavailable. Refresh to check the saved reply before retrying.");
    }
    if (table === "rpc/admin_archive_review") {
      if (isRecord(error) && error.code === "42501") throw new ApiError(403, "Administrator access required");
      console.error("frontend-api review archive failed", { status: response.status });
      throw new ApiError(503, "Review archive is unavailable. Refresh and try again.");
    }
    if (table === "rpc/admin_add_owner_review_photo") {
      if (isRecord(error) && error.code === "42501") throw new ApiError(403, "Administrator access required");
      if (isRecord(error) && error.code === "22023" && typeof error.message === "string") {
        throw new ApiError(422, error.message);
      }
      console.error("frontend-api owner review photo approval failed", { status: response.status });
      throw new ApiError(503, "Owner photo approval is temporarily unavailable");
    }
    if (table === "rpc/admin_archive_toilet") {
      if (isRecord(error) && error.code === "42501") throw new ApiError(403, "Administrator access required");
      console.error("frontend-api toilet archive failed", { status: response.status });
      throw new ApiError(503, "Toilet archive is unavailable. Refresh and try again.");
    }
    if (table === "rpc/admin_publish_toilet") {
      if (isRecord(error) && error.code === "42501") throw new ApiError(403, "Administrator access required");
      console.error("frontend-api toilet publish failed", { status: response.status });
      throw new ApiError(503, "Toilet approval is unavailable. Refresh and try again.");
    }
    if (table === "rpc/admin_create_owner_invite" || table === "rpc/owner_submit_reply" ||
      table === "rpc/owner_submit_review_photos" || table === "rpc/owner_reply_decide" ||
      table === "rpc/admin_archive_owner_reply" || table === "rpc/admin_archive_owner_response") {
      if (isRecord(error) && error.code === "42501") throw new ApiError(403, "Access denied for this action");
      if (isRecord(error) && error.code === "22023" && typeof error.message === "string") throw new ApiError(422, error.message);
      console.error("frontend-api owner contribution failed", { table, status: response.status });
      throw new ApiError(503, "Owner contributions are temporarily unavailable");
    }
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
    if (table === "reviews" && isRecord(error) && error.code === "P0001") {
      throw new ApiError(429, "You have reached the limit of 3 reviews per UTC day. Try again after midnight UTC.");
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

export async function rpcRows(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const rows: unknown = await (await database(`rpc/${name}`, new URLSearchParams(), {
    method: "POST", body: JSON.stringify(args),
  })).json();
  if (!Array.isArray(rows) || !rows.every(isRecord)) throw new ApiError(502, "Invalid owner reply response");
  return rows;
}
