import api from "./index.ts";
import { buildGatewayHeaders } from "../_shared/gateway-auth.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("owner review photos stay private until an administrator adds them", async () => {
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
  const reviewId = "20000000-0000-4000-8000-000000000001";
  const inviteId = "30000000-0000-4000-8000-000000000001";
  const photoId = "40000000-0000-4000-8000-000000000001";
  const image = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const auth = { ...buildGatewayHeaders(config.GATEWAY_INTERNAL_SECRET), Authorization: "Bearer test-token" };
  try {
    const form = new FormData();
    form.set("invite_id", inviteId);
    form.append("photos", new File([image], "restroom.png", { type: "image/png" }));
    const calls: string[] = [];
    let uploadedPath = "";
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      calls.push(url.pathname);
      if (url.pathname === "/auth/v1/user") {
        return Response.json({ id: ownerId, email: "owner@example.test", email_confirmed_at: "2026-01-01" });
      }
      if (url.pathname.startsWith("/storage/v1/object/review-photos/")) {
        assert(init?.method === "POST", "Upload owner image to the private photo bucket");
        uploadedPath = decodeURIComponent(url.pathname.split("/review-photos/")[1]);
        return Response.json({ Key: "stored" });
      }
      if (url.pathname === "/rest/v1/rpc/owner_submit_review_photos") {
        const payload = JSON.parse(String(init?.body));
        assert(payload.p_user_id === ownerId && payload.p_email === "owner@example.test" &&
          payload.p_invite_id === inviteId && payload.p_photo_paths.length === 1 &&
          new RegExp(`^${ownerId}/[0-9a-f-]+\\.png$`, "i").test(payload.p_photo_paths[0]),
        "Bind stored photo to the verified owner and invitation");
        return Response.json([{
          id: photoId, invite_id: inviteId, review_id: reviewId,
          photo_path: payload.p_photo_paths[0], status: "pending", uploaded_at: "2026-11-03T00:00:00Z",
        }]);
      }
      throw new Error(`Unexpected upstream request: ${url.pathname}`);
    };
    const uploaded = await api.fetch(new Request("https://project.example/functions/v1/frontend-api/owner/review-photos", {
      method: "POST", headers: auth, body: form,
    }));
    const uploadResult = await uploaded.json();
    assert(uploaded.status === 201 && uploadResult.photos[0].status === "pending", "Accept private owner upload");
    assert(new RegExp(`^${ownerId}/[0-9a-f-]+\\.png$`, "i").test(uploadedPath) &&
      calls.indexOf("/storage/v1/object/review-photos/" + uploadedPath) < calls.indexOf("/rest/v1/rpc/owner_submit_review_photos"),
    "Store the private object before registering it as pending");

    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/auth/v1/user") {
        return Response.json({ id: "50000000-0000-4000-8000-000000000001", email_confirmed_at: "2026-01-01" });
      }
      if (url.pathname === "/rest/v1/owner_response_admins") return Response.json([{ user_id: "50000000-0000-4000-8000-000000000001" }]);
      if (url.pathname === "/rest/v1/rpc/admin_add_owner_review_photo") {
        const payload = JSON.parse(String(init?.body));
        assert(payload.p_admin_id === "50000000-0000-4000-8000-000000000001" && payload.p_photo_id === photoId,
          "Authorize admin photo action with the verified administrator");
        return Response.json([{ id: reviewId, photo_paths: [`${ownerId}/50000000-0000-4000-8000-000000000001.png`] }]);
      }
      if (url.pathname.startsWith("/storage/v1/object/sign/review-photos/")) {
        return Response.json({ signedURL: "/object/sign/review-photos/owner-photo?token=private" });
      }
      throw new Error(`Unexpected upstream request: ${url.pathname}`);
    };
    const added = await api.fetch(new Request("https://project.example/functions/v1/frontend-api/admin/reviews", {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add_owner_photo", photo_id: photoId }),
    }));
    const addResult = await added.json();
    assert(added.status === 200 && addResult.review.id === reviewId &&
      addResult.review.photo_urls.length === 1 && addResult.review.photo_urls[0].includes("token=private"),
    "Return the appended review image only as a signed URL after admin approval");

    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/auth/v1/user") {
        return Response.json({ id: "50000000-0000-4000-8000-000000000001", email_confirmed_at: "2026-01-01" });
      }
      if (url.pathname === "/rest/v1/owner_response_admins") {
        return Response.json([{ user_id: "50000000-0000-4000-8000-000000000001" }]);
      }
      if (url.pathname === "/rest/v1/reviews") {
        assert(url.searchParams.get("status") === "in.(approved,rejected)" &&
          !url.searchParams.has("archived_at") && url.searchParams.get("limit") === "3",
        "All-history mode includes both moderated statuses without an archive filter");
        return Response.json([], { headers: { "content-range": "*/0" } });
      }
      throw new Error(`Unexpected upstream request: ${url.pathname}`);
    };
    const history = await api.fetch(new Request("https://project.example/functions/v1/frontend-api/admin/reviews?archived=all", {
      headers: auth,
    }));
    assert(history.status === 200 && (await history.json()).reviews.length === 0,
      "Return all active and archived approved/rejected reviews through the history filter");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
});
