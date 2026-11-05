import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {maxPhotoUploadBytes,preparePhoto} from '../lib/photo-preparation.ts';

test('both questionnaires use the camera-enabled photo picker',async()=>{
  for(const name of ['ReviewModal','AddToiletModal']){
    const source=await readFile(new URL(`../components/${name}.tsx`,import.meta.url),'utf8');
    assert.match(source,/<PhotoPicker photos=\{photos\} onChange=\{setPhotos\}/);
  }
  const source=await readFile(new URL('../components/PhotoPicker.tsx',import.meta.url),'utf8');
  assert.match(source,/<input[^>]*type="file"[^>]*accept="image\/\*"[^>]*capture="environment"[^>]*onChange=\{addPhotos\}/);
  assert.match(source,/<input[^>]*type="file"[^>]*accept="image\/jpeg,image\/png,image\/webp" multiple[^>]*onChange=\{addPhotos\}/);
  assert.match(source,/type="button" disabled=\{locked\|\|full\} onClick=\{\(\)=>camera\.current\?\.click\(\)\}/);
});

test('camera photos are resized and converted to uploadable JPEG files',async t=>{
  let closed=false;
  const canvas={
    width:0,height:0,
    getContext:()=>({drawImage(){}}),
    toBlob:callback=>callback(new Blob(['compressed image'],{type:'image/jpeg'})),
  };
  const originalDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  const originalCreateImageBitmap=Object.getOwnPropertyDescriptor(globalThis,'createImageBitmap');
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>canvas}});
  Object.defineProperty(globalThis,'createImageBitmap',{configurable:true,value:async()=>({
    width:4032,height:3024,close(){closed=true},
  })});
  t.after(()=>{
    if(originalDocument)Object.defineProperty(globalThis,'document',originalDocument);
    else delete globalThis.document;
    if(originalCreateImageBitmap)Object.defineProperty(globalThis,'createImageBitmap',originalCreateImageBitmap);
    else delete globalThis.createImageBitmap;
  });
  const photo=await preparePhoto(new File(['camera image'],'camera.png',{type:'image/png',lastModified:123}));
  assert.equal(photo.type,'image/jpeg');
  assert.equal(photo.name,'camera.jpg');
  assert.equal(photo.lastModified,123);
  assert.ok(photo.size>0&&photo.size<=maxPhotoUploadBytes);
  assert.equal(canvas.width,1600);
  assert.equal(canvas.height,1200);
  assert.equal(closed,true);
});
