'use client';

import {useState} from 'react';
import type {Session} from '@supabase/supabase-js';
import type {AdminReview} from '@/lib/review-replies';
import StepHistory from './StepHistory';

const replyStatusLabel:Record<string,string>={pending:'Waiting for moderator',moderated:'Moderator approved - waiting for administrator',published:'Published',rejected:'Not approved'};

export async function archiveAdminReview(session:Session,row:AdminReview){
  const response=await fetch('/api/backend/admin/reviews',{
    method:'POST',cache:'no-store',
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
    body:JSON.stringify({review_id:row.id,archived:!row.archived_at}),
  });
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'Could not update the review archive.');
}

export default function AdminReviewCard({
  row,session,onInviteOwner,onOpenReplies,onChanged,
}:{
  row:AdminReview;session:Session;
  onInviteOwner:(reviewId:string,opener:HTMLButtonElement)=>void;
  onOpenReplies?:()=>void;
  onChanged:(change:'archived'|'photo')=>void;
}){
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const addedOwnerPhotos=row.owner_photos?.filter(photo=>photo.status==='added').length??0;
  const archive=async()=>{
    setBusy('archive');setError('');setMessage('');
    try{await archiveAdminReview(session,row);onChanged('archived')}
    catch(error){setError(error instanceof Error?error.message:'Could not update the review archive.')}
    finally{setBusy(null)}
  };
  const addOwnerPhoto=async(photoId:string)=>{
    setBusy(photoId);setError('');setMessage('');
    try{
      const response=await fetch('/api/backend/admin/reviews',{
        method:'POST',cache:'no-store',
        headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
        body:JSON.stringify({action:'add_owner_photo',photo_id:photoId}),
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not add the owner photo.');
      setMessage('Owner photo added to the review.');
      onChanged('photo');
    }catch(error){setError(error instanceof Error?error.message:'Could not add the owner photo.')}
    finally{setBusy(null)}
  };
  return <article className="rounded-xl border p-3">
    <h3 className="font-bold">{row.restroom_name?`${row.restroom_name} - `:''}{row.osm_type} #{row.osm_id} - {row.rating}/5 - {row.status==='pending'?'Not moderated yet':row.status}{row.archived_at?' - Archived':''}</h3>
    <p className="mt-1 text-xs text-slate-500">Submitted <time dateTime={row.created_at}>{new Date(row.created_at).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'})}</time></p>
    <p className="mt-1 break-all text-xs">Review ID: <button
      type="button"
      className="text-left text-teal-800 underline underline-offset-2"
      onClick={event=>onInviteOwner(row.id,event.currentTarget)}
      aria-label={`Send an owner invite for review ${row.id}`}
    >{row.id}</button></p>
    <p className="mt-1 break-all text-xs">User ID: {row.user_id??'No account (anonymous or deleted)'}</p>
    {error&&<p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    {message&&<p role="status" className="mt-2 text-sm text-teal-800">{message}</p>}
    <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
      <div><dt className="font-semibold">Availability at visit</dt><dd className="capitalize">{row.availability?.replaceAll('_',' ')||'Not provided (older review)'}</dd></div>
      <div><dt className="font-semibold">Clean or Dirty Status</dt><dd className="capitalize">{row.cleanliness_status?.replaceAll('_',' ')||'Not provided (older review)'}</dd></div>
      <div><dt className="font-semibold">Reported issues</dt><dd>{row.issues.length?row.issues.join(', ').replaceAll('_',' '):'None reported'}</dd></div>
    </dl>
    <p className="mt-2 whitespace-pre-wrap break-words text-sm">{row.comment||'No written comment.'}</p>
    <section className="mt-3" aria-label="Reviewer photos">
      <h4 className="text-sm font-semibold">Reviewer photos</h4>
      {row.photo_urls.length>0?<div className="mt-2 grid grid-cols-3 gap-2">{row.photo_urls.map((url,index)=><a key={`${row.id}-${index}`} href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open review photo ${index+1}`}><img src={url} alt={`Photo ${index+1} attached to review`} className="aspect-square w-full rounded-lg object-cover"/></a>)}</div>:
        <p className="mt-1 text-xs text-slate-600">No photos attached by the reviewer.</p>}
    </section>
    {!!row.owner_replies?.length&&<section className="mt-4 rounded-lg border border-teal-200 bg-teal-50 p-3" aria-label="Owner reply photos">
      <h4 className="font-semibold">Owner replies and attached photos</h4>
      {row.owner_replies.map(reply=><div key={reply.id} className="mt-3 border-t border-teal-200 pt-2 first:border-t-0 first:pt-0">
        <p className="text-sm"><span className="font-semibold">{reply.business_name}</span> - {replyStatusLabel[reply.status]}{reply.archived_at?' (archived)':''}</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm">{reply.body}</p>
        {reply.photos.length?<div className="mt-2 flex flex-wrap gap-3">{reply.photos.map((photo,index)=><div key={photo.id} className="w-28">
          <a href={photo.photo_url} target="_blank" rel="noopener noreferrer" aria-label={`Open owner reply photo ${index+1}`}>
            <img src={photo.photo_url} alt={`Owner reply photo ${index+1}`} className="h-28 w-28 rounded-lg border object-cover"/>
          </a>
          <p className="mt-1 text-xs">{replyStatusLabel[photo.status]??photo.status}</p>
        </div>)}</div>:<p className="mt-1 text-xs text-slate-600">No photos attached to this reply.</p>}
      </div>)}
    </section>}
    {!!row.owner_photos?.length&&<section className="mt-4 rounded-lg border border-teal-200 bg-teal-50 p-3" aria-label="Owner-submitted photos">
      <h4 className="font-semibold">Owner-submitted photos</h4>
      <p className="mt-1 text-xs text-slate-600">Pending photos are private. Added photos appear publicly with an owner-provided label.</p>
      <div className="mt-3 flex flex-wrap gap-3">{row.owner_photos.map((photo,index)=><div key={photo.id} className="w-32">
        <a href={photo.photo_url} target="_blank" rel="noopener noreferrer" aria-label={`Open owner-submitted photo ${index+1}`}>
          <img src={photo.photo_url} alt={`Owner-submitted photo ${index+1}`} className="h-28 w-28 rounded-lg border object-cover"/>
        </a>
        {photo.status==='added'?<p className="mt-2 text-xs font-semibold text-teal-800">Added to review</p>:
          <button type="button" disabled={busy!==null||row.status!=='approved'||row.photo_urls.length+addedOwnerPhotos>=3} onClick={()=>void addOwnerPhoto(photo.id)} className="mt-2 rounded-lg bg-teal-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
            {busy===photo.id?'Adding...':'Add to review'}
          </button>}
      </div>)}</div>
      {row.status!=='approved'&&<p className="mt-2 text-xs text-slate-600">Approve the review before adding owner photos.</p>}
      {row.photo_urls.length+addedOwnerPhotos>=3&&<p className="mt-2 text-xs text-slate-600">This review already has the maximum of 3 photos.</p>}
    </section>}
    <StepHistory steps={row.history} label="Review steps taken"/>
    {row.status==='pending'?<p className="mt-3 text-sm font-semibold text-amber-900">Not moderated yet - replies and archiving unlock after moderation.</p>:<>
    {onOpenReplies&&<button type="button" className="pill mt-3 mr-2" onClick={onOpenReplies}>Open private replies</button>}
    <button type="button" disabled={busy!==null} className="pill mt-3" onClick={()=>void archive()}>{busy==='archive'?'Saving...':row.archived_at?'Unarchive':'Archive'}</button></>}
  </article>;
}
