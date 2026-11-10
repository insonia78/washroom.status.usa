import { uuidPattern, ApiError, isRecord } from "./api-utils.ts";
import { database } from "./database.ts";
import { signedReviewPhotos } from "./review-photos.ts";

export async function withOwnerReplyPhotos(replies: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  const replyIds = replies.map(reply => {
    if (typeof reply.id !== "string" || !uuidPattern.test(reply.id)) throw new ApiError(502, "Invalid owner reply identity");
    return reply.id;
  });
  const rows: unknown = replyIds.length ? await (await database("owner_reply_photos", new URLSearchParams({
    select: "id,reply_id,photo_path,status", reply_id: `in.(${replyIds.join(",")})`,
    order: "uploaded_at.asc", limit: String(replyIds.length * 3),
  }))).json() : [];
  if (!Array.isArray(rows) || !rows.every(isRecord)) throw new ApiError(502, "Invalid owner reply photo list");
  const byReply = new Map<string, Record<string, unknown>[]>();
  for (const photo of rows) {
    if (typeof photo.id !== "string" || !uuidPattern.test(photo.id) ||
      typeof photo.reply_id !== "string" || !replyIds.includes(photo.reply_id) ||
      typeof photo.photo_path !== "string" ||
      !["pending", "moderated", "published", "rejected"].includes(String(photo.status))) {
      throw new ApiError(502, "Invalid owner reply photo list");
    }
    const photos = byReply.get(photo.reply_id) ?? [];
    if (photos.length >= 3) throw new ApiError(502, "Invalid owner reply photo count");
    photos.push(photo);
    byReply.set(photo.reply_id, photos);
  }
  return await Promise.all(replies.map(async reply => {
    const photos = byReply.get(String(reply.id)) ?? [];
    const urls = await signedReviewPhotos(photos.map(photo => photo.photo_path));
    return {
      ...reply,
      photos: photos.map((photo, index) => ({
        id: photo.id, photo_url: urls[index], status: photo.status,
      })),
    };
  }));
}
