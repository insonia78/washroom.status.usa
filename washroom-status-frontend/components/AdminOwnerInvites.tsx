'use client';
import {useEffect,useRef,useState} from 'react';
import type {Session} from '@supabase/supabase-js';

export default function AdminOwnerInvites({session,reviewId,onClose}:{session:Session;reviewId:string;onClose:()=>void}){
  const [email,setEmail]=useState('');
  const [selectedReviewId,setSelectedReviewId]=useState(reviewId);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const closeButton=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    closeButton.current?.focus();
    const handleKeyDown=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose()};
    document.addEventListener('keydown',handleKeyDown);
    return()=>document.removeEventListener('keydown',handleKeyDown);
  },[]);
  async function send(event:React.FormEvent){
    event.preventDefault();setBusy(true);setError('');setMessage('');
    try{
      const response=await fetch('/api/backend/admin/owner-invites',{method:'POST',cache:'no-store',
        headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},
        body:JSON.stringify({email,review_id:selectedReviewId.trim(),redirect_to:`${window.location.origin}/owner`})});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not send the invite.');
      setMessage(`Magic link sent to ${email}.`);setEmail('');setSelectedReviewId('');
    }catch(err){setError(err instanceof Error?err.message:'Could not send the invite.')}
    finally{setBusy(false)}
  }
  return <div role="dialog" aria-modal="true" aria-labelledby="owner-invite-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
    <section className="panel w-full max-w-xl" aria-label="Business owner invites" onClick={event=>event.stopPropagation()}>
      <div className="flex items-start justify-between gap-3">
        <h2 id="owner-invite-title" className="text-xl font-bold">Business owner invite</h2>
        <button ref={closeButton} type="button" className="pill" onClick={onClose}>Close</button>
      </div>
    <p className="mt-2 text-sm">Send a magic link to a business owner so they can see this approved review and reply. Their reply goes through moderation, then your final approval, before it is published.</p>
    <form onSubmit={send} className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-semibold">Owner email<input required type="email" value={email} onChange={e=>setEmail(e.target.value)} className="mt-1 w-full rounded-lg border p-3"/></label>
      <label className="text-sm font-semibold">Review ID<input required value={selectedReviewId} onChange={e=>setSelectedReviewId(e.target.value)} className="mt-1 w-full rounded-lg border p-3"/></label>
      <button disabled={busy} className="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white disabled:opacity-50 sm:col-span-2">{busy?'Sending...':'Send magic link'}</button>
    </form>
    {error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {message&&<p role="status" className="mt-3 text-sm">{message}</p>}
    </section>
  </div>;
}
