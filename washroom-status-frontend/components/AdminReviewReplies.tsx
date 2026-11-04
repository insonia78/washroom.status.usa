'use client';
import PageCount from './PageCount';
import {useEffect,useRef,useState} from 'react';
import type {Session} from '@supabase/supabase-js';
import {browserSupabase} from '@/lib/supabase';
import {isAdminReview,isReviewReply,type AdminReview,type ReviewReply} from '@/lib/review-replies';

const endpoint='/api/backend/admin/review-replies';
function ReplyEditor({review,session}:{review:AdminReview;session:Session}){
  const [rows,setRows]=useState<ReviewReply[]>([]);
  const [offset,setOffset]=useState(0); const [total,setTotal]=useState<number|null>(null);
  const [next,setNext]=useState<number|null>(null);
  const [refresh,setRefresh]=useState(0);
  const [loading,setLoading]=useState(true);
  const [ready,setReady]=useState(false);
  const [body,setBody]=useState('');
  const [attempt,setAttempt]=useState<{id:string;body:string}|null>(null);
  const [composing,setComposing]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const inFlight=useRef(false);
  const lifetime=useRef<AbortController|null>(null);
  useEffect(()=>{
    const controller=new AbortController();lifetime.current=controller;
    return()=>{controller.abort();lifetime.current=null};
  },[]);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setReady(false);setError('');setRows([]);
    fetch(`${endpoint}?review_id=${review.id}&offset=${offset}`,{
      headers:{Authorization:`Bearer ${session.access_token}`},cache:'no-store',signal:controller.signal,
    }).then(async response=>{
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not load replies.');
      if(!Array.isArray(data.replies)||!data.replies.every((row:unknown)=>isReviewReply(row)&&row.review_id===review.id)||
        (data.next_offset!==null&&data.next_offset!==offset+3))throw new Error('Invalid reply history.');
      if(!controller.signal.aborted){setTotal(typeof data.total==='number'?data.total:null);setRows(data.replies);setNext(data.next_offset);setReady(true)}
    }).catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:'Could not load replies.')})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    return()=>controller.abort();
  },[review.id,session.access_token,offset,refresh]);
  async function act(action:'save'|'send',row?:ReviewReply){
    const controller=lifetime.current;
    if(inFlight.current||!controller||controller.signal.aborted)return;
    inFlight.current=true;setBusy(true);setError('');setMessage('');
    try{
      const supabase=browserSupabase();
      if(!supabase)throw new Error('Admin sign-in is not configured.');
      const {data,error}=await supabase.auth.getSession();
      if(error)throw error;
      if(!data.session||data.session.user.id!==session.user.id)throw new Error('Your session changed. Sign in again.');
      const draft=action==='save'?(attempt??{id:crypto.randomUUID(),body:body.trim()}):null;
      if(draft)setAttempt(draft);
      const response=await fetch(endpoint,{
        method:'POST',signal:controller.signal,
        headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`},
        body:JSON.stringify(action==='save'?{action,id:draft?.id,review_id:review.id,body:draft?.body}:{action,id:row?.id}),
      });
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||'Reply action failed. Refresh history before retrying.');
      if(!isReviewReply(result.reply)||result.reply.review_id!==review.id||
        result.reply.id!==(draft?.id??row?.id)||(action==='send'&&result.reply.status!=='sent'))throw new Error('Invalid reply confirmation. Refresh history before retrying.');
      if(!controller.signal.aborted){
        const reply:ReviewReply=result.reply;
        if(action==='save'){setComposing(false);setOffset(0)}
        setRows(previous=>[reply,...previous.filter(item=>item.id!==reply.id)].slice(0,3));
        setMessage(reply.status==='sent'?'Email accepted by the provider. This does not confirm inbox delivery.':
          reply.status==='draft'?'Private reply saved. It has not been emailed. Review the saved text, then send it.':
          'Reply saved. Check its delivery state in the history before retrying.');
      }
    }catch(error){if(!controller.signal.aborted)setError(error instanceof Error?error.message:'Reply action failed. Refresh history before retrying.')}
    finally{inFlight.current=false;if(!controller.signal.aborted)setBusy(false)}
  }
  return <section className="mt-4 border-t pt-4" aria-label="Private review replies">
    <h3 className="font-bold">Private replies</h3>
    <p className="mt-1 text-sm text-slate-600">Replies are stored privately. The server looks up the verified recipient email; this panel never receives it. Sent means accepted by the provider, not confirmed delivery.</p>
    {error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {message&&<p role="status" className="mt-3 text-sm text-teal-800">{message}</p>}
    <button type="button" disabled={busy||loading} className="pill mt-3" onClick={()=>setRefresh(value=>value+1)}>Refresh reply history</button>
    {loading?<p role="status" className="mt-3">Loading reply history...</p>:ready&&<>
      {review.user_id===null?<p className="mt-3 text-sm">No recipient account: this review is anonymous or the account was deleted. Email replies are unavailable.</p>:composing?
        <form className="mt-4" onSubmit={event=>{event.preventDefault();void act('save')}}>
          <label className="block text-sm font-semibold">Private reply<textarea required maxLength={4000} disabled={busy||attempt!==null} value={body} onChange={event=>setBody(event.target.value)} className="mt-1 min-h-28 w-full rounded-lg border p-3"/></label>
          {attempt&&<p className="mt-2 text-xs">This save has a fixed reply ID. Retry saving the same text if confirmation was lost; do not create another copy.</p>}
          <button disabled={busy||!body.trim()} className="mt-3 rounded-xl bg-teal-700 px-4 py-3 font-bold text-white disabled:opacity-50">{attempt?'Retry save private reply':'Save private reply'}</button>
        </form>:<button type="button" disabled={busy} className="pill mt-3" onClick={()=>{setBody('');setAttempt(null);setComposing(true);setMessage('')}}>Compose another reply</button>}
      <div className="mt-4 space-y-3">{rows.map(row=><article key={row.id} className="rounded-xl border p-3">
        <p className="break-all text-xs">Reply {row.id} - {row.status}</p>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm">{row.body}</p>
        <p className="mt-2 text-xs">Saved {new Date(row.created_at).toLocaleString()}{row.sent_at?` - Accepted ${new Date(row.sent_at).toLocaleString()}`:''}</p>
        {row.status!=='sent'&&row.recipient_user_id!==null&&<button type="button" disabled={busy} onClick={()=>void act('send',row)} className="pill mt-3">{row.status==='draft'?'Email saved reply':'Retry sending same reply'}</button>}
        {(row.status==='unknown'||row.status==='sending')&&<p className="mt-2 text-xs text-amber-900">Delivery may be in progress or uncertain. Refresh first and wait 60 seconds before retrying this same reply. Retries stop 23 hours after the first attempt to prevent duplicate emails.</p>}
      </article>)}</div>
      <div className="mt-3 flex gap-2">
        <PageCount offset={offset} total={total}/>{offset>0&&<button type="button" disabled={busy} className="pill" onClick={()=>setOffset(value=>Math.max(0,value-3))}>Previous replies</button>}
        {next!==null&&<button type="button" disabled={busy} className="pill" onClick={()=>setOffset(next)}>More replies</button>}
      </div>
    </>}
  </section>;
}

export default function AdminReviewReplies({
  session,
  onInviteOwner,
}:{
  session:Session;
  onInviteOwner:(reviewId:string,opener:HTMLButtonElement)=>void;
}){
  const [rows,setRows]=useState<AdminReview[]>([]);
  const [offset,setOffset]=useState(0); const [total,setTotal]=useState<number|null>(null);
  const [next,setNext]=useState<number|null>(null);
  const [refresh,setRefresh]=useState(0);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [photoMessage,setPhotoMessage]=useState('');
  const [photoBusy,setPhotoBusy]=useState<string|null>(null);
  const [selected,setSelected]=useState<AdminReview|null>(null);
  const [archiveFilter,setArchiveFilter]=useState<'active'|'archived'|'all'>('active');
  const [showPending,setShowPending]=useState(false);
  const archive=async(row:AdminReview)=>{
    setError('');
    try{
      const response=await fetch('/api/backend/admin/reviews',{
        method:'POST',cache:'no-store',
        headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
        body:JSON.stringify({review_id:row.id,archived:!row.archived_at}),
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not update the review archive.');
      if(selected?.id===row.id)setSelected(null);
      setRefresh(value=>value+1);
    }catch(error){setError(error instanceof Error?error.message:'Could not update the review archive.')}
  };
  const addOwnerPhoto=async(photoId:string)=>{
    setPhotoBusy(photoId);setError('');setPhotoMessage('');
    try{
      const response=await fetch('/api/backend/admin/reviews',{
        method:'POST',cache:'no-store',
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},
        body:JSON.stringify({action:'add_owner_photo',photo_id:photoId}),
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not add the owner photo.');
      setPhotoMessage('Owner photo added to the review.');
      setRefresh(value=>value+1);
    }catch(error){setError(error instanceof Error?error.message:'Could not add the owner photo.')}
    finally{setPhotoBusy(null)}
  };
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');setRows([]);
    const archived=archiveFilter==='all'?'all':archiveFilter==='archived'?'1':'0';
    const params=new URLSearchParams({offset:String(offset),archived,moderation:showPending?'pending':'moderated'});
    fetch('/api/backend/admin/reviews?'+params.toString(),{
      headers:{Authorization:`Bearer ${session.access_token}`},cache:'no-store',signal:controller.signal,
    }).then(async response=>{
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not load reviews.');
      if(!Array.isArray(data.reviews)||!data.reviews.every(isAdminReview)||
        (data.next_offset!==null&&data.next_offset!==offset+3))throw new Error('Invalid admin review list.');
      if(!controller.signal.aborted){setTotal(typeof data.total==='number'?data.total:null);setRows(data.reviews);setNext(data.next_offset)}
    }).catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:'Could not load reviews.')})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    return()=>controller.abort();
  },[session.access_token,offset,refresh,archiveFilter,showPending]);
  return <section className="panel mt-5" aria-label="Review reply administration">
    <h2 className="text-xl font-bold">Review reply administration</h2>
    <p className="mt-2 text-sm">Administrator access only. Reviewer identities are shown as user IDs, never email addresses. Private email replies are separate from public owner responses.</p>
    <button type="button" className="pill mt-3" disabled={loading} onClick={()=>setRefresh(value=>value+1)}>Refresh reviews</button>
    <div className="mt-3 flex flex-wrap gap-2" aria-label="Review history filter">
      {([['active','Active reviews'],['archived','Archived reviews'],['all','All history']] as const).map(([value,label])=><button
        key={value} type="button" className="pill" aria-pressed={archiveFilter===value} disabled={loading}
        onClick={()=>{setArchiveFilter(value);setOffset(0);setSelected(null)}}
      >{label}</button>)}
    </div>
    <div role="tablist" aria-label="Review workflow steps" className="mt-3 flex flex-wrap gap-2">
      <button type="button" role="tab" aria-selected={showPending} className={`pill ${showPending?'font-bold underline':''}`} disabled={loading} onClick={()=>{setShowPending(true);setOffset(0);setSelected(null)}}>Step 1: Under review and moderation</button>
      <button type="button" role="tab" aria-selected={!showPending} className={`pill ${!showPending?'font-bold underline':''}`} disabled={loading} onClick={()=>{setShowPending(false);setOffset(0);setSelected(null)}}>Step 2: Administration - waiting approval and review</button>
    </div>
    {showPending&&<p className="mt-2 text-sm text-amber-900">Step 1: these reviews are with the moderators and have not been moderated yet. Once a moderator approves or rejects a review it moves to Step 2.</p>}
    {!showPending&&<p className="mt-2 text-sm">Step 2: approved and rejected reviews are in the administration bucket. Choose All history to view active and archived reviews together.</p>}
    {error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {photoMessage&&<p role="status" className="mt-3 text-sm text-teal-800">{photoMessage}</p>}
    {loading?<p role="status" className="mt-3">Checking admin access and loading reviews...</p>:!error&&<>
      {!rows.length&&<p className="mt-3 text-sm">No reviews found.</p>}
      <div className="mt-4 space-y-3">{rows.map(row=><article key={row.id} className="rounded-xl border p-3">
        <h3 className="font-bold">{row.restroom_name?`${row.restroom_name} - `:''}{row.osm_type} #{row.osm_id} - {row.rating}/5 - {row.status==='pending'?'Not moderated yet':row.status}{row.archived_at?' - Archived':''}</h3>
        <p className="mt-1 text-xs text-slate-500">Submitted <time dateTime={row.created_at}>{new Date(row.created_at).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'})}</time></p>
        <p className="mt-1 break-all text-xs">Review ID: <button
          type="button"
          className="text-left text-teal-800 underline underline-offset-2"
          onClick={event=>onInviteOwner(row.id,event.currentTarget)}
          aria-label={`Send an owner invite for review ${row.id}`}
        >{row.id}</button></p>
        <p className="mt-1 break-all text-xs">User ID: {row.user_id??'No account (anonymous or deleted)'}</p>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="font-semibold">Availability at visit</dt><dd className="capitalize">{row.availability?.replaceAll('_',' ')||'Not provided (older review)'}</dd></div>
          <div><dt className="font-semibold">Clean or Dirty Status</dt><dd className="capitalize">{row.cleanliness_status?.replaceAll('_',' ')||'Not provided (older review)'}</dd></div>
          <div><dt className="font-semibold">Reported issues</dt><dd>{row.issues.length?row.issues.join(', ').replaceAll('_',' '):'None reported'}</dd></div>
        </dl>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm">{row.comment||'No written comment.'}</p>
        {row.photo_urls.length>0&&<div className="mt-3 grid grid-cols-3 gap-2">{row.photo_urls.map((url,index)=><a key={`${row.id}-${index}`} href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open review photo ${index+1}`}><img src={url} alt={`Photo ${index+1} attached to review`} className="aspect-square w-full rounded-lg object-cover"/></a>)}</div>}
        {!!row.owner_photos?.length&&<section className="mt-4 rounded-lg border border-teal-200 bg-teal-50 p-3" aria-label="Owner-submitted photos">
          <h4 className="font-semibold">Owner-submitted photos</h4>
          <p className="mt-1 text-xs text-slate-600">Pending photos are private. Added photos appear publicly with an owner-provided label.</p>
          <div className="mt-3 flex flex-wrap gap-3">{row.owner_photos.map((photo,index)=><div key={photo.id} className="w-32">
            <a href={photo.photo_url} target="_blank" rel="noopener noreferrer" aria-label={`Open owner-submitted photo ${index+1}`}>
              <img src={photo.photo_url} alt={`Owner-submitted photo ${index+1}`} className="h-28 w-28 rounded-lg border object-cover"/>
            </a>
            {photo.status==='added'?<p className="mt-2 text-xs font-semibold text-teal-800">Added to review</p>:
              <button type="button" disabled={photoBusy!==null||row.status!=='approved'||row.photo_urls.length+(row.owner_photos?.filter(item=>item.status==='added').length??0)>=3} onClick={()=>void addOwnerPhoto(photo.id)} className="mt-2 rounded-lg bg-teal-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                {photoBusy===photo.id?'Adding...':'Add to review'}
              </button>}
          </div>)}</div>
          {row.status!=='approved'&&<p className="mt-2 text-xs text-slate-600">Approve the review before adding owner photos.</p>}
          {row.photo_urls.length+(row.owner_photos.filter(photo=>photo.status==='added').length)>=3&&<p className="mt-2 text-xs text-slate-600">This review already has the maximum of 3 photos.</p>}
        </section>}
        {row.status==='pending'?<p className="mt-3 text-sm font-semibold text-amber-900">Not moderated yet - replies and archiving unlock after moderation.</p>:<>
        <button type="button" className="pill mt-3" onClick={()=>setSelected(row)}>Open private replies</button>
        <button type="button" className="pill mt-3 ml-2" onClick={()=>void archive(row)}>{row.archived_at?'Unarchive':'Archive'}</button></>}
      </article>)}</div>
      <div className="mt-3 flex gap-2">
        <PageCount offset={offset} total={total}/>{offset>0&&<button type="button" className="pill" onClick={()=>setOffset(value=>Math.max(0,value-3))}>Previous reviews</button>}
        {next!==null&&<button type="button" className="pill" onClick={()=>setOffset(next)}>More reviews</button>}
      </div>
    </>}
    {selected&&<div role="dialog" aria-modal="true" aria-label="Private replies" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={()=>setSelected(null)}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-4 shadow-xl" onClick={event=>event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <p className="break-all text-sm font-bold">Replying to review {selected.id}</p>
          <button type="button" className="pill" onClick={()=>setSelected(null)}>Close</button>
        </div>
        <p className="mt-1 break-all text-xs">User ID: {selected.user_id??'No account'}</p>
        <ReplyEditor key={`${selected.id}:${session.access_token}`} review={selected} session={session}/>
      </div>
    </div>}
  </section>;
}
