import { ApiError, readJson, uuidPattern, json, isRecord } from "./api-utils.ts";
import { requireVerifiedAccount, requireAllowlistedUser } from "./auth.ts";
import { ownerReviewPhotoLimit, reviewPhotoTypes, reviewPhotoMaxBytes, hasMatchingImageSignature, uploadReviewPhoto, deleteReviewPhotos } from "./review-photos.ts";
import { rpcRows, databasePage, database } from "./database.ts";
import { ownerReplyColumns } from "./owner-columns.ts";
import { withRestroomNames } from "./restroom-names.ts";
import { withOwnerReplyPhotos } from "./owner-reply-photos.ts";

// Owner: submit a reply; it enters moderation (step 1).
export async function ownerReplies(req: Request): Promise<Response> {
  if (req.method !== "POST") throw new ApiError(405, "Method not allowed");
  const account = await requireVerifiedAccount(req);
  let body: Record<string, unknown>;
  let photos: File[] = [];
  if (req.headers.get("content-type")?.toLowerCase().includes("multipart/form-data")) {
    let form: FormData;
    try { form = await req.formData(); } catch { throw new ApiError(400, "Invalid owner reply submission"); }
    const values = form.getAll("photos");
    if (values.length > ownerReviewPhotoLimit || values.some(value => typeof value === "string" || !(value instanceof File))) {
      throw new ApiError(400, "Choose up to 3 image files for your response.");
    }
    photos = values as File[];
    body = {
      invite_id: form.get("invite_id"),
      business_name: form.get("business_name"),
      body: form.get("body"),
    };
  } else {
    body = await readJson(req);
  }
  if (typeof body.reply_id === "string" && uuidPattern.test(body.reply_id) && typeof body.archived === "boolean") {
    const rows = await rpcRows("owner_archive_reply", {
      p_owner_id: account.id, p_email: account.email, p_id: body.reply_id, p_archived: body.archived,
    });
    if (!rows.length) throw new ApiError(409, "This reply cannot be archived yet. Refresh.");
    return json(200, { reply: rows[0] });
  }
  if (typeof body.invite_id !== "string" || !uuidPattern.test(body.invite_id) ||
    typeof body.business_name !== "string" || typeof body.body !== "string") throw new ApiError(400, "Invalid owner reply");
  if (photos.some(file => !reviewPhotoTypes.has(file.type) || file.size <= 0 ||
    file.size > reviewPhotoMaxBytes) ||
    !(await Promise.all(photos.map(hasMatchingImageSignature))).every(Boolean)) {
    throw new ApiError(400, "Choose JPEG, PNG, or WebP photos smaller than 5 MB each.");
  }
  const photoPaths = photos.map(file => {
    const extension = file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
    return `${account.id}/${crypto.randomUUID()}.${extension}`;
  });
  try {
    for (const [index, file] of photos.entries()) await uploadReviewPhoto(photoPaths[index], file);
    const rows = await rpcRows("owner_submit_reply", {
      p_user_id: account.id, p_email: account.email, p_invite_id: body.invite_id,
      p_business_name: body.business_name, p_body: body.body, p_photo_paths: photoPaths,
    });
    if (rows.length !== 1 || typeof rows[0].id !== "string" || rows[0].status !== "pending") {
      throw new ApiError(502, "Invalid owner reply response");
    }
    return json(201, { reply: rows[0] });
  } catch (error) {
    await deleteReviewPhotos(photoPaths);
    throw error;
  }
}

// Step 1 (moderator) and step 2 (administrator) share the same list and decision logic.
export async function ownerReplyStage(req: Request, stage: "moderate" | "publish"): Promise<Response> {
  if (!["GET", "POST"].includes(req.method)) throw new ApiError(405, "Method not allowed");
  const actorId = await requireAllowlistedUser(req, stage === "moderate" ? "moderator" : "admin");
  if (req.method === "POST") {
    const body = await readJson(req);
    if (stage === "publish" && typeof body.archived === "boolean" && typeof body.reply_id === "string" &&
      uuidPattern.test(body.reply_id)) {
      const archiveRows = await rpcRows("admin_archive_owner_reply", {
        p_admin_id: actorId, p_id: body.reply_id, p_archived: body.archived,
      });
      if (!archiveRows.length) throw new ApiError(409, "This reply cannot be archived yet. Refresh.");
      return json(200, { reply: archiveRows[0] });
    }
    if (typeof body.reply_id !== "string" || !uuidPattern.test(body.reply_id) || typeof body.approve !== "boolean") {
      throw new ApiError(400, "Invalid owner reply decision");
    }
    const rows = await rpcRows("owner_reply_decide", {
      p_actor_id: actorId, p_id: body.reply_id, p_stage: stage, p_approve: body.approve,
    });
    if (!rows.length) throw new ApiError(409, "This reply is no longer waiting at this step. Refresh.");
    return json(200, { reply: rows[0] });
  }
  const replyQuery = new URL(req.url).searchParams;
  const offset = replyQuery.get("offset") ?? "0";
  if (!/^\d{1,8}$/.test(offset)) throw new ApiError(400, "Invalid offset");
  const awaitingAdmin = replyQuery.get("awaiting_admin") ?? "0";
  if (awaitingAdmin !== "0" && (stage !== "publish" || awaitingAdmin !== "1")) {
    throw new ApiError(400, "Invalid owner reply notification filter");
  }
  const archivedParam = replyQuery.get("archived") === "1" ? "not.is.null" : "is.null";
  const { rows, total } = await databasePage("owner_replies", new URLSearchParams({
    select: ownerReplyColumns,
    status: stage === "moderate" ? "eq.pending" : awaitingAdmin === "1" ? "eq.moderated" : "in.(moderated,published,rejected)",
    archived_at: archivedParam,
    order: "created_at.asc,id.asc", limit: "3", offset,
  }));
  if (!Array.isArray(rows) || !rows.every(isRecord)) throw new ApiError(502, "Invalid owner reply list");
  const reviewIds = rows.map(r => String(r.review_id)).filter(id => uuidPattern.test(id));
  const reviews: unknown = reviewIds.length ? await (await database("reviews", new URLSearchParams({
    select: "id,osm_type,osm_id,restroom_name,comment", id: `in.(${reviewIds.join(",")})`,
  }))).json() : [];
  const named = Array.isArray(reviews) ? await withRestroomNames(reviews.filter(isRecord)) : [];
  const repliesWithPhotos = await withOwnerReplyPhotos(rows);
  return json(200, {
    total, replies: repliesWithPhotos.map(reply => ({
      ...reply, review: named.find(v => v.id === reply.review_id) ?? null,
    })),
    next_offset: rows.length === 3 ? Number(offset) + 3 : null,
  });
}
