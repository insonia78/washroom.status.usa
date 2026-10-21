import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { NextRequest } from 'next/server.js';
import { GET } from '../app/api/restrooms/route.ts';

const envKeys = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'WASHROOM_GATEWAY_URL'];
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
const originalConsoleError = console.error;
const place = {
  id: 123, osmType: 'node', name: 'Public restroom',
  coordinates: { latitude: 39.9526, longitude: -75.1652 },
  wheelchair: 'yes', fee: 'no', openingHours: '24/7',
};
const request = (query = 'lat=39.9526&lon=-75.1652') =>
  new NextRequest(`http://localhost/api/restrooms?${query}`);

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.example/';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'sb_publishable_test';
  delete process.env.WASHROOM_GATEWAY_URL;
  console.error = () => {};
  globalThis.fetch = async () => {
    assert.fail('Unexpected HTTP request');
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

test('restroom HTTP calls use the gateway and map Places API fields for the UI', async () => {
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls += 1;
    const url = new URL(input);
    assert.equal(url.origin, 'https://project.example');
    assert.equal(url.pathname, '/functions/v1/gateway/places/bathrooms');
    assert.equal(url.searchParams.get('lat'), '39.9526');
    assert.equal(url.searchParams.get('lon'), '-75.1652');
    assert.equal(url.searchParams.get('radius'), '1000');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('apikey'), 'sb_publishable_test');
    assert.equal(headers.get('x-washroom-gateway-secret'), null);
    assert.equal(init.cache, 'no-store');
    assert.ok(init.signal instanceof AbortSignal);
    return Response.json({ success: true, data: [place] });
  };
  const response = await GET(request());
  assert.equal(calls, 1);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /s-maxage=60/);
  assert.deepEqual(await response.json(), {
    restrooms: [{
      id: 123, osm_type: 'node', name: 'Public restroom', lat: 39.9526, lon: -75.1652,
      wheelchair: 'yes', fee: 'no', opening_hours: '24/7',
    }],
    source: 'Gateway · Places API · OpenStreetMap', count: 1,
  });
});

test('gateway override supports local deployments and searches outside Philadelphia', async () => {
  process.env.WASHROOM_GATEWAY_URL = 'http://127.0.0.1:55321/functions/v1/gateway/';
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  globalThis.fetch = async input => {
    const url = new URL(input);
    assert.equal(url.origin, 'http://127.0.0.1:55321');
    assert.equal(url.pathname, '/functions/v1/gateway/places/bathrooms');
    assert.equal(url.searchParams.get('lat'), '40.7128');
    assert.equal(url.searchParams.get('lon'), '-74.006');
    return Response.json({ success: true, data: [] });
  };
  const response = await GET(request('lat=40.7128&lon=-74.006'));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).count, 0);
});

test('invalid or missing coordinates are rejected before making HTTP calls', async () => {
  for (const query of ['', 'lat=&lon=0', 'lat=0&lon=%20', 'lat=NaN&lon=0', 'lat=91&lon=0', 'lat=0&lon=-181']) {
    assert.equal((await GET(request(query))).status, 400, query);
  }
});

test('missing gateway configuration returns an explicit service error', async () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  assert.equal((await GET(request())).status, 503);
});

test('ZIP lookups preserve leading zeros and return resolved coordinates', async () => {
  globalThis.fetch = async input => {
    const url = new URL(input);
    assert.equal(url.pathname, '/functions/v1/gateway/places/bathrooms');
    assert.equal(url.searchParams.get('zip'), '02108');
    assert.equal(url.searchParams.get('countryCode'), 'us');
    assert.equal(url.searchParams.has('lat'), false);
    assert.equal(url.searchParams.has('lon'), false);
    return Response.json({ success: true, data: [], searchOrigin: { latitude: 42.357, longitude: -71.064 } });
  };
  const response = await GET(request('zip=02108'));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).searchOrigin, {
    latitude: 42.357, longitude: -71.064, zipCode: '02108',
  });
});

test('invalid ZIP codes and mixed search inputs are rejected before HTTP calls', async () => {
  for (const query of ['zip=', 'zip=1234', 'zip=123456', 'zip=abcde', 'zip=12345-6789', 'zip=02108&lat=42&lon=-71']) {
    assert.equal((await GET(request(query))).status, 400, query);
  }
});

test('ZIP responses require valid resolved coordinates even when no restrooms match', async () => {
  for (const searchOrigin of [undefined, {}, { latitude: '42', longitude: -71 }, { latitude: 91, longitude: -71 }]) {
    globalThis.fetch = async () => Response.json({ success: true, data: [], searchOrigin });
    assert.equal((await GET(request('zip=02108'))).status, 502);
  }
});

test('public gateway searches work without a Supabase API key', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.example';
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  globalThis.fetch = async (input, init) => {
    assert.equal(new Headers(init.headers).get('apikey'), null);
    return Response.json({ success: true, data: [place] });
  };
  const response = await GET(request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).count, 1);
});

test('gateway HTTP errors preserve status and do not become empty successful results', async () => {
  for (const status of [400, 401, 403, 429, 500, 502, 503, 504]) {
    globalThis.fetch = async () => new Response('upstream error', { status });
    const response = await GET(request());
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(typeof body.error, 'string');
    assert.equal(body.restrooms, undefined);
    if (status === 504) assert.match(body.error, /data source timed out/);
  }
});

test('unreachable gateways and timeouts return explicit errors', async () => {
  for (const [error, status] of [
    [new TypeError('fetch failed'), 502],
    [new DOMException('Timed out', 'TimeoutError'), 504],
  ]) {
    globalThis.fetch = async () => { throw error; };
    assert.equal((await GET(request())).status, status);
  }
});

test('malformed gateway payloads fail rather than silently dropping locations', async () => {
  for (const payload of [
    { data: [] }, { success: false, data: [] }, { success: true },
    { success: true, data: [{ ...place, osmType: 'unknown' }] },
    { success: true, data: [{ ...place, id: '123' }] },
    { success: true, data: [{ ...place, coordinates: { latitude: null, longitude: 0 } }] },
    { success: true, data: [{ ...place, coordinates: { latitude: 91, longitude: 0 } }] },
  ]) {
    globalThis.fetch = async () => Response.json(payload);
    assert.equal((await GET(request())).status, 502);
  }
  globalThis.fetch = async () => new Response('not JSON');
  assert.equal((await GET(request())).status, 502);
});
