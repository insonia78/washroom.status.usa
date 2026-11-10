'use client';
import PageCount from '@/components/PageCount';
import {useEffect,useRef,useState} from 'react';
import type {Session} from '@supabase/supabase-js';
import {browserSupabase} from '@/lib/supabase';
import {isAdminOwnerResponse,isEvidenceUrl,type AdminOwnerResponse} from '@/lib/owner-responses';

type Fields={osm_type:string;osm_id:string;review_id:string;business_name:string;body:string;completed_on:string;evidence_url:string;verification_note:string};
const emptyFields:Fields={osm_type:'node',osm_id:'',review_id:'',business_name:'',body:'',completed_on:'',evidence_url:'',verification_note:''};
const endpoint='/api/backend/admin/owner-responses';

export default function OwnerResponseDashboard({session}:{session:Session}){
  const [rows,setRows]=useState<AdminOwnerResponse[]>([]);
  const [ready,setReady]=useState(false);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [fields,setFields]=useState<Fields>(emptyFields);
  const [draft,setDraft]=useState<AdminOwnerResponse|null>(null);
  const [confirmed,setConfirmed]=useState(false);
  const [dirty,setDirty]=useState(false);
  const [page,setPage]=useState(0); const [total,setTotal]=useState<number|null>(null);
  const [next,setNext]=useState<number|null>(null);
  const [refresh,setRefresh]=useState(0);
  const [showArchived,setShowArchived]=useState(false);
  const lifetime=useRef<AbortController|null>(null);
  useEffect(()=>{
    const controller=new AbortController();lifetime.current=controller;
    return()=>{controller.abort();lifetime.current=null};
  },[]);
  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);setError('');setRows([]);setReady(false);
    fetch(`${endpoint}?offset=${page}&archived=${showArchived?1:0}`,{headers:{Authorization:`Bearer ${session.access_token}`},cache:'no-store',signal:controller.signal})
      .then(async response=>{
        const data=await response.json();
        if(!response.ok)throw new Error(data.error||'Could not load owner responses.');
        if(!Array.isArray(data.responses)||!data.responses.every(isAdminOwnerResponse)||
          (data.next_offset!==null&&data.next_offset!==page+3))throw new Error('Invalid admin response list.');
        if(!controller.signal.aborted){setTotal(typeof data.total==='number'?data.total:null);setRows(data.responses);setNext(data.next_offset);setReady(true)}
      }).catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:'Could not load owner responses.')})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    return()=>controller.abort();
  },[session.access_token,page,refresh,showArchived]);

  function edit(row:AdminOwnerResponse|null){
    setDraft(row);setConfirmed(false);setDirty(false);setError('');setMessage('');
    setFields(row?{osm_type:row.osm_type,osm_id:String(row.osm_id),review_id:row.review_id||'',business_name:row.business_name,body:row.body,
      completed_on:row.completed_on||'',evidence_url:row.evidence_url||'',verification_note:row.verification_note}:emptyFields);
  }
  async function archive(row:AdminOwnerResponse,archived:boolean){
    if(busy)return;
    setBusy(true);setError('');setMessage('');
    try{
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
        body:JSON.stringify({action:'archive',id:row.id,archived})});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||'Could not archive the response.');
      setMessage(archived?'Response archived.':'Response restored.');
      setRefresh(value=>value+1);
    }catch(error){setError(error instanceof Error?error.message:'Could not archive the response.')}
    finally{setBusy(false)}
  }
  function change(key:keyof Fields,value:string){setFields(previous=>({...previous,[key]:value}));setDirty(true)}
  async function save(action:'save'|'publish'){
    const controller=lifetime.current;
    if(busy||!controller||controller.signal.aborted)return;
    setBusy(true);setError('');setMessage('');
    try{
      if(action==='save'&&!confirmed)throw new Error('Confirm that the owner connection was verified offline.');
      if(action==='publish'&&(!draft||dirty))throw new Error('Save your latest changes as a draft before publishing.');
      if(action==='save'&&fields.evidence_url&&!isEvidenceUrl(fields.evidence_url))throw new Error('Evidence link must be HTTPS without credentials.');
      const supabase=browserSupabase();
      if(!supabase)throw new Error('Admin sign-in is not configured.');
      const {data,error}=await supabase.auth.getSession();
      if(error)throw error;
      if(!data.session||data.session.user.id!==session.user.id)throw new Error('Your session has changed. Sign in again.');
      const response=await fetch(endpoint,{
        method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`},
        body:JSON.stringify({action,id:draft?.id??null,version:draft?.version??null,
          ...(action==='save'?{fields:{...fields,osm_id:Number(fields.osm_id),review_id:fields.review_id||null,
            completed_on:fields.completed_on||null,evidence_url:fields.evidence_url||null}}:{})}),
      });
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||'Could not save the owner response.');
      if(!isAdminOwnerResponse(result.response)||result.response.status!==(action==='save'?'draft':'published'))throw new Error('Invalid saved response. Refresh to verify the result.');
      if(!controller.signal.aborted){
        const row=result.response;
        setRows(previous=>[row,...previous.filter(item=>item.id!==row.id)].slice(0,3));
        if(action==='save'){setDraft(row);setDirty(false)}else{edit(null)}
        setMessage(action==='save'?'Draft saved. It is not public. Review it, then choose Publish saved draft.':'Owner response published. It is now visible in the restroom details.');
      }
    }catch(error){if(!controller.signal.aborted)setError(error instanceof Error?error.message:'Could not save the owner response.')}
    finally{if(!controller.signal.aborted)setBusy(false)}
  }
  return <>
    {error&&<p role="alert" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
    {message&&<p role="status" className="mt-4 rounded-xl bg-teal-50 p-3 text-sm">{message}</p>}
    {loading?<p role="status" className="mt-4">Checking admin access and loading responses...</p>:!ready?<button type="button" className="pill mt-4" onClick={()=>setRefresh(value=>value+1)}>Retry admin access</button>:<>
      <form className="panel mt-5 space-y-4" onSubmit={event=>{event.preventDefault();void save('save')}} aria-label="Owner response editor">
        <h2 className="text-xl font-bold">{draft?'Edit owner response draft':'New owner response draft'}</h2>
        <p className="text-sm text-slate-600">Contact the owner offline and verify their connection to this business. Only the business name, response, improvement date and evidence link are public. Keep personal contact information in the private verification note.</p>
        <fieldset disabled={busy} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold">Listing source<select value={fields.osm_type} onChange={event=>change('osm_type',event.target.value)} className="mt-1 w-full rounded-lg border p-2">{['node','way','relation','refuge'].map(value=><option key={value} value={value}>{value==='refuge'?'Refuge Restrooms':`OpenStreetMap ${value}`}</option>)}</select></label>
            <label className="block text-sm font-semibold">Listing ID<input required type="number" min="1" step="1" value={fields.osm_id} onChange={event=>change('osm_id',event.target.value)} className="mt-1 w-full rounded-lg border p-2"/></label>
          </div>
          <p className="text-xs text-slate-600">Use the source and ID shown in restroom details. For newly listed businesses or Refuge locations, run a location search first.</p>
          <label className="block text-sm font-semibold">Review ID (optional)<input value={fields.review_id} pattern="[0-9a-fA-F-]{36}" onChange={event=>change('review_id',event.target.value)} className="mt-1 w-full rounded-lg border p-2"/><span className="mt-1 block text-xs font-normal text-slate-600">Leave blank for a restroom-level improvement update. A reply must reference an approved review for this exact listing.</span></label>
          <label className="block text-sm font-semibold">Public business name<input required maxLength={200} value={fields.business_name} onChange={event=>change('business_name',event.target.value)} className="mt-1 w-full rounded-lg border p-2"/></label>
          <label className="block text-sm font-semibold">Owner reply or improvement update<textarea required maxLength={4000} value={fields.body} onChange={event=>change('body',event.target.value)} className="mt-1 min-h-32 w-full rounded-lg border p-2"/></label>
          <label className="block text-sm font-semibold">Completed improvement date (optional)<input type="date" max={new Date().toISOString().slice(0,10)} value={fields.completed_on} onChange={event=>change('completed_on',event.target.value)} className="mt-1 w-full rounded-lg border p-2"/></label>
          <label className="block text-sm font-semibold">Supporting evidence link (optional)<input type="url" maxLength={2000} placeholder="https://" value={fields.evidence_url} onChange={event=>change('evidence_url',event.target.value)} className="mt-1 w-full rounded-lg border p-2"/></label>
          <label className="block text-sm font-semibold">Private owner verification note<textarea required maxLength={2000} value={fields.verification_note} onChange={event=>change('verification_note',event.target.value)} className="mt-1 min-h-24 w-full rounded-lg border p-2"/></label>
          <label className="flex items-start gap-2 text-sm"><input required type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} className="mt-1"/>I verified the owner's connection to this business offline and checked the response for private information.</label>
          <div className="flex flex-wrap gap-3">
            <button type="submit" className="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white disabled:opacity-50" disabled={busy}>Save draft</button>
            {draft&&<button type="button" disabled={busy||dirty} onClick={()=>void save('publish')} className="rounded-xl border border-teal-700 px-4 py-3 font-bold text-teal-800 disabled:opacity-50">Publish saved draft</button>}
            <button type="button" className="pill" onClick={()=>edit(null)}>New draft / clear editor</button>
          </div>
        </fieldset>
      </form>
      <section className="mt-6" aria-label="Saved owner responses">
        <h2 className="text-xl font-bold">Saved owner responses</h2>
        <button type="button" disabled={busy} onClick={()=>setRefresh(value=>value+1)} className="pill mt-2">Refresh responses</button>
        <button type="button" disabled={busy} onClick={()=>{setPage(0);setShowArchived(value=>!value)}} className="pill mt-2 ml-2">{showArchived?'Show active responses':'Show archived responses'}</button>
        <p className="mt-2 text-xs text-slate-600">Newest updated first, 3 per page. Published responses are read-only; publish a new update to add further progress.</p>
        {!rows.length&&<p className="mt-3 text-sm">{showArchived?'No archived owner responses.':'No saved owner responses.'}</p>}
        {rows.map(row=><article key={row.id} className="panel mt-3">
          <h3 className="font-bold">{row.business_name} - {row.status}</h3>
          <p className="mt-1 break-all text-xs">{row.osm_type} #{row.osm_id} {row.review_id?`- Reply to review ${row.review_id}`:'- Restroom improvement update'}</p>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm">{row.body}</p>
          {row.completed_on&&<p className="mt-2 text-sm">Completed: {row.completed_on}</p>}
          {row.evidence_url&&<a href={row.evidence_url} target="_blank" rel="noopener noreferrer" className="mt-2 block break-all text-sm text-teal-800 underline">Evidence: {row.evidence_url}</a>}
          <p className="mt-2 whitespace-pre-wrap break-words text-sm">Private verification: {row.verification_note}</p>
          <p className="mt-2 text-xs">Updated <time dateTime={row.updated_at}>{new Date(row.updated_at).toLocaleString()}</time> - Version {row.version}</p>
          <button type="button" disabled={busy} className="pill mt-3 mr-2" onClick={()=>void archive(row,!showArchived)}>{showArchived?'Restore':'Archive'}</button>
          {row.status==='draft'&&<button type="button" disabled={busy} className="pill mt-3" onClick={()=>edit(row)}>Edit draft</button>}
        </article>)}
        <div className="mt-4 flex gap-3">
          <PageCount offset={page} total={total}/>{page>0&&<button disabled={busy} type="button" className="pill" onClick={()=>setPage(value=>Math.max(0,value-3))}>Previous page</button>}
          {next!==null&&<button disabled={busy} type="button" className="pill" onClick={()=>setPage(next)}>Next page</button>}
        </div>
      </section>
    </>}
  </>;
}
