'use client';
import {useEffect,useRef,useState} from 'react';
import type {Session} from '@supabase/supabase-js';
import {isAdminReview,type AdminReview,type ReviewStage} from '@/lib/review-replies';
import {AdminReviewCard,ReplyEditor} from './AdminReviewReplies';
import {AdminToiletCard,isAdminToilet,type AdminToilet,type ToiletStage} from './AdminToilets';

const boardLimit=25;
const reviewColumns:{id:ReviewStage;label:string;hint:string}[]=[
  {id:'moderation',label:'1. Moderation',hint:'Waiting for a moderator decision'},
  {id:'administration',label:'2. Administration review',hint:'Moderated - no owner invite or reply yet'},
  {id:'waiting_owner',label:'3. Waiting for owner',hint:'Owner invited - no reply yet'},
  {id:'owner_reply',label:'4. Owner reply in review',hint:'Owner reply waiting for moderator or administrator'},
  {id:'completed',label:'5. Completed',hint:'Owner reply published or private reply emailed'},
  {id:'archived',label:'Archived',hint:'Removed from the active workflow'},
];
const toiletColumns:{id:ToiletStage;label:string;hint:string}[]=[
  {id:'moderation',label:'1. Moderation',hint:'Waiting for a moderator decision'},
  {id:'awaiting_admin',label:'2. Final approval',hint:'Moderator approved - waiting for an administrator'},
  {id:'published',label:'3. Published on map',hint:'Visible to the public'},
  {id:'rejected',label:'Rejected',hint:'Rejected by a moderator'},
  {id:'archived',label:'Archived',hint:'Removed from the active workflow'},
];
const reviewStageOf=(row:AdminReview):ReviewStage=>row.stage??(row.archived_at?'archived':row.status==='pending'?'moderation':'administration');
const toiletStageOf=(row:AdminToilet):ToiletStage=>row.stage??(row.archived_at?'archived':row.status==='pending'?'moderation':
  row.status==='rejected'?'rejected':row.published_at?'published':'awaiting_admin');
const shortDate=(value:string)=>new Date(value).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});

type Board={reviews:AdminReview[];toilets:AdminToilet[];reviewTotals:[number|null,number|null];toiletTotals:[number|null,number|null]};
type Selected={kind:'review'|'toilet';id:string};

async function load(path:string,key:'reviews'|'toilets',session:Session,signal:AbortSignal){
  const response=await fetch(path,{headers:{Authorization:`Bearer ${session.access_token}`},cache:'no-store',signal});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||`Could not load ${key}.`);
  const valid=key==='reviews'?isAdminReview:isAdminToilet;
  if(!Array.isArray(data[key])||!data[key].every(valid)||(data.next_offset!==null&&data.next_offset!==boardLimit))throw new Error(`Invalid ${key} board.`);
  return {rows:data[key] as unknown[],total:typeof data.total==='number'?data.total:null};
}

function Column({label,hint,count,children}:{label:string;hint:string;count:number;children:React.ReactNode}){
  return <section aria-label={label} className="flex w-64 shrink-0 flex-col rounded-xl border bg-slate-50">
    <header className="rounded-t-xl border-b bg-teal-700 px-3 py-2 text-white">
      <h4 className="flex items-center justify-between gap-2 text-sm font-bold">{label}<span className="rounded-full bg-white px-2 text-xs text-teal-800">{count}</span></h4>
      <p className="text-xs text-teal-50">{hint}</p>
    </header>
    <div className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto p-2">
      {count?children:<p className="p-2 text-xs text-slate-500">No tickets</p>}
    </div>
  </section>;
}

function Ticket({title,lines,badges,onOpen}:{title:string;lines:string[];badges:string[];onOpen:(opener:HTMLButtonElement)=>void}){
  return <button type="button" onClick={event=>onOpen(event.currentTarget)}
    className="ticket w-full rounded-lg border bg-white p-2 text-left shadow-sm hover:shadow focus:outline-none focus:ring-2 focus:ring-teal-700">
    <span className="block break-words text-sm font-semibold">{title}</span>
    {lines.map(line=><span key={line} className="mt-0.5 block break-words text-xs text-slate-600">{line}</span>)}
    {!!badges.length&&<span className="mt-1 flex flex-wrap gap-1">{badges.map(badge=><span key={badge} className="rounded bg-teal-50 px-1.5 py-0.5 text-[11px] text-teal-900">{badge}</span>)}</span>}
  </button>;
}

export default function AdminWorkflowBoard({session,onInviteOwner,reloadSignal=0}:{
  session:Session;
  onInviteOwner:(reviewId:string,opener:HTMLButtonElement)=>void;
  reloadSignal?:number;
}){
  const [board,setBoard]=useState<Board|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [refresh,setRefresh]=useState(0);
  const [selected,setSelected]=useState<Selected|null>(null);
  const opener=useRef<HTMLButtonElement|null>(null);
  const dialog=useRef<HTMLDivElement|null>(null);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');
    const query=(archived:0|1)=>`limit=${boardLimit}&moderation=all&archived=${archived}`;
    Promise.all([
      load(`/api/backend/admin/reviews?${query(0)}`,'reviews',session,controller.signal),
      load(`/api/backend/admin/reviews?${query(1)}`,'reviews',session,controller.signal),
      load(`/api/backend/admin/toilets?${query(0)}`,'toilets',session,controller.signal),
      load(`/api/backend/admin/toilets?${query(1)}`,'toilets',session,controller.signal),
    ]).then(([activeReviews,archivedReviews,activeToilets,archivedToilets])=>{
      if(controller.signal.aborted)return;
      setBoard({
        reviews:[...activeReviews.rows,...archivedReviews.rows] as AdminReview[],
        toilets:([...activeToilets.rows,...archivedToilets.rows] as AdminToilet[]).map(row=>({...row,published_at:row.published_at??null})),
        reviewTotals:[activeReviews.total,archivedReviews.total],
        toiletTotals:[activeToilets.total,archivedToilets.total],
      });
    }).catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:'Could not load the workflow board.')})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    return()=>controller.abort();
  },[session,refresh,reloadSignal]);
  useEffect(()=>{if(selected)dialog.current?.focus()},[selected]);
  const review=selected?.kind==='review'?board?.reviews.find(row=>row.id===selected.id):undefined;
  const toilet=selected?.kind==='toilet'?board?.toilets.find(row=>row.id===selected.id):undefined;
  useEffect(()=>{if(board&&selected&&!review&&!toilet)setSelected(null)},[board,selected,review,toilet]);
  const open=(kind:Selected['kind'],id:string)=>(button:HTMLButtonElement)=>{opener.current=button;setSelected({kind,id})};
  const close=()=>{setSelected(null);opener.current?.focus()};
  const truncated=(totals:[number|null,number|null])=>totals.some(total=>total!==null&&total>boardLimit);
  const stageLabel=review?reviewColumns.find(column=>column.id===reviewStageOf(review))?.label:
    toilet?toiletColumns.find(column=>column.id===toiletStageOf(toilet))?.label:'';
  return <section className="panel mt-5" aria-label="Workflow board">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-xl font-bold">Workflow board</h2>
        <p className="mt-1 text-sm text-slate-600">Every review and submitted toilet as a ticket in its current step. Select a ticket to see its details, photos, steps taken and actions.</p>
      </div>
      <button type="button" disabled={loading} onClick={()=>setRefresh(value=>value+1)} className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{loading?'Refreshing...':'Refresh board'}</button>
    </div>
    {error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {loading&&!board?<p role="status" className="mt-3">Loading the workflow board...</p>:board&&<>
      <h3 className="mt-5 text-lg font-bold">Reviews</h3>
      {truncated(board.reviewTotals)&&<p className="mt-1 text-xs text-slate-600">Showing the newest {boardLimit} active and {boardLimit} archived reviews. Use the List view for older reviews.</p>}
      <div className="mt-2 flex gap-3 overflow-x-auto pb-3" role="list" aria-label="Review workflow steps">
        {reviewColumns.map(column=>{
          const rows=board.reviews.filter(row=>reviewStageOf(row)===column.id);
          return <div role="listitem" key={column.id}><Column label={column.label} hint={column.hint} count={rows.length}>
            {rows.map(row=><Ticket key={row.id} onOpen={open('review',row.id)}
              title={row.restroom_name||`${row.osm_type} #${row.osm_id}`}
              lines={[`${row.rating}/5 - ${row.status==='pending'?'not moderated':row.status}`,`Submitted ${shortDate(row.created_at)}`]}
              badges={[
                ...(row.photo_urls.length?[`${row.photo_urls.length} photo${row.photo_urls.length===1?'':'s'}`]:[]),
                ...(row.owner_replies?.length?[`${row.owner_replies.length} owner repl${row.owner_replies.length===1?'y':'ies'}`]:[]),
                ...(row.user_id===null?['Anonymous']:[]),
              ]}/>)}
          </Column></div>;
        })}
      </div>
      <h3 className="mt-5 text-lg font-bold">Submitted toilets</h3>
      {truncated(board.toiletTotals)&&<p className="mt-1 text-xs text-slate-600">Showing the newest {boardLimit} active and {boardLimit} archived toilets. Use the List view for older toilets.</p>}
      <div className="mt-2 flex gap-3 overflow-x-auto pb-3" role="list" aria-label="Toilet workflow steps">
        {toiletColumns.map(column=>{
          const rows=board.toilets.filter(row=>toiletStageOf(row)===column.id);
          return <div role="listitem" key={column.id}><Column label={column.label} hint={column.hint} count={rows.length}>
            {rows.map(row=><Ticket key={row.id} onOpen={open('toilet',row.id)} title={row.name}
              lines={[`${row.latitude.toFixed(4)}, ${row.longitude.toFixed(4)}`,`Submitted ${shortDate(row.created_at)}`]}
              badges={row.photo_urls.length?[`${row.photo_urls.length} photo${row.photo_urls.length===1?'':'s'}`]:[]}/>)}
          </Column></div>;
        })}
      </div>
    </>}
    {(review||toilet)&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={close}>
      <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="ticket-title"
        onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();close()}}}
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-4 shadow-xl focus:outline-none" onClick={event=>event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id="ticket-title" className="text-lg font-bold">{review?'Review ticket':'Toilet ticket'}</h3>
            <p className="text-sm text-slate-600">Current step: <span className="font-semibold text-teal-800">{stageLabel}</span></p>
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={loading} className="pill" onClick={()=>setRefresh(value=>value+1)}>Refresh</button>
            <button type="button" className="pill" onClick={close}>Close</button>
          </div>
        </div>
        <div className="mt-3">
          {review&&<>
            <AdminReviewCard key={review.id} row={review} session={session} onInviteOwner={onInviteOwner} onChanged={()=>setRefresh(value=>value+1)}/>
            {review.status!=='pending'&&<ReplyEditor key={`${review.id}:${session.access_token}`} review={review} session={session}/>}
          </>}
          {toilet&&<AdminToiletCard key={toilet.id} row={toilet} session={session} onChanged={()=>setRefresh(value=>value+1)}/>}
        </div>
      </div>
    </div>}
  </section>;
}
