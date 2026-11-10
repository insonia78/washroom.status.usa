import { ApiError, isRecord, uuidPattern, json, adminPageLimit } from "./api-utils.ts";
import { requireAllowlistedUser } from "./auth.ts";
import { rpcRows, database, databasePage } from "./database.ts";
import { signedReviewPhotos } from "./review-photos.ts";
import { ownerReplyColumns } from "./owner-columns.ts";
import { withOwnerReplyPhotos } from "./owner-reply-photos.ts";
import { emailReplyOrder, emailOwnerPhotoPaths, reviewHistory, reviewStage } from "./workflow-history.ts";
import { withRestroomNames } from "./restroom-names.ts";

export async function adminReviews(req: Request): Promise<Response> {
  if (!["GET", "POST"].includes(req.method)) throw new ApiError(405, "Method not allowed");
  const adminId = await requireAllowlistedUser(req, "admin");
  if (req.method === "POST") {
    let body: unknown;
    try { body = await req.json(); } catch { throw new ApiError(400, "Invalid JSON"); }
    if (isRecord(body) && body.action === "add_owner_photo") {
      if (typeof body.photo_id !== "string" || !uuidPattern.test(body.photo_id)) throw new ApiError(400, "Invalid owner photo");
      const photoRows = await rpcRows("admin_add_owner_review_photo", {
        p_admin_id: adminId, p_photo_id: body.photo_id,
      });
      if (!photoRows.length) throw new ApiError(409, "This owner photo is no longer available. Refresh the review.");
      const photoReview = photoRows[0];
      if (typeof photoReview.id !== "string" || !uuidPattern.test(photoReview.id) ||
        !Array.isArray(photoReview.photo_paths) || !photoReview.photo_paths.every(path => typeof path === "string")) {
        throw new ApiError(502, "Invalid owner photo approval response");
      }
      return json(200, {
        review: { id: photoReview.id, photo_urls: await signedReviewPhotos(photoReview.photo_paths) },
      });
    }
    if (!isRecord(body) || typeof body.review_id !== "string" || !uuidPattern.test(body.review_id) ||
      typeof body.archived !== "boolean") throw new ApiError(400, "Invalid archive request");
    const rows: unknown = await (await database("rpc/admin_archive_review", new URLSearchParams(), {
      method: "POST",
      body: JSON.stringify({ p_admin_id: adminId, p_review_id: body.review_id, p_archived: body.archived }),
    })).json();
    if (!Array.isArray(rows) || rows.length > 1) throw new ApiError(502, "Invalid archive response");
    if (!rows.length) throw new ApiError(404, "Review not found");
    const row: unknown = rows[0];
    if (!isRecord(row) || row.id !== body.review_id || (row.archived_at === null) === body.archived) {
      throw new ApiError(502, "Invalid archive response");
    }
    return json(200, { review: row });
  }
  const query = new URL(req.url).searchParams;
  const offset = query.get("offset") ?? "0";
  if (!/^\d{1,8}$/.test(offset)) throw new ApiError(400, "Invalid review offset");
  const archived = query.get("archived") ?? "0";
  if (archived !== "0" && archived !== "1" && archived !== "all") throw new ApiError(400, "Invalid archived filter");
  const moderation = query.get("moderation") ?? "moderated";
  if (!["moderated", "pending", "all"].includes(moderation)) throw new ApiError(400, "Invalid moderation filter");
  const limit = adminPageLimit(query);
  const reviewParams = new URLSearchParams({
    select: "id,user_id,osm_type,osm_id,restroom_name,rating,availability,cleanliness_status,issues,comment,status,created_at,archived_at,photo_paths",
    order: "created_at.desc,id.desc", limit: String(limit), offset,
  });
  if (moderation !== "all") reviewParams.set("status", moderation === "pending" ? "eq.pending" : "in.(approved,rejected)");
  if (archived !== "all") reviewParams.set("archived_at", archived === "1" ? "not.is.null" : "is.null");
  const { rows, total } = await databasePage("reviews", reviewParams);
  if (!Array.isArray(rows)) throw new ApiError(502, "Invalid admin review list");
  const reviewIds = rows.filter(isRecord).map(review => review.id)
    .filter((id): id is string => typeof id === "string" && uuidPattern.test(id));
  const ownerPhotos: unknown = reviewIds.length ? await (await database("owner_review_photos", new URLSearchParams({
    select: "id,review_id,photo_path,status,uploaded_at,reviewed_at", review_id: `in.(${reviewIds.join(",")})`,
    status: "in.(pending,added)", order: "uploaded_at.asc", limit: "50",
  }))).json() : [];
  if (!Array.isArray(ownerPhotos) || !ownerPhotos.every(isRecord)) throw new ApiError(502, "Invalid owner photo list");
  const historyRows = async (table: string, select: string, order: string) => {
    const result: unknown = reviewIds.length ? await (await database(table, new URLSearchParams({
      select, review_id: `in.(${reviewIds.join(",")})`, order, limit: "200",
    }))).json() : [];
    if (!Array.isArray(result) || !result.every(isRecord)) throw new ApiError(502, "Invalid review history");
    return result;
  };
  const [moderationLog, invites, ownerReplyRows, privateReplies] = await Promise.all([
    historyRows("review_moderation_log", "review_id,decision,note,created_at", "created_at.asc"),
    historyRows("owner_invites", "review_id,email,created_at", "created_at.asc"),
    historyRows("owner_replies", ownerReplyColumns, "created_at.asc"),
    historyRows("review_replies", "review_id,status,created_at,sent_at", "created_at.asc"),
  ]);
  const ownerReplies = await withOwnerReplyPhotos(ownerReplyRows);
  const photosByReview = new Map<string, {id:string;photo_url:string;photo_path:string;status:"pending"|"added"}[]>();
  for (const photo of ownerPhotos) {
    if (typeof photo.id !== "string" || !uuidPattern.test(photo.id) ||
      typeof photo.review_id !== "string" || !reviewIds.includes(photo.review_id) ||
      (photo.status !== "pending" && photo.status !== "added") || typeof photo.photo_path !== "string") {
      throw new ApiError(502, "Invalid owner photo list");
    }
    const [photo_url] = await signedReviewPhotos([photo.photo_path]);
    const photos = photosByReview.get(photo.review_id) ?? [];
    photos.push({ id: photo.id, photo_url, photo_path: photo.photo_path, status: photo.status });
    photosByReview.set(photo.review_id, photos);
  }
  const reviewsWithOwnerPhotos = await Promise.all(rows.map(async review => {
    if (!isRecord(review) || typeof review.id !== "string") throw new ApiError(502, "Invalid admin review list");
    const photoPaths = review.photo_paths;
    if (!Array.isArray(photoPaths) || !photoPaths.every(path => typeof path === "string")) {
      throw new ApiError(502, "Invalid admin review list");
    }
    const ownerPhotosForReview = photosByReview.get(review.id) ?? [];
    const addedPaths = ownerPhotosForReview.filter(photo => photo.status === "added").map(photo => photo.photo_path);
    if (addedPaths.some(path => !photoPaths.includes(path)) ||
      ownerPhotosForReview.some(photo => photo.status === "pending" && photoPaths.includes(photo.photo_path))) {
      throw new ApiError(502, "Invalid owner photo list");
    }
    const { photo_paths, ...details } = review;
    const repliesForReview = ownerReplies.filter(reply => reply.review_id === review.id);
    const approvedReplies = emailReplyOrder(repliesForReview);
    type SignedPhoto = { id: string; photo_url: string; status: string };
    const replyEmailPhotos = approvedReplies.flatMap(reply => (reply.photos as SignedPhoto[])
      .filter(photo => photo.status === "published" || photo.status === "moderated"));
    const addedOwnerPhotos = ownerPhotosForReview.filter(photo => photo.status === "added");
    const emailIds = emailOwnerPhotoPaths(replyEmailPhotos.map(photo => photo.id), addedOwnerPhotos.map(photo => photo.id));
    const emailCandidates: SignedPhoto[] = [...replyEmailPhotos, ...addedOwnerPhotos];
    return {
      ...details,
      photo_urls: await signedReviewPhotos(photoPaths.filter(path => !addedPaths.includes(path))),
      owner_photos: ownerPhotosForReview.map(({photo_path: _photoPath, ...photo}) => photo),
      owner_replies: repliesForReview.map(reply => ({
        id: reply.id, business_name: reply.business_name, body: reply.body, status: reply.status,
        created_at: reply.created_at, archived_at: reply.archived_at ?? null, photos: reply.photos,
      })),
      email_photos: emailIds.map(id => {
        const photo = emailCandidates.find(candidate => candidate.id === id) as SignedPhoto;
        return { id: photo.id, photo_url: photo.photo_url };
      }),
      history: reviewHistory({
        review,
        moderation: moderationLog.filter(row => row.review_id === review.id),
        invites: invites.filter(row => row.review_id === review.id),
        ownerReplies: repliesForReview,
        ownerPhotos: ownerPhotos.filter(row => row.review_id === review.id),
        privateReplies: privateReplies.filter(row => row.review_id === review.id),
      }),
      stage: reviewStage({
        review,
        invites: invites.filter(row => row.review_id === review.id),
        ownerReplies: repliesForReview,
        privateReplies: privateReplies.filter(row => row.review_id === review.id),
      }),
    };
  }));
  return json(200, {
    reviews: await withRestroomNames(reviewsWithOwnerPhotos), total,
    next_offset: rows.length === limit ? Number(offset) + limit : null,
  });
}
