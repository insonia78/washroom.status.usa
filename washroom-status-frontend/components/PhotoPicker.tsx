'use client';
import {useId,useRef,type ChangeEvent} from 'react';
import {Camera} from 'lucide-react';
import {acceptedPhotoTypes,maxPhotoInputBytes,preparePhoto} from '@/lib/photo-preparation';

type Props={
  photos:File[];
  onChange:(photos:File[])=>void;
  preparing:boolean;
  onPreparingChange:(preparing:boolean)=>void;
  disabled:boolean;
  onError:(message:string)=>void;
};

export default function PhotoPicker({photos,onChange,preparing,onPreparingChange,disabled,onError}:Props){
  const camera=useRef<HTMLInputElement>(null);
  const processing=useRef(false);
  const helpId=useId();

  async function addPhotos(event:ChangeEvent<HTMLInputElement>){
    const input=event.currentTarget;
    const selected=[...(input.files??[])];
    input.value='';
    if(!selected.length||disabled||processing.current)return;
    onError('');
    if(photos.length+selected.length>3){onError('Choose no more than 3 photos.');return}
    if(selected.some(file=>!acceptedPhotoTypes.includes(file.type)||file.size<=0||file.size>maxPhotoInputBytes)){
      onError('Choose JPEG, PNG, or WebP photos smaller than 12 MB each.');return;
    }
    processing.current=true;
    onPreparingChange(true);
    try{
      const prepared=await Promise.all(selected.map(preparePhoto));
      onChange([...photos,...prepared]);
    }catch(error){onError(error instanceof Error?error.message:'Could not prepare the photos. Try another image.')}
    finally{
      processing.current=false;
      onPreparingChange(false);
    }
  }

  const locked=disabled||preparing;
  const full=photos.length>=3;
  return <div>
    <p className="text-sm font-medium">Photos (optional, up to 3; automatically compressed for upload)</p>
    <button type="button" disabled={locked||full} onClick={()=>camera.current?.click()} aria-describedby={helpId}
      className="mt-2 inline-flex items-center gap-2 rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
      <Camera size={18} aria-hidden="true"/>Take photo
    </button>
    <input ref={camera} type="file" accept="image/*" capture="environment" disabled={locked||full} onChange={addPhotos} hidden aria-label="Take photo with camera"/>
    <p id={helpId} className="mt-1 text-xs text-slate-600">On supported phones and tablets, Take photo opens your camera. You can also upload existing photos below.</p>
    <label className="mt-3 block text-sm font-medium">Upload photos
      <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={locked||full} onChange={addPhotos}
        className="mt-1 block w-full rounded-lg border border-slate-300 p-2 text-sm"/>
    </label>
    {preparing&&<p role="status" className="mt-1 text-xs text-slate-500">Preparing photos...</p>}
    {full&&<p className="mt-1 text-xs text-slate-600">3 photos attached. Remove a photo to add another.</p>}
    {photos.length>0&&<ul className="mt-2 space-y-1 text-xs">{photos.map((photo,index)=><li key={`${photo.name}-${index}`} className="flex items-center justify-between gap-2">
      <span className="truncate">{photo.name}</span>
      <button type="button" disabled={locked} onClick={()=>onChange(photos.filter((_,photoIndex)=>photoIndex!==index))} className="shrink-0 underline">Remove</button>
    </li>)}</ul>}
  </div>;
}
