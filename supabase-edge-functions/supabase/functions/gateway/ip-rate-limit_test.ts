import { clientIpHeader, canonicalIp, signClientIp, verifyClientIp } from "../_shared/gateway-client-ip.ts";
import { withIpRateLimit } from "./ip-rate-limit.ts";
import type { IpAllowance } from "./ip-rate-store.ts";

const secret = "test-ip-signing-secret-with-32-characters";
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
async function request(ip: string, extra: HeadersInit = {}): Promise<Request> {
  const headers = new Headers(extra);
  headers.set(clientIpHeader, await signClientIp(ip, secret));
  return new Request("https://gateway.example/frontend/reviews", { headers });
}

Deno.test("IP assertions normalize addresses, hide raw IPs, reject tampering and expire", async () => {
  const now = 1_800_000_000_000;
  assert(canonicalIp("2001:0db8:0:0:0:0:0:1") === "2001:db8::1", "IPv6 not canonical");
  assert(canonicalIp("::ffff:192.0.2.1") === "192.0.2.1", "IPv4 mapped address not canonical");
  const token = await signClientIp("192.0.2.1", secret, now);
  assert(!token.includes("192.0.2.1"), "Raw IP leaked");
  const digest = await verifyClientIp(token, secret, now);
  assert(digest && digest.length === 64, "Valid assertion rejected");
  const mapped = await signClientIp("::ffff:c000:201", secret, now);
  assert(mapped === token, "Equivalent IPs do not share quota");
  assert(await verifyClientIp(token, secret, now + 31_000) === null, "Expired assertion accepted");
  assert(await verifyClientIp(token, secret, now - 6000) === null, "Future assertion accepted");
  assert(await verifyClientIp(token, "different-ip-signing-secret-with-32-characters", now) === null, "Wrong secret accepted");
  const forged = `${token[0] === "a" ? "b" : "a"}${token.slice(1)}`;
  assert(await verifyClientIp(forged, secret, now) === null, "Forged hash accepted");
  for (const malformed of [null, "bad", "x".repeat(10_000)]) {
    assert(await verifyClientIp(malformed, secret, now) === null, "Malformed assertion accepted");
  }
  for (const invalid of ["unknown", "192.0.2.1, 198.51.100.1", "192.0.2.1:1234", "fe80::1%eth0"]) {
    let failed = false;
    try { await signClientIp(invalid, secret, now); } catch { failed = true; }
    assert(failed, "Invalid IP accepted");
  }
});

Deno.test("40 requests per IP, regardless of cookies or forwarding headers; other IPs independent", async () => {
  const previous = Deno.env.get("GATEWAY_IP_SIGNING_SECRET");
  Deno.env.set("GATEWAY_IP_SIGNING_SECRET", secret);
  const counts = new Map<string, number>();
  const consume = (id: string): Promise<IpAllowance> => {
    const count = (counts.get(id) ?? 0) + 1;
    counts.set(id, count);
    return Promise.resolve({ allowed: count <= 40, remaining: Math.max(0, 40 - count), retry_after: 60 });
  };
  let forwarded = 0;
  const handler = withIpRateLimit(() => {
    forwarded++;
    return Promise.resolve(Response.json({ ok: true }));
  }, consume);
  try {
    for (let i = 1; i <= 41; i++) {
      const response = await handler(await request("192.0.2.1", {
        cookie: `washroom_device=${crypto.randomUUID()}`, "x-forwarded-for": `198.51.100.${i}`,
      }));
      assert(response.status === (i <= 40 ? 200 : 429), `Unexpected status for request ${i}`);
      assert(response.headers.get("ratelimit-limit") === "40", "Missing limit");
      assert(response.headers.get("ratelimit-remaining") === String(Math.max(0, 40 - i)), "Wrong remaining");
      assert(response.headers.get("cache-control") === "no-store", "IP response can be cached");
      assert(!response.headers.has("set-cookie") && !response.headers.has(clientIpHeader), "Identity leaked");
      if (i === 41) assert(response.headers.get("retry-after") === "60", "Missing retry delay");
    }
    assert(forwarded === 40, "Over-limit request reached backend");
    const other = await handler(await request("192.0.2.2"));
    assert(other.status === 200 && other.headers.get("ratelimit-remaining") === "39", "Other IP affected");
    const preflight = await handler(new Request("https://gateway.example", { method: "OPTIONS" }));
    assert(preflight.status === 200 && counts.size === 2, "OPTIONS consumed quota");
    const unsigned = await handler(new Request("https://gateway.example", {
      headers: { "x-forwarded-for": "192.0.2.99", "x-vercel-forwarded-for": "192.0.2.99" },
    }));
    assert(unsigned.status === 403 && counts.size === 2, "Unsigned IP trusted or consumed Redis");
  } finally {
    if (previous === undefined) Deno.env.delete("GATEWAY_IP_SIGNING_SECRET");
    else Deno.env.set("GATEWAY_IP_SIGNING_SECRET", previous);
  }
});

Deno.test("IP limiter fails closed on storage or signing configuration failure", async () => {
  const previous = Deno.env.get("GATEWAY_IP_SIGNING_SECRET");
  const originalError = console.error;
  console.error = () => {};
  let forwarded = false;
  const handler = withIpRateLimit(() => {
    forwarded = true;
    return Promise.resolve(new Response("unexpected"));
  }, () => Promise.reject(new Error("storage unavailable")));
  try {
    Deno.env.set("GATEWAY_IP_SIGNING_SECRET", secret);
    assert((await handler(await request("192.0.2.1"))).status === 503, "Storage failure allowed");
    Deno.env.delete("GATEWAY_IP_SIGNING_SECRET");
    assert((await handler(await request("192.0.2.1"))).status === 503, "Missing signing allowed");
    Deno.env.set("GATEWAY_IP_SIGNING_SECRET", "short");
    assert((await handler(await request("192.0.2.1"))).status === 503, "Weak signing allowed");
    assert(!forwarded, "Failure reached backend");
  } finally {
    console.error = originalError;
    if (previous === undefined) Deno.env.delete("GATEWAY_IP_SIGNING_SECRET");
    else Deno.env.set("GATEWAY_IP_SIGNING_SECRET", previous);
  }
});
