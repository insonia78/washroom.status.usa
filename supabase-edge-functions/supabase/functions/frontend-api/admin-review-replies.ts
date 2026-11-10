import { database, databasePage, config, upstream } from "./database.ts";
import { ApiError, isRecord, uuidPattern, json } from "./api-utils.ts";
import { requireAllowlistedUser } from "./auth.ts";
import { replyColumns } from "./owner-columns.ts";
import { EmailPhotoAttachment, approvedOwnerPhotoAttachments } from "./email-photos.ts";

export async function replyAction(adminId: string, action: string, id: string, fields: Record<string, unknown> = {}) {
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

export async function adminReviewReplies(req: Request): Promise<Response> {
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
    ? "\n\nPhotos from the business owner showing their improvements are attached to this email."
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
