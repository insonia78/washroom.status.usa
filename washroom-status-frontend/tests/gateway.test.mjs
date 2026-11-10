import assert from 'node:assert/strict';
import './gateway-ip-env.mjs';
import { afterEach, beforeEach, test } from 'node:test';
import { proxyGateway } from '../lib/gateway.ts';
import { GET as reviewsGet, POST as reviewsPost } from '../app/api/reviews/route.ts';
import { GET as backendGet, POST as backendPost } from '../app/api/backend/[...path]/route.ts';

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

test('owner response admin writes forward session and payload only through the gateway',async()=>{
  const body={action:'publish',id:'11111111-1111-4111-8111-111111111111',version:1};
  globalThis.fetch=async(input,init)=>{
    assert.equal(String(input),'https://project.example/functions/v1/gateway/frontend/admin/owner-responses');
    assert.equal(init.method,'POST');
    assert.equal(new Headers(init.headers).get('authorization'),'Bearer admin-test');
    assert.deepEqual(JSON.parse(new TextDecoder().decode(init.body)),body);
    return Response.json({response:{id:body.id,status:'published'}});
  };
  const result=await backendPost(new Request('http://localhost/api/backend/admin/owner-responses',{
    method:'POST',headers:{Authorization:'Bearer admin-test','Content-Type':'application/json'},body:JSON.stringify(body),
  }),{params:Promise.resolve({path:['admin','owner-responses']})});
  assert.equal(result.status,200);
  assert.equal(result.headers.get('cache-control'),'no-store');
});

test('private review reply reads and writes proxy only to the gateway',async()=>{
  for(const path of ['reviews','review-replies']){
    globalThis.fetch=async(input,init)=>{
      assert.equal(String(input),`https://project.example/functions/v1/gateway/frontend/admin/${path}?offset=0`);
      assert.equal(new Headers(init.headers).get('authorization'),'Bearer admin-session');
      return Response.json({});
    };
    const response=await backendGet(new Request(`http://localhost/api/backend/admin/${path}?offset=0`,{
      headers:{Authorization:'Bearer admin-session'},
    }),{params:Promise.resolve({path:['admin',path]})});
    assert.equal(response.status,200);
  }
  const payload={action:'send',id:'11111111-1111-4111-8111-111111111111'};
  globalThis.fetch=async(input,init)=>{
    assert.equal(String(input),'https://project.example/functions/v1/gateway/frontend/admin/review-replies');
    assert.equal(new Headers(init.headers).get('authorization'),'Bearer admin-session');
    assert.deepEqual(JSON.parse(new TextDecoder().decode(init.body)),payload);
    return Response.json({reply:{status:'sent'}});
  };
  const response=await backendPost(new Request('http://localhost/api/backend/admin/review-replies',{
    method:'POST',headers:{Authorization:'Bearer admin-session','Content-Type':'application/json'},body:JSON.stringify(payload),
  }),{params:Promise.resolve({path:['admin','review-replies']})});
  assert.equal(response.status,200);
});

test('city geocoding and boundary data follow the gateway; arbitrary backend paths are rejected', async () => {
  for (const path of [['geocode'], ['map-boundary'], ['auth', 'v1', 'user'], ['moderation', 'reviews'], ['admin','owner-responses'], ['owner-responses']]) {
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

test('moderation decisions forward the caller token and note only through the gateway', async () => {
      const body={review_id:'11111111-1111-4111-8111-111111111111',decision:'approved',note:'Private note'};
      globalThis.fetch=async(input,init)=>{
        assert.equal(String(input),'https://project.example/functions/v1/gateway/frontend/moderation/reviews');
        assert.equal(init.method,'POST');
        assert.equal(new Headers(init.headers).get('authorization'),'Bearer moderator-session');
        assert.deepEqual(JSON.parse(new TextDecoder().decode(init.body)),body);
        return Response.json({review:{id:body.review_id,status:'approved'}});
      };
      const response=await backendPost(new Request('http://localhost/api/backend/moderation/reviews',{
        method:'POST',headers:{Authorization:'Bearer moderator-session','Content-Type':'application/json'},body:JSON.stringify(body),
      }),{params:Promise.resolve({path:['moderation','reviews']})});
      assert.equal(response.status,200);
      assert.equal(response.headers.get('cache-control'),'no-store');
});
