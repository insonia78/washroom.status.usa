import api from "./index.ts";
import { buildGatewayHeaders } from "../_shared/gateway-auth.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("moderator and administrator owner-reply queues return attached photos", async () => {
  const config = {
    GATEWAY_INTERNAL_SECRET: "test-secret",
    SUPABASE_URL: "https://project.example",
    SUPABASE_ANON_KEY: "test-anon",
    SUPABASE_SERVICE_ROLE_KEY: "test-service",
  };
  const previous = new Map(Object.keys(config).map(key => [key, Deno.env.get(key)]));
  const originalFetch = globalThis.fetch;
  for (const [key, value] of Object.entries(config)) Deno.env.set(key, value);
  const moderatorId = "b0000000-0000-4000-8000-000000000001";
  const replyId = "c0000000-0000-4000-8000-000000000001";
  const inviteId = "d0000000-0000-4000-8000-000000000001";
  const reviewId = "e0000000-0000-4000-8000-000000000001";
  const photoId = "f0000000-0000-4000-8000-000000000001";
  const photoPath = `${moderatorId}/${photoId}.jpg`;
  const headers = { ...buildGatewayHeaders(config.GATEWAY_INTERNAL_SECRET), Authorization: "Bearer moderator-token" };
  try {
    globalThis.fetch = async input => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/auth/v1/user") {
        return Response.json({ id: moderatorId, email: "moderator@example.test", email_confirmed_at: "2026-01-01" });
      }
      if (url.pathname === "/rest/v1/review_moderators" || url.pathname === "/rest/v1/owner_response_admins") {
        return Response.json([{ user_id: moderatorId }]);
      }
      if (url.pathname === "/rest/v1/owner_replies") {
        return new Response(JSON.stringify([{
          id: replyId, invite_id: inviteId, review_id: reviewId, osm_type: "refuge", osm_id: 123,
          owner_email: "owner@example.test", business_name: "Business", body: "We fixed this.",
          status: url.searchParams.get("status") === "eq.pending" ? "pending" : "moderated",
          created_at: "2026-11-03T00:00:00Z", archived_at: null,
        }]), { headers: { "Content-Range": "0-0/1" } });
      }
      if (url.pathname === "/rest/v1/owner_reply_photos") {
        assert(url.searchParams.get("reply_id") === `in.(${replyId})`, "Fetch photos for replies on the current page");
        return Response.json([{ id: photoId, reply_id: replyId, photo_path: photoPath, status: "pending" }]);
      }
      if (url.pathname === "/rest/v1/reviews") {
        return Response.json([{
          id: reviewId, osm_type: "refuge", osm_id: 123, restroom_name: "Business restroom", comment: "Original complaint",
        }]);
      }
      if (url.pathname.startsWith("/storage/v1/object/sign/review-photos/")) {
        return Response.json({ signedURL: `/object/sign/review-photos/${encodeURIComponent(photoPath)}?token=test` });
      }
      throw new Error(`Unexpected upstream request: ${url.pathname}`);
    };
    for (const stage of ["moderation", "admin"] as const) {
      const path = stage === "moderation" ? "/frontend-api/moderation/owner-replies" : "/frontend-api/admin/owner-replies";
      const response = await api.fetch(new Request(`https://project.example${path}?offset=0`, { headers }));
      const result = await response.json();
      assert(response.status === 200 && result.replies[0].photos.length === 1 &&
        result.replies[0].photos[0].id === photoId &&
        result.replies[0].photos[0].photo_url.includes("review-photos"),
      `${stage} queue returns a signed photo attachment`);
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
});
