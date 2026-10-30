'use client';
import {useState} from 'react';
import type {useContributionAuth} from '@/lib/contribution-auth';

export default function ContributionSignIn({auth}:{auth:ReturnType<typeof useContributionAuth>}){
  const [email,setEmail]=useState('');
  return <div className="mt-4">
    {auth.checking?<p role="status" className="text-sm">Checking sign-in...</p>:!auth.session?
      <form onSubmit={event=>{event.preventDefault();void auth.signIn(email)}} className="space-y-3">
        <label className="block text-sm font-medium">Email<input required type="email" autoComplete="email" disabled={auth.signingIn} value={email} onChange={event=>setEmail(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-3" placeholder="you@gmail.com"/></label>
        <button disabled={auth.signingIn} className="rounded-xl bg-teal-700 px-5 py-3 font-semibold text-white disabled:opacity-50">{auth.signingIn?'Sending...':'Send sign-in link'}</button>
        <p className="text-xs text-slate-500">No password needed. Open the link in your email, then return to your restroom and reopen this form if needed. Unsaved answers are not retained across page navigation.</p>
        {auth.authMessage&&<p role="status" className="text-sm text-teal-800">{auth.authMessage}</p>}
      </form>:
      <p className="text-sm text-teal-800">Signed in. Your account is linked privately to your submission, not displayed publicly.</p>}
    {auth.authError&&<p role="alert" className="mt-2 text-sm text-red-700">{auth.authError}</p>}
  </div>;
}
