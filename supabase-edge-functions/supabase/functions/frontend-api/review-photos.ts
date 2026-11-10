import { config, upstream } from "./database.ts";
import { ApiError, isRecord } from "./api-utils.ts";

export const reviewPhotoBucket = "review-photos";
export const reviewPhotoLimit = 3;
export const reviewPhotoMaxBytes = 5 * 1024 * 1024;
export const reviewPhotoTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
export const ownerReviewPhotoLimit = 3;
export const reviewPhotoPathPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i;

export function storageObjectUrl(path: string): URL {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return new URL(`/storage/v1/object/${reviewPhotoBucket}/${encoded}`, config("SUPABASE_URL"));
}

export async function hasMatchingImageSignature(file: File): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (file.type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (file.type === "image/png") return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte);
  return file.type === "image/webp" && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
}

export async function uploadReviewPhoto(path: string, file: File): Promise<void> {
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

export async function deleteReviewPhotos(paths: string[]): Promise<void> {
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

export async function signedReviewPhotos(paths: unknown): Promise<string[]> {
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
