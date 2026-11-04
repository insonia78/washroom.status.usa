'use client';
import {useEffect,useState} from 'react';
import {X,ShieldCheck} from 'lucide-react';
import {formatDistance} from '@/lib/distance';
import NavigationLinks from '@/components/NavigationLinks';
import ReviewGrade from '@/components/ReviewGrade';
import OwnerResponses from '@/components/OwnerResponses';
export type Restroom={id:number;osm_type:'node'|'way'|'relation'|'refuge';source?:'refuge-restrooms';created_at?:string;directions?:string;lat:number;lon:number;name:string;wheelchair?:string;fee?:string;opening_hours?:string;category?:string;toilets?:string;distanceMiles?:number};
export function restroomLabel(restroom:Restroom){
if(restroom.source==='refuge-restrooms')return 'Refuge Restrooms listing';
const category=restroom.category==='fuel'?'Gas station':restroom.category==='supermarket'?'Supermarket':null;
if(!category)return 'Mapped restroom';
return `${category} · ${restroom.toilets==='yes'?'Toilets listed':restroom.toilets==='no'?'No toilets listed':'Restroom availability unconfirmed'}`;
}
type Review={id:string;rating:number;availability?:string|null;cleanliness_status?:string|null;issues:string[];comment:string;created_at:string;photo_urls:string[];owner_photo_urls?:string[]};
function isReview(value:unknown):value is Review{
  if(typeof value!=='object'||value===null)return false;
  const review=value as Record<string,unknown>;
  return typeof review.id==='string'&&typeof review.rating==='number'&&Number.isInteger(review.rating)&&review.rating>=1&&review.rating<=5&&
    (review.availability===null||typeof review.availability==='string')&&
    (review.cleanliness_status===null||typeof review.cleanliness_status==='string')&&
    Array.isArray(review.issues)&&review.issues.every((issue:unknown)=>typeof issue==='string')&&
    typeof review.comment==='string'&&typeof review.created_at==='string'&&Number.isFinite(Date.parse(review.created_at))&&
    Array.isArray(review.photo_urls)&&review.photo_urls.every((url:unknown)=>typeof url==='string')&&
    (review.owner_photo_urls===undefined||Array.isArray(review.owner_photo_urls)&&review.owner_photo_urls.every((url:unknown)=>typeof url==='string'));
}
export default function RestroomDetails({restroom,onClose,onAddReview}:{restroom:Restroom;onClose:()=>void;onAddReview?:()=>void}){
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
        if(!Array.isArray(data.reviews)||!data.reviews.every(isReview))throw new Error('Invalid reviews response');
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
    {onAddReview&&<button type="button" onClick={onAddReview} aria-haspopup="dialog" className="mt-3 rounded-xl bg-green-600 px-4 py-2 font-bold text-white hover:bg-green-700">Add review</button>}
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
      <div className="mt-6"><h3 className="text-lg font-bold">Community reviews</h3>{message?<p role="alert" className="mt-2 text-sm text-amber-800">{message}</p>:loading?<p className="mt-2 text-sm">Loading reviews…</p>:reviews.length===0?<p className="mt-2 text-sm text-slate-500">No approved reviews yet. Be the first to submit one.</p>:<div className="mt-3 space-y-3">{reviews.map(review=><article key={review.id} className="rounded-xl border border-slate-200 p-3"><div className="flex justify-between gap-2"><strong>{'★'.repeat(review.rating)}{'☆'.repeat(5-review.rating)}</strong><time className="text-xs text-slate-500" dateTime={review.created_at}>{new Date(review.created_at).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'})}</time></div>
        {review.availability&&<p className="mt-2 text-xs capitalize text-slate-500">Availability reported at visit: {review.availability.replaceAll('_',' ')}</p>}
        {review.cleanliness_status&&<p className="mt-1 text-xs capitalize text-slate-500">Clean or dirty status: {review.cleanliness_status.replaceAll('_',' ')}</p>}
        <p className="mt-2 whitespace-pre-wrap break-words text-sm">{review.comment||'No written comment.'}</p>{review.issues.length>0&&<p className="mt-2 text-xs text-slate-500">Reported: {review.issues.join(', ').replaceAll('_',' ')}</p>}
        {review.photo_urls.length>0&&<div className="mt-3 grid grid-cols-3 gap-2">{review.photo_urls.map((url,index)=><a key={`${review.id}-${index}`} href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open review photo ${index+1}`}><img src={url} alt={`Photo ${index+1} attached to review`} className="aspect-square w-full rounded-lg object-cover"/></a>)}</div>}
        {!!review.owner_photo_urls?.length&&<div className="mt-3">
          <h4 className="text-xs font-semibold text-slate-600">Owner-provided photos (added by an administrator)</h4>
          <div className="mt-2 grid grid-cols-3 gap-2">{review.owner_photo_urls.map((url,index)=><a key={`${review.id}-owner-${index}`} href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open owner-provided photo ${index+1}`}>
            <img src={url} alt={`Owner-provided photo ${index+1}, added by an administrator`} className="aspect-square w-full rounded-lg object-cover"/>
          </a>)}</div>
        </div>}
        <p className="mt-2 break-all text-xs text-slate-500">Review ID: {review.id}</p></article>)}</div>}</div>
    <OwnerResponses key={`${restroom.osm_type}-${restroom.id}`} restroom={restroom}/>
  </section>;
}
