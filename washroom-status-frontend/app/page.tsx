'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {MapPin,Accessibility,Clock3,ShieldCheck,LocateFixed,ChevronLeft,ChevronRight} from 'lucide-react';
import type {Map as MapType} from 'maplibre-gl';
import RestroomDetails, {type Restroom} from '@/components/RestroomDetails';
import AddressSearch from '@/components/AddressSearch';

export default function Home(){const [city,setCity]=useState('Philadelphia, PA');const [items,setItems]=useState<Restroom[]>([]);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [filter,setFilter]=useState('all');const [center,setCenter]=useState<[number,number]>([-75.1652,39.9526]);const [selected,setSelected]=useState<Restroom|null>(null);const [mapReady,setMapReady]=useState(false);
const [searching,setSearching]=useState(false);
const mapArea=useRef<HTMLDivElement>(null);
const focusAfterSearch=useRef(false);
const returnToMap=useCallback(()=>{
  if(!focusAfterSearch.current)return;
  focusAfterSearch.current=false;
  requestAnimationFrame(()=>{
    const map=(window as any).__washroomMap as MapType|undefined;
    map?.getCanvas().focus({preventScroll:true});
    if(window.matchMedia('(max-width: 1023px)').matches){
      mapArea.current?.scrollIntoView({block:'start',behavior:'instant'});
    }
  });
},[]);
const resultsList=useRef<HTMLDivElement>(null);
useEffect(()=>{if(resultsList.current)resultsList.current.scrollLeft=0},[center,filter]);
const [location,setLocation]=useState<[number,number]|null>(null);
const [locationError,setLocationError]=useState('');
const [zoom,setZoom]=useState(12);
const locationRequest=useRef(0);
const locate=useCallback(()=>{
  const request=++locationRequest.current;
  setLocationError('');
  if(!navigator.geolocation){setLocationError('Your browser does not support location. Search a US city or ZIP code instead.');return}
  navigator.geolocation.getCurrentPosition(position=>{
    if(request!==locationRequest.current)return;
    const {longitude,latitude}=position.coords;
    if(!Number.isFinite(longitude)||!Number.isFinite(latitude)||longitude < -179||longitude > -65||latitude < 17||latitude > 72){
      setLocationError('Your location is outside the US map. Search for a US city instead.');return;
    }
    setLocation([longitude,latitude]);setZoom(15);setCity('');setCenter([longitude,latitude]);
  },error=>{
    if(request!==locationRequest.current)return;
    setLocationError(error.code===1?'Location permission denied. Search a US city or ZIP code instead.':
      error.code===3?'Finding your location timed out. Use my location to retry or search a US city.':
      'Your location is unavailable. Use my location to retry or search a US city.');
  },{enableHighAccuracy:true,timeout:10000,maximumAge:60000});
},[]);
useEffect(()=>{locate();return()=>{locationRequest.current++}},[locate]);
useEffect(()=>{let map:MapType|undefined;let markers:any[]=[];let alive=true;(async()=>{const lib=await import('maplibre-gl');if(!alive)return;map=new lib.Map({container:'restroom-map',style:{version:8,sources:{osm:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'}},layers:[{id:'osm',type:'raster',source:'osm'}]},center,zoom:12,minZoom:3,maxZoom:19});map.addControl(new lib.NavigationControl(),'top-right');map.on('load',()=>{if(alive)setMapReady(true)});map.on('error',e=>console.error('MapLibre error:',e.error));// Shade every area outside the US. The mask is derived from actual US
// boundaries, including Alaska and Hawaii, instead of rectangular bounds.
// If the boundary service fails, the map remains usable without the mask.
map.on('load', async () => {
try {
  const response = await fetch('/api/backend/map-boundary');
  if (!response.ok) throw new Error('US boundary unavailable');
  const usa = await response.json();
  if (!alive || !map) return;
  const geometries = usa.geometry.type === 'MultiPolygon' ? usa.geometry.coordinates : [usa.geometry.coordinates];
  const holes = geometries.map((polygon: number[][][]) => polygon[0]);
  const mask = {type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[
    [[-180,-85],[180,-85],[180,85],[-180,85],[-180,-85]],
    ...holes
  ]}};
  map.addSource('outside-usa-mask',{type:'geojson',data:mask as any});
  map.addLayer({id:'outside-usa-shade',type:'fill',source:'outside-usa-mask',paint:{'fill-color':'#64748b','fill-opacity':0.62}});
} catch (err) { console.warn('US boundary overlay could not load:',err); }
});
(window as any).__washroomMap=map;})();return()=>{alive=false;setMapReady(false);markers.forEach(m=>m.remove());map?.remove();(window as any).__washroomMap=undefined}},[]);
useEffect(()=>{const map=(window as any).__washroomMap as MapType|undefined;if(!map||!mapReady)return;map.flyTo({center,zoom});},[center,zoom,mapReady]);
useEffect(()=>{
  if(!location||!mapReady)return;
  let cancelled=false;
  let marker:import('maplibre-gl').Marker|undefined;
  (async()=>{
    const lib=await import('maplibre-gl');
    const map=(window as any).__washroomMap as MapType|undefined;
    if(cancelled||!map)return;
    const point=document.createElement('div');
    point.setAttribute('role','img');point.setAttribute('aria-label','Your current location');
    point.style.cssText='width:18px;height:18px;border-radius:50%;background:#2563eb;border:3px solid white;box-shadow:0 0 0 5px #2563eb33';
    marker=new lib.Marker({element:point}).setLngLat(location).addTo(map);
  })();
  return()=>{cancelled=true;marker?.remove()};
},[location,mapReady]);
useEffect(()=>{let cancelled=false;setBusy(true);setError('');setItems([]);setSelected(null);const controller=new AbortController();fetch(`/api/restrooms?lat=${center[1]}&lon=${center[0]}`,{signal:controller.signal}).then(r=>{if(!r.ok)return r.json().then(d=>{throw new Error(d.error||'Restroom source is unavailable. Please retry.')});return r.json()}).then(d=>{if(!cancelled)setItems(d.restrooms||[])}).catch(e=>{if(!cancelled&&e.name!=='AbortError')setError(e.message)}).finally(()=>{if(!cancelled){setBusy(false);returnToMap()}});return()=>{cancelled=true;controller.abort()}},[center,returnToMap]);
useEffect(()=>{let markers:any[]=[];let cancelled=false;(async()=>{const lib=await import('maplibre-gl');const map=(window as any).__washroomMap as MapType|undefined;if(!map||cancelled||!mapReady)return;items.filter(x=>filter==='all'||(filter==='accessible'&&x.wheelchair==='yes')||(filter==='free'&&x.fee==='no')||(filter==='always'&&x.opening_hours==='24/7')).forEach(x=>{const el=document.createElement('button');el.textContent='🚻';el.setAttribute('aria-label',`View ${x.name}`);el.style.cssText='background:white;border:2px solid #0d9488;border-radius:50%;width:36px;height:36px;cursor:pointer';el.onclick=()=>setSelected(x);markers.push(new lib.Marker({element:el}).setLngLat([x.lon,x.lat]).addTo(map))})})();return()=>{cancelled=true;markers.forEach(m=>m.remove())}},[items,filter,mapReady]);
async function search(e:React.FormEvent){
  e.preventDefault();
  if(searching)return;
  focusAfterSearch.current=false;
  locationRequest.current++;
  setLocationError('');
  setZoom(12);
  setSearching(true);
  setError('');
  const query=city.trim();
  try{
    if(/^\d+$/.test(query)){
      if(!/^\d{5}$/.test(query))throw new Error('Enter a five-digit US ZIP code.');
      const response=await fetch(`/api/backend/geocode?zip=${encodeURIComponent(query)}`);
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||'ZIP code lookup failed.');
      const origin=result;
      if(!origin||!Number.isFinite(origin.latitude)||!Number.isFinite(origin.longitude))throw new Error('ZIP code lookup returned invalid coordinates.');
      focusAfterSearch.current=true;
      setCenter([origin.longitude,origin.latitude]);
      return;
    }
    const r=await fetch(`/api/backend/geocode?q=${encodeURIComponent(query)}`);
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||'City or address lookup failed. Please retry.');
    if(!Number.isFinite(d.latitude)||!Number.isFinite(d.longitude))throw new Error('City or address lookup returned invalid coordinates.');
    focusAfterSearch.current=true;
    setCenter([d.longitude,d.latitude]);
  }catch(e){setError(e instanceof Error?e.message:'Search failed');focusAfterSearch.current=true;returnToMap()}
  finally{setSearching(false)}
}
const shown=items.filter(x=>filter==='all'||(filter==='accessible'&&x.wheelchair==='yes')||(filter==='free'&&x.fee==='no')||(filter==='always'&&x.opening_hours==='24/7'));
const hasResults=!busy&&!error&&shown.length>0;
return <main className="mx-auto max-w-6xl px-4 py-7"><header className="mb-9 flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><span className="rounded-2xl bg-teal-700 p-3 text-2xl text-white">🚻</span><div><h1 className="text-2xl font-black tracking-tight">Washroom Status USA</h1><p className="text-sm text-slate-500">Find clean restrooms. Travel confidently.</p></div></div><a className="rounded-full bg-teal-700 px-5 py-3 font-bold text-white" href="mailto:washroom.status.usa@gmail.com">Contact us</a></header>
<div ref={mapArea} className="grid gap-5 lg:grid-cols-[1.45fr_1fr]">
{locationError&&<p role="alert" className="order-0 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 lg:order-4 lg:col-span-2">{locationError}</p>}
<section className="panel relative z-20 order-2 lg:order-1 lg:col-span-2"><h2 className="mb-3 text-xl font-bold">Find a public restroom</h2><form onSubmit={search} className="flex flex-wrap gap-2">
<AddressSearch value={city} onChange={setCity} searching={searching} onSelect={suggestion=>{focusAfterSearch.current=true;locationRequest.current++;setLocationError('');setError('');setZoom(12);setCenter([suggestion.longitude,suggestion.latitude])}}/>
<button type="button" onClick={locate} className="pill" aria-label="Use my location"><LocateFixed/></button></form><div className="mt-4 flex flex-wrap gap-2">{[['all','All restrooms'],['accessible','♿ Accessible'],['free','Free'],['always','24/7']].map(([id,label])=><button key={id} className="pill text-sm" aria-pressed={filter===id} onClick={()=>setFilter(id)}>{label}</button>)}</div></section>
<div className="order-1 min-w-0 lg:order-2">
<div className="relative isolate" aria-busy={searching||busy}>
  <div id="restroom-map" className="h-[420px] w-full rounded-2xl border border-slate-200 bg-slate-100" aria-label="Interactive restroom map"/>
  {(searching||busy)&&<div role="status" aria-live="polite" aria-label="Map search progress" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-white/40">
    <div className="flex max-w-[85%] items-center gap-3 rounded-xl bg-white p-4 text-sm font-semibold text-teal-900 shadow-lg">
      <span aria-hidden="true" className="h-8 w-8 shrink-0 animate-spin rounded-full border-4 border-teal-200 border-t-teal-700 motion-reduce:animate-none"/>
      <p>{searching?'Finding your location...':'Retrieving restroom locations...'}</p>
    </div>
  </div>}
</div>
<p className="mt-2 text-xs text-slate-500">Map data and tiles © OpenStreetMap contributors. Availability and cleanliness are not verified live.</p></div>
<section className={`panel min-w-0 lg:order-3 ${hasResults||error?'order-0':'order-3'}`}>
<div className="flex items-center justify-between gap-2">
<h2 className="text-xl font-bold">Nearby restrooms{hasResults&&<span className="lg:hidden"> ({shown.length})</span>}</h2>
{hasResults&&shown.length>1&&<div className="flex gap-1 lg:hidden">
  <button type="button" aria-label="Previous restrooms" aria-controls="nearby-restroom-list" className="pill" onClick={()=>resultsList.current?.scrollBy({left:-resultsList.current.clientWidth,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})}><ChevronLeft size={18}/></button>
  <button type="button" aria-label="Next restrooms" aria-controls="nearby-restroom-list" className="pill" onClick={()=>resultsList.current?.scrollBy({left:resultsList.current.clientWidth,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})}><ChevronRight size={18}/></button>
</div>}
</div>
<p className="mb-4 text-sm text-slate-500">OpenStreetMap locations · no fabricated ratings</p>
{busy&&<div role="status" aria-live="polite" className="flex items-center gap-3 rounded-xl bg-teal-50 p-4 text-sm text-teal-900">
  <span aria-hidden="true" className="h-6 w-6 shrink-0 animate-spin rounded-full border-[3px] border-teal-200 border-t-teal-700 motion-reduce:animate-none"/>
  <p>Retrieving restroom locations. Checking OpenStreetMap / Overpass may take a few seconds.</p>
</div>}
{error&&<div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p>{error}</p><button className="mt-2 font-semibold underline" onClick={()=>setCenter(c=>[c[0]+0.000001,c[1]])}>Retry loading</button></div>}{!busy&&!error&&!shown.length&&<p>No matching mapped restrooms found in this area. Try another filter or city.</p>}
<div ref={resultsList} id="nearby-restroom-list" aria-label="Nearby restroom results" role="region" aria-busy={busy} className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 lg:block lg:max-h-[420px] lg:space-y-3 lg:overflow-y-auto lg:overflow-x-hidden">
{shown.map(x=><button key={`${x.osm_type}-${x.id}`} onClick={()=>{setSelected(x);(window as any).__washroomMap?.flyTo({center:[x.lon,x.lat],zoom:16})}} className="w-[85%] shrink-0 snap-start rounded-xl border border-slate-200 p-3 text-left hover:border-teal-600 lg:w-full"><div className="flex items-center gap-2 font-bold"><MapPin size={17} className="text-teal-700"/>{x.name}</div><p className="mt-1 text-xs text-slate-500">Cleanliness: Not yet rated · Availability: Unverified</p><p className="mt-1 text-xs text-slate-500">{x.wheelchair==='yes'?'♿ Wheelchair accessible · ':''}{x.fee==='no'?'Free · ':''}{x.opening_hours||'Hours not listed'}</p></button>)}</div></section></div>{selected&&<RestroomDetails key={`${selected.osm_type}-${selected.id}`} restroom={selected} onClose={()=>setSelected(null)}/>}<section className="mt-8 grid gap-3 md:grid-cols-3">{[[ShieldCheck,'Transparent ratings','Show review counts, timestamps and moderation status.'],[Accessibility,'Accessible search','Filter by documented wheelchair access and facilities.'],[Clock3,'Honest availability','Never mistake listed opening hours for live availability.']].map(([Icon,title,desc])=><div key={title as string} className="panel"><Icon className="mb-3 text-teal-700"/><h3 className="font-bold">{title as string}</h3><p className="mt-1 text-sm text-slate-500">{desc as string}</p></div>)}</section></main>}
