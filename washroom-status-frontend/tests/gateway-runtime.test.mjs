import assert from 'node:assert/strict';
import './gateway-ip-env.mjs';
import { afterEach, beforeEach, test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { proxyGateway } from '../lib/gateway.ts';
import { gatewayAuthFetch } from '../lib/gateway-auth-fetch.ts';
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

test('browser connection policy permits same-origin requests, OpenFreeMap resources, and MapLibre workers', async () => {
  const rules = await nextConfig.headers();
  assert.equal(rules[0].headers[0].value, "connect-src 'self' https://tiles.openfreemap.org; worker-src 'self'");
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
