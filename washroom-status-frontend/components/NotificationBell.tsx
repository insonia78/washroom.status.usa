'use client';

import {Bell} from 'lucide-react';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {Session} from '@supabase/supabase-js';

type Category='reviews'|'responses'|'toilets';
type Counts=Record<Category,number>;
const labels:Record<Category,string>={reviews:'Reviews awaiting moderation',responses:'Owner responses awaiting review',toilets:'Toilet additions awaiting review'};

export default function NotificationBell({session,role,onSelect}:{session:Session;role:'admin'|'moderator';onSelect:(category:Category)=>void}){
  const [counts,setCounts]=useState<Counts|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [open,setOpen]=useState(false);
  const activeRequest=useRef<AbortController|null>(null);

  const refresh=useCallback(async(signal:AbortSignal)=>{
    setLoading(true);setError('');
    const paths:Record<Category,string>=role==='moderator'?{
      reviews:'/api/backend/moderation/reviews?offset=0',
      responses:'/api/backend/moderation/owner-replies?offset=0',
      toilets:'/api/backend/moderation/toilets?offset=0',
    }:{
      reviews:'/api/backend/admin/reviews?moderation=pending&offset=0',
      responses:'/api/backend/admin/owner-replies?awaiting_admin=1&offset=0',
      toilets:'/api/backend/admin/toilets?moderation=awaiting_admin&offset=0',
    };
    try{
      const entries=await Promise.all((Object.entries(paths) as [Category,string][]).map(async([category,path])=>{
        const response=await fetch(path,{headers:{Authorization:`Bearer ${session.access_token}`},cache:'no-store',signal});
        const data=await response.json();
        if(!response.ok)throw new Error(data.error||`Could not load ${labels[category].toLowerCase()}.`);
        if(!Number.isSafeInteger(data.total)||data.total<0)throw new Error(`Invalid count for ${labels[category].toLowerCase()}.`);
        return [category,data.total] as const;
      }));
      if(!signal.aborted){
        const nextCounts:Counts={reviews:0,responses:0,toilets:0};
        for(const [category,count] of entries)nextCounts[category]=count;
        setCounts(nextCounts);
      }
    }catch(cause){
      if(!signal.aborted)setError(cause instanceof Error?cause.message:'Could not load notifications.');
    }finally{
      if(!signal.aborted)setLoading(false);
    }
  },[role,session.access_token]);

  useEffect(()=>{
    let controller=new AbortController();
    activeRequest.current=controller;
    const update=()=>{activeRequest.current?.abort();controller=new AbortController();activeRequest.current=controller;void refresh(controller.signal)};
    void refresh(controller.signal);
    const interval=window.setInterval(()=>{if(document.visibilityState==='visible')update()},30_000);
    window.addEventListener('focus',update);
    return()=>{activeRequest.current?.abort();activeRequest.current=null;window.clearInterval(interval);window.removeEventListener('focus',update)};
  },[refresh,session.access_token]);

  const total=counts?counts.reviews+counts.responses+counts.toilets:0;
  return <div className="relative">
    <button type="button" className="relative rounded-xl px-3 py-2" aria-label={`Notifications${counts?`, ${total} pending items`:''}`}
      aria-expanded={open} aria-controls="dashboard-notifications" onClick={()=>setOpen(value=>!value)}>
      <Bell size={20} aria-hidden="true"/>
      {total>0&&<span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1 text-center text-xs font-bold leading-5 text-white" aria-hidden="true">{total>99?'99+':total}</span>}
    </button>
    {open&&<section id="dashboard-notifications" aria-label="Pending notifications" className="absolute right-0 z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-3 text-slate-900 shadow-xl">
      <h2 className="font-bold">Pending notifications</h2>
      {error&&<p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      {loading&&!counts&&<p role="status" className="mt-2 text-sm text-slate-600">Loading notifications...</p>}
      {counts&&<ul className="mt-2 space-y-1">
        {(Object.keys(labels) as Category[]).map(category=><li key={category}>
          <button type="button" disabled={counts[category]===0} onClick={()=>{onSelect(category);setOpen(false)}}
            className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm disabled:cursor-default disabled:opacity-60">
            <span>{labels[category]}</span><span className="ml-3 font-bold tabular-nums">{counts[category]}</span>
          </button>
        </li>)}
      </ul>}
      <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2">
        {!loading&&counts&&total===0&&<p className="text-sm text-slate-600">Nothing is waiting for review.</p>}
        <button type="button" className="ml-auto rounded-lg px-2 py-1 text-sm font-semibold" disabled={loading}
          onClick={()=>{activeRequest.current?.abort();const controller=new AbortController();activeRequest.current=controller;void refresh(controller.signal)}}>Refresh</button>
      </div>
    </section>}
  </div>;
}
