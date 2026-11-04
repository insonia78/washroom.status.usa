'use client';
import PageCount from './PageCount';
import {useEffect,useState} from 'react';
import type {Session} from '@supabase/supabase-js';

type Reply={id:string;status?:string;archived_at?:string|null;owner_email:string;business_name:string;body:string;created_at:string;
  photos:{id:string;photo_url:string;status:'pending'|'moderated'|'published'|'rejected'}[];
  review:{restroom_name?:string|null;osm_type:string;osm_id:number;comment?:string|null}|null};
const record=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null;
const isReply=(value:unknown):value is Reply=>record(value)&&typeof value.id==='string'&&typeof value.owner_email==='string'&&
  typeof value.business_name==='string'&&typeof value.body==='string'&&typeof value.created_at==='string'&&
  Array.isArray(value.photos)&&value.photos.every(photo=>record(photo)&&typeof photo.id==='string'&&
    typeof photo.photo_url==='string'&&['pending','moderated','published','rejected'].includes(String(photo.status)));

// Step 1 (stage "moderate") is for moderators; step 2 (stage "publish") is the administrator's final approval.
export default function OwnerReplyQueue({session,stage}:{session:Session;stage:'moderate'|'publish'}){
  const endpoint=stage==='moderate'?'/api/backend/moderation/owner-replies':'/api/backend/admin/owner-replies';
  const [rows,setRows]=useState<Reply[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [refresh,setRefresh]=useState(0);
  const [showArchived,setShowArchived]=useState(false);
  const [offset,setOffset]=useState(0); const [total,setTotal]=useState<number|null>(null);
  const [nextOffset,setNextOffset]=useState<number|null>(null);
  const headers={Authorization:`Bearer ${session.access_token}`};
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');
    fetch(`${endpoint}?offset=${offset}${showArchived?'&archived=1':''}`,{headers,cache:'no-store',signal:controller.signal}).then(async response=>{
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not load owner replies.');
      if(!Array.isArray(data.replies)||!data.replies.every(isReply))throw new Error('Invalid owner reply list.');
      if(!controller.signal.aborted){setTotal(typeof data.total==='number'?data.total:null);setRows(data.replies);setNextOffset(typeof data.next_offset==='number'?data.next_offset:null)}
    }).catch(err=>{if(!controller.signal.aborted)setError(err instanceof Error?err.message:'Could not load owner replies.')})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    return()=>controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[session.access_token,refresh,endpoint,showArchived,offset]);
  const archive=async(row:Reply,archived:boolean)=>{
    setError('');
    try{
      const response=await fetch(endpoint,{method:'POST',cache:'no-store',headers:{...headers,'Content-Type':'application/json'},
        body:JSON.stringify({reply_id:row.id,archived})});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not archive the reply.');
      setRefresh(value=>value+1);
    }catch(err){setError(err instanceof Error?err.message:'Could not archive the reply.')}
  };
  const decide=async(row:Reply,approve:boolean)=>{
    setError('');
    try{
      const response=await fetch(endpoint,{method:'POST',cache:'no-store',headers:{...headers,'Content-Type':'application/json'},
        body:JSON.stringify({reply_id:row.id,approve})});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not save the decision.');
      setRefresh(value=>value+1);
    }catch(err){setError(err instanceof Error?err.message:'Could not save the decision.')}
  };
  const title=stage==='moderate'?'Owner replies - Step 1: moderation':'Owner replies - Step 2: administration final approval';
  return <section className="panel mt-5" aria-label={title}>
    <h2 className="text-xl font-bold">{title}</h2>
    <p className="mt-2 text-sm">{stage==='moderate'?'Replies from invited business owners wait here. Approve to send them to the administrator.':'Moderator-approved owner replies wait here. Final approval publishes the reply publicly.'}</p>
    <button type="button" className="pill mt-3" disabled={loading} onClick={()=>setRefresh(value=>value+1)}>Refresh owner replies</button>
    {stage==='publish'&&<label className="ml-3 text-sm"><input type="checkbox" checked={showArchived} onChange={event=>{setShowArchived(event.target.checked);setOffset(0)}}/> Show archived</label>}
    {error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {loading?<p role="status" className="mt-3">Loading owner replies...</p>:!error&&!rows.length&&<p className="mt-3 text-sm">No owner replies waiting.</p>}
    <div className="mt-4 space-y-3">{rows.map(row=><article key={row.id} className="rounded-xl border p-3">
      <h3 className="font-bold">{row.review?.restroom_name?`${row.review.restroom_name} - `:''}{row.business_name}</h3>
      <p className="mt-1 text-xs text-slate-500">From {row.owner_email} on {new Date(row.created_at).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'})}</p>
      {row.review?.comment&&<p className="mt-2 text-sm"><span className="font-semibold">Original review:</span> {row.review.comment}</p>}
      <p className="mt-2 whitespace-pre-wrap text-sm"><span className="font-semibold">Owner reply:</span> {row.body}</p>
      <div className="mt-3 border-t pt-2" aria-label="Owner reply photos">
        <h4 className="text-sm font-semibold">Owner reply photos</h4>
        {!row.photos.length?<p className="mt-1 text-xs text-slate-600">No photos were attached to this reply.</p>:
        <div className="mt-2 flex flex-wrap gap-3">{row.photos.map((photo,index)=><div key={photo.id}>
          <a href={photo.photo_url} target="_blank" rel="noreferrer" aria-label={`Open owner reply photo ${index+1}`}>
            <img src={photo.photo_url} alt={`Owner reply photo ${index+1}`} className="h-24 w-24 rounded-lg border object-cover"/>
          </a>
          <p className="mt-1 text-xs">{photo.status==='pending'?'Waiting for moderation':
            photo.status==='moderated'?'Waiting for administrator':
            photo.status==='published'?'Published':'Not approved'}</p>
        </div>)}</div>
        }
      </div>
      {stage==='publish'&&row.status&&<p className="mt-1 text-xs font-semibold uppercase">{row.status}{row.archived_at?' (archived)':''}</p>}
      <div className="mt-3 flex gap-2">
        {(stage==='moderate'||row.status==='moderated')&&<>
          <button type="button" className="rounded-xl bg-teal-700 px-3 py-2 font-bold text-white" onClick={()=>void decide(row,true)}>{stage==='moderate'?'Approve and send to administration':'Give final approval and publish'}</button>
          <button type="button" className="pill" onClick={()=>void decide(row,false)}>Reject</button>
        </>}
        {stage==='publish'&&row.status!=='moderated'&&<button type="button" className="pill" onClick={()=>void archive(row,!row.archived_at)}>{row.archived_at?'Unarchive':'Archive'}</button>}
      </div>
    </article>)}</div>
    <div className="mt-4 flex gap-3">
      <PageCount offset={offset} total={total}/>{offset>0&&<button type="button" disabled={loading} className="pill" onClick={()=>setOffset(value=>Math.max(0,value-3))}>Previous replies</button>}
      {nextOffset!==null&&<button type="button" disabled={loading} className="pill" onClick={()=>setOffset(nextOffset)}>Next replies</button>}
    </div>
  </section>;
}
