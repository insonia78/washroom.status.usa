'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {X} from 'lucide-react';
import type {Restroom} from '@/components/RestroomDetails';
import {useContributionAuth} from '@/lib/contribution-auth';
import ContributionSignIn from '@/components/ContributionSignIn';

const issueOptions=[['dirty_floor','Dirty floors'],['broken_fixture','Broken fixture'],['odor','Bad odor'],['missing_supplies','Missing supplies'],['other','Other issue']];

export default function ReviewModal({restroom,onClose}:{restroom:Restroom;onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null);
  const titleId=useId();
  const descriptionId=useId();
  const questionId=useId();
  const [rating,setRating]=useState(0);
  const [availability,setAvailability]=useState('');
  const [cleanlinessStatus,setCleanlinessStatus]=useState('');
  const [issues,setIssues]=useState<string[]>([]);
  const [comment,setComment]=useState('');
  const [photos,setPhotos]=useState<File[]>([]);
  const [message,setMessage]=useState('');
  const [sending,setSending]=useState(false);
  const [submitted,setSubmitted]=useState(false);
  const isRefugeRestroom=restroom.source==='refuge-restrooms';
  const auth=useContributionAuth();
  const locked=sending||auth.checking||!auth.session;

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
    if(!rating||!availability||!cleanlinessStatus){setMessage('Answer all three review questions.');return}
    if(photos.length>3||photos.some(file=>!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size<=0||file.size>5*1024*1024)){
      setMessage('Choose up to 3 JPEG, PNG, or WebP photos, each no larger than 5 MB.');return;
    }
    if(sending)return;
    setSending(true);
    setMessage('');
    try{
      const token=await auth.accessToken();
      const form=new FormData();
      form.set('review',JSON.stringify({osm_type:restroom.osm_type,osm_id:restroom.id,rating,availability,cleanliness_status:cleanlinessStatus,issues,comment}));
      photos.forEach(photo=>form.append('photos',photo));
      const response=await fetch('/api/reviews',{
        method:'POST',
        headers:{Authorization:`Bearer ${token}`},
        body:form
      });
      const data=await response.json();
      if(response.status===401)auth.clearSession();
      if(!response.ok)throw new Error(data.error||'Submission failed');
      if(response.status!==201||data.status!=='pending')throw new Error('The server did not confirm your review. Please try again.');
      setSubmitted(true);
      setMessage('Thanks! Your review is awaiting moderation.');
    }catch(error){
      setMessage(error instanceof Error?error.message:'Submission failed');
    }finally{setSending(false)}
  }

  return <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event=>{event.preventDefault();onClose()}}
    onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();onClose()}}}
    onClick={event=>{
      if(event.target!==event.currentTarget)return;
      const bounds=event.currentTarget.getBoundingClientRect();
      if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)onClose();
    }}
    className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-xl backdrop:bg-slate-950/60 sm:p-6">
    <div className="flex items-start justify-between gap-3">
      <div><h2 id={titleId} className="text-xl font-bold">Add a review</h2><p className="mt-1 break-words font-semibold text-teal-800">{restroom.name}</p><p className="mt-1 text-xs text-slate-500">{isRefugeRestroom?'Refuge Restrooms':`OpenStreetMap ${restroom.osm_type}`} #{restroom.id}</p></div>
      <button type="button" autoFocus onClick={onClose} aria-label="Close review modal" className="pill"><X size={18}/></button>
    </div>
    <p id={descriptionId} className="mt-3 text-sm text-slate-600">Sign in to add a review. Reports are screened before publication. An administrator may send a private reply to your verified account email. The admin reply panel shows your user ID, not your email address. Describe your visit without including names or private information. Availability reports are not live verification.</p>
    {!submitted&&<ContributionSignIn auth={auth}/>}
    {!submitted&&
      <form onSubmit={submit} className="mt-4 space-y-4"><fieldset disabled={locked} className="space-y-4">
        <fieldset disabled={sending}><legend className="text-sm font-medium">Restroom Availability: Was it available during your visit? (required)</legend><div className="mt-2 flex flex-wrap gap-2">{[['open','Open'],['closed','Closed'],['temporarily_unavailable','Temporarily unavailable'],['unverified','Unverified']].map(([value,label])=><label key={value} className="pill text-sm"><input required type="radio" name={`${questionId}-availability`} value={value} checked={availability===value} onChange={()=>setAvailability(value)} className="mr-2"/>{label}</label>)}</div></fieldset>
        <fieldset disabled={sending}><legend className="text-sm font-medium">Cleanliness Ratings: How would you rate it? (required)</legend><div className="mt-2 flex flex-wrap gap-2">{[1,2,3,4,5].map(value=><label key={value} className="pill text-sm"><input required type="radio" name={`${questionId}-rating`} value={value} checked={rating===value} onChange={()=>setRating(value)} className="mr-2"/>{value} {value===1?'star':'stars'}</label>)}</div><p className="mt-1 text-xs text-slate-500">1 is lowest, 5 is highest.</p></fieldset>
        <fieldset disabled={sending}><legend className="text-sm font-medium">Clean or Dirty Status: What condition was it in? (required)</legend><div className="mt-2 flex flex-wrap gap-2">{[['excellent','Excellent'],['clean','Clean'],['average','Average'],['poor','Poor'],['very_dirty','Very Dirty']].map(([value,label])=><label key={value} className="pill text-sm"><input required type="radio" name={`${questionId}-condition`} value={value} checked={cleanlinessStatus===value} onChange={()=>setCleanlinessStatus(value)} className="mr-2"/>{label}</label>)}</div></fieldset>
        <fieldset disabled={sending}><legend className="text-sm font-medium">Problems noticed (optional)</legend><div className="mt-2 flex flex-wrap gap-2">{issueOptions.map(([key,label])=><label key={key} className="pill text-xs"><input type="checkbox" checked={issues.includes(key)} onChange={event=>setIssues(previous=>event.target.checked?[...previous,key]:previous.filter(value=>value!==key))} className="mr-2"/>{label}</label>)}</div></fieldset>
        <label className="block text-sm font-medium">Details (optional)<textarea disabled={sending} maxLength={1000} value={comment} onChange={event=>setComment(event.target.value)} className="mt-1 min-h-24 w-full rounded-lg border border-slate-300 p-3" placeholder="Describe what you observed without identifying other restroom users"/></label>
        <div><label className="block text-sm font-medium">Photos (optional, up to 3; 5 MB each)<input disabled={sending} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={event=>{
          const selected=[...(event.currentTarget.files??[])];
          event.currentTarget.value='';
          setMessage('');
          const next=[...photos,...selected];
          if(next.length>3){setMessage('Choose no more than 3 photos.');return}
          if(next.some(file=>!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size<=0||file.size>5*1024*1024)){
            setMessage('Photos must be JPEG, PNG, or WebP files no larger than 5 MB each.');return;
          }
          setPhotos(next);
        }} className="mt-1 block w-full rounded-lg border border-slate-300 p-2 text-sm"/></label>
          {photos.length>0&&<ul className="mt-2 space-y-1 text-xs">{photos.map((photo,index)=><li key={`${photo.name}-${index}`} className="flex items-center justify-between gap-2"><span className="truncate">{photo.name}</span><button type="button" disabled={sending} onClick={()=>setPhotos(previous=>previous.filter((_,photoIndex)=>photoIndex!==index))} className="shrink-0 underline">Remove</button></li>)}</ul>}
        </div>
        <button disabled={sending||!rating||!availability||!cleanlinessStatus} className="rounded-xl bg-teal-700 px-5 py-3 font-bold text-white disabled:opacity-50">{sending?'Submitting...':'Submit for moderation'}</button>
      </fieldset></form>}
    {message&&<p role="status" className="mt-4 text-sm text-slate-700">{message}</p>}
    {submitted&&<button type="button" onClick={onClose} className="mt-4 rounded-xl bg-teal-700 px-5 py-3 font-bold text-white">Done</button>}
  </dialog>;
}
