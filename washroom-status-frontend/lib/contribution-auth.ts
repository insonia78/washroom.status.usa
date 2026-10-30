'use client';
import {useEffect,useState} from 'react';
import type {Session} from '@supabase/supabase-js';
import {browserSupabase} from './supabase';

export function useContributionAuth(){
  const supabase=browserSupabase();
  const [session,setSession]=useState<Session|null>(null);
  const [checking,setChecking]=useState(true);
  const [signingIn,setSigningIn]=useState(false);
  const [authError,setAuthError]=useState('');
  const [authMessage,setAuthMessage]=useState('');
  useEffect(()=>{
    if(!supabase){setChecking(false);setAuthError('Sign-in is not configured. Please contact the site administrator.');return}
    let active=true;
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,current)=>{
      if(active){setSession(current);setChecking(false)}
    });
    supabase.auth.getSession().then(({data,error})=>{
      if(error)throw error;
      if(active)setSession(data.session);
    }).catch(error=>{if(active)setAuthError(error instanceof Error?error.message:'Could not check sign-in.')})
      .finally(()=>{if(active)setChecking(false)});
    return()=>{active=false;subscription.unsubscribe()};
  },[supabase]);

  async function signIn(email:string){
    if(signingIn)return;
    if(!supabase){setAuthError('Sign-in is not configured. Please contact the site administrator.');return}
    setSigningIn(true);setAuthError('');setAuthMessage('');
    try{
      const {error}=await supabase.auth.signInWithOtp({
        email:email.trim(),
        options:{emailRedirectTo:`${window.location.origin}/auth/callback`},
      });
      if(error)throw error;
      setAuthMessage('Check your email for a sign-in link. Gmail and other email providers work. After signing in, reopen this form if needed.');
    }catch(error){setAuthError(error instanceof Error?error.message:'Could not send the sign-in link.')}
    finally{setSigningIn(false)}
  }

  async function accessToken(){
    if(!supabase)throw new Error('Sign-in is not configured.');
    const {data,error}=await supabase.auth.getSession();
    if(error)throw error;
    setSession(data.session);
    if(!data.session)throw new Error('Sign in before submitting.');
    return data.session.access_token;
  }
  return {session,checking,signingIn,authError,authMessage,signIn,accessToken,clearSession:()=>setSession(null)};
}
