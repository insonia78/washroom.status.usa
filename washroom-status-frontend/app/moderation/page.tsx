'use client';
import PageCount from '@/components/PageCount';
import NotFoundView from '@/components/NotFoundView';
import {useEffect,useState} from 'react';
import type {Session} from '@supabase/supabase-js';
import {browserSupabase} from '@/lib/supabase';
import {isPendingReview,type PendingReview} from '@/lib/moderation';
import ToiletModerationQueue from '@/components/ToiletModerationQueue';
import OwnerReplyQueue from '@/components/OwnerReplyQueue';
import NotificationBell from '@/components/NotificationBell';

export default function ModerationPage(){
  const supabase=browserSupabase();
  const [session,setSession]=useState<Session|null>(null);
  const [checking,setChecking]=useState(true);
  const [email,setEmail]=useState('');
  const [reviews,setReviews]=useState<PendingReview[]>([]);
  const [notes,setNotes]=useState<Record<string,string>>({});
  const [loading,setLoading]=useState(false);
  const [ready,setReady]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [refresh,setRefresh]=useState(0);
  const [offset,setOffset]=useState(0); const [total,setTotal]=useState<number|null>(null);
  const [nextOffset,setNextOffset]=useState<number|null>(null);
  const [denied,setDenied]=useState(false);
  const [checked,setChecked]=useState(false);
  const [tab,setTab]=useState<'toilets'|'replies'|'reviews'>('toilets');
  useEffect(()=>{
    if(!supabase){setChecking(false);setError('Moderator sign-in is not configured. Set the public Supabase URL and anonymous key.');return}
    let active=true;
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,current)=>{
      if(active){setSession(current);setChecking(false)}
    });
    supabase.auth.getSession().then(({data,error})=>{
      if(!active)return;
      if(error)throw error;
      setSession(data.session);
    }).catch(error=>{if(active)setError(error instanceof Error?error.message:'Could not check sign-in status.')})
      .finally(()=>{if(active)setChecking(false)});
    return()=>{active=false;subscription.unsubscribe()};
  },[supabase]);

  useEffect(()=>{
    setReviews([]);
    setNotes({});
    setReady(false);
    if(!session){setLoading(false);setChecked(false);return}
    const controller=new AbortController();
    setLoading(true);
    setError('');
    fetch(`/api/backend/moderation/reviews?offset=${offset}`,{headers:{Authorization:`Bearer ${session.access_token}`},signal:controller.signal,cache:'no-store'})
      .then(async response=>{
        const data=await response.json();
        if(response.status===403){if(!controller.signal.aborted)setDenied(true);return}
        if(!response.ok)throw new Error(data.error||'Could not load the moderation queue.');
        if(!Array.isArray(data.reviews)||!data.reviews.every(isPendingReview))throw new Error('Invalid moderation queue response.');
        if(!controller.signal.aborted){setTotal(typeof data.total==='number'?data.total:null);setReviews(data.reviews);setNextOffset(typeof data.next_offset==='number'?data.next_offset:null);setReady(true)}
      }).catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:'Could not load the moderation queue.')})
      .finally(()=>{if(!controller.signal.aborted){setLoading(false);setChecked(true)}});
    return()=>controller.abort();
  },[session,refresh,offset]);

  async function signIn(event:React.FormEvent){
    event.preventDefault();
    if(!supabase){setError('Moderator sign-in is not configured.');return}
    setBusy(true);setError('');setMessage('');
    try{
      const {error}=await supabase.auth.signInWithOtp({email,options:{shouldCreateUser:false,emailRedirectTo:`${window.location.origin}/moderation`}});
      if(error)throw error;
      setMessage('Check your email for a sign-in link. Only existing accounts on the moderator allowlist can access this queue.');
    }catch(error){setError(error instanceof Error?error.message:'Could not send the sign-in link.')}
    finally{setBusy(false)}
  }

  async function signOut(){
    if(!supabase)return;
    setBusy(true);setError('');setMessage('');
    try{
      const {error}=await supabase.auth.signOut();
      if(error)throw error;
      setSession(null);setReviews([]);setNotes({});setReady(false);
    }catch(error){setError(error instanceof Error?error.message:'Could not sign out.')}
    finally{setBusy(false)}
  }

  async function decide(review:PendingReview,decision:'approved'|'rejected'){
    if(!supabase||busy)return;
    setBusy(true);setError('');setMessage('');
    try{
      const {data,error}=await supabase.auth.getSession();
      if(error)throw error;
      if(!data.session)throw new Error('Your session has expired. Sign in again.');
      const response=await fetch('/api/backend/moderation/reviews',{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`},
        body:JSON.stringify({review_id:review.id,decision,note:notes[review.id]||''}),
      });
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||'Could not save the moderation decision.');
      if(result.review?.id!==review.id||result.review?.status!==decision)throw new Error('Invalid moderation decision response. Refresh the queue to verify the result.');
      setReviews(previous=>previous.filter(item=>item.id!==review.id));
      setNotes(previous=>{const next={...previous};delete next[review.id];return next});
      setMessage(`Review ${decision}. ${decision==='approved'?'It is now eligible for public comments and the star average.':'It remains hidden from the public.'} Refresh the queue to load more pending reviews.`);
    }catch(error){setError(error instanceof Error?error.message:'Could not save the moderation decision.')}
    finally{setBusy(false)}
  }

  if(denied)return <NotFoundView/>;
  return <main className="moderator-dashboard mx-auto max-w-4xl px-4 py-7">
    <a href="/" className="text-sm font-semibold text-teal-800 underline">Back to restroom search</a>
    <h1 className="mt-5 text-3xl font-extrabold">Restroom moderation</h1>
    <p className="mt-2 text-sm text-slate-600">Verify submitted toilet locations and review reported answers. Moderator notes are private and are never included in public reviews.</p>
    {error&&<p role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
    {message&&<p role="status" className="mt-4 rounded-xl bg-teal-50 p-3 text-sm text-teal-900">{message}</p>}
    {checking||(session&&!checked)?<p role="status" className="mt-5">Checking access...</p>:!session?
      <form onSubmit={signIn} className="panel mt-5 max-w-md">
        <h2 className="text-xl font-bold">Moderator sign-in</h2>
        <p className="mt-2 text-sm text-slate-600">Use an existing Supabase account that has been explicitly added to the moderator allowlist.</p>
        <label className="mt-4 block text-sm font-semibold">Email<input required type="email" autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-3"/></label>
        <button disabled={busy||!supabase} className="mt-3 rounded-xl bg-teal-700 px-4 py-3 font-bold text-white disabled:opacity-50">{busy?'Sending...':'Send moderator sign-in link'}</button>
      </form>:<>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><p className="text-sm">Signed in as {session.user.email}</p>
          <div className="flex items-center gap-3">
          <NotificationBell key={`bell:${refresh}`} session={session} role="moderator" onSelect={category=>setTab(category==='responses'?'replies':category)}/>
          <button type="button" onClick={signOut} disabled={busy} className="pill disabled:opacity-50">Sign out</button>
          </div>
        </div>
        <nav role="tablist" aria-label="Moderation sections" className="sticky top-0 z-10 mt-5 flex flex-wrap items-center gap-2 rounded-xl border bg-white/95 p-2 shadow-sm">
          {([['toilets','Toilets'],['replies','Owner replies'],['reviews','Reviews']] as const).map(([id,label])=><button key={id} type="button" role="tab" aria-selected={tab===id} onClick={()=>setTab(id)} className={`rounded-lg px-4 py-2 text-sm font-bold ${tab===id?'bg-teal-700 text-white':'text-teal-900 hover:bg-teal-50'}`}>{label}</button>)}
          <button type="button" onClick={()=>{setMessage('');setRefresh(value=>value+1)}} disabled={busy||loading} aria-label="Refresh the moderation queues and notifications"
            className="ml-auto rounded-lg bg-teal-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{loading?'Refreshing...':'Refresh'}</button>
        </nav>
        {tab==='toilets'&&<ToiletModerationQueue session={session} refresh={refresh}/>}
        {tab==='replies'&&<OwnerReplyQueue key={`owner-replies:${session.access_token}:${refresh}`} session={session} stage="moderate"/>}
        {tab==='reviews'&&<>
        <h2 className="mt-6 text-xl font-bold">Pending reviews</h2>
        <p className="mt-1 text-xs text-slate-500">Oldest first, 3 per page.</p>
        {loading?<p role="status" className="mt-4">Loading pending reviews...</p>:ready&&reviews.length===0?<p className="panel mt-4">No pending reviews in this queue.</p>:null}
        <div className="mt-4 space-y-4">{reviews.map(review=><article key={review.id} className="panel">
          <h3 className="font-bold">{review.restroom_name?`${review.restroom_name} - `:''}{review.osm_type==='refuge'?'Refuge Restrooms':`OpenStreetMap ${review.osm_type}`} #{review.osm_id}</h3>
          <a href={review.osm_type==='refuge'?`https://www.refugerestrooms.org/restrooms/${review.osm_id}`:`https://www.openstreetmap.org/${review.osm_type}/${review.osm_id}`} target="_blank" rel="noopener noreferrer" className="text-sm text-teal-800 underline">View restroom on {review.osm_type==='refuge'?'Refuge Restrooms':'OpenStreetMap'}</a>
          <p className="mt-1 text-xs text-slate-500">Submitted <time dateTime={review.created_at}>{new Date(review.created_at).toLocaleString('en-US')}</time> · Review {review.id}</p>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="font-semibold">Cleanliness rating</dt><dd>{review.rating} / 5</dd></div>
            <div><dt className="font-semibold">Availability at visit</dt><dd>{review.availability?.replaceAll('_',' ')||'Not provided (older review)'}</dd></div>
            <div><dt className="font-semibold">Clean or Dirty Status</dt><dd>{review.cleanliness_status?.replaceAll('_',' ')||'Not provided (older review)'}</dd></div>
            <div><dt className="font-semibold">Reported issues</dt><dd>{review.issues.length?review.issues.join(', ').replaceAll('_',' '):'None reported'}</dd></div>
          </dl>
          <p className="mt-3 font-semibold">Comment</p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{review.comment||'No written comment.'}</p>
          {review.photo_urls.length>0?<div className="mt-3 grid grid-cols-3 gap-2">{review.photo_urls.map((url,index)=><a key={`${review.id}-${index}`} href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open review photo ${index+1}`}><img src={url} alt={`Photo ${index+1} attached to review`} className="aspect-square w-full rounded-lg object-cover"/></a>)}</div>:<p className="mt-3 text-xs text-slate-600">No photos attached to this review.</p>}
          <label className="mt-4 block text-sm font-semibold">Private moderator note (optional)<textarea disabled={busy} maxLength={2000} value={notes[review.id]||''} onChange={event=>setNotes(previous=>({...previous,[review.id]:event.target.value}))} className="mt-1 min-h-24 w-full rounded-lg border border-slate-300 p-3"/></label>
          <div className="mt-3 flex gap-3"><button type="button" disabled={busy} onClick={()=>decide(review,'approved')} className="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white disabled:opacity-50">Approve</button><button type="button" disabled={busy} onClick={()=>decide(review,'rejected')} className="rounded-xl border border-red-300 px-4 py-3 font-bold text-red-800 disabled:opacity-50">Reject</button></div>
        </article>)}</div>
        <div className="mt-4 flex gap-3">
          <PageCount offset={offset} total={total}/>{offset>0&&<button type="button" disabled={busy||loading} className="pill" onClick={()=>setOffset(value=>Math.max(0,value-3))}>Previous reviews</button>}
          {nextOffset!==null&&<button type="button" disabled={busy||loading} className="pill" onClick={()=>setOffset(nextOffset)}>Next reviews</button>}
        </div>
        </>}
      </>}
  </main>;
}
