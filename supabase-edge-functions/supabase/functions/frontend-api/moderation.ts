import { ApiError, isRecord, json, uuidPattern } from "./api-utils.ts";
import { requireAllowlistedUser } from "./auth.ts";
import { databasePage, database } from "./database.ts";
import { signedReviewPhotos } from "./review-photos.ts";
import { withRestroomNames } from "./restroom-names.ts";

export async function moderateToilets(req: Request): Promise<Response> {
  if (!["GET", "POST"].includes(req.method)) throw new ApiError(405, "Method not allowed");
  const moderatorId = await requireAllowlistedUser(req, "moderator");
  if (req.method === "GET") {
    const offset = new URL(req.url).searchParams.get("offset") ?? "0";
    if (!/^\d{1,8}$/.test(offset)) throw new ApiError(400, "Invalid offset");
    const { rows, total } = await databasePage("toilet_submissions", new URLSearchParams({
      select: "id,name,latitude,longitude,wheelchair,fee,notes,status,created_at,photo_paths",
      status: "eq.pending", order: "created_at.asc,id.asc", limit: "3", offset,
    }));
    if (!Array.isArray(rows)) throw new ApiError(502, "Invalid toilet moderation queue response");
    const submissions = await Promise.all(rows.map(async row => {
      if (!isRecord(row)) throw new ApiError(502, "Invalid toilet moderation queue response");
      const { photo_paths, ...details } = row;
      return { ...details, photo_urls: await signedReviewPhotos(photo_paths) };
    }));
    return json(200, { submissions, limited_to: 3, total, next_offset: rows.length === 3 ? Number(offset) + 3 : null });
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

export async function moderation(req: Request): Promise<Response> {
  if (!["GET", "POST"].includes(req.method)) throw new ApiError(405, "Method not allowed");
  const userId = await requireAllowlistedUser(req, "moderator");
  if (req.method === "GET") {
    const offset = new URL(req.url).searchParams.get("offset") ?? "0";
    if (!/^\d{1,8}$/.test(offset)) throw new ApiError(400, "Invalid offset");
    const { rows: pending, total } = await databasePage("reviews", new URLSearchParams({
      select: "id,osm_type,osm_id,restroom_name,rating,availability,cleanliness_status,issues,comment,created_at,status,photo_paths",
      status: "eq.pending", order: "created_at.asc,id.asc", limit: "3", offset,
    }));
    if (!Array.isArray(pending)) throw new ApiError(502, "Invalid moderation queue response");
    const reviewsWithPhotos = await Promise.all(pending.map(async review => {
      if (!isRecord(review)) throw new ApiError(502, "Invalid moderation queue response");
      const { photo_paths, ...details } = review;
      return { ...details, photo_urls: await signedReviewPhotos(photo_paths) };
    }));
    return json(200, { reviews: await withRestroomNames(reviewsWithPhotos), limited_to: 3, total, next_offset: pending.length === 3 ? Number(offset) + 3 : null });
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
