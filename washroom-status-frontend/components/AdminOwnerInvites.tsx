'use client';
import {useState} from 'react';
import type {Session} from '@supabase/supabase-js';

export default function AdminOwnerInvites({session}:{session:Session}){
  const [email,setEmail]=useState('');
  const [reviewId,setReviewId]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  async function send(event:React.FormEvent){
    event.preventDefault();setBusy(true);setError('');setMessage('');
    try{
      const response=await fetch('/api/backend/admin/owner-invites',{method:'POST',cache:'no-store',
        headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},
        body:JSON.stringify({email,review_id:reviewId.trim(),redirect_to:`${window.location.origin}/owner`})});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not send the invite.');
      setMessage(`Magic link sent to ${email}.`);setEmail('');setReviewId('');
    }catch(err){setError(err instanceof Error?err.message:'Could not send the invite.')}
    finally{setBusy(false)}
  }
  return <section className="panel mt-5" aria-label="Business owner invites">
    <h2 className="text-xl font-bold">Business owner invites</h2>
    <p className="mt-2 text-sm">Send a magic link to a business owner so they can see one approved review and reply. Their reply goes through moderation, then your final approval, before it is published. Find the review ID in the Reviews section above.</p>
    <form onSubmit={send} className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-semibold">Owner email<input required type="email" value={email} onChange={e=>setEmail(e.target.value)} className="mt-1 w-full rounded-lg border p-3"/></label>
      <label className="text-sm font-semibold">Review ID<input required value={reviewId} onChange={e=>setReviewId(e.target.value)} className="mt-1 w-full rounded-lg border p-3"/></label>
      <button disabled={busy} className="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white disabled:opacity-50 sm:col-span-2">{busy?'Sending...':'Send magic link'}</button>
    </form>
    {error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {message&&<p role="status" className="mt-3 text-sm">{message}</p>}
  </section>;
}
