'use client';
import {X} from 'lucide-react';
import {useLayoutEffect} from 'react';
import {restroomLabel,type Restroom} from '@/components/RestroomDetails';
import LatestReview from '@/components/LatestReview';
import {formatDistance} from '@/lib/distance';

export default function MapRestroomPreview({restroom,onSelect,onClose,onLayout}:{restroom:Restroom;onSelect:()=>void;onClose:()=>void;onLayout:()=>void}){
  useLayoutEffect(onLayout,[onLayout]);
  return <section aria-label={`Map preview for ${restroom.name}`} className="max-h-[280px] overflow-y-auto p-1 text-left text-slate-900">
    <div className="flex items-start justify-between gap-2">
      <h2 className="break-words text-base font-bold">{restroom.name}</h2>
      <button type="button" onClick={onClose} aria-label="Close map preview" className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-teal-700"><X size={18} aria-hidden="true"/></button>
    </div>
    <p className="mt-1 text-xs font-semibold text-amber-800">{restroomLabel(restroom)}</p>
    {restroom.distanceMiles!==undefined&&<p className="mt-1 text-xs text-teal-800">{formatDistance(restroom.distanceMiles)} from search location (straight-line)</p>}
    <dl className="mt-2 space-y-1 text-xs">
      <div><dt className="inline font-semibold">Accessibility: </dt><dd className="inline">{restroom.wheelchair==='yes'?'Wheelchair access listed':restroom.wheelchair==='no'?'No wheelchair access listed':'Unknown'}</dd></div>
      <div><dt className="inline font-semibold">Fee: </dt><dd className="inline">{restroom.fee==='no'?'Free access listed':restroom.fee==='yes'?'Fee listed':'Unknown'}</dd></div>
      <div><dt className="inline font-semibold">Hours: </dt><dd className="inline">{restroom.opening_hours||'Not listed'}</dd></div>
    </dl>
    <p className="mt-2 text-xs text-slate-500">Availability is unverified, not live.</p>
    <LatestReview key={`${restroom.osm_type}-${restroom.id}`} restroom={restroom}/>
    <button type="button" aria-haspopup="dialog" onClick={onSelect} className="mt-3 rounded-lg bg-teal-700 px-3 py-2 text-sm font-bold text-white">View full details and reviews</button>
  </section>;
}
