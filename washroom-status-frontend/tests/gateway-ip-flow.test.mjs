import assert from 'node:assert/strict';
import { test } from 'node:test';
import './gateway-ip-env.mjs';
import { proxyGateway } from '../lib/gateway.ts';
import { withIpRateLimit } from '../../supabase-edge-functions/supabase/functions/gateway/ip-rate-limit.ts';

test('Next.js -> signed IP -> gateway -> Redis: cookies do not reset quota, different IPs do', async () => {
  const originalFetch = globalThis.fetch;
  const originalDeno = globalThis.Deno;
  const keys = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'WASHROOM_GATEWAY_URL'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.VERCEL = '1';
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-redis-token';
  process.env.WASHROOM_GATEWAY_URL = 'https://gateway.example';
  globalThis.Deno = { env: { get: key => process.env[key] } };
  const counts = new Map();
  let forwarded = 0;
  const gateway = withIpRateLimit(async () => {
    forwarded++;
    return Response.json({ ok: true });
  });
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init);
    if (new URL(req.url).hostname === 'redis.example') {
      const [command, script, keyCount, key] = await req.json();
      assert.equal(command, 'EVAL');
      assert.equal(keyCount, '1');
      assert.match(script, /redis.call\('PTTL'/);
      assert.match(key, /^washroom:gateway:ip:v1:[a-f0-9]{64}$/);
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return Response.json({ result: [count <= 100 ? 1 : 0, Math.max(0, 100 - count), 60] });
    }
    return gateway(req);
  };
  const send = (ip, cookie) => proxyGateway(new Request('https://app.example/api/reviews', {
    headers: { 'x-vercel-forwarded-for': ip, 'x-forwarded-for': crypto.randomUUID(), cookie },
  }), '/frontend/reviews');
  try {
    const responses = await Promise.all(Array.from({ length: 200 }, (_, i) =>
      send(i % 2 ? '192.0.2.1' : '::ffff:192.0.2.1', `washroom_device=${crypto.randomUUID()}`)));
    assert.equal(responses.filter(response => response.status === 200).length, 100);
    assert.equal(responses.filter(response => response.status === 429).length, 100);
    assert.equal(forwarded, 100);
    assert.equal(counts.size, 1);
    assert.equal((await send('192.0.2.2', '')).status, 200);
    assert.equal(counts.size, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDeno === undefined) delete globalThis.Deno;
    else globalThis.Deno = originalDeno;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
