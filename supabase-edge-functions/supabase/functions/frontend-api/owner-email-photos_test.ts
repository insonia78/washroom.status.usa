import api from "./index.ts";
import { buildGatewayHeaders } from "../_shared/gateway-auth.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("private review email includes approved owner photos as attachments", async () => {
  const config = {
    GATEWAY_INTERNAL_SECRET: "test-secret",
    SUPABASE_URL: "https://project.example",
    SUPABASE_ANON_KEY: "test-anon",
    SUPABASE_SERVICE_ROLE_KEY: "test-service",
    RESEND_API_KEY: "test-resend-key",
    REVIEW_REPLY_FROM: "replies@example.test",
    EMAIL_PROVIDER: "resend",
  };
  const previous = new Map(Object.keys(config).map(key => [key, Deno.env.get(key)]));
  const originalFetch = globalThis.fetch;
  for (const [key, value] of Object.entries(config)) Deno.env.set(key, value);
  const adminId = "60000000-0000-4000-8000-000000000001";
  const reviewerId = "70000000-0000-4000-8000-000000000001";
  const reviewId = "80000000-0000-4000-8000-000000000001";
  const replyId = "90000000-0000-4000-8000-000000000001";
  const photoId = "a0000000-0000-4000-8000-000000000001";
  const photoPath = `${adminId}/${photoId}.jpg`;
  const ownerReplyId = "b0000000-0000-4000-8000-000000000001";
  const replyPhotoPath = `${adminId}/c0000000-0000-4000-8000-000000000001.jpg`;
  let attachedPaths = 0;
  const headers = { ...buildGatewayHeaders(config.GATEWAY_INTERNAL_SECRET), Authorization: "Bearer admin-token" };
  try {
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/auth/v1/user") {
        return Response.json({ id: adminId, email: "admin@example.test", email_confirmed_at: "2026-01-01" });
      }
      if (url.pathname === "/rest/v1/owner_response_admins") return Response.json([{ user_id: adminId }]);
      if (url.pathname === `/auth/v1/admin/users/${reviewerId}`) {
        return Response.json({ id: reviewerId, email: "reviewer@example.test", email_confirmed_at: "2026-01-01" });
      }
      if (url.pathname === "/rest/v1/rpc/admin_review_reply") {
        const body = JSON.parse(String(init?.body));
        if (body.p_action === "claim") {
          return Response.json([{
            id: replyId, review_id: reviewId, recipient_user_id: reviewerId,
            body: "The business submitted an update.", status: "sending",
          }]);
        }
        assert(body.p_action === "sent", "Finish the reply after the provider accepts the email");
        return Response.json([{
          id: replyId, review_id: reviewId, recipient_user_id: reviewerId,
          body: "The business submitted an update.", status: "sent",
        }]);
      }
      if (url.pathname === "/rest/v1/owner_replies") {
        assert(url.searchParams.get("review_id") === `eq.${reviewId}` &&
          url.searchParams.get("status") === "in.(moderated,published)" && !url.searchParams.has("archived_at"),
        "Include moderator-approved and published owner replies, archived or not");
        return Response.json([{
          id: ownerReplyId, status: "moderated", moderated_at: "2026-11-04T00:00:00Z", published_at: null,
        }]);
      }
      if (url.pathname === "/rest/v1/owner_reply_photos") {
        assert(url.searchParams.get("reply_id") === `in.(${ownerReplyId})` &&
          url.searchParams.get("status") === "in.(moderated,published)",
        "Include only moderator-approved or published owner reply photos");
        return Response.json([{ reply_id: ownerReplyId, photo_path: replyPhotoPath }]);
      }
      if (url.pathname === "/rest/v1/owner_review_photos") {
        assert(url.searchParams.get("review_id") === `eq.${reviewId}` &&
          url.searchParams.get("status") === "eq.added",
        "Include only owner photos approved for this review");
        return Response.json([{ photo_path: photoPath }]);
      }
      if (url.pathname === `/storage/v1/object/review-photos/${photoPath}` ||
        url.pathname === `/storage/v1/object/review-photos/${replyPhotoPath}`) {
        assert(init?.method !== "POST", "Fetch the approved owner photo from private storage");
        return new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
          headers: { "Content-Type": "image/jpeg", "Content-Length": "3" },
        });
      }
      if (url.hostname === "api.resend.com") {
        const payload = JSON.parse(String(init?.body));
        assert(payload.attachments?.length === 2 &&
          payload.attachments[0].filename === "owner-photo-1.jpg" &&
          payload.attachments[1].filename === "owner-photo-2.jpg" &&
          payload.attachments[0].content_type === "image/jpeg" &&
          payload.attachments[0].content === "/9j/" &&
          payload.text.includes("Photos from the business owner showing their improvements are attached"),
        "Attach the moderator-approved reply photo and approved owner photo to the email reply");
        attachedPaths = 2;
        return Response.json({ id: "provider-message-id" });
      }
      throw new Error(`Unexpected upstream request: ${url.pathname}`);
    };
    const response = await api.fetch(new Request("https://project.example/frontend-api/admin/review-replies", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send", id: replyId }),
    }));
    const result = await response.json();
    assert(response.status === 200 && result.reply.status === "sent" && attachedPaths === 2,
      "Send the reply and persist the provider confirmation");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
});

