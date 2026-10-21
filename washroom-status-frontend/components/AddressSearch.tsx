'use client';

import {useEffect,useRef,useState} from 'react';
import {Search} from 'lucide-react';

type Suggestion = {label:string;latitude:number;longitude:number};
type Props = {value:string;onChange:(value:string)=>void;onSelect:(suggestion:Suggestion)=>void;searching:boolean};

function isSuggestion(value:unknown):value is Suggestion {
  if(typeof value!=='object'||value===null)return false;
  return 'label' in value&&typeof value.label==='string'&&
    'latitude' in value&&typeof value.latitude==='number'&&Number.isFinite(value.latitude)&&Math.abs(value.latitude)<=90&&
    'longitude' in value&&typeof value.longitude==='number'&&Number.isFinite(value.longitude)&&Math.abs(value.longitude)<=180;
}

export default function AddressSearch({value,onChange,onSelect,searching}:Props){
  const input=useRef<HTMLInputElement>(null);
  const [open,setOpen]=useState(false);
  const [suggestions,setSuggestions]=useState<Suggestion[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [active,setActive]=useState(-1);
  const query=value.trim();
  const eligible=query.length>=3&&query.length<=200&&(!/^\d+$/.test(query)||/^\d{5}$/.test(query));

  useEffect(()=>{if(searching)setOpen(false)},[searching]);

  useEffect(()=>{
    setSuggestions([]);setActive(-1);setError('');setLoading(false);
    if(!open||!eligible||searching)return;
    const controller=new AbortController();
    setLoading(true);
    const timer=setTimeout(async()=>{
      try{
        const params=new URLSearchParams({suggest:'1',...(/^\d{5}$/.test(query)?{zip:query}:{q:query})});
        const response=await fetch(`/api/backend/geocode?${params}`,{signal:controller.signal});
        const data=await response.json();
        if(!response.ok)throw new Error(data.error||'Address suggestions are unavailable. You can still use Search.');
        if(!Array.isArray(data.suggestions)||!data.suggestions.every(isSuggestion))throw new Error('Invalid address suggestions response.');
        if(!controller.signal.aborted)setSuggestions(data.suggestions);
      }catch(error){
        if(!controller.signal.aborted)setError(error instanceof Error?error.message:'Address suggestions failed.');
      }finally{
        if(!controller.signal.aborted)setLoading(false);
      }
    },400);
    return()=>{clearTimeout(timer);controller.abort()};
  },[query,open,eligible,searching]);

  function select(suggestion:Suggestion){
    setOpen(false);setSuggestions([]);setActive(-1);
    onChange(suggestion.label);
    onSelect(suggestion);
  }

  const expanded=open&&eligible&&!searching;
  return <>
    <div className="relative min-w-52 flex-1">
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3">
        <Search size={19} aria-hidden="true"/>
        <input ref={input} role="combobox" aria-autocomplete="list" aria-expanded={expanded}
          aria-controls="address-suggestions" aria-activedescendant={expanded&&active>=0?`address-suggestion-${active}`:undefined}
          aria-label="US city, address, or ZIP code" autoComplete="off" maxLength={200}
          className="min-w-0 flex-1 py-3 outline-none" placeholder="City, address, or ZIP code" value={value}
          onFocus={()=>setOpen(true)} onBlur={()=>setOpen(false)}
          onChange={e=>{onChange(e.target.value);setSuggestions([]);setActive(-1);setOpen(true)}}
          onKeyDown={e=>{
            if(e.key==='Escape'){e.preventDefault();setOpen(false);setActive(-1)}
            if(expanded&&suggestions.length&&(e.key==='ArrowDown'||e.key==='ArrowUp')){
              e.preventDefault();setActive(index=>e.key==='ArrowDown'?(index+1)%suggestions.length:(index<=0?suggestions.length-1:index-1));
            }
            if(e.key==='Enter'&&expanded&&active>=0&&suggestions[active]){e.preventDefault();select(suggestions[active])}
          }}/>
      </div>
      {expanded&&<div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
        {loading&&<p role="status" className="p-3 text-sm text-slate-500">Finding address suggestions...</p>}
        {error&&<p role="status" className="p-3 text-sm text-amber-900">{error}</p>}
        {!loading&&!error&&!suggestions.length&&<p role="status" className="p-3 text-sm text-slate-500">No matching US addresses found.</p>}
        <ul id="address-suggestions" role="listbox" aria-label="Address suggestions">
          {suggestions.map((suggestion,index)=><li key={`${suggestion.label}-${index}`} id={`address-suggestion-${index}`}
            role="option" aria-selected={index===active} onMouseDown={e=>e.preventDefault()}
            onMouseEnter={()=>setActive(index)} onClick={()=>select(suggestion)}
            className={`cursor-pointer rounded-lg p-3 text-sm ${index===active?'bg-teal-50 text-teal-900':'hover:bg-slate-50'}`}>
            {suggestion.label}
          </li>)}
        </ul>
      </div>}
    </div>
    <button type="submit" disabled={searching} className="rounded-xl bg-teal-700 px-6 py-3 font-bold text-white disabled:opacity-50">Search</button>
    <button type="button" aria-label="Clear search" className="rounded-xl border border-slate-300 bg-white px-6 py-3 font-bold text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-teal-700"
      onClick={()=>{onChange('');setSuggestions([]);setError('');setActive(-1);input.current?.focus()}}>Clear</button>
  </>;
}
