import {Star} from 'lucide-react';
import {starFillPercent} from '@/lib/ratings';

export default function ReviewGrade({average,count}:{average:number|null;count:number}){
  return <div className="mb-3">
    <div role="img" aria-label={average===null?'Not yet rated':`${average.toFixed(1)} out of 5 stars, ${count} approved review${count===1?'':'s'}`} className="flex gap-1">
      {[1,2,3,4,5].map(star=><span key={star} aria-hidden="true" className="relative inline-block h-5 w-5">
        <Star size={20} className="text-slate-300"/>
        <span className="absolute inset-y-0 left-0 overflow-hidden" style={{width:`${starFillPercent(average,star)}%`}}><Star size={20} className="max-w-none text-amber-500" fill="currentColor"/></span>
      </span>)}
    </div>
    <p className="mt-1 text-xs text-slate-600">{average===null?'Not yet rated':`${average.toFixed(1)} / 5`} · {count} approved {count===1?'review':'reviews'}</p>
  </div>;
}
