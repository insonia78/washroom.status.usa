export const maxPhotoInputBytes=12*1024*1024;
export const maxPhotoUploadBytes=1024*1024;
export const acceptedPhotoTypes=['image/jpeg','image/png','image/webp'];

export async function preparePhoto(file:File):Promise<File>{
  const bitmap=await createImageBitmap(file);
  try{
    let scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
    for(let attempt=0;attempt<6;attempt++){
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(bitmap.width*scale));
      canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      const context=canvas.getContext('2d');
      if(!context)throw new Error('Photo processing is unavailable in this browser.');
      context.drawImage(bitmap,0,0,canvas.width,canvas.height);
      const quality=Math.max(0.5,0.82-attempt*0.07);
      const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
      if(blob&&blob.size<=maxPhotoUploadBytes){
        const name=file.name.replace(/\.[^.]+$/,'')||'photo';
        return new File([blob],`${name}.jpg`,{type:'image/jpeg',lastModified:file.lastModified});
      }
      if(attempt>=2)scale*=0.8;
    }
    throw new Error('This photo could not be reduced enough to upload. Try a smaller image.');
  }finally{bitmap.close()}
}
