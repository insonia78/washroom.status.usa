import { consumeIpRequest } from "./ip-rate-store.ts";

Deno.test("rate store uses atomic Redis EVAL, validates allowances and reports failures", async () => {
  const originalFetch = globalThis.fetch;
  const config = { UPSTASH_REDIS_REST_URL: "https://redis.example", UPSTASH_REDIS_REST_TOKEN: "test-token" };
  const previous = new Map(Object.keys(config).map(key => [key, Deno.env.get(key)]));
  for (const [key, value] of Object.entries(config)) Deno.env.set(key, value);
  try {
    globalThis.fetch = async (input, init) => {
      const req = new Request(input, init);
      const command = await req.json();
      if (req.url !== "https://redis.example/" || req.headers.get("authorization") !== "Bearer test-token" ||
          command[0] !== "EVAL" || command[2] !== "1" ||
          command[3] !== "washroom:gateway:ip:v1:ip-hash" ||
          !command[1].includes("redis.call('PTTL'") || init?.redirect !== "error") {
        throw new Error("Wrong Redis REST command");
      }
      return Response.json({ result: [1, 199, 60] });
    };
    const result = await consumeIpRequest("ip-hash");
    if (!result.allowed || result.remaining !== 199) throw new Error("Wrong result");
    for (const response of [
      new Response("Unavailable", { status: 503 }),
      Response.json([]), Response.json({ result: [1, 200, 60] }),
      Response.json({ result: [0, 1, 60] }), Response.json({ result: [1, 199, 0] }),
      Response.json({ error: "ERR script failed" }), Response.json({ result: [1, 199, 60], error: "ERR" }),
    ]) {
      globalThis.fetch = async () => response;
      let failed = false;
      try { await consumeIpRequest("ip-hash"); } catch { failed = true; }
      if (!failed) throw new Error("Invalid storage response accepted");
    }
    globalThis.fetch = () => Promise.resolve(Response.json({ result: [0, 0, 20] }));
    const denied = await consumeIpRequest("ip-hash");
    if (denied.allowed || denied.remaining !== 0 || denied.retry_after !== 20) throw new Error("Denial not preserved");
    for (const url of ["http://redis.example", "https://user:pass@redis.example", "https://redis.example?token=bad"]) {
      Deno.env.set("UPSTASH_REDIS_REST_URL", url);
      let failed = false;
      try { await consumeIpRequest("ip-hash"); } catch { failed = true; }
      if (!failed) throw new Error("Unsafe Redis URL accepted");
    }
    Deno.env.delete("UPSTASH_REDIS_REST_URL");
    let failed = false;
    try { await consumeIpRequest("ip-hash"); } catch { failed = true; }
    if (!failed) throw new Error("Missing configuration accepted");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
});
