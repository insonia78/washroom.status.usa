import { clientIpHeader, verifyClientIp } from "../_shared/gateway-client-ip.ts";
import { consumeIpRequest, type IpAllowance } from "./ip-rate-store.ts";

type Handler = (req: Request) => Promise<Response>;
type Consume = (id: string) => Promise<IpAllowance>;
const exposedHeaders = ["RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset", "Retry-After"];

function failure(req: Request, status: number, error: string): Response {
  return Response.json({ error }, {
    status,
    headers: { "Access-Control-Allow-Origin": req.headers.get("origin") ?? "*", Vary: "Origin" },
  });
}

export function withIpRateLimit(handler: Handler, consume: Consume = consumeIpRequest): Handler {
  return async (req) => {
    if (req.method === "OPTIONS") return await handler(req);
    let allowance: IpAllowance;
    try {
      const secret = Deno.env.get("GATEWAY_IP_SIGNING_SECRET");
      if (!secret) throw new Error("Gateway client IP verification is not configured.");
      const ipHash = await verifyClientIp(req.headers.get(clientIpHeader), secret);
      if (!ipHash) {
        console.warn("[gateway] ip-rate-limit.untrusted-request");
        const denied = failure(req, 403, "Use the application API: a trusted client IP is required.");
        denied.headers.set("Cache-Control", "no-store");
        return denied;
      }
      allowance = await consume(ipHash);
    } catch (error) {
      console.error("[gateway] ip-rate-limit.unavailable", error instanceof Error ? error.message : "Unknown error");
      const response = failure(req, 503, "Request limiting is temporarily unavailable. Please try again.");
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
    const response = allowance.allowed
      ? await handler(req)
      : failure(req, 429, "Too many requests. Limit: 100 requests per IP address per minute.");
    const headers = new Headers(response.headers);
    headers.set("RateLimit-Limit", "100");
    headers.set("RateLimit-Remaining", String(allowance.remaining));
    headers.set("RateLimit-Reset", String(allowance.retry_after));
    const exposed = headers.get("Access-Control-Expose-Headers");
    headers.set("Access-Control-Expose-Headers", [exposed, ...exposedHeaders].filter(Boolean).join(", "));
    headers.set("Cache-Control", "no-store");
    if (!allowance.allowed) headers.set("Retry-After", String(allowance.retry_after));
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };
}
