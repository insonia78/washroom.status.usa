import { authorizeGatewayRequest } from "../_shared/gateway-auth.ts";
import { geocodeZipCode } from "../places-api/services/geocoding.ts";
import { RequestError } from "../places-api/utils/errors.ts";
import { locationDatabaseHeaders } from "../_shared/database-schema.ts";
import { emailOwnerPhotoPaths, reviewHistory, reviewStage, toiletHistory, toiletStage } from "./workflow-history.ts";

// Admin lists use 3 per page; the workflow board loads up to 25 per request.
function adminPageLimit(query: URLSearchParams): number {
  const limit = query.get("limit") ?? "3";
  if (limit !== "3" && limit !== "25") throw new ApiError(400, "Invalid page size");
  return Number(limit);
}

// Carries an HTTP status alongside a frontend API error message.
class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Creates a no-store JSON response for frontend API routes.
const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const reviewPhotoBucket = "review-photos";
const reviewPhotoLimit = 3;
const reviewPhotoMaxBytes = 5 * 1024 * 1024;
const reviewPhotoTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const ownerReviewPhotoLimit = 3;
const reviewPhotoPathPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i;

// Narrows unknown values to plain object records before field access.
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function storageObjectUrl(path: string): URL {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return new URL(`/storage/v1/object/${reviewPhotoBucket}/${encoded}`, config("SUPABASE_URL"));
}

async function hasMatchingImageSignature(file: File): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (file.type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (file.type === "image/png") return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte);
  return file.type === "image/webp" && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
}

async function uploadReviewPhoto(path: string, file: File): Promise<void> {
  const response = await upstream(storageObjectUrl(path), {
    method: "POST",
    headers: {
      apikey: config("SUPABASE_SERVICE_ROLE_KEY"),
      Authorization: `Bearer ${config("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": file.type,
      "x-upsert": "false",
    },
    body: await file.arrayBuffer(),
  });
  if (!response.ok) {
    console.error("frontend-api review photo upload failed", { status: response.status });
    throw new ApiError(503, "Review photos could not be uploaded. Please try again.");
  }
}

async function deleteReviewPhotos(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const response = await upstream(new URL(`/storage/v1/object/${reviewPhotoBucket}`, config("SUPABASE_URL")), {
    method: "DELETE",
    headers: {
      apikey: config("SUPABASE_SERVICE_ROLE_KEY"),
      Authorization: `Bearer ${config("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefixes: paths }),
  });
  if (!response.ok) {
    console.error("frontend-api review photo cleanup failed", { status: response.status });
  }
}

async function signedReviewPhotos(paths: unknown): Promise<string[]> {
  if (!Array.isArray(paths) || paths.length > reviewPhotoLimit ||
    !paths.every(path => typeof path === "string" && reviewPhotoPathPattern.test(path))) {
    throw new ApiError(502, "Invalid review photo database response");
  }
  return await Promise.all(paths.map(async path => {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const response = await upstream(new URL(`/storage/v1/object/sign/${reviewPhotoBucket}/${encoded}`, config("SUPABASE_URL")), {
      method: "POST",
      headers: {
        apikey: config("SUPABASE_SERVICE_ROLE_KEY"),
        Authorization: `Bearer ${config("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn: 86400 }),
    });
    if (!response.ok) {
      console.error("frontend-api review photo signing failed", { status: response.status });
      throw new ApiError(503, "Review photos are temporarily unavailable");
    }
    const result: unknown = await response.json();
    if (!isRecord(result) || typeof result.signedURL !== "string") {
      throw new ApiError(502, "Invalid signed review photo response");
    }
    const signedURL = result.signedURL.startsWith("/object/")
      ? new URL(`/storage/v1${result.signedURL}`, config("SUPABASE_URL")).toString()
      : new URL(result.signedURL, `${config("SUPABASE_URL")}/storage/v1/`).toString();
    return signedURL;
  }));
}

type EmailPhotoAttachment = {
  filename: string;
  contentType: string;
  content: Uint8Array;
  encodedContent: string;
};

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

async function approvedOwnerPhotoAttachments(reviewId: string): Promise<EmailPhotoAttachment[]> {
  const publishedReplies: unknown = await (await database("owner_replies", new URLSearchParams({
    select: "id", review_id: `eq.${reviewId}`, status: "eq.published",
    order: "published_at.desc", limit: "10",
  }))).json();
  if (!Array.isArray(publishedReplies) || !publishedReplies.every(isRecord) ||
    publishedReplies.some(reply => typeof reply.id !== "string" || !uuidPattern.test(reply.id))) {
    throw new ApiError(502, "Invalid published owner reply list");
  }
  const replyIds = publishedReplies.map(reply => String(reply.id));
  const replyPhotos: unknown = replyIds.length ? await (await database("owner_reply_photos", new URLSearchParams({
    select: "reply_id,photo_path", reply_id: `in.(${replyIds.join(",")})`, status: "eq.published",
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

// Reads a required environment variable or reports a configuration error.
function config(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new ApiError(503, `Missing ${name} in frontend-api.`);
  return value;
}

// Sends a bounded upstream request and avoids following redirects.
async function upstream(url: URL | string, init: RequestInit = {}) {
  return await fetch(url, { ...init, signal: AbortSignal.timeout(20_000), redirect: "manual" });
}

// Reads one page of rows plus the exact total from the Content-Range header.
async function databasePage(table: string, params: URLSearchParams): Promise<{ rows: unknown; total: number | null }> {
  const response = await database(table, params, { headers: { Prefer: "count=exact" } });
  const match = /\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
  return { rows: await response.json(), total: match ? Number(match[1]) : null };
}

// Makes an authenticated Supabase REST request and maps database failures to API errors.
async function database(table: string, params: URLSearchParams, init: RequestInit = {}) {
  const key = config("SUPABASE_SERVICE_ROLE_KEY");
  const url = new URL(`/rest/v1/${table}`, config("SUPABASE_URL"));
  url.search = params.toString();
  const response = await upstream(url, {
    ...init,
    headers: {
      ...locationDatabaseHeaders(init.method),
      apikey: key, Authorization: `Bearer ${key}`,
      "Content-Type": "application/json", Prefer: "return=minimal",
            ...(init.headers as Record<string, string> | undefined),
          },
  });
  if (!response.ok) {
    const error: unknown = await response.json();
    if (table === "rpc/admin_review_reply") {
      if (isRecord(error) && error.code === "42501") throw new ApiError(403, "Administrator access required");
      if (isRecord(error) && error.code === "22023") throw new ApiError(422,
        typeof error.message === "string" ? error.message : "Invalid review reply");
      console.error("frontend-api reply storage failed", { status: response.status });
      throw new ApiError(503, "Reply storage is unavailable. Refresh to check the saved reply before retrying.");
    }
    if (table === "rpc/admin_archive_review") {
      if (isRecord(error) && error.code === "42501") throw new ApiError(403, "Administrator access required");
      console.error("frontend-api review archive failed", { status: response.status });
      throw new ApiError(503, "Review archive is unavailable. Refresh and try again.");
    }
    if (table === "rpc/admin_add_owner_review_photo") {
      if (isRecord(error) && error.code === "42501") throw new ApiError(403, "Administrator access required");
      if (isRecord(error) && error.code === "22023" && typeof error.message === "string") {
        throw new ApiError(422, error.message);
      }
      console.error("frontend-api owner review photo approval failed", { status: response.status });
      throw new ApiError(503, "Owner photo approval is temporarily unavailable");
    }
    if (table === "rpc/admin_archive_toilet") {
      if (isRecord(error) && error.code === "42501") throw new ApiError(403, "Administrator access required");
      console.error("frontend-api toilet archive failed", { status: response.status });
      throw new ApiError(503, "Toilet archive is unavailable. Refresh and try again.");
    }
    if (table === "rpc/admin_publish_toilet") {
      if (isRecord(error) && error.code === "42501") throw new ApiError(403, "Administrator access required");
      console.error("frontend-api toilet publish failed", { status: response.status });
      throw new ApiError(503, "Toilet approval is unavailable. Refresh and try again.");
    }
    if (table === "rpc/admin_create_owner_invite" || table === "rpc/owner_submit_reply" ||
      table === "rpc/owner_submit_review_photos" || table === "rpc/owner_reply_decide" ||
      table === "rpc/admin_archive_owner_reply" || table === "rpc/admin_archive_owner_response") {
      if (isRecord(error) && error.code === "42501") throw new ApiError(403, "Access denied for this action");
      if (isRecord(error) && error.code === "22023" && typeof error.message === "string") throw new ApiError(422, error.message);
      console.error("frontend-api owner contribution failed", { table, status: response.status });
      throw new ApiError(503, "Owner contributions are temporarily unavailable");
    }
    if (table === "toilet_submissions") {
      if (isRecord(error) && error.code === "P0001") {
        throw new ApiError(429, "You have reached the limit of 3 toilet submissions per UTC day. Try again after midnight UTC.");
      }
      console.error("frontend-api toilet submission failed", { status: response.status });
      throw new ApiError(503, "Toilet could not be saved. Please try again.");
    }
    if (table === "rpc/moderate_toilet_submission") {
      if (isRecord(error) && error.code === "42501") throw new ApiError(403, "Moderator access required");
      console.error("frontend-api toilet moderation failed", { status: response.status });
      throw new ApiError(503, "Toilet moderation is temporarily unavailable");
    }
    if (table === "reviews" && isRecord(error) && error.code === "P0001") {
      throw new ApiError(429, "You have reached the limit of 3 reviews per UTC day. Try again after midnight UTC.");
    }
    if (isRecord(error) && error.code === "23505") {
      throw new ApiError(409, "You have already reviewed this restroom");
    }
    if (table === "rpc/save_owner_response" && isRecord(error)) {
      if (error.code === "42501") throw new ApiError(403, "Administrator access required");
      if (["22023", "23514", "23503", "22P02"].includes(String(error.code))) {
        throw new ApiError(422, error.code === "22023" && typeof error.message === "string" ?
          error.message : "Invalid owner response. Check the listing, approved review, and response fields.");
      }
    }
    console.error("frontend-api database request failed", { table, status: response.status });
    throw new ApiError(503, "Reviews are temporarily unavailable");
  }
  return response;
}

// Source type keeps Refuge IDs distinct from OpenStreetMap IDs.
function validRestroom(type: unknown, id: unknown): boolean {
  return typeof type === "string" && ["node", "way", "relation", "refuge"].includes(type) &&
    typeof id === "number" && Number.isSafeInteger(id) && id > 0;
}

const maxContributionMiles = 11;
function milesBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (v: number) => v * Math.PI / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function usCoordinates(lat: unknown, lon: unknown): [number, number] | null {
  return typeof lat === "number" && typeof lon === "number" && Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= 17 && lat <= 72 && lon >= -179 && lon <= -65 ? [lat, lon] : null;
}

async function toiletSubmissions(req: Request): Promise<Response> {
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

// Lists approved reviews or validates and submits a new review for moderation.
async function reviews(req: Request): Promise<Response> {
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

// Proxies supported Supabase Auth routes while forwarding only required headers.
async function auth(req: Request, path: string): Promise<Response> {
  const allowed = path === "/auth/v1/user" ? ["GET", "PUT"] :
    /^\/auth\/v1\/(otp|verify|token|logout)$/.test(path) ? ["POST"] : [];
  if (!allowed.length) throw new ApiError(404, "Route not found");
  if (!allowed.includes(req.method)) throw new ApiError(405, "Method not allowed");
  const url = new URL(path, config("SUPABASE_URL"));
  url.search = new URL(req.url).search;
  const headers = new Headers({ apikey: config("SUPABASE_ANON_KEY") });
  for (const name of ["authorization", "content-type", "x-client-info", "x-supabase-api-version"]) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  const response = await upstream(url, {
    method: req.method, headers,
    body: req.method === "GET" ? undefined : await req.arrayBuffer(),
  });
  const responseHeaders = new Headers({ "Cache-Control": "no-store" });
  for (const name of ["content-type", "retry-after"]) {
    const value = response.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new Response(response.body, { status: response.status, headers: responseHeaders });
}

async function requireAuthenticatedUser(req: Request): Promise<string> {
  return (await requireVerifiedAccount(req)).id;
}

async function requireVerifiedAccount(req: Request): Promise<{ id: string; email: string }> {
  const authorization = req.headers.get("authorization");
  if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) throw new ApiError(401, "Sign in to continue");
  const response = await upstream(new URL("/auth/v1/user", config("SUPABASE_URL")), {
    headers: { apikey: config("SUPABASE_ANON_KEY"), Authorization: authorization },
  });
  if (!response.ok) {
    if ([401, 403].includes(response.status)) throw new ApiError(401, "Your session has expired. Sign in again.");
    throw new ApiError(503, "Session validation is temporarily unavailable");
  }
  const user: unknown = await response.json();
  if (!isRecord(user) || typeof user.id !== "string" || !user.email_confirmed_at || user.is_anonymous === true) throw new ApiError(403, "A verified account is required");
    return { id: user.id, email: typeof user.email === "string" ? user.email.toLowerCase() : "" };
}

async function requireAllowlistedUser(req: Request, role: "moderator" | "admin"): Promise<string> {
  const userId = await requireAuthenticatedUser(req);
  const moderators: unknown = await (await database(role === "admin" ? "owner_response_admins" : "review_moderators", new URLSearchParams({
    select: "user_id", user_id: `eq.${userId}`, limit: "1",
  }))).json();
  if (!Array.isArray(moderators)) throw new ApiError(502, `Invalid ${role} lookup response`);
  if (!moderators.length) throw new ApiError(403, `Your account is not on the ${role} allowlist`);
  return userId;
}

async function moderateToilets(req: Request): Promise<Response> {
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

// Adds restroom_name to reviews from the restrooms table; Refuge listings have no local name.
async function withRestroomNames(rows: unknown[]): Promise<Record<string, unknown>[]> {
  const ids = [...new Set(rows.flatMap(row => isRecord(row) && row.osm_type !== "refuge" &&
    Number.isSafeInteger(row.osm_id) ? [Number(row.osm_id)] : []))];
  const names = new Map<string, string>();
  if (ids.length) {
    const found: unknown = await (await database("restrooms", new URLSearchParams({
      select: "osm_type,osm_id,name", osm_id: `in.(${ids.join(",")})`, limit: "1000",
    }))).json();
    if (Array.isArray(found)) {
      for (const item of found) {
        if (isRecord(item) && typeof item.name === "string" && item.name) names.set(`${item.osm_type}:${item.osm_id}`, item.name);
      }
    }
  }
  return rows.map(row => {
    const review = row as Record<string, unknown>;
    const stored = typeof review.restroom_name === "string" && review.restroom_name ? review.restroom_name : null;
    return { ...review, restroom_name: stored ?? names.get(`${review.osm_type}:${review.osm_id}`) ?? null };
  });
}

async function moderation(req: Request): Promise<Response> {
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

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const publicOwnerColumns = "id,osm_type,osm_id,review_id,business_name,body,completed_on,evidence_url,published_at";
const publicOwnerPhotoColumns = `${publicOwnerColumns},photo_paths`;
const adminOwnerColumns = `${publicOwnerColumns},verification_note,status,version,updated_at,archived_at`;
const replyColumns = "id,review_id,recipient_user_id,body,status,created_by,last_sent_by,created_at,first_attempt_at,last_attempt_at,sent_at,provider_id";

async function adminReviews(req: Request): Promise<Response> {
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
    const latestPublished = [...repliesForReview].filter(reply => reply.status === "published")
      .sort((a, b) => String(b.published_at ?? "").localeCompare(String(a.published_at ?? "")));
    type SignedPhoto = { id: string; photo_url: string; status: string };
    const replyEmailPhotos = latestPublished.flatMap(reply => (reply.photos as SignedPhoto[])
      .filter(photo => photo.status === "published"));
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

async function adminToilets(req: Request): Promise<Response> {
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

async function readJson(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try { body = await req.json(); } catch { throw new ApiError(400, "Invalid JSON"); }
  if (!isRecord(body)) throw new ApiError(400, "Invalid request");
  return body;
}

async function rpcRows(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const rows: unknown = await (await database(`rpc/${name}`, new URLSearchParams(), {
    method: "POST", body: JSON.stringify(args),
  })).json();
  if (!Array.isArray(rows) || !rows.every(isRecord)) throw new ApiError(502, "Invalid owner reply response");
  return rows;
}

const ownerReplyColumns = "id,invite_id,review_id,osm_type,osm_id,owner_email,business_name,body,status,created_at,moderated_at,published_at,archived_at";

async function withOwnerReplyPhotos(replies: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
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

// Admin: invite a business owner to answer one approved review through a magic link.
async function adminOwnerInvites(req: Request): Promise<Response> {
  if (!["GET", "POST"].includes(req.method)) throw new ApiError(405, "Method not allowed");
  const adminId = await requireAllowlistedUser(req, "admin");
  if (req.method === "GET") {
    const query = new URL(req.url).searchParams;
    const reviewId = query.get("review_id");
    if (reviewId !== null && !uuidPattern.test(reviewId)) throw new ApiError(400, "Invalid review ID");
    const rows: unknown = await (await database("owner_invites", new URLSearchParams({
      select: "id,email,review_id,created_at",
      ...(reviewId ? { review_id: `eq.${reviewId}` } : {}),
      order: "created_at.desc", limit: "50",
    }))).json();
    if (!Array.isArray(rows) || !rows.every(isRecord)) throw new ApiError(502, "Invalid invite list");
    const inviteIds = rows.map(row => row.id).filter((id): id is string => typeof id === "string" && uuidPattern.test(id));
    const replies: unknown = inviteIds.length ? await (await database("owner_replies", new URLSearchParams({
      select: "id,invite_id,status,created_at", invite_id: `in.(${inviteIds.join(",")})`,
      order: "created_at.desc", limit: String(inviteIds.length * 10),
    }))).json() : [];
    if (!Array.isArray(replies) || !replies.every(isRecord)) throw new ApiError(502, "Invalid owner reply status list");
    const latestReply = new Map<string, Record<string, unknown>>();
    for (const reply of replies) {
      if (typeof reply.invite_id === "string" && uuidPattern.test(reply.invite_id) &&
        typeof reply.status === "string" && !latestReply.has(reply.invite_id)) {
        latestReply.set(reply.invite_id, reply);
      }
    }
    return json(200, { invites: rows.map(invite => {
      if (typeof invite.id !== "string" || typeof invite.email !== "string" ||
        typeof invite.review_id !== "string" || typeof invite.created_at !== "string") {
        throw new ApiError(502, "Invalid owner invite record");
      }
      const reply = latestReply.get(invite.id);
      return {
        ...invite,
        response_status: reply?.status ?? "waiting",
        response_created_at: typeof reply?.created_at === "string" ? reply.created_at : null,
      };
    }) });
  }
  const body = await readJson(req);
  if (typeof body.email !== "string" || typeof body.review_id !== "string" || !uuidPattern.test(body.review_id)) {
    throw new ApiError(400, "Provide the owner email and an approved review");
  }
  let redirectTo = "";
  if (typeof body.redirect_to === "string") {
    try {
      const target = new URL(body.redirect_to);
      if (["http:", "https:"].includes(target.protocol) && target.pathname === "/owner") redirectTo = target.toString();
    } catch { /* ignored */ }
  }
  const rows = await rpcRows("admin_create_owner_invite", {
    p_admin_id: adminId, p_email: body.email.trim(), p_review_id: body.review_id,
  });
  if (rows.length !== 1) throw new ApiError(502, "Invalid invite response");
  const otpUrl = new URL("/auth/v1/otp", config("SUPABASE_URL"));
  if (redirectTo) otpUrl.searchParams.set("redirect_to", redirectTo);
  const sent = await upstream(otpUrl, {
    method: "POST",
    headers: { apikey: config("SUPABASE_ANON_KEY"), "Content-Type": "application/json" },
    body: JSON.stringify({ email: String(rows[0].email), create_user: true }),
  });
  if (!sent.ok) {
    console.error("frontend-api owner magic link failed", { status: sent.status });
    throw new ApiError(502, "Invite saved, but the magic link could not be sent. Check Supabase Auth email settings and send it again.");
  }
  return json(200, { invite: rows[0], magic_link_sent: true });
}

// Owner: list invited reviews with the owner's own replies.
async function ownerReviews(req: Request): Promise<Response> {
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

// Owner: upload private photos for an invited, approved review.
async function ownerReviewPhotos(req: Request): Promise<Response> {
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

// Owner: submit a reply; it enters moderation (step 1).
async function ownerReplies(req: Request): Promise<Response> {
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
async function ownerReplyStage(req: Request, stage: "moderate" | "publish"): Promise<Response> {
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

async function replyAction(adminId: string, action: string, id: string, fields: Record<string, unknown> = {}) {
  const rows: unknown = await (await database("rpc/admin_review_reply", new URLSearchParams(), {
    method: "POST", body: JSON.stringify({ ...fields, p_admin_id: adminId, p_action: action, p_id: id }),
  })).json();
  if (!Array.isArray(rows) || rows.length > 1) {
    throw new ApiError(502, "Invalid saved reply. Refresh before retrying.");
  }
  if (!rows.length) throw new ApiError(409, "Reply is unavailable or a send is in progress. Refresh and wait at least 60 seconds before retrying.");
  const row: unknown = rows[0];
  if (!isRecord(row) || row.id !== id) throw new ApiError(502, "Invalid saved reply. Refresh before retrying.");
  return row;
}

async function adminReviewReplies(req: Request): Promise<Response> {
  if (!["GET", "POST"].includes(req.method)) throw new ApiError(405, "Method not allowed");
  const adminId = await requireAllowlistedUser(req, "admin");
  if (req.method === "GET") {
    const query = new URL(req.url).searchParams;
    const reviewId = query.get("review_id");
    const offset = query.get("offset") ?? "0";
    if (!reviewId || !uuidPattern.test(reviewId) || !/^\d{1,8}$/.test(offset)) throw new ApiError(400, "Invalid review or reply offset");
    const { rows: replies, total } = await databasePage("review_replies", new URLSearchParams({
      select: replyColumns, review_id: `eq.${reviewId}`, order: "created_at.desc,id.desc", limit: "3", offset,
          }));
    if (!Array.isArray(replies)) throw new ApiError(502, "Invalid reply history");
          return json(200, { replies, total, next_offset: replies.length === 3 ? Number(offset) + 3 : null });
  }
  let body: unknown;
  try { body = await req.json(); } catch { throw new ApiError(400, "Invalid JSON"); }
  if (!isRecord(body) || typeof body.id !== "string" || !uuidPattern.test(body.id) ||
    !["save", "send"].includes(String(body.action))) throw new ApiError(400, "Invalid reply action");
  const replyId = body.id;
  if (body.action === "save") {
    if (typeof body.review_id !== "string" || !uuidPattern.test(body.review_id) ||
      typeof body.body !== "string" || !body.body.trim() || body.body.length > 4000) throw new ApiError(400, "Select a review and enter a reply of 1 to 4000 characters");
    const reply = await replyAction(adminId, "save", replyId, { p_review_id: body.review_id, p_body: body.body.trim() });
    return json(200, { reply });
  }
  // Configuration is checked before claiming a delivery or contacting the recipient.
  const useGmail = Deno.env.get("EMAIL_PROVIDER")?.trim().toLowerCase() === "gmail";
  const apiKey = useGmail ? "" : config("RESEND_API_KEY");
  const gmailUser = useGmail ? config("GMAIL_USER") : "";
  const gmailPassword = useGmail ? config("GMAIL_APP_PASSWORD") : "";
  const from = useGmail ? (Deno.env.get("REVIEW_REPLY_FROM")?.trim() || gmailUser) : config("REVIEW_REPLY_FROM");
  const reply = await replyAction(adminId, "claim", replyId);
  if (reply.status === "sent") return json(200, { reply });
  if (reply.status !== "sending" || typeof reply.recipient_user_id !== "string" ||
    !uuidPattern.test(reply.recipient_user_id) || typeof reply.review_id !== "string" ||
    !uuidPattern.test(reply.review_id) || typeof reply.body !== "string") throw new ApiError(502, "Invalid saved reply");
  const finish = async (action: "sent" | "failed" | "unknown", providerId?: string) =>
    await replyAction(adminId, action, replyId, providerId ? { p_provider_id: providerId } : {});
  const serviceKey = config("SUPABASE_SERVICE_ROLE_KEY");
  let recipient: unknown;
  try {
    const lookup = await upstream(new URL(`/auth/v1/admin/users/${reply.recipient_user_id}`, config("SUPABASE_URL")), {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    if (!lookup.ok) {
      await lookup.body?.cancel();
      throw new Error("Recipient lookup failed");
    }
    recipient = await lookup.json();
  } catch {
    await finish("failed");
    throw new ApiError(503, "Recipient lookup failed. The reply is saved; no email was sent.");
  }
  if (!isRecord(recipient) || recipient.id !== reply.recipient_user_id || typeof recipient.email !== "string" ||
    !recipient.email || !recipient.email_confirmed_at || recipient.is_anonymous === true) {
    await finish("failed");
    throw new ApiError(422, "The reviewer does not have a verified email account. No email was sent.");
  }
  let photoAttachments: EmailPhotoAttachment[];
  try {
    photoAttachments = await approvedOwnerPhotoAttachments(reply.review_id);
  } catch (error) {
    await finish("failed");
    if (error instanceof ApiError) throw error;
    console.error("frontend-api owner photo attachment preparation failed");
    throw new ApiError(503, "Approved owner photos could not be attached. The reply is saved; no email was sent.");
  }
  const subject = "A reply to your Washroom Status USA review";
  const attachmentNote = photoAttachments.length
    ? "\n\nApproved owner-provided photos are attached to this email."
    : "";
  const text = `An administrator replied to your review.\n\n${reply.body}${attachmentNote}\n\nWashroom Status USA\nThis is a private reply, not a public review response.`;
  if (useGmail) {
    // SMTP gives no idempotency key, so any failure is treated as uncertain to avoid duplicate sends.
    try {
      const nodemailer = (await import("npm:nodemailer@6.9.16")).default;
      const transport = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true,
        auth: { user: gmailUser, pass: gmailPassword } });
      await transport.sendMail({ from, to: recipient.email, subject, text,
        attachments: photoAttachments.map(photo => ({
          filename: photo.filename, content: photo.content, contentType: photo.contentType,
        })),
      });
    } catch (error) {
      await finish("unknown");
      console.error("frontend-api gmail send failed", { reason: error instanceof Error ? error.message.replaceAll(/[\w.+-]+@[\w.-]+/g, "[email]") : "unknown" });
      throw new ApiError(503, "Email provider did not confirm the send. Reply saved. Check email configuration and retry this same saved reply.");
    }
    return json(200, { reply: await finish("sent", `gmail/${replyId}`) });
  }
  let delivered: Response;
  try {
    delivered = await upstream("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json",
        "Idempotency-Key": `review-reply/${replyId}` },
      body: JSON.stringify({
        from, to: [recipient.email], subject, text,
        ...(photoAttachments.length ? { attachments: photoAttachments.map(photo => ({
          filename: photo.filename, content: photo.encodedContent, content_type: photo.contentType,
        })) } : {}),
      }),
    });
  } catch {
    await finish("unknown");
    throw new ApiError(503, "Email delivery is uncertain. Reply saved. Retry this same saved reply after 60 seconds; do not create a duplicate.");
  }
  if (!delivered.ok) {
    // Never return or log provider response bodies: they may contain the recipient address.
    await finish(delivered.status >= 500 || delivered.status === 409 ? "unknown" : "failed");
    await delivered.body?.cancel();
    console.error("frontend-api reply email rejected", { status: delivered.status });
    throw new ApiError(503, "Email provider did not confirm the send. Reply saved. Check email configuration and retry this same saved reply.");
  }
  let confirmation: unknown;
  try { confirmation = await delivered.json(); } catch { confirmation = null; }
  if (!isRecord(confirmation) || typeof confirmation.id !== "string" || !confirmation.id || confirmation.id.length > 200) {
    await finish("unknown");
    throw new ApiError(502, "Email confirmation is uncertain. Reply saved. Retry this same saved reply, not a new one.");
  }
  return json(200, { reply: await finish("sent", confirmation.id) });
}

function ownerTarget(query: URLSearchParams, required: boolean): URLSearchParams {
  const params = new URLSearchParams();
  if (required || query.has("osm_type") || query.has("osm_id")) {
    const type = query.get("osm_type");
    const id = Number(query.get("osm_id"));
    if (!validRestroom(type, id)) throw new ApiError(400, "Invalid restroom");
    params.set("osm_type", `eq.${type}`);
    params.set("osm_id", `eq.${id}`);
  }
  return params;
}

async function ownerResponses(req: Request, admin: boolean): Promise<Response> {
  if (!(admin ? ["GET", "POST"] : ["GET"]).includes(req.method)) throw new ApiError(405, "Method not allowed");
  const adminId = admin ? await requireAllowlistedUser(req, "admin") : null;
  if (req.method === "GET") {
    const query = new URL(req.url).searchParams;
    const params = ownerTarget(query, !admin);
    params.set("select", admin ? adminOwnerColumns : publicOwnerPhotoColumns);
    params.set("order", admin ? "updated_at.desc,id.desc" : "published_at.desc,id.desc");
    const pageSize = admin ? 3 : 50;
    params.set("limit", String(pageSize));
    const offsetText = query.get("offset") ?? "0";
    if (!/^\d{1,8}$/.test(offsetText)) throw new ApiError(400, "Invalid response offset");
    params.set("offset", offsetText);
    if (!admin) params.set("status", "eq.published");
    const archivedFilter = query.get("archived") ?? "0";
    if (archivedFilter !== "0" && archivedFilter !== "1") throw new ApiError(400, "Invalid archived filter");
    params.set("archived_at", admin && archivedFilter === "1" ? "not.is.null" : "is.null");
    const { rows, total } = await databasePage("owner_responses", params);
    if (!Array.isArray(rows) || !rows.every(isRecord)) throw new ApiError(502, "Invalid owner response list");
    // Hide replies if their review is no longer approved, even after publication.
    let responses = rows;
    if (!admin) {
      const ids = rows.filter(isRecord).map(row => row.review_id).filter(id => typeof id === "string");
      if (ids.length) {
        if (!ids.every(id => uuidPattern.test(id))) throw new ApiError(502, "Invalid owner response review identity");
        const approved: unknown = await (await database("reviews", new URLSearchParams({
          select: "id", id: `in.(${ids.join(",")})`, status: "eq.approved",
          osm_type: params.get("osm_type")!, osm_id: params.get("osm_id")!,
        }))).json();
        if (!Array.isArray(approved) || !approved.every(isRecord)) throw new ApiError(502, "Invalid approved review lookup");
        const visible = new Set(approved.map(row => row.id));
        responses = rows.filter(row => isRecord(row) && (row.review_id === null || visible.has(row.review_id)));
      }
    }
    const publicResponses = admin ? responses : await Promise.all(responses.map(async row => {
      if (!isRecord(row)) throw new ApiError(502, "Invalid owner response list");
      const { photo_paths, ...details } = row;
      return { ...details, photo_urls: await signedReviewPhotos(photo_paths) };
    }));
    return json(200, { responses: publicResponses, total, next_offset: rows.length === pageSize ? Number(offsetText) + pageSize : null });
  }
  let body: unknown;
  try { body = await req.json(); } catch { throw new ApiError(400, "Invalid JSON"); }
  if (isRecord(body) && body.action === "archive") {
    if (typeof body.id !== "string" || !uuidPattern.test(body.id) || typeof body.archived !== "boolean") throw new ApiError(400, "Invalid archive request");
    const archiveRows = await rpcRows("admin_archive_owner_response", { p_admin_id: adminId, p_id: body.id, p_archived: body.archived });
    if (!archiveRows.length) throw new ApiError(404, "Response not found. Refresh.");
    return json(200, { response: archiveRows[0] });
  }
  if (!isRecord(body) || typeof body.action !== "string" || !["save", "publish"].includes(body.action) ||
    (body.id !== null && (typeof body.id !== "string" || !uuidPattern.test(body.id))) ||
    (body.id === null ? body.version !== null : typeof body.version !== "number" || !Number.isSafeInteger(body.version) || body.version < 1) ||
    (body.action === "publish" && body.id === null)) throw new ApiError(400, "Invalid owner response action");
  let fields: Record<string, unknown> | null = null;
  if (body.action === "save") {
    const value = body.fields;
    if (!isRecord(value) || !validRestroom(value.osm_type, value.osm_id) ||
      (value.review_id !== null && (typeof value.review_id !== "string" || !uuidPattern.test(value.review_id))) ||
      typeof value.business_name !== "string" || !value.business_name.trim() || value.business_name.length > 200 ||
      typeof value.body !== "string" || !value.body.trim() || value.body.length > 4000 ||
      typeof value.verification_note !== "string" || !value.verification_note.trim() || value.verification_note.length > 2000 ||
      (value.evidence_url !== null && (typeof value.evidence_url !== "string" || value.evidence_url.length > 2000)) ||
      (value.completed_on !== null && (typeof value.completed_on !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value.completed_on) || !Number.isFinite(Date.parse(value.completed_on)) ||
        new Date(value.completed_on).toISOString().slice(0, 10) !== value.completed_on ||
        value.completed_on > new Date().toISOString().slice(0, 10)))) throw new ApiError(400, "Invalid owner response fields");
    if (value.evidence_url !== null) {
      let url: URL;
      try { url = new URL(value.evidence_url); } catch { throw new ApiError(400, "Evidence link must be a valid HTTPS URL"); }
      if (url.protocol !== "https:" || !url.hostname || url.username || url.password) throw new ApiError(400, "Evidence link must be HTTPS without credentials");
    }
    fields = {
      osm_type: value.osm_type, osm_id: value.osm_id, review_id: value.review_id,
      business_name: value.business_name.trim(), body: value.body.trim(), verification_note: value.verification_note.trim(),
      completed_on: value.completed_on, evidence_url: value.evidence_url,
    };
  }
  const result: unknown = await (await database("rpc/save_owner_response", new URLSearchParams(), {
    method: "POST", body: JSON.stringify({ p_admin_id: adminId, p_action: body.action, p_id: body.id, p_version: body.version, p_fields: fields }),
  })).json();
  if (!Array.isArray(result)) throw new ApiError(502, "Invalid owner response result");
  if (!result.length) throw new ApiError(409, "This draft has changed or was already published. Refresh before trying again.");
  if (result.length !== 1 || !isRecord(result[0]) || typeof result[0].id !== "string" ||
    result[0].status !== (body.action === "publish" ? "published" : "draft")) throw new ApiError(502, "Invalid owner response result");
  return json(200, { response: result[0] });
}

export default {
  // Authorizes gateway traffic and dispatches review, auth, geocoding, and map requests.
  async fetch(req: Request): Promise<Response> {
    const denied = authorizeGatewayRequest(req, json, "frontend-api");
    if (denied) return denied;
    const path = new URL(req.url).pathname.replace(/^\/(?:functions\/v1\/)?frontend-api(?=\/|$)/, "").replace(/\/$/, "") || "/";
    try {
      if (path === "/toilet-submissions") return await toiletSubmissions(req);
      if (path === "/moderation/toilets") return await moderateToilets(req);
      if (path === "/reviews") return await reviews(req);
      if (path === "/moderation/reviews") return await moderation(req);
      if (path === "/admin/owner-responses") return await ownerResponses(req, true);
      if (path === "/admin/reviews") return await adminReviews(req);
      if (path === "/admin/toilets") return await adminToilets(req);
      if (path === "/admin/review-replies") return await adminReviewReplies(req);
      if (path === "/admin/owner-invites") return await adminOwnerInvites(req);
      if (path === "/admin/owner-replies") return await ownerReplyStage(req, "publish");
      if (path === "/moderation/owner-replies") return await ownerReplyStage(req, "moderate");
      if (path === "/owner/reviews") return await ownerReviews(req);
      if (path === "/owner/review-photos") return await ownerReviewPhotos(req);
      if (path === "/owner/replies") return await ownerReplies(req);
      if (path === "/owner-responses") return await ownerResponses(req, false);
      if (path.startsWith("/auth/")) return await auth(req, path);
      if (req.method !== "GET") throw new ApiError(405, "Method not allowed");
      // Resolves ZIP codes or geocodes a US address, returning coordinates or suggestions.
      if (path === "/geocode") {
        const suggest = new URL(req.url).searchParams.get("suggest") === "1";
        const zip = new URL(req.url).searchParams.get("zip");
        if (zip !== null) {
          const origin = await geocodeZipCode(zip.trim());
          if (!origin) throw new ApiError(404, "No matching US ZIP code found.");
          if (suggest) return json(200, { suggestions: [{
            label: `ZIP ${origin.zipCode}, USA`, latitude: origin.latitude, longitude: origin.longitude,
          }] });
          return json(200, { latitude: origin.latitude, longitude: origin.longitude, zipCode: origin.zipCode });
        }
        const query = new URL(req.url).searchParams.get("q")?.trim();
        if (!query || query.length > 200) throw new ApiError(400, "Provide a US city or address (up to 200 characters).");
        const url = new URL("https://photon.komoot.io/api/");
        url.search = new URLSearchParams({ limit: suggest ? "5" : "1", countrycode: "US", lang: "en", q: query }).toString();
        const response = await upstream(url, { headers: { "User-Agent": "WashroomStatusUSA/1.0" } });
        if (!response.ok) {
          console.error("City geocoder failed", { status: response.status });
          throw new ApiError(502, `City or address lookup is unavailable (provider HTTP ${response.status})`);
        }
        const results: unknown = await response.json();
        if (!isRecord(results) || !Array.isArray(results.features)) throw new ApiError(502, "Invalid geocoding response");
        if (!results.features.length && !suggest) throw new ApiError(404, "No matching US city or address found.");
        const suggestions = results.features.slice(0, suggest ? 5 : 1).map((first: unknown) => {
          if (!isRecord(first) || !isRecord(first.geometry) ||
            first.geometry.type !== "Point" || !Array.isArray(first.geometry.coordinates) ||
            !isRecord(first.properties) || String(first.properties.countrycode).toUpperCase() !== "US") {
            throw new ApiError(502, "Invalid US geocoding result");
          }
          const [longitude, latitude] = first.geometry.coordinates;
          if (typeof latitude !== "number" || typeof longitude !== "number" ||
            !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
            Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new ApiError(502, "Invalid geocoding coordinates");
          const properties = first.properties;
          const street = [properties.housenumber, properties.street]
            .filter(value => typeof value === "string" && value.trim()).join(" ");
          const parts = [properties.name, street, properties.city || properties.town || properties.village,
            properties.state, properties.postcode, "USA"]
            .filter((value): value is string => typeof value === "string" && !!value.trim());
          return { latitude, longitude, label: [...new Set(parts)].join(", ") };
        });
        if (suggest) return json(200, { suggestions });
        const { latitude, longitude } = suggestions[0];
        return json(200, { latitude, longitude });
      }
      // Retrieves and validates the US boundary feature used to frame the map.
      if (path === "/map-boundary") {
        const response = await upstream("https://raw.githubusercontent.com/johan/world.geo.json/master/countries/USA.geo.json");
        if (!response.ok) throw new ApiError(502, "US boundary unavailable");
        const data: unknown = await response.json();
        const feature: unknown = isRecord(data) && data.type === "FeatureCollection" &&
          Array.isArray(data.features) ? data.features[0] : data;
        if (!isRecord(feature) || !isRecord(feature.geometry) ||
          !["Polygon", "MultiPolygon"].includes(String(feature.geometry.type)) ||
          !Array.isArray(feature.geometry.coordinates)) throw new ApiError(502, "Invalid US boundary response");
        return json(200, feature);
      }
      throw new ApiError(404, "Route not found");
    } catch (error) {
      console.error("frontend-api request failed", { path, error: error instanceof Error ? error.message : String(error) });
      const status = error instanceof ApiError || error instanceof RequestError ? error.status :
        error instanceof Error && error.name === "TimeoutError" ? 504 : 502;
      return json(status, { error: error instanceof ApiError || error instanceof RequestError ? error.message : "Application backend is temporarily unavailable" });
    }
  },
};
