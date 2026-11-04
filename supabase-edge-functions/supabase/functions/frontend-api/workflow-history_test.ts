import api from "./index.ts";
import { buildGatewayHeaders } from "../_shared/gateway-auth.ts";
import { emailOwnerPhotoPaths, reviewHistory, toiletHistory } from "./workflow-history.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("workflow history lists the steps taken in time order", () => {
  const steps = reviewHistory({
    review: { created_at: "2026-11-01T00:00:00Z", archived_at: "2026-11-09T00:00:00Z", photo_paths: ["a", "b"] },
    moderation: [{ decision: "approved", note: "Looks fine", created_at: "2026-11-02T00:00:00Z" }],
    invites: [{ email: "owner@example.test", created_at: "2026-11-03T00:00:00Z" }],
    ownerReplies: [{
      business_name: "Cafe", status: "rejected", created_at: "2026-11-04T00:00:00Z",
      moderated_at: "2026-11-05T00:00:00Z", published_at: "2026-11-06T00:00:00Z", photos: [{}],
    }],
    ownerPhotos: [],
    privateReplies: [{ created_at: "2026-11-07T00:00:00Z", sent_at: "2026-11-08T00:00:00Z" }],
  });
  assert(JSON.stringify(steps.map(step => step.label)) === JSON.stringify([
    "Review submitted", "Moderator approved the review", "Owner invited", "Owner replied",
    "Moderator approved the owner reply", "Administrator rejected the owner reply",
    "Private reply drafted", "Private reply emailed to the reviewer", "Review archived",
  ]), `Unexpected review steps: ${JSON.stringify(steps)}`);
  assert(steps[0].detail === "2 photos attached" && steps[1].detail === "Note: Looks fine" &&
    steps[3].detail === "Cafe - 1 photo attached", "Describe photos and moderator notes");

  const toilet = toiletHistory({
    status: "approved", created_at: "2026-11-01T00:00:00Z", moderated_at: "2026-11-02T00:00:00Z",
    published_at: null, archived_at: null, photo_paths: [],
  });
  assert(JSON.stringify(toilet.map(step => step.label)) ===
    JSON.stringify(["Toilet submitted", "Moderator approved the toilet"]), "Skip steps not taken yet");
  assert(toiletHistory({ status: "rejected", created_at: "2026-11-01T00:00:00Z", moderated_at: "2026-11-02T00:00:00Z" })[1].label ===
    "Moderator rejected the toilet", "Show moderator rejection");

  assert(JSON.stringify(emailOwnerPhotoPaths(["r1", "r2"], ["o1", "o2"])) === JSON.stringify(["r1", "r2", "o1"]),
    "Email reply photos first, capped at 3");
});

Deno.test("admin review cards include owner reply photos, email photos and step history", async () => {
  const config = {
    GATEWAY_INTERNAL_SECRET: "test-secret",
    SUPABASE_URL: "https://project.example",
    SUPABASE_ANON_KEY: "test-anon",
    SUPABASE_SERVICE_ROLE_KEY: "test-service",
  };
  const previous = new Map(Object.keys(config).map(key => [key, Deno.env.get(key)]));
  const originalFetch = globalThis.fetch;
  for (const [key, value] of Object.entries(config)) Deno.env.set(key, value);
  const adminId = "50000000-0000-4000-8000-000000000001";
  const reviewId = "20000000-0000-4000-8000-000000000001";
  const replyId = "60000000-0000-4000-8000-000000000001";
  const replyPhotoId = "70000000-0000-4000-8000-000000000001";
  const photoPath = `${adminId}/80000000-0000-4000-8000-000000000001.png`;
  const headers = { ...buildGatewayHeaders(config.GATEWAY_INTERNAL_SECRET), Authorization: `Bearer ${"admin-session"}` };
  try {
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      if (url.pathname === "/auth/v1/user") return Response.json({ id: adminId, email_confirmed_at: "2026-01-01" });
      if (url.pathname === "/rest/v1/owner_response_admins") return Response.json([{ user_id: adminId }]);
      if (url.pathname === "/rest/v1/reviews") {
        return Response.json([{
          id: reviewId, user_id: null, osm_type: "refuge", osm_id: 1, restroom_name: "Cafe", rating: 2,
          issues: [], comment: "", status: "approved", created_at: "2026-11-01T00:00:00Z",
          archived_at: null, photo_paths: [],
        }], { headers: { "content-range": "0-0/1" } });
      }
      if (url.pathname === "/rest/v1/review_moderation_log") {
        return Response.json([{ review_id: reviewId, decision: "approved", note: "", created_at: "2026-11-02T00:00:00Z" }]);
      }
      if (url.pathname === "/rest/v1/owner_invites") {
        return Response.json([{ review_id: reviewId, email: "owner@example.test", created_at: "2026-11-03T00:00:00Z" }]);
      }
      if (url.pathname === "/rest/v1/owner_replies") {
        return Response.json([{
          id: replyId, invite_id: "30000000-0000-4000-8000-000000000001", review_id: reviewId,
          osm_type: "refuge", osm_id: 1, owner_email: "owner@example.test", business_name: "Cafe", body: "Fixed",
          status: "published", created_at: "2026-11-04T00:00:00Z", moderated_at: "2026-11-05T00:00:00Z",
          published_at: "2026-11-06T00:00:00Z", archived_at: null,
        }]);
      }
      if (url.pathname === "/rest/v1/owner_reply_photos") {
        return Response.json([{ id: replyPhotoId, reply_id: replyId, photo_path: photoPath, status: "published" }]);
      }
      if (url.pathname === "/rest/v1/owner_review_photos" || url.pathname === "/rest/v1/review_replies") return Response.json([]);
      if (url.pathname.startsWith("/storage/v1/object/sign/review-photos/")) {
        return Response.json({ signedURL: "/object/sign/review-photos/reply-photo?token=private" });
      }
      throw new Error(`Unexpected upstream request: ${url.pathname}`);
    };
    const response = await api.fetch(new Request("https://project.example/frontend-api/admin/reviews", { headers }));
    const body = await response.json();
    const review = body.reviews?.[0];
    assert(response.status === 200 && review, `Load admin reviews: ${JSON.stringify(body)}`);
    assert(review.owner_replies.length === 1 && review.owner_replies[0].photos[0].photo_url.includes("token=private"),
      "Show signed owner reply photos on the admin card");
    assert(review.email_photos.length === 1 && review.email_photos[0].id === replyPhotoId,
      "Preview published owner reply photos as email attachments");
    assert(!JSON.stringify(review).includes(photoPath), "Never expose private storage paths");
    assert(JSON.stringify(review.history.map((step: { label: string }) => step.label)) === JSON.stringify([
      "Review submitted", "Moderator approved the review", "Owner invited", "Owner replied",
      "Moderator approved the owner reply", "Administrator published the owner reply",
    ]), `Unexpected history: ${JSON.stringify(review.history)}`);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
});
