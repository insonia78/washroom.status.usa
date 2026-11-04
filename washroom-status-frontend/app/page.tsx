'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {MapPin,Accessibility,Clock3,ShieldCheck,LocateFixed,ChevronLeft,ChevronRight} from 'lucide-react';
import OpenFreeMap, {type OpenFreeMapHandle} from '@/components/OpenFreeMap';
import RestroomDetails, {restroomLabel,type Restroom} from '@/components/RestroomDetails';
import AddressSearch from '@/components/AddressSearch';
import {distanceMiles,formatDistance,sortByDistance} from '@/lib/distance';
import {LOCATION_RESULTS_ERROR,apiFailureMessage} from '@/lib/user-messages';
import NavigationLinks from '@/components/NavigationLinks';
import {requestCurrentPosition} from '@/lib/geolocation';
import ContributionStart from '@/components/ContributionStart';
import LatestReview from '@/components/LatestReview';


export default function Home(){const [city,setCity]=useState('');const [items,setItems]=useState<Restroom[]>([]);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [filter,setFilter]=useState('all');const [center,setCenter]=useState<[number,number]>([-98.5795,39.8283]);const [selected,setSelected]=useState<Restroom|null>(null);
const [hasSearchOrigin,setHasSearchOrigin]=useState(false);
const [currentLocationActive,setCurrentLocationActive]=useState(false);
const [toiletCoordinates,setToiletCoordinates]=useState<[number,number]|null>(null);
const [reviewRestroom,setReviewRestroom]=useState<Restroom|null>(null);
const [searching,setSearching]=useState(false);
const [searchVisible,setSearchVisible]=useState(false);
const [warning,setWarning]=useState('');
const [radiusMiles,setRadiusMiles]=useState('5');
const mapArea=useRef<HTMLDivElement>(null);
const mapRef=useRef<OpenFreeMapHandle>(null);
const focusAfterSearch=useRef(false);
const focusMapArea=useCallback(()=>{
  requestAnimationFrame(()=>{
    mapRef.current?.focusMap();
    if(window.matchMedia('(max-width: 1023px)').matches){
      mapArea.current?.scrollIntoView({block:'start',behavior:'instant'});
    }
  });
},[]);
const returnToMap=useCallback(()=>{
  if(!focusAfterSearch.current)return;
  focusAfterSearch.current=false;
  focusMapArea();
},[focusMapArea]);
const resultsList=useRef<HTMLDivElement>(null);
useEffect(()=>{if(resultsList.current)resultsList.current.scrollLeft=0},[center,filter,radiusMiles]);
const [location,setLocation]=useState<[number,number]|null>(null);
const [locationError,setLocationError]=useState('');
const [locating,setLocating]=useState(false);
const [zoom,setZoom]=useState(3);
const locationRequest=useRef(0);
const locate=useCallback(()=>{
  const request=++locationRequest.current;
  setCurrentLocationActive(false);
  setLocationError('');
  if(!window.isSecureContext){setLocating(false);setLocationError('Location requires HTTPS on mobile. Open the secure HTTPS site in Safari or Chrome, or search a US city or ZIP code.');return}
  if(!navigator.geolocation){setLocating(false);setLocationError('Your browser does not support location. Open this site in Safari or Chrome, or search a US city or ZIP code.');return}
  setLocating(true);
  requestCurrentPosition(navigator.geolocation,()=>request===locationRequest.current).then(position=>{
    if(request!==locationRequest.current)return;
    const {longitude,latitude}=position.coords;
    if(!Number.isFinite(longitude)||!Number.isFinite(latitude)||longitude < -179||longitude > -65||latitude < 17||latitude > 72){
      setLocationError('Your location is outside the US map. Search for a US city instead.');return;
    }
    focusAfterSearch.current=true;
    focusMapArea();
    setLocation([longitude,latitude]);setCurrentLocationActive(true);setZoom(15);setCity('');setHasSearchOrigin(true);setCenter([longitude,latitude]);
  }).catch((error:GeolocationPositionError)=>{
    if(request!==locationRequest.current)return;
    setLocationError(error.code===1?'Location access is blocked. Enable Location Services and allow location for this site in Safari or Chrome settings, then tap Use my location. If using an in-app browser, open the site in Safari or Chrome.':
      error.code===3?'Finding your location timed out. Use my location to retry or search a US city.':
      'Your location is unavailable. Turn on Location Services and allow browser location access, then tap Use my location or search a US city.');
  }).finally(()=>{if(request===locationRequest.current)setLocating(false)});
},[focusMapArea]);
useEffect(()=>{locate();return()=>{locationRequest.current++}},[locate]);
const handleSelect=useCallback((restroom:Restroom)=>setSelected(restroom),[]);
useEffect(()=>{if(!hasSearchOrigin)return;let cancelled=false;setBusy(true);setError('');setWarning('');setItems([]);setSelected(null);const controller=new AbortController();fetch(`/api/restrooms?lat=${center[1]}&lon=${center[0]}&radiusMiles=${radiusMiles}`,{signal:controller.signal}).then(r=>{if(!r.ok)return r.json().then(d=>{throw new Error(d.error||LOCATION_RESULTS_ERROR)});return r.json()}).then(d=>{if(!cancelled){setItems((d.restrooms||[]).map((item:Restroom)=>({...item,distanceMiles:distanceMiles(center[1],center[0],item.lat,item.lon)})));setWarning(d.warning||'')}}).catch(e=>{if(!cancelled&&e.name!=='AbortError')setError(apiFailureMessage(e instanceof Error?e.message:null))}).finally(()=>{if(!cancelled){setBusy(false);returnToMap()}});return()=>{cancelled=true;controller.abort()}},[center,radiusMiles,returnToMap,hasSearchOrigin]);
async function search(e:React.FormEvent){
  e.preventDefault();
  if(searching)return;
  if(!city.trim()){setError('Enter a US city, address, or ZIP code.');return}
  e.currentTarget.querySelector('input')?.blur();
  focusMapArea();
  focusAfterSearch.current=false;
  locationRequest.current++;
  setCurrentLocationActive(false);
  setLocating(false);
  setLocationError('');
  setZoom(12);
  setSearching(true);
  setError('');
  setWarning('');
  const query=city.trim();
  if(/^\d+$/.test(query)&&!/^\d{5}$/.test(query)){
    setError('Enter a five-digit US ZIP code.');
    setSearching(false);
    focusAfterSearch.current=true;
    returnToMap();
    return;
  }
  try{
    if(/^\d+$/.test(query)){
      const response=await fetch(`/api/backend/geocode?zip=${encodeURIComponent(query)}`);
      const result=await response.json();
      if(!response.ok)throw new Error(apiFailureMessage(result.error, 'ZIP Geocoding API'));
      const origin=result;
      if(!origin||!Number.isFinite(origin.latitude)||!Number.isFinite(origin.longitude))throw new Error(LOCATION_RESULTS_ERROR);
      focusAfterSearch.current=true;
      setHasSearchOrigin(true);
      setCenter([origin.longitude,origin.latitude]);
      return;
    }
    const r=await fetch(`/api/backend/geocode?q=${encodeURIComponent(query)}`);
    const d=await r.json();
    if(!r.ok)throw new Error(apiFailureMessage(d.error, 'Photon Geocoding API'));
    if(!Number.isFinite(d.latitude)||!Number.isFinite(d.longitude))throw new Error(LOCATION_RESULTS_ERROR);
    focusAfterSearch.current=true;
    setHasSearchOrigin(true);
    setCenter([d.longitude,d.latitude]);
  }catch(error){setError(apiFailureMessage(error instanceof Error?error.message:null,/^\d{5}$/.test(query)?'ZIP Geocoding API':'Photon Geocoding API'));focusAfterSearch.current=true;returnToMap()}
  finally{setSearching(false)}
}
const shown=sortByDistance(items.filter(x=>filter==='all'||(filter==='accessible'&&x.wheelchair==='yes')||(filter==='free'&&x.fee==='no')||(filter==='always'&&x.opening_hours==='24/7')));
const hasResults=!busy&&!error&&shown.length>0;
const addToiletButton=currentLocationActive&&location&&!locating&&!searching?<button type="button" aria-haspopup="dialog" onClick={()=>setToiletCoordinates([...location])} className="shrink-0 rounded-xl bg-green-600 px-3 py-3 text-sm font-bold text-white hover:bg-green-700">Add a toilet</button>:null;
const radiusControl=<label className="flex flex-col items-start gap-1 text-sm font-semibold sm:flex-row sm:items-center sm:gap-2">Search radius<select aria-describedby="radius-search-help" value={radiusMiles} onChange={event=>{focusAfterSearch.current=true;setRadiusMiles(event.target.value)}} className="rounded-xl border border-slate-300 bg-white px-3 py-3">{['1','2','5','10'].map(miles=><option key={miles} value={miles}>{miles} {miles==='1'?'mile':'miles'}</option>)}</select></label>;
return <main className="mx-auto max-w-6xl px-4 py-7"><header className="mb-9 flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><span className="rounded-2xl bg-teal-700 p-3 text-2xl text-white">🚻</span><div><h1 className="text-2xl font-black tracking-tight">Washroom Status USA</h1><p className="text-sm text-slate-500">Find clean restrooms. Travel confidently.</p></div></div><a className="header-brand" href="https://codyza.com" target="_blank" rel="noopener noreferrer"><span className="footer-credit">Powered by</span><span className="header-brand-name">Codyza.com</span></a></header>
<div ref={mapArea} className="grid gap-5 lg:grid-cols-[1.45fr_1fr]">
<section aria-label="Restroom controls" className="panel order-first lg:col-span-2">
<div className="flex flex-wrap items-center gap-2">
{radiusControl}{addToiletButton}
<button type="button" aria-expanded={searchVisible} aria-controls="toilet-address-search" onClick={()=>setSearchVisible(visible=>!visible)} className="pill text-sm font-semibold">Search a toilet</button>
<button type="button" onClick={locate} disabled={locating} className="pill disabled:opacity-50" aria-label="Use my location" aria-busy={locating}><LocateFixed className={locating?'animate-pulse motion-reduce:animate-none':''}/></button>
{currentLocationActive&&<span className="self-center text-sm font-semibold text-teal-800">Current location</span>}
</div>
{locating&&<p role="status" className="mt-2 text-sm text-teal-800">Finding your location. Allow location access if prompted.</p>}
<div className="mt-4 flex flex-wrap gap-2">{[['all','All restrooms'],['accessible','♿ Accessible'],['free','Free'],['always','24/7']].map(([id,label])=><button key={id} className="pill text-sm" aria-pressed={filter===id} onClick={()=>setFilter(id)}>{label}</button>)}</div>
</section>
{locationError&&<p role="alert" className="order-0 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 lg:order-4 lg:col-span-2">{locationError}</p>}
<section id="toilet-address-search" hidden={!searchVisible} className="panel relative z-20 order-0 lg:order-1 lg:col-span-2"><h2 className="mb-3 text-xl font-bold">Find a public restroom</h2><form onSubmit={search} className="flex flex-wrap gap-2">
<AddressSearch value={city} onChange={value=>{setCity(value);setCurrentLocationActive(false);locationRequest.current++;setLocating(false)}} searching={searching} onSelect={suggestion=>{setCurrentLocationActive(false);focusAfterSearch.current=true;focusMapArea();locationRequest.current++;setLocating(false);setLocationError('');setError('');setZoom(12);setHasSearchOrigin(true);setCenter([suggestion.longitude,suggestion.latitude])}}/>
</form></section>
<div className="order-1 min-w-0 lg:order-2">
<p id="radius-search-help" className="mb-2 text-xs text-slate-500">{hasSearchOrigin?'Searching':'Search'} within {radiusMiles} {radiusMiles==='1'?'mile':'miles'}. {hasSearchOrigin?'Radius changes automatically reload restrooms and imported gas stations.':'Choose a location to find nearby restrooms and imported gas stations.'}</p>
<div className="relative isolate" aria-busy={searching||busy}>
  <OpenFreeMap ref={mapRef} center={center} zoom={zoom} overview={!hasSearchOrigin} location={location} items={items} filter={filter} onSelect={handleSelect}/>
  {(searching||busy)&&<div role="status" aria-live="polite" aria-label="Map search progress" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-white/40">
    <div className="flex max-w-[85%] items-center gap-3 rounded-xl bg-white p-4 text-sm font-semibold text-teal-900 shadow-lg">
      <span aria-hidden="true" className="h-8 w-8 shrink-0 animate-spin rounded-full border-4 border-teal-200 border-t-teal-700 motion-reduce:animate-none"/>
      <p>{searching?'Finding your location...':'Retrieving restroom locations...'}</p>
    </div>
  </div>}
</div>
<p className="mt-2 text-xs text-slate-500">Map provided by OpenFreeMap using OpenStreetMap data. Restroom availability and cleanliness are not verified live.</p></div>
<section className={`panel min-w-0 lg:order-3 ${hasResults||error||warning?'order-0':'order-3'}`}>
<div className="flex items-center justify-between gap-2">
<h2 className="text-xl font-bold">Nearby restrooms{hasResults&&<span className="lg:hidden"> ({shown.length})</span>}</h2>
{hasResults&&shown.length>1&&<div className="flex gap-1 lg:hidden">
  <button type="button" aria-label="Previous restrooms" aria-controls="nearby-restroom-list" className="pill" onClick={()=>resultsList.current?.scrollBy({left:-resultsList.current.clientWidth,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})}><ChevronLeft size={18}/></button>
  <button type="button" aria-label="Next restrooms" aria-controls="nearby-restroom-list" className="pill" onClick={()=>resultsList.current?.scrollBy({left:resultsList.current.clientWidth,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})}><ChevronRight size={18}/></button>
</div>}
</div>
<p className="mb-4 text-sm text-slate-500">Includes imported gas stations. Restroom availability may be unconfirmed.</p>
{warning&&<div role="alert" className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p>{warning}</p><button className="mt-2 font-semibold underline" onClick={()=>setCenter(c=>[...c])}>Retry loading all places</button></div>}
{busy&&<div role="status" aria-live="polite" className="flex items-center gap-3 rounded-xl bg-teal-50 p-4 text-sm text-teal-900">
  <span aria-hidden="true" className="h-6 w-6 shrink-0 animate-spin rounded-full border-[3px] border-teal-200 border-t-teal-700 motion-reduce:animate-none"/>
  <p>Retrieving nearby locations. This may take a few seconds.</p>
</div>}
{error&&<div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p>{error}</p>{hasSearchOrigin&&<button className="mt-2 font-semibold underline" onClick={()=>setCenter(c=>[...c])}>Retry loading</button>}</div>}{!hasSearchOrigin&&!error&&<p>Search a US city, address, or ZIP code, or choose Use my location to find nearby restrooms.</p>}{hasSearchOrigin&&!busy&&!error&&!shown.length&&<p>No matching mapped restrooms found in this area. Try another filter or city.</p>}
<div ref={resultsList} id="nearby-restroom-list" aria-label="Nearby restroom results" role="region" aria-busy={busy} className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 lg:block lg:max-h-[420px] lg:space-y-3 lg:overflow-y-auto lg:overflow-x-hidden">
{shown.map(x=><div key={`${x.osm_type}-${x.id}`} className="w-[85%] shrink-0 snap-start rounded-xl border border-slate-200 p-3 text-left hover:border-teal-600 lg:w-full"><button onClick={()=>{setSelected(x);mapRef.current?.focus([x.lon,x.lat],16)}} className="w-full text-left" aria-label={`View details for ${x.name}`}><div className="flex items-center gap-2 font-bold"><MapPin size={17} className="text-teal-700"/>{x.name}</div><p className="mt-1 text-xs font-semibold text-amber-800">{restroomLabel(x)}</p>{x.distanceMiles!==undefined&&<p className="mt-1 text-xs font-semibold text-teal-700">{formatDistance(x.distanceMiles)} from search location (straight-line)</p>}<p className="mt-1 text-xs text-slate-500">Availability: Unverified</p><p className="mt-1 text-xs text-slate-500">{x.wheelchair==='yes'?'♿ Wheelchair accessible · ':''}{x.fee==='no'?'Free · ':''}{x.opening_hours||'Hours not listed'}</p></button><NavigationLinks latitude={x.lat} longitude={x.lon} name={x.name}/>
{currentLocationActive&&<button type="button" aria-label={`Add review for ${x.name}`} aria-haspopup="dialog" onClick={()=>{setSelected(x);setReviewRestroom(x)}} className="mt-3 rounded-xl bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-700">Add review</button>}
<LatestReview restroom={x}/>
</div>)}</div></section></div>
{selected&&<RestroomDetails key={`details-${selected.osm_type}-${selected.id}`} restroom={selected} onClose={()=>setSelected(null)} onAddReview={currentLocationActive?()=>setReviewRestroom(selected):undefined}/>}
{reviewRestroom&&<ContributionStart key={`review-${reviewRestroom.osm_type}-${reviewRestroom.id}`} title="Add a review" name={reviewRestroom.name} context={{kind:'review',restroom:reviewRestroom,userLocation:[...location!]}} onClose={()=>setReviewRestroom(null)}/>}
{toiletCoordinates&&<ContributionStart title="Add a toilet" context={{kind:'toilet',coordinates:toiletCoordinates}} onClose={()=>setToiletCoordinates(null)}/>}
<section className="mt-8 grid gap-3 md:grid-cols-3">{[[ShieldCheck,'Transparent ratings','Show review counts, timestamps and moderation status.'],[Accessibility,'Accessible search','Filter by documented wheelchair access and facilities.'],[Clock3,'Honest availability','Never mistake listed opening hours for live availability.']].map(([Icon,title,desc])=><div key={title as string} className="panel"><Icon className="mb-3 text-teal-700"/><h3 className="font-bold">{title as string}</h3><p className="mt-1 text-sm text-slate-500">{desc as string}</p></div>)}</section></main>}
