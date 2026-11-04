'use client';
import {useEffect,useState} from 'react';
import type {Session} from '@supabase/supabase-js';
import {browserSupabase} from '@/lib/supabase';
import {acceptedPhotoTypes,maxPhotoInputBytes,preparePhoto} from '@/lib/photo-preparation';

type Item={invite_id:string;
  review:{restroom_name?:string|null;osm_type:string;osm_id:number;rating?:number;availability?:string|null;cleanliness_status?:string|null;issues?:string[]|null;comment?:string|null;created_at?:string;photo_urls?:string[]};
  owner_photos:{id:string;photo_url:string;status:'pending'|'added'}[];
  replies:{id:string;body:string;status:string;business_name:string}[]};
const statusLabel:Record<string,string>={pending:'Waiting for moderation',moderated:'Waiting for administrator approval',published:'Published',rejected:'Not approved'};
const ownerPhotoStatus:Record<Item['owner_photos'][number]['status'],string>={pending:'Private - waiting for administrator review',added:'Added to the review'};

function OwnerReviews({session,onSent}:{session:Session;onSent:()=>void}){
  const [items,setItems]=useState<Item[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [refresh,setRefresh]=useState(0);
  const [drafts,setDrafts]=useState<Record<string,{business:string;body:string}>>({});
  const [photoDrafts,setPhotoDrafts]=useState<Record<string,File[]>>({});
  const [preparingPhotos,setPreparingPhotos]=useState(false);
  const [uploadingInvite,setUploadingInvite]=useState<string|null>(null);
  const headers={Authorization:`Bearer ${session.access_token}`};
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');
    fetch('/api/backend/owner/reviews',{headers,cache:'no-store',signal:controller.signal}).then(async response=>{
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not load your invited reviews.');
      if(!Array.isArray(data.items))throw new Error('Invalid response.');
      if(!controller.signal.aborted)setItems(data.items);
    }).catch(err=>{if(!controller.signal.aborted)setError(err instanceof Error?err.message:'Could not load your invited reviews.')})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    return()=>controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[session.access_token,refresh]);
  async function submit(event:React.FormEvent,item:Item){
    event.preventDefault();setError('');setMessage('');
    const draft=drafts[item.invite_id]??{business:item.review.restroom_name??'',body:''};
    try{
      const response=await fetch('/api/backend/owner/replies',{method:'POST',cache:'no-store',headers:{...headers,'Content-Type':'application/json'},
        body:JSON.stringify({invite_id:item.invite_id,business_name:draft.business,body:draft.body})});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not send your reply.');
      setMessage('Reply received. It will be reviewed by a moderator, then approved by an administrator before it is published.');
      setRefresh(value=>value+1);
      onSent();
    }catch(err){setError(err instanceof Error?err.message:'Could not send your reply.')}
  }
  async function uploadPhotos(item:Item){
    const selected=photoDrafts[item.invite_id]??[];
    if(!selected.length||uploadingInvite||preparingPhotos)return;
    setUploadingInvite(item.invite_id);setError('');setMessage('');
    try{
      const form=new FormData();
      form.set('invite_id',item.invite_id);
      selected.forEach(photo=>form.append('photos',photo));
      const response=await fetch('/api/backend/owner/review-photos',{method:'POST',cache:'no-store',headers,body:form});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not upload the photos.');
      setPhotoDrafts(previous=>({...previous,[item.invite_id]:[]}));
      setMessage('Photos uploaded privately. An administrator will review them before they are added to the review.');
      setRefresh(value=>value+1);
    }catch(err){setError(err instanceof Error?err.message:'Could not upload the photos.')}
    finally{setUploadingInvite(null)}
  }
  return <>
    {error&&<p role="alert" className="mt-4 text-amber-800">{error}</p>}
    {message&&<p role="status" className="mt-4 text-sm">{message}</p>}
    {loading?<p role="status" className="mt-4">Loading...</p>:!items.length&&!error&&<p className="panel mt-4">No reviews have been shared with this email address.</p>}
    <div className="mt-4 space-y-4">{items.map(item=>{
      const draft=drafts[item.invite_id]??{business:item.review.restroom_name??'',body:''};
      const open=item.replies.some(r=>r.status==='pending'||r.status==='moderated'||r.status==='published');
      const selectedPhotos=photoDrafts[item.invite_id]??[];
      return <article key={item.invite_id} className="panel">
        <h2 className="font-bold">{item.review.restroom_name||`${item.review.osm_type==='refuge'?'Refuge Restrooms':'OpenStreetMap'} #${item.review.osm_id}`}</h2>
        {item.review.rating!==undefined&&<p className="mt-1 text-sm">Rating: {item.review.rating}/5</p>}
        {item.review.created_at&&<p className="text-xs text-slate-500">Reported {new Date(item.review.created_at).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'})}</p>}
        <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          {item.review.availability&&<div><dt className="inline font-semibold">Availability: </dt><dd className="inline">{item.review.availability.replace(/_/g,' ')}</dd></div>}
          {item.review.cleanliness_status&&<div><dt className="inline font-semibold">Cleanliness: </dt><dd className="inline">{item.review.cleanliness_status.replace(/_/g,' ')}</dd></div>}
        </dl>
        {!!item.review.issues?.length&&<p className="mt-2 text-sm"><span className="font-semibold">Reported problems:</span> {item.review.issues.map(i=>i.replace(/_/g,' ')).join(', ')}</p>}
        <p className="mt-2 whitespace-pre-wrap text-sm">{item.review.comment||'No written comment.'}</p>
        {!!item.review.photo_urls?.length&&<div className="mt-3 flex flex-wrap gap-2">{item.review.photo_urls.map((url,index)=>
          <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt={`Photo ${index+1} of the reported problem`} className="h-32 w-32 rounded-lg border object-cover"/></a>)}</div>}
        <section className="mt-4 border-t pt-3" aria-label="Owner photos for administrator review">
          <h3 className="font-semibold">Photos for this review</h3>
          <p className="mt-1 text-xs text-slate-600">Owner photos stay private until an administrator adds them to the review. Up to 3 photos can be submitted per invitation.</p>
          {!!item.owner_photos.length&&<div className="mt-2 flex flex-wrap gap-3">{item.owner_photos.map((photo,index)=><div key={photo.id}>
            <a href={photo.photo_url} target="_blank" rel="noreferrer"><img src={photo.photo_url} alt={`Owner-submitted photo ${index+1}`} className="h-24 w-24 rounded-lg border object-cover"/></a>
            <p className="mt-1 max-w-32 text-xs">{ownerPhotoStatus[photo.status]}</p>
          </div>)}</div>}
          {item.owner_photos.length<3&&<div className="mt-3">
            <label className="block text-sm font-semibold">Upload photos (JPEG, PNG, or WebP)
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={uploadingInvite!==null||preparingPhotos} onChange={async event=>{
                const input=event.currentTarget;
                const selected=[...(input.files??[])];
                input.value='';
                if(item.owner_photos.length+selectedPhotos.length+selected.length>3){setError('Choose no more than 3 photos for this invitation.');return}
                if(selected.some(file=>!acceptedPhotoTypes.includes(file.type)||file.size<=0||file.size>maxPhotoInputBytes)){
                  setError('Choose JPEG, PNG, or WebP photos smaller than 12 MB each.');return;
                }
                setError('');setPreparingPhotos(true);
                try{
                  const prepared=await Promise.all(selected.map(preparePhoto));
                  setPhotoDrafts(previous=>({...previous,[item.invite_id]:[...(previous[item.invite_id]??[]),...prepared]}));
                }catch(err){setError(err instanceof Error?err.message:'Could not prepare the photos. Try another image.')}
                finally{setPreparingPhotos(false)}
              }} className="mt-1 block w-full rounded-lg border p-2 text-sm"/>
            </label>
            {preparingPhotos&&<p role="status" className="mt-2 text-xs">Preparing photos...</p>}
            {selectedPhotos.length>0&&<div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span>{selectedPhotos.length} photo(s) ready to upload</span>
              <button type="button" disabled={uploadingInvite!==null||preparingPhotos} onClick={()=>setPhotoDrafts(previous=>({...previous,[item.invite_id]:[]}))} className="underline">Clear</button>
              <button type="button" disabled={uploadingInvite!==null||preparingPhotos} onClick={()=>void uploadPhotos(item)} className="rounded-lg bg-teal-700 px-3 py-2 font-bold text-white disabled:opacity-50">
                {uploadingInvite===item.invite_id?'Uploading...':'Upload photos for review'}
              </button>
            </div>}
          </div>}
        </section>
        {item.replies.map(r=><p key={r.id} className="mt-3 rounded-lg border p-2 text-sm"><span className="font-semibold">{statusLabel[r.status]??r.status}:</span> {r.body}</p>)}
        {!open&&<form onSubmit={event=>void submit(event,item)} className="mt-3">
          <label className="block text-sm font-semibold">Business name<input required maxLength={200} value={draft.business} onChange={e=>setDrafts({...drafts,[item.invite_id]:{...draft,business:e.target.value}})} className="mt-1 w-full rounded-lg border p-3"/></label>
          <label className="mt-2 block text-sm font-semibold">Your reply<textarea required maxLength={4000} rows={4} value={draft.body} onChange={e=>setDrafts({...drafts,[item.invite_id]:{...draft,body:e.target.value}})} className="mt-1 w-full rounded-lg border p-3"/></label>
          <button className="mt-3 rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Send reply for review</button>
        </form>}
      </article>;
    })}</div>
  </>;
}

export default function OwnerPage(){
  const supabase=browserSupabase();
  const [session,setSession]=useState<Session|null>(null);
  const [checking,setChecking]=useState(true);
  const [email,setEmail]=useState('');
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  useEffect(()=>{
    if(!supabase){setChecking(false);setError('Sign-in is not configured.');return}
    let active=true;
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,current)=>{if(active){setSession(current);setChecking(false)}});
    supabase.auth.getSession().then(({data})=>{if(active)setSession(data.session)})
      .catch(err=>{if(active)setError(err instanceof Error?err.message:'Could not check sign-in.')})
      .finally(()=>{if(active)setChecking(false)});
    return()=>{active=false;subscription.unsubscribe()};
  },[supabase]);
  async function endSession(note:string){
    await supabase?.auth.signOut({scope:'global'});setMessage(note);
  }
  async function signIn(event:React.FormEvent){
    event.preventDefault();if(!supabase)return;setError('');setMessage('');
    const {error:otpError}=await supabase.auth.signInWithOtp({email,options:{shouldCreateUser:false,emailRedirectTo:`${window.location.origin}/owner`}});
    if(otpError)setError(otpError.message);else setMessage('Check your email for the sign-in link.');
  }
  return <main className="mx-auto max-w-3xl px-4 py-7">
    <a href="/" className="text-sm text-teal-800 underline">Back to restroom search</a>
    <h1 className="mt-5 text-3xl font-extrabold">Business owner replies</h1>
    <p className="mt-2 text-sm text-slate-600">See the reviews shared with you and send a reply. Replies are checked by a moderator and approved by an administrator before they are published.</p>
    {checking?<p role="status" className="mt-4">Checking sign-in...</p>:session?<>
      <div className="mt-4 flex items-center gap-3"><p className="text-sm">Signed in as {session.user.email}</p>
        <button type="button" className="pill" onClick={()=>void endSession('You have been signed out.')}>Sign out</button></div>
      <OwnerReviews session={session} onSent={()=>void endSession('Reply received. It will be reviewed by a moderator, then approved by an administrator before it is published. You have been signed out and this link no longer works.')}/>
    </>:<form onSubmit={signIn} className="panel mt-5 max-w-md">
      <p className="text-sm">Use the invitation email, or request a new link with the email address you were invited with.</p>
      {error&&<p role="alert" className="mt-3 text-amber-800">{error}</p>}
      {message&&<p role="status" className="mt-3 text-sm">{message}</p>}
      <label className="mt-3 block text-sm font-semibold">Email<input required type="email" value={email} onChange={e=>setEmail(e.target.value)} className="mt-1 w-full rounded-lg border p-3"/></label>
      <button className="mt-3 rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Send sign-in link</button>
    </form>}
  </main>;
}
