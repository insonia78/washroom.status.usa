import assert from 'node:assert/strict';
import {afterEach,beforeEach,test} from 'node:test';
import {POST} from '../app/api/backend/[...path]/route.ts';

const originalFetch=globalThis.fetch;
const originalUrl=process.env.WASHROOM_GATEWAY_URL;
beforeEach(()=>{process.env.WASHROOM_GATEWAY_URL='https://gateway.example/functions/v1/gateway'});
afterEach(()=>{
  globalThis.fetch=originalFetch;
  if(originalUrl===undefined)delete process.env.WASHROOM_GATEWAY_URL;
  else process.env.WASHROOM_GATEWAY_URL=originalUrl;
});

test('toilet submissions pass through the gateway with unchanged coordinates and pending confirmation',async()=>{
  const fields={name:'Park toilet',latitude:40.71,longitude:-74,wheelchair:'unknown',fee:'no',notes:''};
  globalThis.fetch=async(input,init)=>{
    assert.equal(String(input),'https://gateway.example/functions/v1/gateway/frontend/toilet-submissions');
    assert.equal(init.method,'POST');
    assert.deepEqual(JSON.parse(new TextDecoder().decode(init.body)),fields);
    assert.equal(init.cache,'no-store');
    return Response.json({status:'pending'},{status:201});
  };
  const response=await POST(new Request('https://app.example/api/backend/toilet-submissions',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(fields),
  }),{params:Promise.resolve({path:['toilet-submissions']})});
  assert.equal(response.status,201);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(await response.json(),{status:'pending'});
});

test('toilet submission validation and database failures remain explicit through the adapter',async()=>{
  for(const status of [400,401,403,429,503]){
    globalThis.fetch=async()=>Response.json({error:'Toilet could not be saved'},{status});
    const response=await POST(new Request('https://app.example/api/backend/toilet-submissions',{method:'POST',body:'{}'}),
      {params:Promise.resolve({path:['toilet-submissions']})});
    assert.equal(response.status,status);
    assert.equal((await response.json()).error,'Toilet could not be saved');
  }
});

test('toilet moderation queue and decisions forward the moderator session through the gateway',async()=>{
  for(const method of ['GET','POST']){
    globalThis.fetch=async(input,init)=>{
      assert.equal(String(input),'https://gateway.example/functions/v1/gateway/frontend/moderation/toilets');
      assert.equal(init.method,method);
      assert.equal(new Headers(init.headers).get('authorization'),'Bearer moderator-token');
      return Response.json(method==='GET'?{submissions:[]}:{submission:{id:'toilet-id',status:'approved'}});
    };
    const request=new Request('https://app.example/api/backend/moderation/toilets',{
      method,headers:{Authorization:'Bearer moderator-token'},body:method==='POST'?JSON.stringify({id:'toilet-id',decision:'approved'}):undefined,
    });
    const response=await POST(request,{params:Promise.resolve({path:['moderation','toilets']})});
    assert.equal(response.status,200);
  }
});
