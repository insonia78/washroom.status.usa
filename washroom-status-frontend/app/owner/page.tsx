'use client';
import {useEffect,useState} from 'react';
import type {Session} from '@supabase/supabase-js';
import {browserSupabase} from '@/lib/supabase';

type Item={invite_id:string;
  review:{restroom_name?:string|null;osm_type:string;osm_id:number;rating?:number;comment?:string|null};
  replies:{id:string;body:string;status:string;business_name:string}[]};
const statusLabel:Record<string,string>={pending:'Waiting for moderation',moderated:'Waiting for administrator approval',published:'Published',rejected:'Not approved'};

function OwnerReviews({session}:{session:Session}){
  const [items,setItems]=useState<Item[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [refresh,setRefresh]=useState(0);
  const [drafts,setDrafts]=useState<Record<string,{business:string;body:string}>>({});
  const headers={Authorization:`Bearer ${session.access_token}`};
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');
    fetch('/api/backend/owner/reviews',{headers,cache:'no-store',signal:controller.signal}).then(async response=>{
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not load your invited reviews.');
      if(!Array.isArray(data.items))throw new Error('Invalid response.');
      if(!controller.signal.aborted)setItems(data.items);
    }).catch(err=>{if(!controller.signal.aborted)setError(err instanceof Error?err.message:'Could not load your invited reviews.')})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    return()=>controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[session.access_token,refresh]);
  async function submit(event:React.FormEvent,item:Item){
    event.preventDefault();setError('');setMessage('');
    const draft=drafts[item.invite_id]??{business:item.review.restroom_name??'',body:''};
    try{
      const response=await fetch('/api/backend/owner/replies',{method:'POST',cache:'no-store',headers:{...headers,'Content-Type':'application/json'},
        body:JSON.stringify({invite_id:item.invite_id,business_name:draft.business,body:draft.body})});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not send your reply.');
      setMessage('Reply received. It will be reviewed by a moderator, then approved by an administrator before it is published.');
      setRefresh(value=>value+1);
    }catch(err){setError(err instanceof Error?err.message:'Could not send your reply.')}
  }
  return <>
    {error&&<p role="alert" className="mt-4 text-amber-800">{error}</p>}
    {message&&<p role="status" className="mt-4 text-sm">{message}</p>}
    {loading?<p role="status" className="mt-4">Loading...</p>:!items.length&&!error&&<p className="panel mt-4">No reviews have been shared with this email address.</p>}
    <div className="mt-4 space-y-4">{items.map(item=>{
      const draft=drafts[item.invite_id]??{business:item.review.restroom_name??'',body:''};
      const open=item.replies.some(r=>r.status==='pending'||r.status==='moderated'||r.status==='published');
      return <article key={item.invite_id} className="panel">
        <h2 className="font-bold">{item.review.restroom_name||`${item.review.osm_type==='refuge'?'Refuge Restrooms':'OpenStreetMap'} #${item.review.osm_id}`}</h2>
        {item.review.rating!==undefined&&<p className="mt-1 text-sm">Rating: {item.review.rating}/5</p>}
        <p className="mt-2 whitespace-pre-wrap text-sm">{item.review.comment||'No written comment.'}</p>
        {item.replies.map(r=><p key={r.id} className="mt-3 rounded-lg border p-2 text-sm"><span className="font-semibold">{statusLabel[r.status]??r.status}:</span> {r.body}</p>)}
        {!open&&<form onSubmit={event=>void submit(event,item)} className="mt-3">
          <label className="block text-sm font-semibold">Business name<input required maxLength={200} value={draft.business} onChange={e=>setDrafts({...drafts,[item.invite_id]:{...draft,business:e.target.value}})} className="mt-1 w-full rounded-lg border p-3"/></label>
          <label className="mt-2 block text-sm font-semibold">Your reply<textarea required maxLength={4000} rows={4} value={draft.body} onChange={e=>setDrafts({...drafts,[item.invite_id]:{...draft,body:e.target.value}})} className="mt-1 w-full rounded-lg border p-3"/></label>
          <button className="mt-3 rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Send reply for review</button>
        </form>}
      </article>;
    })}</div>
  </>;
}

export default function OwnerPage(){
  const supabase=browserSupabase();
  const [session,setSession]=useState<Session|null>(null);
  const [checking,setChecking]=useState(true);
  const [email,setEmail]=useState('');
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  useEffect(()=>{
    if(!supabase){setChecking(false);setError('Sign-in is not configured.');return}
    let active=true;
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,current)=>{if(active){setSession(current);setChecking(false)}});
    supabase.auth.getSession().then(({data})=>{if(active)setSession(data.session)})
      .catch(err=>{if(active)setError(err instanceof Error?err.message:'Could not check sign-in.')})
      .finally(()=>{if(active)setChecking(false)});
    return()=>{active=false;subscription.unsubscribe()};
  },[supabase]);
  async function signIn(event:React.FormEvent){
    event.preventDefault();if(!supabase)return;setError('');setMessage('');
    const {error:otpError}=await supabase.auth.signInWithOtp({email,options:{shouldCreateUser:false,emailRedirectTo:`${window.location.origin}/owner`}});
    if(otpError)setError(otpError.message);else setMessage('Check your email for the sign-in link.');
  }
  return <main className="mx-auto max-w-3xl px-4 py-7">
    <a href="/" className="text-sm text-teal-800 underline">Back to restroom search</a>
    <h1 className="mt-5 text-3xl font-extrabold">Business owner replies</h1>
    <p className="mt-2 text-sm text-slate-600">See the reviews shared with you and send a reply. Replies are checked by a moderator and approved by an administrator before they are published.</p>
    {checking?<p role="status" className="mt-4">Checking sign-in...</p>:session?<>
      <div className="mt-4 flex items-center gap-3"><p className="text-sm">Signed in as {session.user.email}</p>
        <button type="button" className="pill" onClick={()=>void supabase?.auth.signOut()}>Sign out</button></div>
      <OwnerReviews session={session}/>
    </>:<form onSubmit={signIn} className="panel mt-5 max-w-md">
      <p className="text-sm">Use the invitation email, or request a new link with the email address you were invited with.</p>
      {error&&<p role="alert" className="mt-3 text-amber-800">{error}</p>}
      {message&&<p role="status" className="mt-3 text-sm">{message}</p>}
      <label className="mt-3 block text-sm font-semibold">Email<input required type="email" value={email} onChange={e=>setEmail(e.target.value)} className="mt-1 w-full rounded-lg border p-3"/></label>
      <button className="mt-3 rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Send sign-in link</button>
    </form>}
  </main>;
}
