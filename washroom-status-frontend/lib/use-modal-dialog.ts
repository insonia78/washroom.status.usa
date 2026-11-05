'use client';
import {useEffect,useRef} from 'react';

const openDialogs=new Set<HTMLDialogElement>();
let originalOverflow='';

export function useModalDialog(){
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const element=dialog.current;
    if(!element)return;
    const trigger=document.activeElement;
    if(!element.open)element.showModal();
    if(openDialogs.size===0)originalOverflow=document.body.style.overflow;
    openDialogs.add(element);
    document.body.style.overflow='hidden';
    return()=>{
      element.close();
      openDialogs.delete(element);
      if(openDialogs.size===0)document.body.style.overflow=originalOverflow;
      if(trigger instanceof HTMLElement&&trigger.isConnected)trigger.focus({preventScroll:true});
    };
  },[]);
  return dialog;
}
