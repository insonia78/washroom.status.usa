'use client';
import {useEffect,useState} from 'react';
import type {Session} from '@supabase/supabase-js';
import {browserSupabase} from '@/lib/supabase';
import {isPendingToilet,type PendingToilet} from '@/lib/moderation';
import {googleMapsLocationUrl} from '@/lib/navigation';
import NavigationLinks from '@/components/NavigationLinks';

export default function ToiletModerationQueue({session,refresh}:{session:Session;refresh:number}){
  const [items,setItems]=useState<PendingToilet[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    setItems([]);setLoading(true);setError('');
    fetch('/api/backend/moderation/toilets',{
      headers:{Authorization:`Bearer ${session.access_token}`},signal:controller.signal,cache:'no-store',
    }).then(async response=>{
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not load toilet submissions.');
      if(!Array.isArray(data.submissions)||!data.submissions.every(isPendingToilet))throw new Error('Invalid toilet moderation queue response.');
      if(!controller.signal.aborted)setItems(data.submissions);
    }).catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:'Could not load toilet submissions.')})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    return()=>controller.abort();
  },[session,refresh]);

  async function decide(item:PendingToilet,decision:'approved'|'rejected'){
    if(busy)return;
    setBusy(true);setError('');setMessage('');
    try{
      const supabase=browserSupabase();
      if(!supabase)throw new Error('Moderator sign-in is not configured.');
      const {data,error}=await supabase.auth.getSession();
      if(error)throw error;
      if(!data.session)throw new Error('Your session has expired. Sign in again.');
      const response=await fetch('/api/backend/moderation/toilets',{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`},
        body:JSON.stringify({id:item.id,decision}),
      });
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||'Could not save toilet moderation decision.');
      if(result.submission?.id!==item.id||result.submission?.status!==decision)throw new Error('Invalid decision confirmation. Refresh the queue to verify.');
      setItems(previous=>previous.filter(row=>row.id!==item.id));
      setMessage(`Toilet ${decision}. ${decision==='approved'?'Approval records the verification only; map publication is a separate step.':'It remains private.'}`);
    }catch(error){setError(error instanceof Error?error.message:'Could not save toilet moderation decision.')}
    finally{setBusy(false)}
  }

  return <section aria-labelledby="toilet-moderation-heading" className="mt-6">
    <h2 id="toilet-moderation-heading" className="text-xl font-bold">Pending toilets</h2>
    <p className="mt-1 text-xs text-slate-500">Oldest first, up to 50. Verify the exact submitted GPS point before deciding. Approval does not automatically publish a listing.</p>
    {error&&<p role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
    {message&&<p role="status" className="mt-3 rounded-xl bg-teal-50 p-3 text-sm text-teal-900">{message}</p>}
    {loading?<p role="status" className="mt-4">Loading pending toilets...</p>:!error&&!items.length?<p className="panel mt-4">No pending toilets.</p>:null}
    <div className="mt-4 space-y-4">{items.map(item=><article key={item.id} className="panel">
      <h3 className="font-bold">{item.name}</h3>
      <p className="mt-1 break-words text-sm">Exact coordinates: {item.latitude}, {item.longitude}</p>
      <a href={googleMapsLocationUrl(item.latitude,item.longitude)} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex text-sm font-semibold text-teal-800 underline" aria-label={`View exact location of ${item.name} on Google Maps (opens in a new tab)`}>View exact location on Google Maps</a>
      <NavigationLinks latitude={item.latitude} longitude={item.longitude} name={item.name}/>
      <p className="mt-3 text-sm">Wheelchair accessible: {item.wheelchair} · Fee required: {item.fee}</p>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm">{item.notes||'No access details provided.'}</p>
      <p className="mt-2 text-xs text-slate-500">Submitted <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString('en-US')}</time></p>
      <div className="mt-3 flex gap-3"><button type="button" disabled={busy} onClick={()=>decide(item,'approved')} className="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white disabled:opacity-50">Approve toilet</button><button type="button" disabled={busy} onClick={()=>decide(item,'rejected')} className="rounded-xl border border-red-300 px-4 py-3 font-bold text-red-800 disabled:opacity-50">Reject toilet</button></div>
    </article>)}</div>
  </section>;
}
