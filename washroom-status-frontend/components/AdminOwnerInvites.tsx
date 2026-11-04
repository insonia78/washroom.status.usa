'use client';
import {useEffect,useRef,useState} from 'react';
import type {Session} from '@supabase/supabase-js';

type Invite={
  id:string;
  email:string;
  created_at:string;
  response_status:string;
  response_created_at:string|null;
};

const responseStatus:Record<string,string>={
  waiting:'Waiting for owner response',
  pending:'Owner replied - waiting for moderation',
  moderated:'Owner replied - waiting for administrator',
  published:'Owner response published',
  rejected:'Owner response was not approved',
};
const isInvite=(value:unknown):value is Invite=>{
  if(typeof value!=='object'||value===null)return false;
  const row=value as Record<string,unknown>;
  return typeof row.id==='string'&&typeof row.email==='string'&&
    typeof row.created_at==='string'&&typeof row.response_status==='string'&&
    (row.response_created_at===null||typeof row.response_created_at==='string');
};

export default function AdminOwnerInvites({session,reviewId,onClose}:{
  session:Session;reviewId:string;onClose:()=>void;
}){
  const [email,setEmail]=useState('');
  const [selectedReviewId,setSelectedReviewId]=useState(reviewId);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [invites,setInvites]=useState<Invite[]>([]);
  const [loadingInvites,setLoadingInvites]=useState(true);
  const [refresh,setRefresh]=useState(0);
  const [invitePage,setInvitePage]=useState(0);
  const closeButton=useRef<HTMLButtonElement>(null);

  useEffect(()=>{
    closeButton.current?.focus();
    const handleKeyDown=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose()};
    document.addEventListener('keydown',handleKeyDown);
    return()=>document.removeEventListener('keydown',handleKeyDown);
  },[onClose]);

  useEffect(()=>{
    const controller=new AbortController();
    setLoadingInvites(true);
    fetch(`/api/backend/admin/owner-invites?review_id=${encodeURIComponent(reviewId)}`,{
      headers:{Authorization:`Bearer ${session.access_token}`},
      cache:'no-store',
      signal:controller.signal,
    }).then(async response=>{
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not load owner invitation status.');
      if(!Array.isArray(data.invites)||!data.invites.every(isInvite))throw new Error('Invalid owner invitation status.');
      if(!controller.signal.aborted){setInvites(data.invites);setInvitePage(0)}
    }).catch(err=>{
      if(!controller.signal.aborted)setError(err instanceof Error?err.message:'Could not load owner invitation status.');
    }).finally(()=>{if(!controller.signal.aborted)setLoadingInvites(false)});
    return()=>controller.abort();
  },[session.access_token,reviewId,refresh]);

  async function send(event:React.FormEvent){
    event.preventDefault();setBusy(true);setError('');setMessage('');
    try{
      const response=await fetch('/api/backend/admin/owner-invites',{method:'POST',cache:'no-store',
        headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},
        body:JSON.stringify({email,review_id:selectedReviewId.trim(),redirect_to:`${window.location.origin}/owner`})});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not send the invite.');
      setMessage(`Magic link sent to ${email}. Waiting for the owner to respond.`);
      setEmail('');setSelectedReviewId(reviewId);setRefresh(value=>value+1);
    }catch(err){setError(err instanceof Error?err.message:'Could not send the invite.')}
    finally{setBusy(false)}
  }

  const currentInvite=invites[invitePage];
  return <div role="dialog" aria-modal="true" aria-labelledby="owner-invite-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
    <section className="panel w-full max-w-xl" aria-label="Business owner invites" onClick={event=>event.stopPropagation()}>
      <div className="flex items-start justify-between gap-3">
        <h2 id="owner-invite-title" className="text-xl font-bold">Business owner invite</h2>
        <button ref={closeButton} type="button" className="pill" onClick={onClose}>Close</button>
      </div>
      <p className="mt-2 text-sm">Send a magic link to a business owner so they can see this approved review and reply. Their reply goes through moderation, then your final approval, before it is published.</p>
      <section className="mt-4 border-t pt-3" aria-label="Owner invitation status">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">Forwarded to business owners</h3>
          <button type="button" className="pill text-sm" disabled={loadingInvites} onClick={()=>setRefresh(value=>value+1)}>Refresh</button>
        </div>
        {loadingInvites?<p role="status" className="mt-2 text-sm">Loading invitation status...</p>:
          !currentInvite?<p className="mt-2 text-sm text-slate-600">No owner has been invited for this review yet.</p>:
          <article className="mt-2 rounded-lg border p-3 text-sm">
            <p className="font-semibold">{currentInvite.email}</p>
            <p className="text-teal-800">{responseStatus[currentInvite.response_status]??currentInvite.response_status}</p>
            <p className="text-xs text-slate-500">Forwarded {new Date(currentInvite.created_at).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'})}</p>
            {currentInvite.response_created_at&&<p className="text-xs text-slate-500">Response received {new Date(currentInvite.response_created_at).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'})}</p>}
          </article>}
        {!loadingInvites&&invites.length>1&&<div className="mt-2 flex items-center justify-between text-sm">
          <button type="button" className="pill" disabled={invitePage===0} onClick={()=>setInvitePage(page=>Math.max(0,page-1))}>Previous owner</button>
          <span aria-live="polite">Owner {invitePage+1} of {invites.length}</span>
          <button type="button" className="pill" disabled={invitePage>=invites.length-1} onClick={()=>setInvitePage(page=>Math.min(invites.length-1,page+1))}>Next owner</button>
        </div>}
      </section>
      <form onSubmit={send} className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold">Owner email<input required type="email" value={email} onChange={event=>setEmail(event.target.value)} className="mt-1 w-full rounded-lg border p-3"/></label>
        <label className="text-sm font-semibold">Review ID<input required value={selectedReviewId} onChange={event=>setSelectedReviewId(event.target.value)} className="mt-1 w-full rounded-lg border p-3"/></label>
        <button disabled={busy} className="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white disabled:opacity-50 sm:col-span-2">{busy?'Sending...':'Send magic link'}</button>
      </form>
      {error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      {message&&<p role="status" className="mt-3 text-sm">{message}</p>}
    </section>
  </div>;
}
