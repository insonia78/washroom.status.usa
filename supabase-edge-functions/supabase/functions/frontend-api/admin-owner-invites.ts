import { ApiError, uuidPattern, isRecord, json, readJson } from "./api-utils.ts";
import { requireAllowlistedUser } from "./auth.ts";
import { database, rpcRows, config, upstream } from "./database.ts";

// Admin: invite a business owner to answer one approved review through a magic link.
export async function adminOwnerInvites(req: Request): Promise<Response> {
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
