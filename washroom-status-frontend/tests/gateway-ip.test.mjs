import assert from 'node:assert/strict';
import { beforeEach, afterEach, test } from 'node:test';
import './gateway-ip-env.mjs';
import { gatewayIpHeaders, gatewayRateResponseHeaders } from '../lib/gateway-ip.ts';
import { clientIpHeader, verifyClientIp } from '../../supabase-edge-functions/supabase/functions/_shared/gateway-client-ip.ts';
import { proxyGateway } from '../lib/gateway.ts';
import { NextRequest } from 'next/server.js';
import { GET as restroomsGet } from '../app/api/restrooms/route.ts';

const originalFetch = globalThis.fetch;
const originalError = console.error;
const originalUrl = process.env.WASHROOM_GATEWAY_URL;
beforeEach(() => {
  process.env.VERCEL = '1';
  process.env.WASHROOM_GATEWAY_URL = 'https://gateway.example';
  console.error = () => {};
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  console.error = originalError;
  if (originalUrl === undefined) delete process.env.WASHROOM_GATEWAY_URL;
  else process.env.WASHROOM_GATEWAY_URL = originalUrl;
});
const request = (path = '/api/reviews', headers = {}) => new Request(`https://app.example${path}`, {
  headers: { 'x-vercel-forwarded-for': '192.0.2.1', ...headers },
});

test('only trusted Vercel IP is signed; browser headers and cookies cannot select quota', async () => {
  const headers = await gatewayIpHeaders(request('/api/reviews', {
    cookie: 'washroom_device=forged', [clientIpHeader]: 'forged', 'x-forwarded-for': '198.51.100.1',
  }));
  const actual = await verifyClientIp(headers.get(clientIpHeader), process.env.GATEWAY_IP_SIGNING_SECRET);
  const expectedHeaders = await gatewayIpHeaders(request());
  const expected = await verifyClientIp(expectedHeaders.get(clientIpHeader), process.env.GATEWAY_IP_SIGNING_SECRET);
  assert.equal(actual, expected);
  assert.match(actual, /^[a-f0-9]{64}$/);
  assert.equal(headers.has('cookie'), false);
  assert.equal(headers.has('x-forwarded-for'), false);
  assert.equal(headers.get(clientIpHeader).includes('192.0.2.1'), false);
  const other = await gatewayIpHeaders(request('', { 'x-vercel-forwarded-for': '192.0.2.2' }));
  assert.notEqual(await verifyClientIp(other.get(clientIpHeader), process.env.GATEWAY_IP_SIGNING_SECRET), actual);
});

test('missing/malformed trusted IP, untrusted production and signing misconfiguration fail closed', async () => {
  for (const ip of ['', 'bad', '192.0.2.1, 198.51.100.1']) {
    await assert.rejects(gatewayIpHeaders(request('', { 'x-vercel-forwarded-for': ip })));
  }
  delete process.env.VERCEL;
  process.env.NODE_ENV = 'production';
  await assert.rejects(gatewayIpHeaders(request()), /trusted Vercel/);
  await assert.rejects(gatewayIpHeaders(new Request('http://localhost')), /trusted Vercel/);
  process.env.NODE_ENV = 'development';
  await assert.rejects(gatewayIpHeaders(request()), /trusted Vercel/);
  const local = await gatewayIpHeaders(new Request('http://localhost', {
    headers: { 'x-forwarded-for': '192.0.2.99' },
  }));
  assert.ok(local.has(clientIpHeader));
  delete process.env.GATEWAY_IP_SIGNING_SECRET;
  await assert.rejects(gatewayIpHeaders(new Request('http://localhost')), /GATEWAY_IP_SIGNING_SECRET/);
});

test('quota response headers propagate without cookies, signatures or caching', () => {
  const response = new Response(null, { headers: {
    'RateLimit-Limit': '200', 'RateLimit-Remaining': '0', 'RateLimit-Reset': '35', 'Retry-After': '35',
    'Set-Cookie': 'washroom_device=old', [clientIpHeader]: 'private-assertion',
  } });
  const headers = gatewayRateResponseHeaders(response);
  assert.equal(headers.get('ratelimit-limit'), '200');
  assert.equal(headers.get('ratelimit-remaining'), '0');
  assert.equal(headers.get('ratelimit-reset'), '35');
  assert.equal(headers.get('retry-after'), '35');
  assert.equal(headers.get('cache-control'), 'no-store');
  assert.equal(headers.has('set-cookie'), false);
  assert.equal(headers.has(clientIpHeader), false);
});

test('proxy and restroom adapter forward signed IPs and preserve 429 and retry headers', async () => {
  globalThis.fetch = async (_url, init) => {
    assert.ok(await verifyClientIp(new Headers(init.headers).get(clientIpHeader), process.env.GATEWAY_IP_SIGNING_SECRET));
    assert.equal(new Headers(init.headers).has('cookie'), false);
    return Response.json({ error: 'Too many requests' }, { status: 429, headers: {
      'Retry-After': '20', 'RateLimit-Limit': '200', 'RateLimit-Remaining': '0',
    } });
  };
  const responses = [
    await proxyGateway(request(), '/frontend/reviews'),
    await restroomsGet(new NextRequest(request('/api/restrooms?zip=02108'))),
  ];
  for (const response of responses) {
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '20');
    assert.equal(response.headers.get('ratelimit-remaining'), '0');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.has('set-cookie'), false);
  }
  assert.match((await responses[1].json()).error, /wait a minute/);
});

test('first search does not create identity cookies and cannot enter shared caches', async () => {
  globalThis.fetch = async () => Response.json({ success: true, data: [] }, { headers: {
    'RateLimit-Limit': '200', 'RateLimit-Remaining': '199', 'RateLimit-Reset': '60',
  } });
  const response = await restroomsGet(new NextRequest(request('/api/restrooms?lat=42.36&lon=-71.06')));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('ratelimit-remaining'), '199');
  assert.equal(response.headers.has('set-cookie'), false);
  assert.deepEqual((await response.json()).restrooms, []);
});

test('missing signing configuration returns 503 without making network calls', async () => {
  delete process.env.GATEWAY_IP_SIGNING_SECRET;
  globalThis.fetch = async () => assert.fail('Misconfigured IP forwarding must not reach network');
  assert.equal((await proxyGateway(request(), '/frontend/reviews')).status, 503);
  assert.equal((await restroomsGet(new NextRequest(request('/api/restrooms?zip=02108')))).status, 503);
});
