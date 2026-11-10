import { ApiError, isRecord, usCoordinates, milesBetween, json } from "./api-utils.ts";
import { requireAuthenticatedUser } from "./auth.ts";
import { reviewPhotoLimit, reviewPhotoTypes, reviewPhotoMaxBytes, hasMatchingImageSignature, uploadReviewPhoto, deleteReviewPhotos } from "./review-photos.ts";
import { database } from "./database.ts";

export async function toiletSubmissions(req: Request): Promise<Response> {
  if (req.method !== "POST") throw new ApiError(405, "Method not allowed");
  const userId = await requireAuthenticatedUser(req);
  let body: unknown;
  let photos: File[] = [];
  try {
    if (req.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
      const form = await req.formData();
      const payload = form.get("submission");
      if (typeof payload !== "string") throw new ApiError(400, "Invalid toilet fields");
      body = JSON.parse(payload);
      const values = form.getAll("photos");
      if (values.length > reviewPhotoLimit || values.some(value => typeof value === "string" || !(value instanceof File))) {
        throw new ApiError(400, "Choose up to 3 image files.");
      }
      photos = values as File[];
    } else {
      body = await req.json();
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "Invalid toilet fields");
  }
  if (!isRecord(body)) throw new ApiError(400, "Invalid toilet fields");
  if (body.current_location !== true) throw new ApiError(400, "Toilets can only be added while using your current location.");
  const { name, latitude, longitude, wheelchair, fee, notes } = body;
  const validAnswer = (value: unknown) =>
    typeof value === "string" && ["yes", "no", "unknown"].includes(value);
  if (typeof name !== "string" || !name.trim() || name.trim().length > 120 ||
    typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < 17 || latitude > 72 ||
    typeof longitude !== "number" || !Number.isFinite(longitude) || longitude < -179 || longitude > -65 ||
    !validAnswer(wheelchair) || !validAnswer(fee) ||
    typeof notes !== "string" || notes.length > 1000 ||
    photos.some(file => !reviewPhotoTypes.has(file.type) || file.size <= 0 || file.size > reviewPhotoMaxBytes) ||
    !(await Promise.all(photos.map(hasMatchingImageSignature))).every(Boolean)) {
    throw new ApiError(400, "Enter a toilet name (up to 120 characters), valid US coordinates, accessibility, fee, and notes (up to 1000 characters).");
  }
  const toiletUser = usCoordinates(body.user_latitude, body.user_longitude);
  if (!toiletUser || milesBetween(toiletUser[0], toiletUser[1], latitude, longitude) > 0.1) {
    throw new ApiError(403, "Toilets can only be added at your current location.");
  }
  const photoPaths = photos.map(file => {
    const extension = file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
    return `${userId}/${crypto.randomUUID()}.${extension}`;
  });
  try {
    for (const [index, file] of photos.entries()) await uploadReviewPhoto(photoPaths[index], file);
    await database("toilet_submissions", new URLSearchParams(), {
      method: "POST",
      body: JSON.stringify({
        name: name.trim(), latitude, longitude, wheelchair, fee, notes: notes.trim(),
        photo_paths: photoPaths, status: "pending", user_id: userId,
      }),
    });
  } catch (error) {
    await deleteReviewPhotos(photoPaths);
    throw error;
  }
  return json(201, { message: "Toilet saved for moderation", status: "pending" });
}
