'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {X} from 'lucide-react';
import {useContributionAuth} from '@/lib/contribution-auth';
import ContributionSignIn from '@/components/ContributionSignIn';
import {acceptedPhotoTypes,maxPhotoInputBytes,preparePhoto} from '@/lib/photo-preparation';

export default function AddToiletModal({coordinates,onClose}:{coordinates:[number,number];onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null);
  const titleId=useId();
  const descriptionId=useId();
  const [name,setName]=useState('');
  const [wheelchair,setWheelchair]=useState('unknown');
  const [fee,setFee]=useState('unknown');
  const [notes,setNotes]=useState('');
  const [photos,setPhotos]=useState<File[]>([]);
  const [preparingPhotos,setPreparingPhotos]=useState(false);
  const [sending,setSending]=useState(false);
  const [submitted,setSubmitted]=useState(false);
  const [error,setError]=useState('');
  const inFlight=useRef(false);
  const auth=useContributionAuth();
  const {session,checking}=auth;

  useEffect(()=>{
    const element=dialog.current;
    const trigger=document.activeElement;
    const overflow=document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow='hidden';
    return()=>{
      element?.close();
      document.body.style.overflow=overflow;
      if(trigger instanceof HTMLElement&&trigger.isConnected)trigger.focus({preventScroll:true});
    };
  },[]);

  async function submit(event:React.FormEvent){
    event.preventDefault();
    if(inFlight.current)return;
    if(!name.trim()){setError('Enter a toilet name.');return}
    inFlight.current=true;
    setSending(true);
    setError('');
    try{
      const token=await auth.accessToken();
      const form=new FormData();
      form.set('submission',JSON.stringify({name:name.trim(),longitude:coordinates[0],latitude:coordinates[1],wheelchair,fee,notes}));
      photos.forEach(photo=>form.append('photos',photo));
      const response=await fetch('/api/backend/toilet-submissions',{
          method:'POST',
          headers:{Authorization:`Bearer ${token}`},
          body:form,
        });
        const data:unknown=await response.json().catch(async()=>{
          const text=await response.clone().text();
          return {error:response.status===413||/request entity too large/i.test(text)
            ?'The photos are too large to submit. Remove a photo and try again.'
            :'The server returned an unexpected response. Please try again.'};
        });
        if(response.status===401)auth.clearSession();
        if(!response.ok)throw new Error(typeof data==='object'&&data!==null&&'error' in data&&typeof data.error==='string'?data.error:'Toilet could not be saved. Please try again.');
        if(response.status!==201||typeof data!=='object'||data===null||!('status' in data)||data.status!=='pending')throw new Error('The server did not confirm your submission. Please try again.');
      setSubmitted(true);
    }catch(error){
      setError(error instanceof Error?error.message:'Toilet could not be saved. Check your connection and try again.');
    }finally{
      inFlight.current=false;
      setSending(false);
    }
  }

  return <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event=>{event.preventDefault();if(!inFlight.current)onClose()}}
    onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();if(!inFlight.current)onClose()}}}
    onClick={event=>{
      if(inFlight.current||event.target!==event.currentTarget)return;
      const bounds=event.currentTarget.getBoundingClientRect();
      if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)onClose();
    }}
    className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-xl backdrop:bg-slate-950/60 sm:p-6">
    <div className="flex items-start justify-between gap-3">
      <h2 id={titleId} className="text-xl font-bold">Add a toilet</h2>
      <button type="button" disabled={sending} onClick={onClose} aria-label="Close add toilet modal" className="pill disabled:opacity-50"><X size={18}/></button>
    </div>
    <p id={descriptionId} className="mt-3 text-sm text-slate-600">Add a public toilet at your current location. Sign-in is required. Each account can submit up to 3 toilets per UTC day (resets at midnight UTC). Your submission is saved privately for moderation, not published immediately. Do not include private information. If you attach photos, at least one must clearly show the business/restroom name or identifying sign; submissions without this evidence may be rejected.</p>
    <p className="mt-2 text-sm font-semibold text-teal-800">Current location: {coordinates[1].toFixed(5)}, {coordinates[0].toFixed(5)}</p>
    {!submitted&&<ContributionSignIn auth={auth}/>}
    {!submitted?<form onSubmit={submit} className="mt-4 space-y-4" aria-busy={sending}>
      <fieldset disabled={sending||preparingPhotos||checking||!session} className="space-y-4">
        <label className="block text-sm font-medium">Toilet name (required)<input autoFocus required maxLength={120} value={name} onChange={event=>setName(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-3" placeholder="For example, Riverside Park public toilets"/></label>
        <label className="block text-sm font-medium">Wheelchair accessible<select value={wheelchair} onChange={event=>setWheelchair(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-3"><option value="unknown">Not sure</option><option value="yes">Yes</option><option value="no">No</option></select></label>
        <label className="block text-sm font-medium">Fee required<select value={fee} onChange={event=>setFee(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-3"><option value="unknown">Not sure</option><option value="yes">Yes</option><option value="no">No (free)</option></select></label>
        <label className="block text-sm font-medium">Access details (optional)<textarea maxLength={1000} value={notes} onChange={event=>setNotes(event.target.value)} className="mt-1 min-h-24 w-full rounded-lg border border-slate-300 p-3" placeholder="Entrance, opening hours, or how to find the toilet"/></label>
        <div><label className="block text-sm font-medium">Photos (optional, up to 3; automatically compressed for upload)<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={async event=>{
          const input=event.currentTarget;
          const selected=[...(input.files??[])];
          input.value='';
          setError('');
          if(photos.length+selected.length>3){setError('Choose no more than 3 photos.');return}
          if(selected.some(file=>!acceptedPhotoTypes.includes(file.type)||file.size<=0||file.size>maxPhotoInputBytes)){
            setError('Choose JPEG, PNG, or WebP photos smaller than 12 MB each.');return;
          }
          setPreparingPhotos(true);
          try{
            const prepared=await Promise.all(selected.map(preparePhoto));
            setPhotos(previous=>[...previous,...prepared]);
          }catch(error){setError(error instanceof Error?error.message:'Could not prepare the photos. Try another image.')}
          finally{setPreparingPhotos(false)}
        }} className="mt-1 block w-full rounded-lg border border-slate-300 p-2 text-sm"/></label>
          {preparingPhotos&&<p role="status" className="mt-1 text-xs text-slate-500">Preparing photos...</p>}
          {photos.length>0&&<ul className="mt-2 space-y-1 text-xs">{photos.map((photo,index)=><li key={`${photo.name}-${index}`} className="flex items-center justify-between gap-2"><span className="truncate">{photo.name}</span><button type="button" disabled={sending} onClick={()=>setPhotos(previous=>previous.filter((_,photoIndex)=>photoIndex!==index))} className="shrink-0 underline">Remove</button></li>)}</ul>}
        </div>
        <button disabled={!name.trim()||sending||preparingPhotos||checking||!session} className="rounded-xl bg-teal-700 px-5 py-3 font-bold text-white disabled:opacity-50">{sending?'Saving...':'Submit for moderation'}</button>
      </fieldset>
    </form>:<div className="mt-4"><p role="status" className="rounded-xl bg-teal-50 p-3 text-teal-900">Thanks! Your toilet was saved and is awaiting moderation. It will not appear in nearby results yet.</p><button type="button" onClick={onClose} className="mt-4 rounded-xl bg-teal-700 px-5 py-3 font-bold text-white">Done</button></div>}
    {error&&<p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
  </dialog>;
}
