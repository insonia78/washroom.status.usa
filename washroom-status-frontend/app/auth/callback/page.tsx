'use client';
import {useEffect,useState} from 'react';
import {browserSupabase} from '@/lib/supabase';
import {readContributionContext} from '@/lib/contribution-auth';

export default function AuthCallback(){
  const [error,setError]=useState('');
  const [complete,setComplete]=useState(false);
  useEffect(()=>{
    let active=true;
    const supabase=browserSupabase();
    const query=new URLSearchParams(window.location.search);
    const hash=new URLSearchParams(window.location.hash.slice(1));
    const providerError=query.get('error_description')||hash.get('error_description')||query.get('error')||hash.get('error');
    if(providerError){setError(providerError);window.history.replaceState(null,'','/auth/callback');return}
    if(!supabase){setError('Sign-in is not configured. Please contact the site administrator.');return}
    supabase.auth.getSession().then(({data,error})=>{
      if(error)throw error;
      if(!data.session)throw new Error('Email sign-in did not complete. Return to search and request a new link.');
      if(active){setComplete(true);      window.history.replaceState(null,'','/auth/callback');if(readContributionContext())window.location.replace('/contribute')}
    }).catch(error=>{if(active){setError(error instanceof Error?error.message:'Could not complete sign-in.');window.history.replaceState(null,'','/auth/callback')}});
    return()=>{active=false};
  },[]);
  return <main className="mx-auto max-w-lg px-4 py-10"><h1 className="text-2xl font-bold">Email sign-in</h1>
    {error?<p role="alert" className="mt-4 text-red-700">{error}</p>:complete?
      <p role="status" className="mt-4 text-teal-800">You are signed in. Return to search, select your restroom or current location, and reopen Add review or Add a toilet.</p>:
      <p role="status" className="mt-4">Completing sign-in...</p>}
    <a href="/" className="mt-5 inline-flex rounded-xl bg-teal-700 px-5 py-3 font-bold text-white">Back to restroom search</a>
  </main>;
}
