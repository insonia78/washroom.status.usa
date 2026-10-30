import assert from 'node:assert/strict';
import {afterEach,test} from 'node:test';
import {createClient} from '@supabase/supabase-js';
import {gatewayAuthFetch} from '../lib/gateway-auth-fetch.ts';

const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch});

test('email magic links use the gateway OTP proxy and application callback, including Gmail addresses',async()=>{
  let calls=0;
  globalThis.fetch=async(input,init)=>{
    calls++;
    const url=new URL(String(input),'http://localhost');
    assert.equal(url.pathname,'/api/backend/auth/v1/otp');
    assert.equal(url.searchParams.get('redirect_to'),'https://washroom.example/auth/callback');
    assert.equal(init.method,'POST');
    const body=JSON.parse(new TextDecoder().decode(init.body));
    assert.equal(body.email,'visitor@gmail.com');
    assert.equal(body.create_user,true);
    return Response.json({});
  };
  const client=createClient('https://project.example','public-key',{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:gatewayAuthFetch},
  });
  const {error}=await client.auth.signInWithOtp({
    email:'visitor@gmail.com',options:{emailRedirectTo:'https://washroom.example/auth/callback'},
  });
  assert.equal(error,null);
  assert.equal(calls,1);
});

test('email delivery errors remain explicit rather than confirming a sent link',async()=>{
  globalThis.fetch=async()=>Response.json({msg:'Email rate limit exceeded',code:'over_email_send_rate_limit'},{status:429});
  const client=createClient('https://project.example','public-key',{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:gatewayAuthFetch},
  });
  const {error}=await client.auth.signInWithOtp({email:'visitor@gmail.com'});
  assert.equal(error.status,429);
  assert.match(error.message,/rate limit/i);
});
