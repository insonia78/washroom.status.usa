import { ApiError, uuidPattern, json } from "./api-utils.ts";
import { requireVerifiedAccount } from "./auth.ts";
import { ownerReviewPhotoLimit, reviewPhotoTypes, reviewPhotoMaxBytes, hasMatchingImageSignature, uploadReviewPhoto, deleteReviewPhotos } from "./review-photos.ts";
import { rpcRows } from "./database.ts";

// Owner: upload private photos for an invited, approved review.
export async function ownerReviewPhotos(req: Request): Promise<Response> {
  if (req.method !== "POST") throw new ApiError(405, "Method not allowed");
  const account = await requireVerifiedAccount(req);
  if (!account.email) throw new ApiError(403, "A verified email is required");
  let form: FormData;
  try { form = await req.formData(); } catch { throw new ApiError(400, "Invalid photo upload"); }
  const inviteId = form.get("invite_id");
  const values = form.getAll("photos");
  if (typeof inviteId !== "string" || !uuidPattern.test(inviteId) ||
    values.length < 1 || values.length > ownerReviewPhotoLimit ||
    values.some(value => typeof value === "string" || !(value instanceof File))) {
    throw new ApiError(400, "Choose up to 3 image files for an invited review.");
  }
  const photos = values as File[];
  if (photos.some(file => !reviewPhotoTypes.has(file.type) || file.size <= 0 || file.size > reviewPhotoMaxBytes) ||
    !(await Promise.all(photos.map(hasMatchingImageSignature))).every(Boolean)) {
    throw new ApiError(400, "Choose JPEG, PNG, or WebP photos smaller than 5 MB each.");
  }
  const photoPaths = photos.map(file => {
    const extension = file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
    return `${account.id}/${crypto.randomUUID()}.${extension}`;
  });
  try {
    for (const [index, file] of photos.entries()) await uploadReviewPhoto(photoPaths[index], file);
    const rows = await rpcRows("owner_submit_review_photos", {
      p_user_id: account.id, p_email: account.email, p_invite_id: inviteId, p_photo_paths: photoPaths,
    });
    if (rows.length !== photos.length || rows.some((row, index) =>
      row.invite_id !== inviteId || row.photo_path !== photoPaths[index] || row.status !== "pending")) {
      throw new ApiError(502, "Invalid owner photo upload response");
    }
    return json(201, { photos: rows.map(row => ({ id: row.id, status: row.status })) });
  } catch (error) {
    await deleteReviewPhotos(photoPaths);
    throw error;
  }
}
