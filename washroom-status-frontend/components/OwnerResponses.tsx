'use client';
import {useEffect,useState} from 'react';
import type {Restroom} from '@/components/RestroomDetails';
import {isOwnerResponse,type OwnerResponse} from '@/lib/owner-responses';

export default function OwnerResponses({restroom}:{restroom:Restroom}){
  const [rows,setRows]=useState<OwnerResponse[]>([]);
  const [offset,setOffset]=useState(0);
  const [next,setNext]=useState<number|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);setError('');
    fetch(`/api/backend/owner-responses?osm_type=${restroom.osm_type}&osm_id=${restroom.id}&offset=${offset}`,{cache:'no-store',signal:controller.signal})
      .then(async response=>{
        const data=await response.json();
        if(!response.ok)throw new Error(data.error||'Could not load owner responses.');
        if(!Array.isArray(data.responses)||!data.responses.every((row:unknown)=>isOwnerResponse(row)&&row.published_at!==null&&row.osm_type===restroom.osm_type&&row.osm_id===restroom.id)||
          (data.next_offset!==null&&data.next_offset!==offset+50))throw new Error('Invalid owner response list.');
        if(!controller.signal.aborted){
          setRows(previous=>offset===0?data.responses:[...previous,...data.responses.filter((row:OwnerResponse)=>!previous.some(item=>item.id===row.id))]);
          setNext(data.next_offset);
        }
      }).catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:'Could not load owner responses.')})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    return()=>controller.abort();
  },[restroom.osm_type,restroom.id,offset,attempt]);
  return <section className="mt-6 border-t border-slate-200 pt-4" aria-label="Owner responses and improvements">
    <h3 className="text-lg font-bold">Owner responses and improvements</h3>
    <p className="mt-1 text-xs text-slate-600">Submitted by owners offline and published by an administrator after checking their connection to the business. Improvement claims and evidence are owner-provided, not independent inspections.</p>
    {rows.map(row=><article key={row.id} className="mt-3 rounded-xl border border-teal-200 bg-teal-50 p-3">
      <h4 className="font-bold">{row.business_name} - {row.review_id?'Owner reply':'Improvement update'}</h4>
      {row.review_id&&<p className="mt-1 break-all text-xs text-slate-600">Reply to review #{row.review_id}</p>}
      <p className="mt-2 whitespace-pre-wrap break-words text-sm">{row.body}</p>
      {row.completed_on&&<p className="mt-2 text-xs">Improvements completed: <time dateTime={row.completed_on}>{row.completed_on}</time></p>}
      {row.evidence_url&&<a href={row.evidence_url} target="_blank" rel="noopener noreferrer" className="mt-2 block text-sm text-teal-800 underline">View owner-provided evidence (external website)</a>}
      <p className="mt-2 text-xs text-slate-500">Published <time dateTime={row.published_at!}>{new Date(row.published_at!).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'})}</time></p>
    </article>)}
    {loading&&<p role="status" className="mt-3 text-sm">Loading owner responses...</p>}
    {error&&<div role="alert" className="mt-3 text-sm text-amber-800">{error} <button type="button" className="underline" onClick={()=>setAttempt(value=>value+1)}>Retry owner responses</button></div>}
    {!loading&&!error&&rows.length===0&&<p className="mt-3 text-sm text-slate-500">No published owner responses yet.</p>}
    {!loading&&!error&&next!==null&&<button type="button" className="pill mt-3" onClick={()=>setOffset(next)}>Load more owner responses</button>}
  </section>;
}
