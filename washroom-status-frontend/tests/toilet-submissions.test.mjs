import './gateway-ip-env.mjs';
import assert from 'node:assert/strict';
import {afterEach,beforeEach,test} from 'node:test';
import {POST} from '../app/api/backend/[...path]/route.ts';

const originalFetch=globalThis.fetch;
const originalUrl=process.env.WASHROOM_GATEWAY_URL;
beforeEach(()=>{
  process.env.WASHROOM_GATEWAY_URL='https://gateway.example/functions/v1/gateway';
  process.env.VERCEL='1';
});
afterEach(()=>{
  globalThis.fetch=originalFetch;
  if(originalUrl===undefined)delete process.env.WASHROOM_GATEWAY_URL;
  else process.env.WASHROOM_GATEWAY_URL=originalUrl;
});

test('toilet submissions forward multipart photos and unchanged coordinates through the gateway',async()=>{
  const fields={name:'Park toilet',latitude:40.71,longitude:-74,wheelchair:'unknown',fee:'no',notes:''};
  globalThis.fetch=async(input,init)=>{
    assert.equal(String(input),'https://gateway.example/functions/v1/gateway/frontend/toilet-submissions');
    assert.equal(init.method,'POST');
    assert.match(new Headers(init.headers).get('content-type'),/^multipart\/form-data; boundary=/);
    const body=new TextDecoder().decode(init.body);
    assert.ok(body.includes(JSON.stringify(fields)));
    assert.ok(body.includes('sign.jpg'));
    assert.equal(init.cache,'no-store');
    return Response.json({status:'pending'},{status:201});
  };
  const form=new FormData();
  form.set('submission',JSON.stringify(fields));
  form.append('photos',new File(['photo'], 'sign.jpg', {type:'image/jpeg'}));
  const response=await POST(new Request('https://app.example/api/backend/toilet-submissions',{
    method:'POST',body:form,headers:{'x-vercel-forwarded-for':'192.0.2.1'},
  }),{params:Promise.resolve({path:['toilet-submissions']})});
  assert.equal(response.status,201);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(await response.json(),{status:'pending'});
});

test('toilet submission validation and database failures remain explicit through the adapter',async()=>{
  for(const status of [400,401,403,429,503]){
    globalThis.fetch=async()=>Response.json({error:'Toilet could not be saved'},{status});
    const response=await POST(new Request('https://app.example/api/backend/toilet-submissions',{
      method:'POST',body:'{}',headers:{'x-vercel-forwarded-for':'192.0.2.1'},
    }),
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
    request.headers.set('x-vercel-forwarded-for','192.0.2.1');
    const response=await POST(request,{params:Promise.resolve({path:['moderation','toilets']})});
    assert.equal(response.status,200);
  }
});
