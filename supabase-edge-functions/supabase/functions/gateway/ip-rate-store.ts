import { ipRateScript } from "./ip-rate-script.ts";

export type IpAllowance = { allowed: boolean; remaining: number; retry_after: number };

export async function consumeIpRequest(ipHash: string): Promise<IpAllowance> {
  const baseUrl = Deno.env.get("UPSTASH_REDIS_REST_URL");
  const token = Deno.env.get("UPSTASH_REDIS_REST_TOKEN");
  if (!baseUrl || !token) throw new Error("Gateway Redis rate-limit storage is not configured.");
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Gateway Redis REST URL must use HTTPS without credentials, query or fragment.");
  }
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`, "Content-Type": "application/json",
    },
    body: JSON.stringify(["EVAL", ipRateScript, "1", `washroom:gateway:ip:v1:${ipHash}`]),
    signal: AbortSignal.timeout(5000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Gateway Redis rate-limit storage returned ${response.status}.`);
  const payload: unknown = await response.json();
  const result: unknown = payload && typeof payload === "object" && !("error" in payload) &&
      "result" in payload ? payload.result : null;
  if (!Array.isArray(result) || result.length !== 3) {
    throw new Error("Gateway Redis rate-limit storage returned an invalid allowance.");
  }
  const [allowed, remaining, retryAfter]: unknown[] = result;
  if ((allowed !== 0 && allowed !== 1) ||
      typeof remaining !== "number" || !Number.isInteger(remaining) || remaining < 0 || remaining > 99 ||
      typeof retryAfter !== "number" || !Number.isInteger(retryAfter) || retryAfter < 1 || retryAfter > 60 ||
      (allowed === 0 && remaining !== 0)) {
    throw new Error("Gateway Redis rate-limit storage returned an invalid allowance.");
  }
  return { allowed: allowed === 1, remaining, retry_after: retryAfter };
}
