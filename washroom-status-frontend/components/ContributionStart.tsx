'use client';
import {useEffect,useId} from 'react';
import {X} from 'lucide-react';
import {saveContributionContext,useContributionAuth,type ContributionContext} from '@/lib/contribution-auth';
import ContributionSignIn from '@/components/ContributionSignIn';
import {useModalDialog} from '@/lib/use-modal-dialog';

export default function ContributionStart({context,title,name,onClose}:{context:ContributionContext;title:string;name?:string;onClose:()=>void}){
  const dialog=useModalDialog();
  const titleId=useId();
  const descriptionId=useId();
  const auth=useContributionAuth();

  useEffect(()=>{
    if(auth.session){
      saveContributionContext(context);
      window.location.assign('/contribute');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[auth.session]);

  return <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event=>{event.preventDefault();onClose()}}
    onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();onClose()}}}
    className="public-dialog fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-xl backdrop:bg-slate-950/60 sm:p-6">
    <div className="flex items-start justify-between gap-3">
      <div><h2 id={titleId} className="text-xl font-bold">{title}</h2>{name&&<p className="mt-1 break-words font-semibold text-teal-800">{name}</p>}</div>
      <button type="button" autoFocus onClick={onClose} aria-label={`Close ${title.toLowerCase()}`} className="pill"><X size={18}/></button>
    </div>
    <p id={descriptionId} className="mt-3 text-sm text-slate-600">Enter your email. We will send a link that opens the questionnaire.</p>
    {auth.session?<p role="status" className="mt-4 text-sm">Opening questionnaire...</p>:<ContributionSignIn auth={auth} context={context}/>}
  </dialog>;
}
