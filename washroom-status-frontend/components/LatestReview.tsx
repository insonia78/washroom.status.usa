'use client';
import {useEffect,useRef,useState} from 'react';
import type {Restroom} from '@/components/RestroomDetails';
import ReviewGrade from '@/components/ReviewGrade';
import {fetchLatestReview} from '@/lib/review-request-queue';
import {observeReview} from '@/lib/observe-review';
import {parsePublicReviews,type PublicReview} from '@/lib/public-reviews';

export default function LatestReview({restroom}:{restroom:Restroom}){
  const host=useRef<HTMLDivElement>(null);
  const [latest,setLatest]=useState<PublicReview|null>(null);
  const [grade,setGrade]=useState<{average:number|null;count:number}|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);
    setLatest(null);
    setGrade(null);
    setError('');
    const disconnect=host.current?observeReview(host.current,()=>{
      void fetchLatestReview(`/api/reviews?osm_type=${restroom.osm_type}&osm_id=${restroom.id}&latest=1`,controller.signal)
        .then(payload=>{
          const data=parsePublicReviews(payload,1);
          if(!controller.signal.aborted){
            setLatest(data.reviews[0]??null);
            setGrade({average:data.average,count:data.review_count});
          }
        })
        .catch(error=>{
          if(!controller.signal.aborted)setError(error instanceof Error?error.message:'Could not load the latest review.');
        })
        .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    }):()=>{};
    return()=>{disconnect();controller.abort()};
  },[restroom.id,restroom.osm_type,attempt]);
  return <div ref={host} className="mt-3 border-t border-slate-200 pt-3 text-sm">
    {grade&&<ReviewGrade average={grade.average} count={grade.count}/>}
    <p className="font-semibold">Latest approved review</p>
    {loading?<p role="status" className="mt-1 text-xs text-slate-500">Loading latest review...</p>:error?<div role="alert" className="mt-1 text-xs text-amber-800"><p>{error}</p><button type="button" onClick={()=>setAttempt(value=>value+1)} className="mt-1 underline">Retry latest review</button></div>:latest?<>
      <p className="mt-1 font-medium">{latest.rating} / 5 · {latest.cleanliness_status?.replaceAll('_',' ')||'Cleanliness status not recorded'}</p>
      <p className="mt-1 text-xs text-slate-600">Availability at visit: {latest.availability?.replaceAll('_',' ')||'Not recorded'}</p>
      <time dateTime={latest.created_at} className="mt-1 block text-xs text-slate-500">{new Date(latest.created_at).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'})}</time>
      <p className="mt-1 whitespace-pre-wrap break-words">{latest.comment||'No written comment.'}</p>
      {latest.issues.length>0&&<p className="mt-1 text-xs text-slate-500">Reported: {latest.issues.join(', ').replaceAll('_',' ')}</p>}
      {latest.photo_urls.length>0&&<div className="mt-2 flex gap-2 overflow-x-auto">{latest.photo_urls.map((url,index)=><img loading="lazy" key={`${latest.id}-${index}`} src={url} alt={`Photo ${index+1} attached to review`} className="h-16 w-16 shrink-0 rounded-lg object-cover"/>)}</div>}
      {!!latest.owner_photo_urls?.length&&<div className="mt-2">
        <p className="text-xs font-semibold text-slate-600">Owner-provided photos (added by an administrator)</p>
        <div className="mt-1 flex gap-2 overflow-x-auto">{latest.owner_photo_urls.map((url,index)=><img loading="lazy" key={`${latest.id}-owner-${index}`} src={url} alt={`Owner-provided photo ${index+1}, added by an administrator`} className="h-16 w-16 shrink-0 rounded-lg object-cover"/>)}</div>
      </div>}
    </>:<p className="mt-1 text-xs text-slate-500">No approved reviews yet.</p>}
  </div>;
}
