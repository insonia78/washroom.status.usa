import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { gatewayFetch, proxyGateway } from '../lib/gateway.ts';
import { gatewayAuthFetch } from '../lib/gateway-auth-fetch.ts';
import { GET as reviewsGet, POST as reviewsPost } from '../app/api/reviews/route.ts';
import { GET as backendGet } from '../app/api/backend/[...path]/route.ts';
import nextConfig from '../next.config.mjs';
import { createClient } from '@supabase/supabase-js';

const originalFetch = globalThis.fetch;
const keys = ['WASHROOM_GATEWAY_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];
const originalEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
const originalConsoleError = console.error;

beforeEach(() => {
  process.env.WASHROOM_GATEWAY_URL = 'https://project.example/functions/v1/gateway';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'public-key';
  console.error = () => {};
  globalThis.fetch = async () => assert.fail('Unexpected network request');
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
  for (const key of keys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

test('Next.js review reads and writes only proxy to the gateway', async () => {
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return Response.json({ message: 'pending' }, { status: init.method === 'POST' ? 201 : 200 });
  };
  const read = await reviewsGet(new Request('http://localhost/api/reviews?osm_type=node&osm_id=123'));
  const payload = JSON.stringify({ rating: 4 });
  const write = await reviewsPost(new Request('http://localhost/api/reviews', {
    method: 'POST', headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json',
      'x-washroom-gateway-secret': 'must-not-forward', cookie: 'private=value' },
    body: payload,
  }));
  assert.equal(read.status, 200);
  assert.equal(write.status, 201);
  assert.equal(calls[0].url, 'https://project.example/functions/v1/gateway/frontend/reviews?osm_type=node&osm_id=123');
  assert.equal(calls[1].url, 'https://project.example/functions/v1/gateway/frontend/reviews');
  assert.equal(new TextDecoder().decode(calls[1].init.body), payload);
  const headers = new Headers(calls[1].init.headers);
  assert.equal(headers.get('authorization'), 'Bearer user-token');
  assert.equal(headers.get('x-washroom-gateway-secret'), null);
  assert.equal(headers.get('cookie'), null);
  assert.equal(calls[1].init.redirect, 'manual');
  assert.equal(write.headers.get('cache-control'), 'no-store');
});

test('city geocoding and boundary data follow the gateway; arbitrary backend paths are rejected', async () => {
  for (const path of [['geocode'], ['map-boundary'], ['auth', 'v1', 'user']]) {
    globalThis.fetch = async (input) => {
      assert.equal(String(input), `https://project.example/functions/v1/gateway/frontend/${path.join('/')}?q=Boston`);
      return Response.json({});
    };
    const response = await backendGet(new Request('http://localhost/api/backend/anything?q=Boston'), {
      params: Promise.resolve({ path }),
    });
    assert.equal(response.status, 200);
  }
  globalThis.fetch = async () => assert.fail('Disallowed paths must not make requests');
  for (const path of [['rest', 'v1', 'reviews'], ['auth', 'v1', 'admin'], ['..', 'reviews']]) {
    assert.equal((await backendGet(new Request('http://localhost/api/backend/test'), {
      params: Promise.resolve({ path }),
    })).status, 404);
  }
});

test('address and ZIP suggestions preserve query parameters through the gateway', async () => {
  for (const query of ['suggest=1&q=1600%20Pennsylvania%20Washington', 'suggest=1&zip=02108']) {
    const body = { suggestions: [{ label: 'Test address, USA', latitude: 38.9, longitude: -77.03 }] };
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      assert.equal(url.pathname, '/functions/v1/gateway/frontend/geocode');
      assert.equal(url.searchParams.get('suggest'), '1');
      assert.deepEqual([...url.searchParams], [...new URLSearchParams(query)]);
      return Response.json(body);
    };
    const response = await backendGet(new Request(`http://localhost/api/backend/geocode?${query}`), {
      params: Promise.resolve({ path: ['geocode'] }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), body);
  }
});

test('Supabase SDK HTTP calls are rewritten to same-origin gateway-backed auth routes', async () => {
  for (const endpoint of ['otp', 'verify', 'token', 'logout', 'user']) {
    globalThis.fetch = async (input, init) => {
      assert.equal(input, `/api/backend/auth/v1/${endpoint}?grant_type=refresh_token`);
      assert.equal(new Headers(init.headers).get('authorization'), 'Bearer user-token');
      assert.deepEqual(JSON.parse(new TextDecoder().decode(init.body)), { refresh_token: 'test' });
      return Response.json({});
    };
    await gatewayAuthFetch(`https://project.example/auth/v1/${endpoint}?grant_type=refresh_token`, {
      method: 'POST', headers: { Authorization: 'Bearer user-token' },
      body: JSON.stringify({ refresh_token: 'test' }),
    });
  }
  await assert.rejects(gatewayAuthFetch('https://project.example/rest/v1/reviews'), /Only gateway-backed/);
});

test('the actual Supabase SDK sends magic-link and user-validation calls through the proxy', async () => {
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    if (String(input).includes('/otp')) return Response.json({});
    return Response.json({ id: 'user-id', email: 'test@example.com' });
  };
  const client = createClient('https://project.example', 'test-public-key', {
    global: { fetch: gatewayAuthFetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const otp = await client.auth.signInWithOtp({
    email: 'test@example.com', options: { emailRedirectTo: 'http://localhost:3000' },
  });
  assert.equal(otp.error, null);
  assert.match(calls[0].url, /^\/api\/backend\/auth\/v1\/otp\?/);
  assert.equal(new URL(calls[0].url, 'http://localhost').searchParams.get('redirect_to'), 'http://localhost:3000');
  assert.equal(JSON.parse(new TextDecoder().decode(calls[0].init.body)).email, 'test@example.com');
  const user = await client.auth.getUser('user-token');
  assert.equal(user.error, null);
  assert.equal(user.data.user.id, 'user-id');
  assert.equal(calls[1].url, '/api/backend/auth/v1/user');
});

test('gateway failures and throttling remain explicit errors', async () => {
  globalThis.fetch = async () => Response.json({ error: 'rate limited' }, {
    status: 429, headers: { 'Retry-After': '60' },
  });
  let response = await proxyGateway(new Request('http://localhost'), '/frontend/reviews');
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  assert.equal((await proxyGateway(new Request('http://localhost'), '/frontend/reviews')).status, 502);
  delete process.env.WASHROOM_GATEWAY_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  response = await proxyGateway(new Request('http://localhost'), '/frontend/reviews');
  assert.equal(response.status, 503);
});

test('browser connection policy permits only same-origin requests and approved map tiles', async () => {
  const rules = await nextConfig.headers();
  assert.equal(rules[0].headers[0].value, "connect-src 'self' https://tile.openstreetmap.org");
});

test('application source has no direct database queries or external fetches outside gateway transport', async () => {
  const root = new URL('../', import.meta.url);
  for (const folder of ['app', 'components', 'lib']) {
    for (const entry of await readdir(new URL(folder, root), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name)) continue;
      const file = `${entry.parentPath ?? entry.path}\\${entry.name}`;
      const source = await readFile(file, 'utf8');
      assert.doesNotMatch(source, /\.from\s*\(/, file);
      assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|serverSupabase/, file);
      assert.doesNotMatch(source, /fetch\s*\(\s*['"`]https?:\/\//, file);
    }
  }
});
