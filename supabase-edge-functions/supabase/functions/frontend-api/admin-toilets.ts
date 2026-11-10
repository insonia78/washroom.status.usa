import { ApiError, isRecord, uuidPattern, json, adminPageLimit } from "./api-utils.ts";
import { requireAllowlistedUser } from "./auth.ts";
import { database, databasePage } from "./database.ts";
import { signedReviewPhotos } from "./review-photos.ts";
import { toiletHistory, toiletStage } from "./workflow-history.ts";

export async function adminToilets(req: Request): Promise<Response> {
  if (!["GET", "POST"].includes(req.method)) throw new ApiError(405, "Method not allowed");
  const adminId = await requireAllowlistedUser(req, "admin");
  if (req.method === "POST") {
    let body: unknown;
    try { body = await req.json(); } catch { throw new ApiError(400, "Invalid JSON"); }
    if (isRecord(body) && typeof body.toilet_id === "string" && uuidPattern.test(body.toilet_id) &&
      typeof body.publish === "boolean") {
      const published: unknown = await (await database("rpc/admin_publish_toilet", new URLSearchParams(), {
        method: "POST",
        body: JSON.stringify({ p_admin_id: adminId, p_toilet_id: body.toilet_id, p_publish: body.publish }),
      })).json();
      if (!Array.isArray(published) || published.length > 1) throw new ApiError(502, "Invalid approval response");
      if (!published.length) throw new ApiError(409, "Only moderator-approved toilets can be given final approval");
      const result: unknown = published[0];
      if (!isRecord(result) || result.id !== body.toilet_id || (result.published_at === null) === body.publish) {
        throw new ApiError(502, "Invalid approval response");
      }
      return json(200, { toilet: result });
    }
    if (!isRecord(body) || typeof body.toilet_id !== "string" || !uuidPattern.test(body.toilet_id) ||
      typeof body.archived !== "boolean") throw new ApiError(400, "Invalid archive request");
    const rows: unknown = await (await database("rpc/admin_archive_toilet", new URLSearchParams(), {
      method: "POST",
      body: JSON.stringify({ p_admin_id: adminId, p_toilet_id: body.toilet_id, p_archived: body.archived }),
    })).json();
    if (!Array.isArray(rows) || rows.length > 1) throw new ApiError(502, "Invalid archive response");
    if (!rows.length) throw new ApiError(404, "Toilet not found");
    const row: unknown = rows[0];
    if (!isRecord(row) || row.id !== body.toilet_id || (row.archived_at === null) === body.archived) {
      throw new ApiError(502, "Invalid archive response");
    }
    return json(200, { toilet: row });
  }
  const query = new URL(req.url).searchParams;
  const offset = query.get("offset") ?? "0";
  if (!/^\d{1,8}$/.test(offset)) throw new ApiError(400, "Invalid toilet offset");
  const archived = query.get("archived") ?? "0";
  if (archived !== "0" && archived !== "1") throw new ApiError(400, "Invalid archived filter");
  const moderation = query.get("moderation") ?? "moderated";
  if (!["moderated", "pending", "awaiting_admin", "all"].includes(moderation)) throw new ApiError(400, "Invalid moderation filter");
  const limit = adminPageLimit(query);
  const { rows, total } = await databasePage("toilet_submissions", new URLSearchParams({
    select: "id,user_id,name,latitude,longitude,wheelchair,fee,notes,status,created_at,moderated_at,archived_at,published_at,photo_paths",
    archived_at: archived === "1" ? "not.is.null" : "is.null",
    ...(moderation === "all" ? {} : {
      status: moderation === "pending" ? "eq.pending" : moderation === "awaiting_admin" ? "eq.approved" : "in.(approved,rejected)",
    }),
    ...(moderation === "awaiting_admin" ? { published_at: "is.null" } : {}),
    order: "created_at.desc,id.desc", limit: String(limit), offset,
  }));
  if (!Array.isArray(rows)) throw new ApiError(502, "Invalid admin toilet list");
  const toilets = await Promise.all(rows.map(async row => {
    if (!isRecord(row)) throw new ApiError(502, "Invalid admin toilet list");
    const { photo_paths, ...details } = row;
    return {
      ...details, photo_urls: await signedReviewPhotos(photo_paths),
      history: toiletHistory(row), stage: toiletStage(row),
    };
  }));
  return json(200, { toilets, total, next_offset: rows.length === limit ? Number(offset) + limit : null });
}
