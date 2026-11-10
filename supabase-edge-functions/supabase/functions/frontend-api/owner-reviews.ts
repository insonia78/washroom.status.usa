import { ApiError, isRecord, json, uuidPattern } from "./api-utils.ts";
import { requireVerifiedAccount } from "./auth.ts";
import { database } from "./database.ts";
import { ownerReplyColumns } from "./owner-columns.ts";
import { withOwnerReplyPhotos } from "./owner-reply-photos.ts";
import { ownerReviewPhotoLimit, signedReviewPhotos } from "./review-photos.ts";
import { withRestroomNames } from "./restroom-names.ts";

// Owner: list invited reviews with the owner's own replies.
export async function ownerReviews(req: Request): Promise<Response> {
  if (req.method !== "GET") throw new ApiError(405, "Method not allowed");
  const account = await requireVerifiedAccount(req);
  if (!account.email) throw new ApiError(403, "A verified email is required");
  const invites: unknown = await (await database("owner_invites", new URLSearchParams({
    select: "id,review_id", email: `eq.${account.email}`, order: "created_at.desc", limit: "50",
  }))).json();
  if (!Array.isArray(invites) || !invites.every(isRecord)) throw new ApiError(502, "Invalid invite list");
  if (!invites.length) return json(200, { items: [] });
  const ids = invites.map(i => String(i.review_id)).filter(id => uuidPattern.test(id));
  const reviews: unknown = await (await database("reviews", new URLSearchParams({
    select: "id,osm_type,osm_id,restroom_name,rating,availability,cleanliness_status,issues,comment,status,created_at,photo_paths",
    id: `in.(${ids.join(",")})`, status: "eq.approved",
  }))).json();
  if (!Array.isArray(reviews) || !reviews.every(isRecord)) throw new ApiError(502, "Invalid owner review list");
  for (const review of reviews) {
    if (typeof review.osm_type !== "string" || !["node", "way", "relation", "refuge"].includes(review.osm_type) ||
      !Number.isSafeInteger(review.osm_id) || Number(review.osm_id) <= 0) {
      throw new ApiError(502, "Invalid owner review location");
    }
  }
  const refugeIds = [...new Set(reviews.filter(review => review.osm_type === "refuge")
    .map(review => Number(review.osm_id)))];
  const locations: unknown = refugeIds.length ? await (await database("review_locations", new URLSearchParams({
    select: "osm_type,osm_id,latitude,longitude", osm_type: "eq.refuge",
    osm_id: `in.(${refugeIds.join(",")})`, limit: String(refugeIds.length),
  }))).json() : [];
  if (!Array.isArray(locations) || !locations.every(isRecord)) throw new ApiError(502, "Invalid owner review locations");
  const coordinates = new Map<string, {latitude:number;longitude:number}>();
  for (const location of locations) {
    if (typeof location.osm_type !== "string" || !["node", "way", "relation", "refuge"].includes(location.osm_type) ||
      !Number.isSafeInteger(location.osm_id) || Number(location.osm_id) <= 0 ||
      (location.latitude === null && location.longitude === null)) continue;
    if (typeof location.latitude !== "number" || !Number.isFinite(location.latitude) || Math.abs(location.latitude) > 90 ||
      typeof location.longitude !== "number" || !Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180) {
      throw new ApiError(502, "Invalid owner review coordinates");
    }
    coordinates.set(`${location.osm_type}:${location.osm_id}`, {
      latitude: location.latitude, longitude: location.longitude,
    });
  }
  const restroomIds = [...new Set(reviews.filter(review =>
    typeof review.osm_type === "string" && review.osm_type !== "refuge" &&
    !coordinates.has(`${review.osm_type}:${review.osm_id}`),
  ).map(review => Number(review.osm_id)))];
  const restrooms: unknown = restroomIds.length ? await (await database("restrooms", new URLSearchParams({
    select: "osm_type,osm_id,latitude,longitude",
    osm_type: "in.(node,way,relation)", osm_id: `in.(${restroomIds.join(",")})`,
    limit: String(restroomIds.length * 3),
  }))).json() : [];
  if (!Array.isArray(restrooms) || !restrooms.every(isRecord)) throw new ApiError(502, "Invalid owner restroom locations");
  for (const restroom of restrooms) {
    if (typeof restroom.osm_type !== "string" || !Number.isSafeInteger(restroom.osm_id) ||
      typeof restroom.latitude !== "number" || !Number.isFinite(restroom.latitude) ||
      Math.abs(restroom.latitude) > 90 || typeof restroom.longitude !== "number" ||
      !Number.isFinite(restroom.longitude) || Math.abs(restroom.longitude) > 180) continue;
    coordinates.set(`${restroom.osm_type}:${restroom.osm_id}`, {
      latitude: restroom.latitude, longitude: restroom.longitude,
    });
  }
  const replies: unknown = await (await database("owner_replies", new URLSearchParams({
    select: ownerReplyColumns, owner_email: `eq.${account.email}`, order: "created_at.desc",
  }))).json();
  if (!Array.isArray(replies) || !replies.every(isRecord)) throw new ApiError(502, "Invalid owner reply list");
  const repliesWithPhotos = await withOwnerReplyPhotos(replies);
  const inviteIds = invites.map(invite => invite.id)
    .filter((id): id is string => typeof id === "string" && uuidPattern.test(id));
  const submittedPhotos: unknown = inviteIds.length ? await (await database("owner_review_photos", new URLSearchParams({
    select: "id,invite_id,review_id,photo_path,status", invite_id: `in.(${inviteIds.join(",")})`,
    order: "uploaded_at.asc", limit: String(inviteIds.length * ownerReviewPhotoLimit),
  }))).json() : [];
  if (!Array.isArray(submittedPhotos) || !submittedPhotos.every(isRecord)) {
    throw new ApiError(502, "Invalid owner review list");
  }
  const withPhotos = await Promise.all(reviews.filter(isRecord).map(async review => {
    const { photo_paths, ...details } = review;
    if (typeof review.id !== "string" || !Array.isArray(photo_paths) ||
      !photo_paths.every(path => typeof path === "string")) throw new ApiError(502, "Invalid owner review list");
    const ownerPaths = submittedPhotos.filter(photo => photo.review_id === review.id && photo.status === "added")
      .map(photo => photo.photo_path).filter((path): path is string => typeof path === "string");
    if (ownerPaths.some(path => !photo_paths.includes(path))) throw new ApiError(502, "Invalid owner review photo list");
    return {
      ...details,
      ...coordinates.get(`${review.osm_type}:${review.osm_id}`),
      photo_urls: await signedReviewPhotos(photo_paths.filter(path => !ownerPaths.includes(path))),
      owner_photo_urls: await signedReviewPhotos(ownerPaths),
    };
  }));
  const withOwnerPhotos = await Promise.all(submittedPhotos.map(async photo => {
    if (typeof photo.id !== "string" || typeof photo.invite_id !== "string" ||
      typeof photo.review_id !== "string" || typeof photo.photo_path !== "string" ||
      !["pending", "added"].includes(String(photo.status))) throw new ApiError(502, "Invalid owner review photo list");
    const [photo_url] = await signedReviewPhotos([photo.photo_path]);
    return {
      id: photo.id, invite_id: photo.invite_id, review_id: photo.review_id,
      photo_url, status: photo.status,
    };
  }));
  const named = await withRestroomNames(withPhotos);
  const items = invites.flatMap(invite => {
    const review = named.find(r => r.id === invite.review_id);
    if (!review) return [];
    return [{
      invite_id: invite.id,
      review,
      owner_photos: withOwnerPhotos.filter(photo => photo.invite_id === invite.id),
      replies: repliesWithPhotos.filter(reply => reply.invite_id === invite.id),
    }];
  });
  return json(200, { items });
}
