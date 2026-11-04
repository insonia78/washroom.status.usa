import api from "./index.ts";
import { buildGatewayHeaders } from "../_shared/gateway-auth.ts";
function assert(value: unknown, message: string): void {
  if (!value) throw new Error(message);
}
const admin = "11111111-1111-4111-8111-111111111111";
const reviewer = "22222222-2222-4222-8222-222222222222";
const reviewId = "33333333-3333-4333-8333-333333333333";
const replyId = "44444444-4444-4444-8444-444444444444";
const recipientEmail = "private-recipient@example.test";
Deno.test("admin review replies keep emails backend-only and preserve delivery failures", async t => {
  const env = { GATEWAY_INTERNAL_SECRET: "test-secret", SUPABASE_URL: "https://project.example",
    SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service-test",
    RESEND_API_KEY: "resend-test", REVIEW_REPLY_FROM: "Washroom <reply@example.test>" };
  const previous = new Map(Object.keys(env).map(key => [key, Deno.env.get(key)]));
  const originalFetch = globalThis.fetch;
  const originalLog = console.error;
  const logs: string[] = [];
  console.error = (...args) => logs.push(JSON.stringify(args));
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  const request = (path: string, body?: unknown, signed = true) => new Request(`https://project.example/frontend-api${path}`, {
    method: body === undefined ? "GET" : "POST", headers: { ...buildGatewayHeaders(env.GATEWAY_INTERNAL_SECRET),
      ...(signed ? { Authorization: "Bearer admin-test" } : {}), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const authorized = (url: URL) => {
    if (url.pathname === "/auth/v1/user") return Response.json({ id: admin, email_confirmed_at: "2026-01-01" });
    if (url.pathname === "/rest/v1/owner_response_admins") return Response.json([{ user_id: admin }]);
    return null;
  };
  let state: Record<string, unknown>;
  const reset = () => {
    state = { id: replyId, review_id: reviewId, recipient_user_id: reviewer, body: "Private saved reply",
      status: "draft", created_by: admin, created_at: "2026-10-31T01:00:00Z",
      first_attempt_at: null, last_attempt_at: null, sent_at: null, provider_id: null };
  };
  let emails = 0;
  let provider: () => Response | Promise<Response> = () => Response.json({ id: "provider-id" });
  let recipient: unknown = { id: reviewer, email: recipientEmail, email_confirmed_at: "2026-01-01" };
  let storageFails = false;
  const actions: string[] = [];
  const mock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const auth = authorized(url); if (auth) return auth;
    if (url.pathname.startsWith("/rest/v1/")) {
      const headers = new Headers(init?.headers);
      assert(headers.get(init?.method === "POST" ? "Content-Profile" : "Accept-Profile") === "app_locations", "Use private schema");
    }
    if (url.pathname === "/rest/v1/owner_replies" || url.pathname === "/rest/v1/owner_review_photos" ||
      url.pathname === "/rest/v1/owner_reply_photos") return Response.json([]);
    if (url.pathname === "/rest/v1/rpc/admin_review_reply") {
      const body = JSON.parse(String(init?.body));
      assert(body.p_admin_id === admin && body.p_id === replyId, "Verify actor and saved reply identity");
      actions.push(body.p_action);
      if (body.p_action === "save") {
        assert(body.p_review_id === reviewId && body.p_body === "Private saved reply", "Only save validated text and review");
        assert(!("email" in body) && !("recipient_user_id" in body), "Never accept client recipient");
      } else if (body.p_action === "claim" && state.status !== "sent") {
        state = { ...state, status: "sending", first_attempt_at: "2026-10-31T01:00:00Z", last_attempt_at: "2026-10-31T01:00:00Z" };
      } else if (body.p_action !== "claim") {
        if (storageFails) return Response.json({ code: "other" }, { status: 500 });
        state = { ...state, status: body.p_action, sent_at: body.p_action === "sent" ? "2026-10-31T01:00:00Z" : null,
          provider_id: body.p_provider_id ?? null };
      }
      return Response.json([state]);
    }
    if (url.pathname === `/auth/v1/admin/users/${reviewer}`) {
      assert(new Headers(init?.headers).get("authorization") === "Bearer service-test", "Use backend-only Auth admin API");
      return Response.json(recipient);
    }
    if (url.href === "https://api.resend.com/emails") {
      emails++;
      const body = JSON.parse(String(init?.body));
      assert(new Headers(init?.headers).get("Idempotency-Key") === `review-reply/${replyId}`, "Stable provider idempotency key");
      assert(body.to.length === 1 && body.to[0] === recipientEmail, "Recipient only from Auth admin lookup");
      assert(body.text.includes("Private saved reply") && !body.text.includes("forged"), "Send immutable saved text");
      return await provider();
    }
    throw new Error(`Unexpected request ${url.pathname}`);
  };
  try {
    await t.step("all reads and writes require an admin, not moderator membership", async () => {
      for (const [path, body] of [["/admin/reviews", undefined], [`/admin/review-replies?review_id=${reviewId}`, undefined],
        ["/admin/review-replies", { action: "save", id: replyId, review_id: reviewId, body: "text" }],
        ["/admin/review-replies", { action: "send", id: replyId }]] as const) {
        globalThis.fetch = async () => { throw new Error("Unsigned request called upstream"); };
        assert((await api.fetch(request(path, body, false))).status === 401, "Require session");
        globalThis.fetch = async input => {
          const url = new URL(String(input));
          if (url.pathname === "/auth/v1/user") return Response.json({ id: admin, email_confirmed_at: "2026-01-01" });
          assert(url.pathname === "/rest/v1/owner_response_admins", "Only admin allowlist grants access");
          return Response.json([]);
        };
        assert((await api.fetch(request(path, body))).status === 403, "Reject moderator-only/ordinary account");
      }
    });
    await t.step("admin review list includes user IDs but does not fetch emails", async () => {
      globalThis.fetch = async input => {
        const url = new URL(String(input));const auth = authorized(url);if (auth) return auth;
        if (["/rest/v1/owner_review_photos", "/rest/v1/review_moderation_log", "/rest/v1/owner_invites",
          "/rest/v1/owner_replies", "/rest/v1/review_replies"].includes(url.pathname)) return Response.json([]);
        assert(url.pathname === "/rest/v1/reviews", "Do not call Auth admin lookup for lists");
        assert(url.searchParams.get("select")?.includes("user_id") && url.searchParams.get("select")?.includes("availability") &&
          url.searchParams.get("select")?.includes("cleanliness_status") && !url.searchParams.get("select")?.includes("email"),
          "Return the entire review without reviewer email");
        assert(url.searchParams.get("limit") === "3" && url.searchParams.get("offset") === "50", "Bound and paginate reviews");
        return Response.json([{ id: reviewId, user_id: reviewer, availability: "open", cleanliness_status: "clean", issues: [], photo_paths: [] }]);
      };
      const response = await api.fetch(request("/admin/reviews?offset=50"));
      const responseBody = await response.text();
      assert(response.status === 200 && responseBody.includes(reviewer),
        `Expose private user ID to admin: ${response.status} ${responseBody}`);
    });
    await t.step("save, history, send and repeat send do not expose recipient email", async () => {
      reset();emails = 0;actions.length = 0;globalThis.fetch = mock;
      const saved = await api.fetch(request("/admin/review-replies", { action: "save", id: replyId,
        review_id: reviewId, body: " Private saved reply ", email: "forged@example.test", recipient_user_id: admin }));
      assert(saved.status === 200 && emails === 0, "Saving does not send");
      const send = await api.fetch(request("/admin/review-replies", { action: "send", id: replyId, body: "forged" }));
      const result = await send.text();
      assert(send.status === 200 && result.includes('"sent"') && !result.includes(recipientEmail), "Safe sent confirmation");
      assert(state.provider_id === "provider-id" && state.sent_at !== null && emails === 1, "Persist provider confirmation");
      assert((await api.fetch(request("/admin/review-replies", { action: "send", id: replyId }))).status === 200 && emails === 1, "Do not resend accepted mail");
      globalThis.fetch = async input => {
        const url = new URL(String(input));const auth = authorized(url);if (auth) return auth;
        assert(url.pathname === "/rest/v1/review_replies" && url.searchParams.get("review_id") === `eq.${reviewId}`, "Read back same review");
        assert(!url.searchParams.get("select")?.includes("email"), "No email columns");
        return Response.json([state]);
      };
      const history = await api.fetch(request(`/admin/review-replies?review_id=${reviewId}`));
      const text = await history.text();
      assert(history.status === 200 && text.includes("Private saved reply") && !text.includes(recipientEmail), "Read stored reply without email");
    });
    await t.step("missing email configuration leaves draft untouched", async () => {
      reset();globalThis.fetch = mock;actions.length = 0;Deno.env.delete("RESEND_API_KEY");
      assert((await api.fetch(request("/admin/review-replies", { action: "send", id: replyId }))).status === 503, "Explicit configuration error");
      assert(!actions.length && state.status === "draft", "No delivery claim without configuration");
      Deno.env.set("RESEND_API_KEY", env.RESEND_API_KEY);
    });
    await t.step("provider rejection and timeout remain explicit, with redacted logs/responses", async () => {
      for (const [mode, expected] of [["reject", "failed"], ["timeout", "unknown"], ["bad-json", "unknown"]] as const) {
        reset();emails = 0;globalThis.fetch = mock;
        provider = () => {
          if (mode === "timeout") throw new Error(`provider leaked ${recipientEmail}`);
          return mode === "bad-json" ? new Response("bad") : Response.json({ message: recipientEmail }, { status: 429 });
        };
        const response = await api.fetch(request("/admin/review-replies", { action: "send", id: replyId }));
        const text = await response.text();
        assert(response.status >= 500 && !text.includes(recipientEmail), "No false success or provider detail leakage");
        assert(state.status === expected && state.sent_at === null && emails === 1, "Persist honest delivery state");
      }
      assert(!logs.join("").includes(recipientEmail), "Never log recipient/provider response");
    });
    await t.step("unverified recipients and persistence failure do not claim delivery", async () => {
      reset();emails = 0;globalThis.fetch = mock;recipient = { id: reviewer, email: recipientEmail };
      assert((await api.fetch(request("/admin/review-replies", { action: "send", id: replyId }))).status === 422, "Require verified recipient");
      assert(emails === 0 && state.status === "failed", "No unverified email");
      recipient = { id: reviewer, email: recipientEmail, email_confirmed_at: "2026-01-01" };
      reset();storageFails = true;provider = () => Response.json({ id: "provider-id" });
      assert((await api.fetch(request("/admin/review-replies", { action: "send", id: replyId }))).status === 503, "Lost persistence confirmation stays error");
      assert(state.status === "sending", "Retain retryable state after accepted mail but failed final write");
      storageFails = false;
    });
    await t.step("invalid payloads never write or send", async () => {
      globalThis.fetch = async input => {
        const auth = authorized(new URL(String(input)));if (auth) return auth;
        throw new Error("Invalid input made downstream call");
      };
      for (const body of [{ action: "save", id: "bad" }, { action: "send", id: "bad" },
        { action: "save", id: replyId, review_id: reviewId, body: "" },
        { action: "save", id: replyId, review_id: reviewId, body: "x".repeat(4001) },
        { action: "delete", id: replyId }]) {
        assert((await api.fetch(request("/admin/review-replies", body))).status === 400, "Validate fields");
      }
    });
  } finally {
    globalThis.fetch = originalFetch;console.error = originalLog;
    for (const [key, value] of previous) { if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value); }
  }
});
