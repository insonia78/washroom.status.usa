import { validRestroom, ApiError, isRecord, uuidPattern, json } from "./api-utils.ts";
import { requireAllowlistedUser } from "./auth.ts";
import { adminOwnerColumns, publicOwnerPhotoColumns } from "./owner-columns.ts";
import { databasePage, database, rpcRows } from "./database.ts";
import { signedReviewPhotos } from "./review-photos.ts";

export function ownerTarget(query: URLSearchParams, required: boolean): URLSearchParams {
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

export async function ownerResponses(req: Request, admin: boolean): Promise<Response> {
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
