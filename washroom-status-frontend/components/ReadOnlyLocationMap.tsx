'use client';

import {useEffect,useRef,useState} from 'react';

export default function ReadOnlyLocationMap({latitude,longitude,label}:{latitude:number;longitude:number;label:string}){
  const containerRef=useRef<HTMLDivElement>(null);
  const [error,setError]=useState(false);

  useEffect(()=>{
    let active=true;
    let map:import('maplibre-gl').Map|undefined;
    let observer:ResizeObserver|undefined;
    import('maplibre-gl').then(({Map,Marker,setWorkerUrl})=>{
      if(!active||!containerRef.current)return;
      setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs',import.meta.url).toString());
      map=new Map({
        container:containerRef.current,
        style:'https://tiles.openfreemap.org/styles/liberty',
        center:[longitude,latitude],
        zoom:15,
        interactive:false,
        attributionControl:{compact:true},
      });
      map.getCanvas().setAttribute('tabindex','-1');
      map.getCanvas().setAttribute('aria-label',`${label}. Read-only map.`);
      map.on('error',event=>{
        console.error('Owner review map resource failed to load:',event.error);
        if(active)setError(true);
      });
      map.on('idle',()=>{
        if(active&&map?.areTilesLoaded())setError(false);
      });
      const marker=document.createElement('div');
      marker.setAttribute('role','img');
      marker.setAttribute('aria-label',label);
      marker.style.cssText='width:22px;height:22px;border-radius:50%;background:#0f766e;border:3px solid white;box-shadow:0 1px 5px #0006';
      new Marker({element:marker}).setLngLat([longitude,latitude]).addTo(map);
      observer=new ResizeObserver(()=>map?.resize());
      observer.observe(containerRef.current);
    }).catch(cause=>{
      console.error('Owner review map failed to load:',cause);
      if(active)setError(true);
    });
    return()=>{active=false;observer?.disconnect();map?.remove()};
  },[latitude,longitude,label]);

  return <section className="mt-3" aria-label="Complaint restroom location">
    <h3 className="text-sm font-semibold">Complaint location (read-only)</h3>
    <div ref={containerRef} className="mt-2 h-52 overflow-hidden rounded-xl border border-slate-200" aria-label={`Read-only map showing ${label}`}/>
    {error&&<p role="status" className="mt-2 text-sm text-slate-600">Map tiles are unavailable. Coordinates: {latitude.toFixed(5)}, {longitude.toFixed(5)}.</p>}
  </section>;
}
