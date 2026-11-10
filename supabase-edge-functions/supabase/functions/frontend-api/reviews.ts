import { validRestroom, ApiError, isRecord, uuidPattern, json, usCoordinates, milesBetween, maxContributionMiles } from "./api-utils.ts";
import { database } from "./database.ts";
import { ownerReviewPhotoLimit, signedReviewPhotos, reviewPhotoLimit, reviewPhotoTypes, reviewPhotoMaxBytes, hasMatchingImageSignature, uploadReviewPhoto, deleteReviewPhotos } from "./review-photos.ts";
import { requireAuthenticatedUser } from "./auth.ts";

// Lists approved reviews or validates and submits a new review for moderation.
export async function reviews(req: Request): Promise<Response> {
  if (req.method === "GET") {
    const query = new URL(req.url).searchParams;
    const type = query.get("osm_type");
    const id = Number(query.get("osm_id"));
    if (!validRestroom(type, id)) throw new ApiError(400, "Invalid restroom");
    const latest = query.get("latest");
    if (latest !== null && latest !== "1") throw new ApiError(400, "Invalid latest review query");
    const params = new URLSearchParams({
      select: "id,rating,availability,cleanliness_status,issues,comment,created_at,photo_paths", osm_type: `eq.${type}`,
      osm_id: `eq.${id}`, status: "eq.approved", order: "created_at.desc,id.desc", limit: latest ? "1" : "50",
    });
    const data: unknown = await (await database("reviews", params)).json();
    if (!Array.isArray(data) || !data.every(row => isRecord(row) && typeof row.rating === "number")) {
      throw new ApiError(502, "Invalid reviews database response");
    }
    const reviewIds = data.map(row => row.id)
      .filter((reviewId): reviewId is string => typeof reviewId === "string" && uuidPattern.test(reviewId));
    const ownerPhotoRows: unknown = reviewIds.length ? await (await database("owner_review_photos", new URLSearchParams({
      select: "review_id,photo_path", review_id: `in.(${reviewIds.join(",")})`, status: "eq.added",
      order: "uploaded_at.asc", limit: String(reviewIds.length * ownerReviewPhotoLimit),
    }))).json() : [];
    if (!Array.isArray(ownerPhotoRows) || !ownerPhotoRows.every(isRecord)) {
      throw new ApiError(502, "Invalid approved owner photo list");
    }
    const ownerPathsByReview = new Map<string, string[]>();
    for (const ownerPhoto of ownerPhotoRows) {
      if (typeof ownerPhoto.review_id !== "string" || !reviewIds.includes(ownerPhoto.review_id) ||
        typeof ownerPhoto.photo_path !== "string") throw new ApiError(502, "Invalid approved owner photo list");
      const ownerPaths = ownerPathsByReview.get(ownerPhoto.review_id) ?? [];
      ownerPaths.push(ownerPhoto.photo_path);
      ownerPathsByReview.set(ownerPhoto.review_id, ownerPaths);
    }
    const reviewsWithPhotos = await Promise.all(data.map(async row => {
      if (!isRecord(row)) throw new ApiError(502, "Invalid reviews database response");
      const { photo_paths, ...review } = row;
      if (typeof review.id !== "string" || !Array.isArray(photo_paths) ||
        !photo_paths.every(path => typeof path === "string")) throw new ApiError(502, "Invalid reviews database response");
      const ownerPaths = ownerPathsByReview.get(review.id) ?? [];
      if (ownerPaths.some(path => !photo_paths.includes(path))) throw new ApiError(502, "Invalid approved owner photo list");
      return {
        ...review,
        photo_urls: await signedReviewPhotos(photo_paths.filter(path => !ownerPaths.includes(path))),
        owner_photo_urls: await signedReviewPhotos(ownerPaths),
      };
    }));
    const summary: unknown = await (await database("rpc/approved_review_summary", new URLSearchParams(), {
      method: "POST", body: JSON.stringify({ p_osm_type: type, p_osm_id: id }),
    })).json();
    if (!Array.isArray(summary) || summary.length !== 1 || !isRecord(summary[0]) ||
      typeof summary[0].review_count !== "number" || !Number.isSafeInteger(summary[0].review_count) || summary[0].review_count < 0 ||
      (summary[0].review_count === 0 ? summary[0].average !== null :
        typeof summary[0].average !== "number" || !Number.isFinite(summary[0].average) || summary[0].average < 1 || summary[0].average > 5)) {
      throw new ApiError(502, "Invalid review summary database response");
    }
    return json(200, { reviews: reviewsWithPhotos, count: data.length, average: summary[0].average, review_count: summary[0].review_count, limited_to: latest ? 1 : 50 });
  }
  if (req.method !== "POST") throw new ApiError(405, "Method not allowed");
  let body: unknown;
  let photos: File[] = [];
  try {
    if (req.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
      const form = await req.formData();
      const payload = form.get("review");
      if (typeof payload !== "string") throw new ApiError(400, "Invalid review fields");
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
    throw new ApiError(400, "Invalid review fields");
  }
  if (!isRecord(body)) throw new ApiError(400, "Invalid review fields");
  if (body.current_location !== true) throw new ApiError(400, "Reviews can only be added while using your current location.");
  const { osm_type, osm_id, rating, availability, cleanliness_status, issues, comment } = body;
  const restroomName = typeof body.restroom_name === "string" ? body.restroom_name.trim().slice(0, 200) || null : null;
  const allowedIssues = ["dirty_floor", "broken_fixture", "odor", "missing_supplies", "other"];
  if (!validRestroom(osm_type, osm_id) || typeof rating !== "number" ||
    !Number.isInteger(rating) || rating < 1 || rating > 5 ||
    typeof availability !== "string" || !["open", "closed", "temporarily_unavailable", "unverified"].includes(availability) ||
    typeof cleanliness_status !== "string" || !["excellent", "clean", "average", "poor", "very_dirty"].includes(cleanliness_status) ||
    !Array.isArray(issues) || issues.length > 6 ||
    issues.some(value => typeof value !== "string" || !allowedIssues.includes(value)) ||
    typeof comment !== "string" || comment.length > 1000 ||
    photos.some(file => !reviewPhotoTypes.has(file.type) || file.size <= 0 || file.size > reviewPhotoMaxBytes) ||
    !(await Promise.all(photos.map(hasMatchingImageSignature))).every(Boolean)) {
    throw new ApiError(400, "Invalid review fields");
  }
  const userId = await requireAuthenticatedUser(req);
  const locationParams = new URLSearchParams({
    select: "osm_id", osm_type: `eq.${osm_type}`, osm_id: `eq.${osm_id}`, limit: "1",
  });
  const reviewUser = usCoordinates(body.user_latitude, body.user_longitude);
  let reviewRestroom = usCoordinates(body.restroom_latitude, body.restroom_longitude);
  if (osm_type !== "refuge") {
    const stored: unknown = await (await database("restrooms", new URLSearchParams({
      select: "latitude,longitude", osm_type: `eq.${osm_type}`, osm_id: `eq.${osm_id}`, limit: "1",
    }))).json();
    if (Array.isArray(stored) && isRecord(stored[0])) reviewRestroom = usCoordinates(stored[0].latitude, stored[0].longitude) ?? reviewRestroom;
  }
  if (!reviewUser || !reviewRestroom || milesBetween(reviewUser[0], reviewUser[1], reviewRestroom[0], reviewRestroom[1]) > maxContributionMiles) {
    throw new ApiError(403, "Reviews can only be added to restrooms near your current location.");
  }
  let locations: unknown = await (await database(osm_type === "refuge" ? "review_locations" : "restrooms", locationParams)).json();
  if (!Array.isArray(locations)) throw new ApiError(502, "Invalid restroom database response");
  if (!locations.length && osm_type !== "refuge") {
    locations = await (await database("review_locations", locationParams)).json();
    if (!Array.isArray(locations)) throw new ApiError(502, "Invalid restroom database response");
  }
  if (!locations.length) throw new ApiError(422, "Restroom is not in the verified location list. Refresh the search and try again.");
  const photoPaths = photos.map(file => {
    const extension = file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
    return `${userId}/${crypto.randomUUID()}.${extension}`;
  });
  try {
    for (const [index, file] of photos.entries()) await uploadReviewPhoto(photoPaths[index], file);
    await database("reviews", new URLSearchParams(), {
      method: "POST",
      body: JSON.stringify({
        osm_type, osm_id, rating, availability, cleanliness_status, issues, comment: comment.trim(),
        restroom_name: restroomName, photo_paths: photoPaths, user_id: userId, status: "pending",
      }),
    });
  } catch (error) {
    await deleteReviewPhotos(photoPaths);
    throw error;
  }
  return json(201, { message: "Review submitted for moderation", status: "pending" });
}
