'use client';
import NotFoundView from '@/components/NotFoundView';
import {useEffect,useRef,useState} from 'react';
import type {Session} from '@supabase/supabase-js';
import {browserSupabase} from '@/lib/supabase';
import AdminReviewReplies from '@/components/AdminReviewReplies';
import AdminToilets from '@/components/AdminToilets';
import AdminWorkflowBoard from '@/components/AdminWorkflowBoard';
import AdminOwnerInvites from '@/components/AdminOwnerInvites';
import OwnerReplyQueue from '@/components/OwnerReplyQueue';
import NotificationBell from '@/components/NotificationBell';
import OwnerResponseDashboard from '@/components/AdminOwnerResponseDashboard';

const tabs=[{id:'moderation',label:'Reviews & submitted toilets'},{id:'responses',label:'Owner responses'},{id:'replies',label:'Owner replies'}] as const;
const endpoint='/api/backend/admin/owner-responses';

export default function AdminPage(){
  const supabase=browserSupabase();
  const [session,setSession]=useState<Session|null>(null);
  const [checking,setChecking]=useState(true);
  const [email,setEmail]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [denied,setDenied]=useState(false);
  const [checked,setChecked]=useState(false);
  const [tab,setTab]=useState<(typeof tabs)[number]['id']>('moderation');
  const [view,setView]=useState<'board'|'list'>('board');
  const [reload,setReload]=useState(0);
  const [inviteClosed,setInviteClosed]=useState(0);
  const [inviteReviewId,setInviteReviewId]=useState<string|null>(null);
  const inviteOpener=useRef<HTMLButtonElement|null>(null);
  useEffect(()=>{
    if(!session)return;
    const controller=new AbortController();
    fetch(`${endpoint}?offset=0`,{headers:{Authorization:`Bearer ${session.access_token}`},cache:'no-store',signal:controller.signal})
      .then(response=>{if(response.status===403)setDenied(true)}).catch(()=>{}).finally(()=>{if(!controller.signal.aborted)setChecked(true)});
    return()=>controller.abort();
  },[session]);
  useEffect(()=>{
    if(!supabase){setChecking(false);setError('Admin sign-in is not configured. Set the public Supabase URL and anonymous key.');return}
    let active=true;
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,current)=>{if(active){setSession(current);setChecking(false)}});
    supabase.auth.getSession().then(({data,error})=>{
      if(error)throw error;
      if(active)setSession(data.session);
    }).catch(error=>{if(active)setError(error instanceof Error?error.message:'Could not check sign-in.')})
      .finally(()=>{if(active)setChecking(false)});
    return()=>{active=false;subscription.unsubscribe()};
  },[supabase]);
  async function signIn(event:React.FormEvent){
    event.preventDefault();if(!supabase)return;
    setBusy(true);setError('');setMessage('');
    try{
      const {error}=await supabase.auth.signInWithOtp({email,options:{shouldCreateUser:false,emailRedirectTo:`${window.location.origin}/admin`}});
      if(error)throw error;
      setMessage('Check your email. Only existing verified accounts on the separate admin allowlist can use this dashboard.');
    }catch(error){setError(error instanceof Error?error.message:'Could not send sign-in link.')}
    finally{setBusy(false)}
  }
  async function signOut(){
    if(!supabase)return;
    setBusy(true);setError('');setMessage('');
    try{
      const {error}=await supabase.auth.signOut();
      if(error)throw error;
      setSession(null);
    }catch(error){setError(error instanceof Error?error.message:'Could not sign out.')}
    finally{setBusy(false)}
  }
  if(denied)return <NotFoundView/>;
  return <main className="admin-dashboard mx-auto max-w-7xl px-4 py-7">
    <a href="/" className="text-sm text-teal-800 underline">Back to restroom search</a>
    <h1 className="mt-5 text-3xl font-extrabold">Restroom administration</h1>
    <p className="mt-2 text-sm text-slate-600">Admin-only dashboard for private replies to reviewers, verified public owner replies and improvement updates. Review moderator access does not grant admin access.</p>
    {error&&<p role="alert" className="mt-4 text-amber-800">{error}</p>}
    {message&&<p role="status" className="mt-4 text-sm">{message}</p>}
    {checking||(session&&!checked)?<p role="status" className="mt-4">Checking access...</p>:session?<>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">Signed in as {session.user.email}</p>
        <div className="flex items-center gap-3">
          <NotificationBell key={`bell:${reload}`} session={session} role="admin" onSelect={category=>setTab(category==='responses'?'replies':'moderation')}/>
          <button type="button" disabled={busy} onClick={()=>void signOut()} className="pill">Sign out</button>
        </div>
      </div>
      <nav role="tablist" aria-label="Administration sections" className="sticky top-0 z-10 mt-5 flex flex-wrap items-center gap-2 rounded-xl border bg-white/95 p-2 shadow-sm">
        {tabs.map(item=><button key={item.id} type="button" role="tab" aria-selected={tab===item.id} onClick={()=>setTab(item.id)} className={`rounded-lg px-4 py-2 text-sm font-bold ${tab===item.id?'bg-teal-700 text-white':'text-teal-900 hover:bg-teal-50'}`}>{item.label}</button>)}
        <button type="button" onClick={()=>setReload(value=>value+1)} aria-label="Refresh this section and notifications"
          className="ml-auto rounded-lg bg-teal-700 px-4 py-2 text-sm font-bold text-white">Refresh</button>
      </nav>
      {tab==='moderation'&&<>
        <div role="group" aria-label="Reviews and toilets view" className="mt-5 inline-flex rounded-xl border bg-white p-1">
          {([['board','Board'],['list','List']] as const).map(([value,label])=><button key={value} type="button" aria-pressed={view===value} onClick={()=>setView(value)}
            className={`rounded-lg px-4 py-1.5 text-sm font-bold ${view===value?'bg-teal-700 text-white':'text-teal-900 hover:bg-teal-50'}`}>{label}</button>)}
        </div>
        {view==='board'?<AdminWorkflowBoard key={`board:${session.access_token}:${reload}`} session={session} reloadSignal={inviteClosed} onInviteOwner={(reviewId,opener)=>{inviteOpener.current=opener;setInviteReviewId(reviewId)}}/>:
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <AdminReviewReplies key={`replies:${session.access_token}:${reload}`} session={session} onInviteOwner={(reviewId,opener)=>{inviteOpener.current=opener;setInviteReviewId(reviewId)}}/>
          <AdminToilets key={`toilets:${session.access_token}:${reload}`} session={session}/>
        </div>}
      </>}
      {tab==='responses'&&<OwnerResponseDashboard key={`${session.access_token}:${reload}`} session={session}/>}
      {tab==='replies'&&<OwnerReplyQueue key={`owner-replies:${session.access_token}:${reload}`} session={session} stage="publish"/>}
      {inviteReviewId&&<AdminOwnerInvites
        key={`invite:${session.access_token}:${inviteReviewId}`}
        session={session}
        reviewId={inviteReviewId}
        onClose={()=>{setInviteReviewId(null);setInviteClosed(value=>value+1);inviteOpener.current?.focus()}}
      />}
    </>:<form onSubmit={signIn} className="panel mt-5 max-w-md">
      <h2 className="text-xl font-bold">Administrator sign-in</h2>
      <label className="mt-4 block text-sm font-semibold">Email<input required type="email" autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)} className="mt-1 w-full rounded-lg border p-3"/></label>
      <button disabled={busy||!supabase} className="mt-3 rounded-xl bg-teal-700 px-4 py-3 font-bold text-white disabled:opacity-50">Send admin sign-in link</button>
    </form>}
  </main>;
}
