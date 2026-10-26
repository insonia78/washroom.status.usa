'use client';
import {useEffect,useState} from 'react';
import {X,ShieldCheck} from 'lucide-react';
import {formatDistance} from '@/lib/distance';
import NavigationLinks from '@/components/NavigationLinks';
import ReviewGrade from '@/components/ReviewGrade';
export type Restroom={id:number;osm_type:'node'|'way'|'relation'|'refuge';source?:'refuge-restrooms';created_at?:string;directions?:string;lat:number;lon:number;name:string;wheelchair?:string;fee?:string;opening_hours?:string;category?:string;toilets?:string;distanceMiles?:number};
export function restroomLabel(restroom:Restroom){
if(restroom.source==='refuge-restrooms')return 'Refuge Restrooms listing';
const category=restroom.category==='fuel'?'Gas station':restroom.category==='supermarket'?'Supermarket':null;
if(!category)return 'Mapped restroom';
return `${category} · ${restroom.toilets==='yes'?'Toilets listed':restroom.toilets==='no'?'No toilets listed':'Restroom availability unconfirmed'}`;
}
type Review={id:string;rating:number;availability?:string|null;cleanliness_status?:string|null;issues:string[];comment:string;created_at:string};
export default function RestroomDetails({restroom,onClose,onAddReview}:{restroom:Restroom;onClose:()=>void;onAddReview:()=>void}){
  const [reviews,setReviews]=useState<Review[]>([]);
  const [average,setAverage]=useState<number|null>(null);
  const [reviewCount,setReviewCount]=useState(0);
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState('');
  const isRefugeRestroom=restroom.source==='refuge-restrooms';
  useEffect(()=>{
    let active=true;
    setLoading(true);
    setMessage('');
    setReviews([]);
    setAverage(null);
    setReviewCount(0);
    fetch(`/api/reviews?osm_type=${restroom.osm_type}&osm_id=${restroom.id}`).then(async response=>{
        const data=await response.json();
        if(!response.ok)throw new Error(data.error||'Could not load reviews');
        if(!Array.isArray(data.reviews))throw new Error('Invalid reviews response');
        if(!Number.isSafeInteger(data.review_count)||data.review_count<0||
          (data.review_count===0?data.average!==null:typeof data.average!=='number'||!Number.isFinite(data.average)||data.average<1||data.average>5))throw new Error('Invalid review grade response.');
        return data;
      }).then(data=>{
        if(active){setReviews(data.reviews);setAverage(data.average??null);setReviewCount(data.review_count)}
      }).catch(error=>{
        if(active)setMessage(error instanceof Error?error.message:'Could not load reviews');
      }).finally(()=>{if(active)setLoading(false)});
    return()=>{active=false};
  },[restroom.id,restroom.osm_type]);
  return <section className="panel mt-5" aria-label="Restroom details">
    <div className="flex items-start justify-between gap-3">
      <div><p className="text-xs font-bold uppercase tracking-wider text-teal-700">{isRefugeRestroom?'Refuge Restrooms listing':'Restroom details'}</p><h2 className="mt-1 text-2xl font-extrabold">{restroom.name}</h2><p className="mt-1 text-sm text-slate-500">{isRefugeRestroom?'Refuge Restrooms':`OpenStreetMap ${restroom.osm_type}`} #{restroom.id}</p></div>
      <button onClick={onClose} aria-label="Close details" className="pill"><X size={18}/></button>
    </div>
    <p className="mt-3 text-sm font-semibold text-amber-800">{restroomLabel(restroom)}</p>
    {isRefugeRestroom&&restroom.created_at&&<p className="mt-2 text-sm text-slate-600">Added {new Date(restroom.created_at).toLocaleDateString('en-US')}</p>}
    {restroom.distanceMiles!==undefined&&<p className="mt-2 text-sm font-semibold text-teal-700">{formatDistance(restroom.distanceMiles)} from search location (straight-line)</p>}
    <NavigationLinks latitude={restroom.lat} longitude={restroom.lon} name={restroom.name}/>
    <button type="button" onClick={onAddReview} aria-haspopup="dialog" className="mt-3 rounded-xl bg-teal-700 px-4 py-2 font-bold text-white">Add review</button>
    {isRefugeRestroom?<>
      {restroom.directions&&<p className="mt-3 whitespace-pre-wrap text-sm">{restroom.directions}</p>}
      <p className="mt-4 text-xs text-slate-600">Accessibility and restroom details are provided by Refuge Restrooms. Community reviews are collected and moderated by Washroom Status USA, not Refuge Restrooms.</p>
    </>:null}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Cleanliness</p><ReviewGrade average={average} count={reviewCount}/><p className="text-xs text-slate-500">{reviews.length} recent approved reviews shown</p></div>
        <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Availability</p><p className="font-bold">Unverified</p><p className="text-xs text-slate-500">No live sensor data</p></div>
        <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">{isRefugeRestroom?'Facilities from Refuge Restrooms':'Facilities from OSM'}</p><p className="font-bold">{restroom.wheelchair==='yes'?'Wheelchair access listed':'Accessibility unknown'}</p><p className="text-xs text-slate-500">{restroom.fee==='no'?'Free access listed':'Fee unknown'} · {restroom.opening_hours||'Hours unknown'}</p></div>
      </div>
      <p className="mt-3 flex items-center gap-2 text-xs text-slate-600"><ShieldCheck size={16}/> Ratings reflect approved community reports, not independent inspections. New reports may take time to appear.</p>
      <div className="mt-6"><h3 className="text-lg font-bold">Community reviews</h3>{message?<p role="alert" className="mt-2 text-sm text-amber-800">{message}</p>:loading?<p className="mt-2 text-sm">Loading reviews…</p>:reviews.length===0?<p className="mt-2 text-sm text-slate-500">No approved reviews yet. Be the first to submit one.</p>:<div className="mt-3 space-y-3">{reviews.map(review=><article key={review.id} className="rounded-xl border border-slate-200 p-3"><div className="flex justify-between gap-2"><strong>{'★'.repeat(review.rating)}{'☆'.repeat(5-review.rating)}</strong><time className="text-xs text-slate-500" dateTime={review.created_at}>{new Date(review.created_at).toLocaleDateString('en-US')}</time></div>
        {review.availability&&<p className="mt-2 text-xs capitalize text-slate-500">Availability reported at visit: {review.availability.replaceAll('_',' ')}</p>}
        {review.cleanliness_status&&<p className="mt-1 text-xs capitalize text-slate-500">Clean or dirty status: {review.cleanliness_status.replaceAll('_',' ')}</p>}
        {review.comment&&<p className="mt-2 whitespace-pre-wrap break-words text-sm">{review.comment}</p>}{review.issues.length>0&&<p className="mt-2 text-xs text-slate-500">Reported: {review.issues.join(', ').replaceAll('_',' ')}</p>}</article>)}</div>}</div>
  </section>;
}
