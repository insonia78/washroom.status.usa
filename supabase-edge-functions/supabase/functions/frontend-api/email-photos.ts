import { database, upstream, config } from "./database.ts";
import { isRecord, uuidPattern, ApiError } from "./api-utils.ts";
import { emailReplyOrder, emailOwnerPhotoPaths } from "./workflow-history.ts";
import { reviewPhotoPathPattern, reviewPhotoBucket, reviewPhotoMaxBytes } from "./review-photos.ts";

export type EmailPhotoAttachment = {
  filename: string;
  contentType: string;
  content: Uint8Array;
  encodedContent: string;
};

export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

export async function approvedOwnerPhotoAttachments(reviewId: string): Promise<EmailPhotoAttachment[]> {
  const approvedReplies: unknown = await (await database("owner_replies", new URLSearchParams({
    select: "id,status,moderated_at,published_at", review_id: `eq.${reviewId}`, status: "in.(moderated,published)",
    order: "created_at.desc", limit: "10",
  }))).json();
  if (!Array.isArray(approvedReplies) || !approvedReplies.every(isRecord) ||
    approvedReplies.some(reply => typeof reply.id !== "string" || !uuidPattern.test(reply.id))) {
    throw new ApiError(502, "Invalid approved owner reply list");
  }
  const replyIds = emailReplyOrder(approvedReplies).map(reply => String(reply.id));
  const replyPhotos: unknown = replyIds.length ? await (await database("owner_reply_photos", new URLSearchParams({
    select: "reply_id,photo_path", reply_id: `in.(${replyIds.join(",")})`, status: "in.(moderated,published)",
    order: "uploaded_at.asc", limit: String(replyIds.length * 3),
  }))).json() : [];
  const rows: unknown = await (await database("owner_review_photos", new URLSearchParams({
    select: "photo_path", review_id: `eq.${reviewId}`, status: "eq.added",
    order: "uploaded_at.asc", limit: "3",
  }))).json();
  const validPaths = (list: unknown): list is Record<string, unknown>[] => Array.isArray(list) && list.every(isRecord) &&
    list.every(row => typeof row.photo_path === "string" && reviewPhotoPathPattern.test(row.photo_path));
  if (!validPaths(replyPhotos) || !validPaths(rows)) throw new ApiError(502, "Invalid approved owner photo list");
  const replyPaths = replyIds.flatMap(id => replyPhotos.filter(photo => photo.reply_id === id).map(photo => String(photo.photo_path)));
  const paths = emailOwnerPhotoPaths(replyPaths, rows.map(row => String(row.photo_path)));
  const attachments: EmailPhotoAttachment[] = [];
  let totalBytes = 0;
  for (const [index, path] of paths.entries()) {
    const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    const contentType = extension === "jpg" ? "image/jpeg" : extension === "png" ? "image/png" : "image/webp";
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const response = await upstream(new URL(`/storage/v1/object/${reviewPhotoBucket}/${encodedPath}`, config("SUPABASE_URL")), {
      headers: {
        apikey: config("SUPABASE_SERVICE_ROLE_KEY"),
        Authorization: `******"SUPABASE_SERVICE_ROLE_KEY")}`,
      },
    });
    if (!response.ok) {
      await response.body?.cancel();
      console.error("frontend-api approved owner photo download failed", { status: response.status });
      throw new ApiError(503, "Approved owner photos could not be attached. No email was sent.");
    }
    const declaredSize = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredSize) && declaredSize > reviewPhotoMaxBytes) {
      await response.body?.cancel();
      throw new ApiError(502, "Approved owner photo exceeds the email attachment limit");
    }
    const content = new Uint8Array(await response.arrayBuffer());
    totalBytes += content.byteLength;
    if (!content.byteLength || content.byteLength > reviewPhotoMaxBytes || totalBytes > 15 * 1024 * 1024) {
      throw new ApiError(502, "Approved owner photos exceed the email attachment limit");
    }
    attachments.push({
      filename: `owner-photo-${index + 1}.${extension}`,
      contentType,
      content,
      encodedContent: encodeBase64(content),
    });
  }
  return attachments;
}
