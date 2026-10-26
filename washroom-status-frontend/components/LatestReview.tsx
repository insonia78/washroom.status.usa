'use client';
import {useEffect,useState} from 'react';
import type {Restroom} from '@/components/RestroomDetails';
import ReviewGrade from '@/components/ReviewGrade';

type Comment={id:string;comment:string;created_at:string};

export default function LatestReview({restroom}:{restroom:Restroom}){
  const [latest,setLatest]=useState<Comment|null>(null);
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
    fetch(`/api/reviews?osm_type=${restroom.osm_type}&osm_id=${restroom.id}&latest=1`,{signal:controller.signal,cache:'no-store'})
      .then(async response=>{
        const data=await response.json();
        if(!response.ok)throw new Error(data.error||'Could not load the latest comment.');
        if(!Array.isArray(data.reviews)||data.reviews.length>1)throw new Error('Invalid latest comment response.');
        const review=data.reviews[0];
        if(review&&(typeof review.id!=='string'||typeof review.comment!=='string'||!review.comment.trim()||typeof review.created_at!=='string'||!Number.isFinite(Date.parse(review.created_at))))throw new Error('Invalid latest comment response.');
        if(!Number.isSafeInteger(data.review_count)||data.review_count<0||
          (data.review_count===0?data.average!==null:typeof data.average!=='number'||!Number.isFinite(data.average)||data.average<1||data.average>5))throw new Error('Invalid review grade response.');
        if(!controller.signal.aborted){setLatest(review??null);setGrade({average:data.average,count:data.review_count})}
      })
      .catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:'Could not load the latest comment.')})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    return()=>controller.abort();
  },[restroom.id,restroom.osm_type,attempt]);
  return <div className="mt-3 border-t border-slate-200 pt-3 text-sm">
    {grade&&<ReviewGrade average={grade.average} count={grade.count}/>}
    <p className="font-semibold">Latest approved comment</p>
    {loading?<p role="status" className="mt-1 text-xs text-slate-500">Loading latest comment...</p>:error?<div role="alert" className="mt-1 text-xs text-amber-800"><p>{error}</p><button type="button" onClick={()=>setAttempt(value=>value+1)} className="mt-1 underline">Retry latest comment</button></div>:latest?<><p className="mt-1 whitespace-pre-wrap break-words">{latest.comment}</p><time dateTime={latest.created_at} className="mt-1 block text-xs text-slate-500">{new Date(latest.created_at).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'})}</time></>:<p className="mt-1 text-xs text-slate-500">No approved comments yet.</p>}
  </div>;
}
