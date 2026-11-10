import api from "./index.ts";
import { buildGatewayHeaders } from "../_shared/gateway-auth.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("owner review cards include verified listing coordinates for a read-only map", async () => {
  const config = {
    GATEWAY_INTERNAL_SECRET: "test-secret",
    SUPABASE_URL: "https://project.example",
    SUPABASE_ANON_KEY: "test-anon",
    SUPABASE_SERVICE_ROLE_KEY: "test-service",
  };
  const previous = new Map(Object.keys(config).map(key => [key, Deno.env.get(key)]));
  const originalFetch = globalThis.fetch;
  for (const [key, value] of Object.entries(config)) Deno.env.set(key, value);
  const ownerId = "10000000-0000-4000-8000-000000000001";
  const inviteId = "20000000-0000-4000-8000-000000000001";
  const reviewId = "30000000-0000-4000-8000-000000000001";
  const replyId = "40000000-0000-4000-8000-000000000001";
  const photoId = "50000000-0000-4000-8000-000000000001";
  const photoPath = `${ownerId}/${photoId}.jpg`;
  const headers = { ...buildGatewayHeaders(config.GATEWAY_INTERNAL_SECRET), Authorization: "Bearer owner-token" };
  try {
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/auth/v1/user") {
        return Response.json({ id: ownerId, email: "owner@example.test", email_confirmed_at: "2026-01-01" });
      }
      if (url.pathname === "/rest/v1/owner_invites") {
        if (url.searchParams.has("email")) {
          assert(url.searchParams.get("email") === "eq.owner@example.test", "Only use invitations for the verified owner email");
          return Response.json([{ id: inviteId, review_id: reviewId }]);
        } else {
          assert(url.searchParams.get("review_id") === `eq.${reviewId}`, "Filter admin invite status by the selected review");
          return Response.json([{
            id: inviteId, email: "owner@example.test", review_id: reviewId,
            created_at: "2026-11-03T00:00:00Z",
          }]);
        }
      }
      if (url.pathname === "/rest/v1/owner_response_admins") return Response.json([{ user_id: ownerId }]);
      if (url.pathname === "/rest/v1/reviews") {
        return Response.json([{
          id: reviewId, osm_type: "node", osm_id: 123, restroom_name: "Business restroom",
          rating: 2, availability: "closed", cleanliness_status: "dirty", issues: ["broken_lock"],
          comment: "The lock is broken.", status: "approved", created_at: "2026-11-03T00:00:00Z",
          photo_paths: [],
        }]);
      }
      if (url.pathname === "/rest/v1/review_locations") {
        assert(url.searchParams.get("osm_type") === "eq.refuge", "Only Refuge listings need registered-location coordinates");
        return Response.json([]);
      }
      if (url.pathname === "/rest/v1/owner_replies" || url.pathname === "/rest/v1/owner_review_photos") {
        if (url.pathname.endsWith("/owner_replies") && url.searchParams.has("invite_id")) return Response.json([]);
        if (url.pathname.endsWith("/owner_replies")) return Response.json([{
          id: replyId, invite_id: inviteId, review_id: reviewId,
          owner_email: "owner@example.test", business_name: "Business", body: "Thanks for letting us know.",
          status: "published", created_at: "2026-11-03T00:00:00Z", archived_at: null,
        }]);
        return Response.json([]);
      }
      if (url.pathname === "/rest/v1/owner_reply_photos") return Response.json([{
        id: photoId, reply_id: replyId, photo_path: photoPath, status: "published",
      }]);
      if (url.pathname === "/rest/v1/owner_responses") return Response.json([{
        id: replyId, osm_type: "node", osm_id: 123, review_id: reviewId,
        business_name: "Business", body: "We fixed this.", completed_on: null,
        evidence_url: null, published_at: "2026-11-03T00:00:00Z", photo_paths: [photoPath],
      }]);
      if (url.pathname.startsWith("/storage/v1/object/sign/review-photos/")) {
        return Response.json({ signedURL: `/object/sign/review-photos/${encodeURIComponent(photoPath)}?token=test` });
      }
      if (url.pathname === "/rest/v1/restrooms") {
        assert(url.searchParams.get("osm_id") === "in.(123)", "Fall back to verified restroom coordinates");
        return Response.json([{ osm_type: "node", osm_id: 123, latitude: 40.71, longitude: -74 }]);
      }
      if (url.pathname === "/rest/v1/rpc/owner_archive_reply") {
        const body = await new Response(init?.body).json();
        assert(body.p_owner_id === ownerId && body.p_email === "owner@example.test" &&
          body.p_id === replyId && body.p_archived === true,
        "Archive only the verified owner's own response");
        return Response.json([{
          id: body.p_id, archived_at: "2026-11-03T00:00:00Z",
        }]);
      }
      if (url.pathname.startsWith("/storage/v1/object/review-photos/")) {
        assert(init?.method === "POST", "Upload reply photos to private storage");
        return new Response(null, { status: 201 });
      }
      if (url.pathname === "/rest/v1/rpc/owner_submit_reply") {
        const body = JSON.parse(String(init?.body));
        assert(body.p_user_id === ownerId && body.p_invite_id === inviteId &&
          body.p_photo_paths.length === 1 && body.p_photo_paths[0].startsWith(`${ownerId}/`),
        "Create the owner reply and its private photo metadata together");
        return Response.json([{ id: replyId, status: "pending" }]);
      }
      throw new Error(`Unexpected upstream request: ${url.pathname}`);
    };
    const response = await api.fetch(new Request("https://project.example/frontend-api/owner/reviews", { headers }));
    const result = await response.json();
    assert(response.status === 200 && result.items.length === 1 &&
      result.items[0].review.latitude === 40.71 && result.items[0].review.longitude === -74 &&
      result.items[0].replies[0].photos[0].photo_url.includes("review-photos"),
    "Return verified coordinates with the invited complaint for the owner map");
    const inviteStatusResponse = await api.fetch(new Request(
      `https://project.example/frontend-api/admin/owner-invites?review_id=${reviewId}`, { headers },
    ));
    const inviteStatus = await inviteStatusResponse.json();
    assert(inviteStatusResponse.status === 200 &&
      inviteStatus.invites[0].response_status === "waiting",
    "Show forwarded reviews as waiting until the invited owner replies");
    const publicResponse = await api.fetch(new Request(
      "https://project.example/frontend-api/owner-responses?osm_type=node&osm_id=123", { headers },
    ));
    const published = await publicResponse.json();
    assert(publicResponse.status === 200 && published.responses?.[0]?.photo_urls?.length === 1,
      `Expose only signed reply photos after final publication: ${publicResponse.status} ${JSON.stringify(published)}`);
    const replyForm = new FormData();
    replyForm.set("invite_id", inviteId);
    replyForm.set("business_name", "Business");
    replyForm.set("body", "We will fix this.");
    replyForm.set("photos", new File([new Uint8Array([0xff, 0xd8, 0xff])], "reply.jpg", { type: "image/jpeg" }));
    const submitResponse = await api.fetch(new Request("https://project.example/frontend-api/owner/replies", {
      method: "POST", headers, body: replyForm,
    }));
    assert(submitResponse.status === 201, "Accept a reply with private photo attachments for moderation");
    const archiveResponse = await api.fetch(new Request("https://project.example/frontend-api/owner/replies", {
      method: "POST", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ reply_id: replyId, archived: true }),
    }));
    assert(archiveResponse.status === 200, "Allow an owner to archive their completed response");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
});
