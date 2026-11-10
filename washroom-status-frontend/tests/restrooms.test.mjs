import assert from 'node:assert/strict';
import './gateway-ip-env.mjs';
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
    assert.equal(url.searchParams.get('radius'), '8046.72');
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
  assert.equal(response.headers.get('cache-control'), 'no-store');
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

test('business categories and explicit or unknown restroom availability reach the UI', async () => {
  for (const [category, toilets] of [['fuel', 'unknown'], ['supermarket', 'unknown'], ['supermarket', 'yes'], ['supermarket', 'no']]) {
    globalThis.fetch = async () => Response.json({ success: true, data: [{ ...place, category, toilets }] });
    const response = await GET(request());
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.restrooms[0].category, category);
    assert.equal(body.restrooms[0].toilets, toilets);
  }
});

test('Refuge Restrooms records preserve their provider identity and creation date', async () => {
  const createdAt = '2024-01-02T03:04:05.000Z';
  globalThis.fetch = async () => Response.json({
    success: true,
    data: [{
      id: 45333,
      osmType: 'refuge',
      provider: 'refuge-restrooms',
      createdAt,
      directions: 'Ask the staff for access.',
      name: 'Example restroom',
      coordinates: { latitude: 39.9526, longitude: -75.1652 },
    }],
  });
  const response = await GET(request());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.restrooms[0].osm_type, 'refuge');
  assert.equal(body.restrooms[0].source, 'refuge-restrooms');
  assert.equal(body.restrooms[0].created_at, createdAt);
  assert.equal(body.restrooms[0].directions, 'Ask the staff for access.');
});

test('invalid or missing coordinates are rejected before making HTTP calls', async () => {
  for (const query of ['', 'lat=&lon=0', 'lat=0&lon=%20', 'lat=NaN&lon=0', 'lat=91&lon=0', 'lat=0&lon=-181']) {
    assert.equal((await GET(request(query))).status, 400, query);
  }
});

test('manual radius choices forward exact meter radii through the gateway for coordinates and ZIPs', async () => {
  for (const [miles, meters] of [['1', '1609.344'], ['2', '3218.688'], ['5', '8046.72'], ['10', '16093.44']]) {
    for (const query of ['lat=40.0999&lon=-83.0157', 'zip=27707']) {
      let calls = 0;
      globalThis.fetch = async input => {
        calls++;
        const url = new URL(input);
        assert.equal(url.pathname, '/functions/v1/gateway/places/bathrooms');
        assert.equal(url.searchParams.get('radius'), meters);
        return Response.json({
          success: true, data: [],
          searchOrigin: { latitude: 35.9631, longitude: -78.9315 },
        });
      };
      assert.equal((await GET(request(`${query}&radiusMiles=${miles}`))).status, 200);
      assert.equal(calls, 1);
    }
  }
});

test('unsupported manual radii are rejected without upstream requests', async () => {
  for (const radius of ['', '0', '-1', '3', '100', 'NaN', 'Infinity', '1.5', 'constructor', '__proto__']) {
    const response = await GET(request(`lat=40&lon=-83&radiusMiles=${radius}`));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /search radius/);
  }
});

test('partial results preserve stored restrooms and the warning without caching', async () => {
  const warning = "Refuge Restrooms API request failed. Please try again. Results may be incomplete.";
  globalThis.fetch = async () => Response.json({
    success: true,
    data: [place],
    warning: 'Refuge Restrooms data could not be checked.',
  });
  const response = await GET(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.count, 1);
  assert.equal(body.restrooms[0].id, place.id);
  assert.equal(body.warning, warning);
});
