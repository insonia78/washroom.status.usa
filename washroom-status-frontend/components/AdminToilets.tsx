'use client';
import {useEffect,useState} from 'react';
import type {Session} from '@supabase/supabase-js';

type AdminToilet={
  id:string;user_id:string|null;name:string;latitude:number;longitude:number;wheelchair:string;fee:string;
  notes:string;photo_urls:string[];status:'pending'|'approved'|'rejected';created_at:string;archived_at:string|null;
};
const record=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null;
const isAdminToilet=(value:unknown):value is AdminToilet=>record(value)&&typeof value.id==='string'&&
  (value.user_id===null||typeof value.user_id==='string')&&typeof value.name==='string'&&
  typeof value.latitude==='number'&&typeof value.longitude==='number'&&
  typeof value.wheelchair==='string'&&typeof value.fee==='string'&&typeof value.notes==='string'&&
  Array.isArray(value.photo_urls)&&value.photo_urls.every(url=>typeof url==='string')&&
  typeof value.status==='string'&&['pending','approved','rejected'].includes(value.status)&&
  typeof value.created_at==='string'&&(value.archived_at===null||typeof value.archived_at==='string');

export default function AdminToilets({session}:{session:Session}){
  const [rows,setRows]=useState<AdminToilet[]>([]);
  const [offset,setOffset]=useState(0);
  const [next,setNext]=useState<number|null>(null);
  const [refresh,setRefresh]=useState(0);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [showArchived,setShowArchived]=useState(false);
  const [showPending,setShowPending]=useState(false);
  const headers={Authorization:`Bearer ${session.access_token}`};
  const archive=async(row:AdminToilet)=>{
    setError('');
    try{
      const response=await fetch('/api/backend/admin/toilets',{
        method:'POST',cache:'no-store',headers:{...headers,'Content-Type':'application/json'},
        body:JSON.stringify({toilet_id:row.id,archived:!row.archived_at}),
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not update the toilet archive.');
      setRefresh(value=>value+1);
    }catch(error){setError(error instanceof Error?error.message:'Could not update the toilet archive.')}
  };
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');setRows([]);
    fetch(`/api/backend/admin/toilets?offset=${offset}&archived=${showArchived?1:0}&moderation=${showPending?'pending':'moderated'}`,{
      headers,cache:'no-store',signal:controller.signal,
    }).then(async response=>{
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not load added toilets.');
      if(!Array.isArray(data.toilets)||!data.toilets.every(isAdminToilet)||
        (data.next_offset!==null&&data.next_offset!==offset+50))throw new Error('Invalid admin toilet list.');
      if(!controller.signal.aborted){setRows(data.toilets);setNext(data.next_offset)}
    }).catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:'Could not load added toilets.')})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    return()=>controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[session.access_token,offset,refresh,showArchived,showPending]);
  const reset=()=>setOffset(0);
  return <section className="panel mt-5" aria-label="Added toilet administration">
    <h2 className="text-xl font-bold">Added toilets administration</h2>
    <p className="mt-2 text-sm">Toilets submitted by users. Submitter identities are shown as user IDs, never email addresses.</p>
    <button type="button" className="pill mt-3" disabled={loading} onClick={()=>setRefresh(value=>value+1)}>Refresh toilets</button>
    <button type="button" className="pill mt-3 ml-2" disabled={loading} onClick={()=>{setShowArchived(value=>!value);reset()}}>{showArchived?'Show active toilets':'Show archived toilets'}</button>
    <button type="button" className="pill mt-3 ml-2" disabled={loading} onClick={()=>{setShowPending(value=>!value);reset()}}>{showPending?'Show moderated toilets':'Show toilets not moderated yet'}</button>
    {showPending&&<p className="mt-2 text-sm text-amber-900">These toilets have not been moderated yet. A moderator must approve or reject them before they appear in the main administrator list.</p>}
    {error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {loading?<p role="status" className="mt-3">Loading added toilets...</p>:!error&&<>
      {!rows.length&&<p className="mt-3 text-sm">No toilets found.</p>}
      <div className="mt-4 space-y-3">{rows.map(row=><article key={row.id} className="rounded-xl border p-3">
        <h3 className="font-bold">{row.name} - {row.status==='pending'?'Not moderated yet':row.status}</h3>
        <p className="mt-1 text-xs text-slate-500">Submitted <time dateTime={row.created_at}>{new Date(row.created_at).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'})}</time></p>
        <p className="mt-1 break-all text-xs">Toilet ID: {row.id}</p>
        <p className="mt-1 break-all text-xs">User ID: {row.user_id??'No account (deleted)'}</p>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="font-semibold">Location</dt><dd>{row.latitude.toFixed(5)}, {row.longitude.toFixed(5)}</dd></div>
          <div><dt className="font-semibold">Wheelchair accessible</dt><dd className="capitalize">{row.wheelchair}</dd></div>
          <div><dt className="font-semibold">Fee</dt><dd className="capitalize">{row.fee}</dd></div>
        </dl>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm">{row.notes||'No notes.'}</p>
        {row.photo_urls.length>0&&<div className="mt-3 grid grid-cols-3 gap-2">{row.photo_urls.map((url,index)=><a key={`${row.id}-${index}`} href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open toilet photo ${index+1}`}><img src={url} alt={`Photo ${index+1} attached to toilet`} className="aspect-square w-full rounded-lg object-cover"/></a>)}</div>}
        {row.status==='pending'?<p className="mt-3 text-sm font-semibold text-amber-900">Not moderated yet - archiving unlocks after moderation.</p>:
          <button type="button" className="pill mt-3" onClick={()=>void archive(row)}>{row.archived_at?'Unarchive':'Archive'}</button>}
      </article>)}</div>
      <div className="mt-3 flex gap-2">
        {offset>0&&<button type="button" className="pill" onClick={()=>setOffset(value=>Math.max(0,value-50))}>Previous toilets</button>}
        {next!==null&&<button type="button" className="pill" onClick={()=>setOffset(next)}>More toilets</button>}
      </div>
    </>}
  </section>;
}
