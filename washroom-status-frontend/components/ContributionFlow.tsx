'use client';
import {useEffect,useState} from 'react';
import {browserSupabase} from '@/lib/supabase';
import {clearContributionContext,readContributionContext,type ContributionContext} from '@/lib/contribution-auth';
import ReviewModal from '@/components/ReviewModal';
import AddToiletModal from '@/components/AddToiletModal';

export default function ContributionFlow(){
  const [context,setContext]=useState<ContributionContext|null>(null);
  const [ready,setReady]=useState(false);

  useEffect(()=>{
    setContext(readContributionContext());
    setReady(true);
  },[]);

  async function finish(){
    clearContributionContext();
    await browserSupabase()?.auth.signOut({scope:'global'}).catch(()=>undefined);
    window.location.replace('/');
  }

  if(!ready)return <main className="mx-auto max-w-lg px-4 py-10"><p role="status">Loading questionnaire...</p></main>;
  if(!context)return <main className="mx-auto max-w-lg px-4 py-10"><h1 className="text-2xl font-bold">Questionnaire unavailable</h1>
    <p className="mt-4">This link has expired or was opened in a different browser. Return to the main page and request a new link.</p>
    <a href="/" className="mt-5 inline-flex rounded-xl bg-teal-700 px-5 py-3 font-bold text-white">Back to restroom search</a></main>;
  return <main className="mx-auto max-w-lg px-4 py-10">
    {context.kind==='review'?<ReviewModal restroom={context.restroom} userLocation={context.userLocation} onClose={()=>void finish()}/>:<AddToiletModal coordinates={context.coordinates} onClose={()=>void finish()}/>}
  </main>;
}
